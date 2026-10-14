/**
 * The page's script reader: the devtools `inspectedWindow` API adapted into
 * what the page needs — the asset loader the definition search runs over,
 * the inspected page's origin, and a watch for scripts added after a read.
 *
 * Everything the platform hands back is treated as untrusted: the resource
 * list and each resource's fields are shape-checked before use, every
 * callback reads `runtime.lastError` (left unread it becomes a console
 * error), base64-encoded content is decoded instead of searched as
 * gibberish, and a resource whose content never arrives is skipped after a
 * timeout instead of stalling the whole read. Browsers without a resource
 * listing (Firefox's devtools expose none) get `null` from
 * {@link realInspectedScripts}, and the page says the search cannot run there.
 */
import { createLogger } from '../../../../lib/logger';
import {
  loadScriptAssets,
  type InlineScriptSource,
  type InspectedScriptResource,
  type ScriptAsset
} from '../../../../lib/panel/undefined-refs';
import { isHttpUrl } from '../../../../utils/urls';

const log = createLogger('panel');

/**
 * How long one resource's content may take (ms). DevTools answers in
 * milliseconds; a resource that never answers is skipped so the others
 * still get searched.
 */
export const CONTENT_TIMEOUT_MS = 5_000;

/** One read of the page's scripts. */
export interface ScriptRead {
  /** The searchable sources (external files + the inline stack). */
  readonly assets: ScriptAsset[];
  /**
   * Script files the read had to skip — content unreadable (`lastError`),
   * empty, undecodable, or not answered in time. The search cannot see
   * them, so the page says so instead of a confident "not found".
   */
  readonly unreadable: number;
}

/** Read the page's scripts into searchable assets. */
export type ScriptLoader = (inlineScripts: readonly InlineScriptSource[]) => Promise<ScriptRead>;

/** Everything the page reads from the inspected window. */
export interface InspectedScripts {
  /** Read the scripts. */
  readonly load: ScriptLoader;
  /** The inspected page's origin (`https://example.com`), or `null` when unreadable. */
  readonly readPageOrigin: () => Promise<string | null>;
  /**
   * Watch for http(s) scripts the page loads after a read.
   *
   * @param onAdded Called with each added script's URL.
   * @returns The unsubscribe (a no-op where the browser has no such event).
   */
  readonly watchAddedScripts: (onAdded: (url: string) => void) => () => void;
}

/** The platform calls the loader needs — injected so the adapter is unit-testable. */
export interface ScriptLoaderDeps {
  /** `inspectedWindow.getResources` in callback form (the manifest's Chrome floor predates its promise form). */
  getResources: (onResources: (resources: unknown) => void) => void;
  /** Read (and so clear) `runtime.lastError`; its message, or `null` when unset. */
  readLastError: () => string | null;
  /** Arm a one-shot timer; returns its cancel. Default `setTimeout`. */
  schedule?: (run: () => void, ms: number) => () => void;
  /** The per-resource content timeout (default {@link CONTENT_TIMEOUT_MS}). */
  contentTimeoutMs?: number;
}

/** The resource list could not be read; the message names the platform's reason. */
export class ScriptListError extends Error {
  /** @param message What failed (platform `lastError` text or a shape violation). */
  constructor(message: string) {
    super(message);
    this.name = 'ScriptListError';
  }
}

/** The default timer seam. */
function defaultSchedule(run: () => void, ms: number): () => void {
  const handle = setTimeout(run, ms);
  return () => {
    clearTimeout(handle);
  };
}

/**
 * Decode one resource's content as text. DevTools reports an `encoding`
 * beside the content: empty for text, `base64` for encoded bodies. Anything
 * else (or undecodable base64) yields `null` — the resource then contributes
 * nothing rather than garbage.
 *
 * @param content The content value the platform passed.
 * @param encoding The encoding value the platform passed.
 * @returns The text, or `null`.
 */
export function decodeResourceContent(content: unknown, encoding: unknown): string | null {
  if (typeof content !== 'string') return null;
  if (encoding === undefined || encoding === null || encoding === '') return content;
  if (encoding !== 'base64') return null;
  try {
    const binary = atob(content);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    // Malformed base64: the resource is unreadable, which the caller records as "nothing".
    return null;
  }
}

/** The fields this adapter reads off one platform resource. */
interface RawResource {
  readonly url?: unknown;
  readonly type?: unknown;
  readonly getContent?: unknown;
}

/** The context an adapted resource reads its content with. */
interface ContentContext {
  readonly readLastError: () => string | null;
  readonly schedule: (run: () => void, ms: number) => () => void;
  readonly timeoutMs: number;
  /** Count one skipped resource (this read's tally). */
  readonly skipped: () => void;
}

/**
 * Adapt one platform resource, or drop it when its shape is wrong (no string
 * URL, no `getContent` function). The adapted `getContent` answers exactly
 * once: the decoded content, or `null` — counted as skipped — on a
 * `lastError`, an empty or undecodable body, or after the timeout (a late
 * answer is then ignored).
 *
 * @param raw One entry of the platform's list.
 * @param context The `lastError` reader and the timeout.
 * @returns The adapted resource, or `null`.
 */
function adaptResource(raw: unknown, context: ContentContext): InspectedScriptResource | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const resource = raw as RawResource;
  const { url, type, getContent } = resource;
  if (typeof url !== 'string' || typeof getContent !== 'function') return null;
  return {
    url,
    type: typeof type === 'string' ? type : undefined,
    getContent(onContent) {
      let answered = false;
      let cancelTimeout = (): void => undefined;
      const answer = (content: string | null): void => {
        if (answered) return;
        answered = true;
        cancelTimeout();
        if (content === null || content === '') {
          context.skipped();
          onContent(null);
          return;
        }
        onContent(content);
      };
      cancelTimeout = context.schedule(() => {
        log.debug('A script resource did not answer in time; it is skipped', { url });
        answer(null);
      }, context.timeoutMs);
      // Called as a method of the platform object it came from.
      (getContent as (callback: (content: unknown, encoding: unknown) => void) => void).call(
        resource,
        (content, encoding) => {
          const failure = context.readLastError();
          if (failure !== null) {
            log.debug('A script resource could not be read; it is skipped', { url, failure });
            answer(null);
            return;
          }
          answer(decodeResourceContent(content, encoding));
        }
      );
    }
  };
}

/**
 * Build the loader over injected platform calls.
 *
 * The listing callback is the one point that can fail as a whole: a
 * `lastError` or a non-list answer rejects with {@link ScriptListError}. A
 * synchronous throw from the platform call rejects too (the shared loader
 * runs it inside its promise). Per-resource failures only drop that resource
 * and are counted in the result's `unreadable`.
 *
 * @param deps The platform calls.
 * @returns The loader.
 */
export function createScriptLoader(deps: ScriptLoaderDeps): ScriptLoader {
  return (inlineScripts) =>
    new Promise<ScriptRead>((resolve, reject) => {
      // One tally per read: the resources this read had to skip.
      let unreadable = 0;
      const context: ContentContext = {
        readLastError: deps.readLastError,
        schedule: deps.schedule ?? defaultSchedule,
        timeoutMs: deps.contentTimeoutMs ?? CONTENT_TIMEOUT_MS,
        skipped: () => {
          unreadable += 1;
        }
      };
      loadScriptAssets(
        {
          getResources(onComplete) {
            deps.getResources((resources) => {
              const failure = deps.readLastError();
              if (failure !== null) {
                reject(new ScriptListError(failure));
                return;
              }
              if (!Array.isArray(resources)) {
                reject(new ScriptListError('The resource listing was not a list.'));
                return;
              }
              const adapted: InspectedScriptResource[] = [];
              for (const raw of resources) {
                const resource = adaptResource(raw, context);
                if (resource !== null) adapted.push(resource);
              }
              onComplete(adapted);
            });
          }
        },
        inlineScripts
      ).then((assets) => {
        resolve({ assets, unreadable });
      }, reject);
    });
}

/**
 * Validate an origin string read from the page: it must be exactly the
 * origin of an http(s) URL (the page's world answers this; never trusted).
 *
 * @param value The evaluated value.
 * @returns The origin, or `null`.
 */
export function parsePageOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !isHttpUrl(value)) return null;
  try {
    return new URL(value).origin === value ? value : null;
  } catch {
    // isHttpUrl parsed it already; an exotic value that fails here is not an origin.
    return null;
  }
}

/** The eval callback's exception shape as this adapter reads it. */
interface EvalExceptionShape {
  readonly isError?: unknown;
  readonly isException?: unknown;
}

/** The platform calls behind {@link createInspectedScripts}. */
export interface InspectedWindowDeps extends ScriptLoaderDeps {
  /** `inspectedWindow.eval` in callback form. */
  evaluate: (expression: string, onResult: (result: unknown, exception: unknown) => void) => void;
  /** `inspectedWindow.onResourceAdded.addListener`/`removeListener`, when the browser has them. */
  onResourceAdded?: {
    add: (listener: (resource: unknown) => void) => void;
    remove: (listener: (resource: unknown) => void) => void;
  };
}

/**
 * Build the page's inspected-window reader over injected platform calls.
 *
 * @param deps The platform calls.
 * @returns The reader.
 */
export function createInspectedScripts(deps: InspectedWindowDeps): InspectedScripts {
  return {
    load: createScriptLoader(deps),
    readPageOrigin: () =>
      new Promise<string | null>((resolve) => {
        try {
          deps.evaluate('location.origin', (result, exception) => {
            const failure = deps.readLastError();
            const thrown = exception as EvalExceptionShape | null | undefined;
            if (failure !== null || thrown?.isError === true || thrown?.isException === true) {
              log.debug('The inspected page origin could not be read', { failure });
              resolve(null);
              return;
            }
            resolve(parsePageOrigin(result));
          });
        } catch (cause) {
          log.debug('The inspected page origin could not be read', cause);
          resolve(null);
        }
      }),
    watchAddedScripts: (onAdded) => {
      const events = deps.onResourceAdded;
      if (events === undefined) return () => undefined;
      const listener = (resource: unknown): void => {
        // One failing delivery must not break sibling listeners.
        try {
          if (typeof resource !== 'object' || resource === null) return;
          const { url, type } = resource as RawResource;
          if (type === 'script' && typeof url === 'string' && isHttpUrl(url)) onAdded(url);
        } catch (cause) {
          log.warn('Handling an added script failed', cause);
        }
      };
      try {
        events.add(listener);
      } catch (cause) {
        log.debug('Watching added scripts is unavailable', cause);
        return () => undefined;
      }
      return () => {
        try {
          events.remove(listener);
        } catch (cause) {
          log.debug('Removing the added-scripts watch failed', cause);
        }
      };
    }
  };
}

/** A devtools event as this context may expose it. */
interface EventShape {
  readonly addListener?: unknown;
  readonly removeListener?: unknown;
}

/** The devtools namespace as this context may or may not have it (probed, never assumed). */
interface DevtoolsShape {
  readonly devtools?: {
    readonly inspectedWindow?: {
      readonly getResources?: unknown;
      readonly eval?: unknown;
      readonly onResourceAdded?: EventShape;
    };
  };
  readonly runtime?: { readonly lastError?: { readonly message?: string } | null };
}

/**
 * The real reader, when this browser can list the inspected page's resources.
 *
 * @returns The reader, or `null` without `devtools.inspectedWindow.getResources`.
 */
export function realInspectedScripts(): InspectedScripts | null {
  const api = browser as unknown as DevtoolsShape;
  const inspectedWindow = api.devtools?.inspectedWindow;
  const getResources = inspectedWindow?.getResources;
  if (inspectedWindow === undefined || typeof getResources !== 'function') return null;
  const evaluate = inspectedWindow.eval;
  const added = inspectedWindow.onResourceAdded;
  const addListener = added?.addListener;
  const removeListener = added?.removeListener;
  return createInspectedScripts({
    getResources: (onResources) => {
      (getResources as (callback: (resources: unknown) => void) => void).call(
        inspectedWindow,
        onResources
      );
    },
    readLastError: () => {
      const lastError = api.runtime?.lastError;
      if (lastError === undefined || lastError === null) return null;
      return lastError.message ?? 'Unknown error';
    },
    evaluate: (expression, onResult) => {
      if (typeof evaluate !== 'function') {
        onResult(undefined, { isError: true });
        return;
      }
      (evaluate as (code: string, callback: (r: unknown, e: unknown) => void) => void).call(
        inspectedWindow,
        expression,
        onResult
      );
    },
    onResourceAdded:
      typeof addListener === 'function' && typeof removeListener === 'function'
        ? {
            add: (listener) => {
              (addListener as (l: (r: unknown) => void) => void).call(added, listener);
            },
            remove: (listener) => {
              (removeListener as (l: (r: unknown) => void) => void).call(added, listener);
            }
          }
        : undefined
  });
}
