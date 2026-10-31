/**
 * Simulated-runtime delivery for a `webRequest`-redirecting browser: a
 * blocking request hook sees the script requests named like a simulated
 * runtime and redirects the one the host names to its packaged
 * web-accessible copy (the site never receives it; the page's CSP still
 * judges the URL the page asked for). Everything else — other frames,
 * other URLs, other pages, any fault — is left to the site unchanged. The
 * hook never rejects.
 *
 * The hook is held per tab, only while the tab's live session simulates a
 * feature with a runtime ({@link withRuntimeHooks}): one listener per such
 * tab, filtered to it (a request filter names at most one tab), so no
 * other tab's requests ever reach it — a blocking hook delays every
 * request it sees.
 */
import type { Logger } from '../logger';
import { isRecord } from '../../utils/is-record';
import { LAZYLOAD_RUNTIME_FILE } from '../wp-rocket-simulation/simulation-data';
import type { SimulatedFeatureId, SimulateSpec } from '../wp-rocket-simulation/spec';
import type { ArmResult, InterceptionBackend, InterceptionHost } from './backend';

/** The hook's answer: a redirect, or nothing (the request goes on as made). */
export type RuntimeRedirectAnswer = { readonly redirectUrl: string } | Record<string, never>;

/** The request facts the hook reads (validated: the details are untrusted). */
interface RuntimeRequest {
  readonly tabId: number;
  readonly frameId: number;
  readonly url: string;
  /** The requesting document's URL. */
  readonly documentUrl: string;
}

/** What the hook needs. */
export interface RuntimeRedirectDeps {
  readonly host: Pick<InterceptionHost, 'simulatedRuntime'>;
  readonly log: Pick<Logger, 'error'>;
}

/** The answer that leaves a request alone. */
const LEAVE: RuntimeRedirectAnswer = {};

/**
 * The hook's URL filter: script requests named like a simulated runtime on
 * every host the extension may act on (no port: a match pattern without
 * one matches any port).
 *
 * @param hostPatterns The extension's host match patterns, each `<scheme>://*\/*`.
 * @throws {@link Error} naming a pattern not of that form.
 */
export function runtimeRequestPatterns(hostPatterns: readonly string[]): string[] {
  return hostPatterns.map((pattern) => {
    if (!/^[a-z]+:\/\/\*\/\*$/.test(pattern)) {
      throw new Error(`Host pattern not of the form <scheme>://*/*: ${pattern}`);
    }
    return `${pattern}/${LAZYLOAD_RUNTIME_FILE}`;
  });
}

/**
 * The request facts, or null when the details lack one.
 *
 * @param details The hook's details (untrusted).
 */
function parseRuntimeRequest(details: unknown): RuntimeRequest | null {
  if (!isRecord(details)) return null;
  const { tabId, frameId, url, documentUrl } = details;
  return typeof tabId === 'number' &&
    typeof frameId === 'number' &&
    typeof url === 'string' &&
    typeof documentUrl === 'string'
    ? { tabId, frameId, url, documentUrl }
    : null;
}

/**
 * Create the blocking hook body.
 *
 * @param deps The host and the logger.
 * @returns The hook: resolves to a redirect to the packaged file the host
 *   names for a top-frame request of a tab, or to nothing.
 */
export function createRuntimeRedirect(
  deps: RuntimeRedirectDeps
): (details: unknown) => Promise<RuntimeRedirectAnswer> {
  return async (details) => {
    const request = parseRuntimeRequest(details);
    // Not a tab's top-level page (a sub-frame, a tab-less request, no
    // requesting document): never simulated.
    if (request === null || request.tabId < 0 || request.frameId !== 0) return LEAVE;
    try {
      const file = await deps.host.simulatedRuntime(
        request.tabId,
        request.url,
        request.documentUrl
      );
      return file === null ? LEAVE : { redirectUrl: file.url };
    } catch (cause) {
      deps.log.error('Simulated runtime hook failed — request left to the site', {
        tabId: request.tabId,
        cause
      });
      return LEAVE;
    }
  };
}

/** The simulated features whose pages load a runtime the hook answers. */
const RUNTIME_FEATURES: ReadonlySet<SimulatedFeatureId> = new Set(['lazyload']);

/**
 * Whether a session simulating `simulate` needs the runtime hook.
 *
 * @param simulate The session's simulation (absent: none).
 */
export function needsRuntimeHook(simulate: SimulateSpec | undefined): boolean {
  return simulate?.features.some((feature) => RUNTIME_FEATURES.has(feature)) ?? false;
}

/** A blocking hook body (one per held tab: listener identity is per tab). */
export type RuntimeHookListener = (details: unknown) => Promise<RuntimeRedirectAnswer>;

/** The blocking request event the hooks are held on (Firefox's `webRequest.onBeforeRequest`). */
export interface RuntimeHookEvent {
  addListener(
    callback: RuntimeHookListener,
    filter: { readonly urls: string[]; readonly types: 'script'[]; readonly tabId: number },
    extraInfoSpec: 'blocking'[]
  ): void;
  removeListener(callback: RuntimeHookListener): void;
}

/** The per-tab hook holder. */
export interface RuntimeHooks {
  /**
   * Hold (`wanted`) or drop the tab's hook; idempotent. Never throws: a
   * refused registration is logged and the tab is left without a hook
   * (its runtime then comes from the site).
   */
  set(tabId: number, wanted: boolean): void;
  /** The tabs holding a hook (for tests and logs). */
  heldTabs(): number[];
}

/** What {@link createRuntimeHooks} needs. */
export interface RuntimeHooksDeps {
  readonly event: RuntimeHookEvent;
  /** The URL filter (see {@link runtimeRequestPatterns}). */
  readonly urls: readonly string[];
  /** The hook body every held tab's listener calls. */
  readonly hook: RuntimeHookListener;
  readonly log: Pick<Logger, 'error'>;
}

/**
 * Create the per-tab hook holder: one blocking listener per held tab,
 * filtered to that tab.
 *
 * @param deps The event, the URL filter, the hook body and the logger.
 */
export function createRuntimeHooks(deps: RuntimeHooksDeps): RuntimeHooks {
  const held = new Map<number, RuntimeHookListener>();

  const hold = (tabId: number): void => {
    // A distinct function per tab: removal is by identity.
    const listener: RuntimeHookListener = (details) => deps.hook(details);
    try {
      deps.event.addListener(listener, { urls: [...deps.urls], types: ['script'], tabId }, [
        'blocking'
      ]);
      held.set(tabId, listener);
    } catch (cause) {
      deps.log.error('Simulated runtime hook not registered — runtime left to the site', {
        tabId,
        cause
      });
    }
  };

  const drop = (tabId: number, listener: RuntimeHookListener): void => {
    held.delete(tabId);
    try {
      deps.event.removeListener(listener);
    } catch (cause) {
      deps.log.error('Simulated runtime hook not removed', { tabId, cause });
    }
  };

  return {
    set(tabId, wanted) {
      const listener = held.get(tabId);
      if (wanted && listener === undefined) hold(tabId);
      else if (!wanted && listener !== undefined) drop(tabId, listener);
    },
    heldTabs: () => [...held.keys()]
  };
}

/**
 * The backend with the runtime hooks following its sessions: a tab holds
 * its hook while armed (or resumed) for a session that
 * {@link needsRuntimeHook}, and drops it on disarm, a failed arm or a
 * stale resume — so the hooks need no recovery of their own: a restarted
 * background re-arms or resumes exactly the sessions that live on.
 *
 * @param backend The backend whose sessions the hooks follow.
 * @param hooks The per-tab hook holder.
 * @returns The same backend, its arm/resume/disarm also holding the hooks.
 */
export function withRuntimeHooks<B extends InterceptionBackend>(
  backend: B,
  hooks: RuntimeHooks
): B {
  return {
    ...backend,
    async arm(tabId, generation, origin, simulate): Promise<ArmResult> {
      try {
        const result = await backend.arm(tabId, generation, origin, simulate);
        hooks.set(tabId, result.armed && needsRuntimeHook(simulate));
        return result;
      } catch (cause) {
        hooks.set(tabId, false);
        throw cause;
      }
    },
    async resume(tabId, generation, origin, simulate): Promise<boolean> {
      try {
        const live = await backend.resume(tabId, generation, origin, simulate);
        hooks.set(tabId, live && needsRuntimeHook(simulate));
        return live;
      } catch (cause) {
        hooks.set(tabId, false);
        throw cause;
      }
    },
    disarm(tabId): Promise<void> {
      hooks.set(tabId, false);
      return backend.disarm(tabId);
    }
  };
}
