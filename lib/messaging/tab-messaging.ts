/**
 * Feature detection for the panel's two ways to reach a tab. A context can
 * lack the `tabs` namespace entirely: Firefox gives DevTools pages (the
 * devtools page and its panels) only the content-script API set plus
 * `devtools.*`, so a tab send there throws instead of reaching the page —
 * while `runtime.sendMessage` (to the background, which can relay) still
 * works. Callers check once and pick a transport, or render an explicit
 * state rather than a failure with a retry that can never work.
 */

/** The slice of the extension API object the probes read (structural: any shape may arrive). */
interface MaybeMessagingApi {
  readonly tabs?: { readonly sendMessage?: unknown } | null;
  readonly runtime?: { readonly sendMessage?: unknown } | null;
}

/**
 * Read one namespace's `sendMessage` from an untrusted API object.
 *
 * @param api The extension API object (`browser`), or anything.
 * @param namespace Which namespace to read.
 * @returns Whether that namespace's `sendMessage` is a callable function.
 */
function hasSend(api: unknown, namespace: keyof MaybeMessagingApi): boolean {
  if (typeof api !== 'object' || api === null) return false;
  return typeof (api as MaybeMessagingApi)[namespace]?.sendMessage === 'function';
}

/**
 * Whether this context can message a tab's content scripts.
 *
 * @param api The extension API object (`browser`), injected for tests.
 * @returns True only when `tabs.sendMessage` is a callable function.
 */
export function canMessageTabs(api: unknown): boolean {
  return hasSend(api, 'tabs');
}

/**
 * Whether this context can message the extension's own contexts (the
 * background among them).
 *
 * @param api The extension API object (`browser`), injected for tests.
 * @returns True only when `runtime.sendMessage` is a callable function.
 */
export function canMessageRuntime(api: unknown): boolean {
  return hasSend(api, 'runtime');
}
