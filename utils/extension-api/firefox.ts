import type { ExtensionApiScope, RuntimeIdHolder } from './scope';

/**
 * Firefox's extension namespace: the native promise-based `browser`.
 *
 * Firefox defines `browser` on each extension global itself (the content
 * script sandbox, the extension page), so a DOM named property cannot shadow
 * it. No own-property test here: it is unverified on Firefox, and a false
 * negative would fall back to the callback-only MV2 `chrome`.
 *
 * @param scope The global scope (`globalThis` in the build).
 * @returns `scope.browser` when it carries a runtime id, else `scope.chrome`.
 */
export function firefoxExtensionApi(scope: ExtensionApiScope): unknown {
  return (scope.browser as RuntimeIdHolder)?.runtime?.id ? scope.browser : scope.chrome;
}
