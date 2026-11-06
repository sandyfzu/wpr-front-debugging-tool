import type { ExtensionApiScope, MessageSender, RuntimeIdHolder } from './scope';

/**
 * Chromium's extension namespace, immune to DOM clobbering.
 *
 * Chromium installs `browser` (and `chrome`) in an isolated world when the
 * world is created, and skips a name the page's DOM already answers: a world
 * first created after the page parsed (a script injected into a tab loaded
 * before this extension instance started — install, update, reload) sees a
 * page `<form id="browser"><input name="runtime" id="x">` as `browser`, with
 * `runtime.id` reading `"x"`. A DOM named property always lives on the
 * window's prototype chain, while the genuine namespace is an own property of
 * the global — so only an own `browser` with a runtime id is taken; otherwise
 * `chrome`, the namespace every supported Chromium exposes.
 *
 * Limit: a page clobbering both names, or a frame named `browser` or `chrome`
 * (a named frame stops Chromium installing either global, or `chrome`'s API),
 * leaves no genuine namespace; `chrome` is returned as is and the script's
 * first API call fails.
 *
 * @param scope The global scope (`globalThis` in the build).
 * @returns The genuine `browser` when present, else `scope.chrome`.
 */
export function chromiumExtensionApi(scope: ExtensionApiScope): unknown {
  // Inline, not a shared helper: this line ships in every bundle.
  return Object.hasOwn(scope, 'browser') && (scope.browser as RuntimeIdHolder)?.runtime?.id
    ? scope.browser
    : scope.chrome;
}

/**
 * Pin the genuine namespace as the world's own `chrome` global.
 *
 * Code outside the `browser` alias reads the bare `chrome` global at each
 * call (the messaging library: callback sends + `runtime.lastError`). A page
 * forges it like `browser`: `<form id="chrome"><input name="runtime">` in a
 * world created after parse, or `<html id="chrome">` even at
 * `document_start` (the root element exists when the world is created:
 * Chromium decorates that element, and once the body adds another
 * `id="chrome"` named access answers a bare HTMLCollection). An own property
 * outranks named access for good, so the namespace is defined as one while
 * `chrome` is not own yet. Chromium's native `browser` is a sound `chrome`:
 * it shares `chrome`'s API objects (`runtime`, `tabs`, …), so callbacks and
 * `runtime.lastError` behave identically. Only the world sees the property;
 * a world whose `chrome` is already own (service worker, extension pages,
 * worlds created before parse) is left untouched.
 *
 * @param scope The global scope (`globalThis` in the build).
 * @param namespace The resolved namespace ({@link chromiumExtensionApi}).
 * @returns `namespace`, for the caller to export.
 */
export function pinChromeNamespace(scope: ExtensionApiScope, namespace: unknown): unknown {
  if (
    !Object.hasOwn(scope, 'chrome') &&
    typeof (namespace as MessageSender)?.runtime?.sendMessage === 'function'
  ) {
    try {
      // The attributes of the global Chromium itself defines.
      Object.defineProperty(scope, 'chrome', {
        value: namespace,
        writable: true,
        enumerable: true,
        configurable: true
      });
    } catch (cause) {
      // Not reachable from a page (it cannot freeze this world's global);
      // the bundle keeps its resolved `browser` and degrades only bare readers.
      console.error('[WPR FDT] Pinning the chrome namespace failed', cause);
    }
  }
  return namespace;
}
