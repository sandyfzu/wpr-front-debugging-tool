/**
 * Feature detection for tab-targeted messaging. A context can lack the
 * `tabs` namespace entirely: Firefox gives DevTools pages (the devtools page
 * and its panels) only the content-script API set plus `devtools.*`, so a
 * tab send there throws instead of reaching the page. Callers check once and
 * render an explicit state rather than a failure with a retry that can never
 * work.
 */

/** The slice of the extension API object the probe reads (structural: any shape may arrive). */
interface MaybeTabsApi {
  readonly tabs?: { readonly sendMessage?: unknown } | null;
}

/**
 * Whether this context can message a tab's content scripts.
 *
 * @param api The extension API object (`browser`), injected for tests.
 * @returns True only when `tabs.sendMessage` is a callable function.
 */
export function canMessageTabs(api: unknown): boolean {
  if (typeof api !== 'object' || api === null) return false;
  return typeof (api as MaybeTabsApi).tabs?.sendMessage === 'function';
}
