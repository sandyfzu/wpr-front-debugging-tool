/**
 * The page's script reader: the devtools `inspectedWindow.getResources` API
 * adapted into the asset loader the definition search runs over.
 *
 * Everything the platform hands back is treated as untrusted: the resource
 * list and each resource's fields are shape-checked before use, every
 * callback reads `runtime.lastError` (left unread it becomes a console
 * error), and base64-encoded content is decoded instead of searched as
 * gibberish. Browsers without the API (Firefox's devtools expose no resource
 * listing) get `null` from {@link realScriptLoader}, and the page says the
 * search cannot run there.
 */
import { createLogger } from '../../../../lib/logger';
import {
  loadScriptAssets,
  type InlineScriptSource,
  type InspectedScriptResource,
  type ScriptAsset
} from '../../../../lib/panel/undefined-refs';

const log = createLogger('panel');

/** Read the page's scripts (external files + the inline stack) into searchable assets. */
export type ScriptLoader = (inlineScripts: readonly InlineScriptSource[]) => Promise<ScriptAsset[]>;

/** The platform calls the loader needs — injected so the adapter is unit-testable. */
export interface ScriptLoaderDeps {
  /** `inspectedWindow.getResources` in callback form (the manifest's Chrome floor predates its promise form). */
  getResources: (onResources: (resources: unknown) => void) => void;
  /** Read (and so clear) `runtime.lastError`; its message, or `null` when unset. */
  readLastError: () => string | null;
}

/** The resource list could not be read; the message names the platform's reason. */
export class ScriptListError extends Error {
  /** @param message What failed (platform `lastError` text or a shape violation). */
  constructor(message: string) {
    super(message);
    this.name = 'ScriptListError';
  }
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

/**
 * Adapt one platform resource, or drop it when its shape is wrong (no string
 * URL, no `getContent` function). The adapted `getContent` reads
 * `lastError` and decodes; a failed read hands `null` on.
 *
 * @param raw One entry of the platform's list.
 * @param readLastError The `lastError` reader.
 * @returns The adapted resource, or `null`.
 */
function adaptResource(
  raw: unknown,
  readLastError: () => string | null
): InspectedScriptResource | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const resource = raw as RawResource;
  const { url, type, getContent } = resource;
  if (typeof url !== 'string' || typeof getContent !== 'function') return null;
  return {
    url,
    type: typeof type === 'string' ? type : undefined,
    getContent(onContent) {
      // Called as a method of the platform object it came from.
      (getContent as (callback: (content: unknown, encoding: unknown) => void) => void).call(
        resource,
        (content, encoding) => {
          const failure = readLastError();
          if (failure !== null) {
            log.debug('A script resource could not be read; it is skipped', { url, failure });
            onContent(null);
            return;
          }
          onContent(decodeResourceContent(content, encoding));
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
 * runs it inside its promise). Per-resource failures only drop that resource.
 *
 * @param deps The platform calls.
 * @returns The loader.
 */
export function createScriptLoader(deps: ScriptLoaderDeps): ScriptLoader {
  return (inlineScripts) =>
    new Promise<ScriptAsset[]>((resolve, reject) => {
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
                const resource = adaptResource(raw, deps.readLastError);
                if (resource !== null) adapted.push(resource);
              }
              onComplete(adapted);
            });
          }
        },
        inlineScripts
      ).then(resolve, reject);
    });
}

/** The devtools namespace as this context may or may not have it (probed, never assumed). */
interface DevtoolsResourcesShape {
  readonly devtools?: {
    readonly inspectedWindow?: { readonly getResources?: unknown };
  };
  readonly runtime?: { readonly lastError?: { readonly message?: string } | null };
}

/**
 * The real loader, when this browser can list the inspected page's
 * resources.
 *
 * @returns The loader, or `null` without `devtools.inspectedWindow.getResources`.
 */
export function realScriptLoader(): ScriptLoader | null {
  const api = browser as unknown as DevtoolsResourcesShape;
  const inspectedWindow = api.devtools?.inspectedWindow;
  const getResources = inspectedWindow?.getResources;
  if (typeof getResources !== 'function') return null;
  return createScriptLoader({
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
    }
  });
}
