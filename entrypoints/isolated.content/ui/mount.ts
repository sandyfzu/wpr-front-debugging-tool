/**
 * Mounting shared by every UI this content script injects into a host page:
 * a Solid root inside a WXT shadow-root UI container, palette resolved and
 * applied to the container before the first paint — and kept on the stored
 * appearance while mounted (the live-theme leg), so an appearance change in
 * the options page or the panel's palette cycle restyles the mounted UI
 * live, no reload.
 *
 * Injection isolation the caller gets by mounting through here: everything
 * renders inside the shadow root, and the container carries the appearance —
 * `data-theme="system"|"dark"|"light"` (the container contract is
 * `live-theme.ts`'s).
 */

import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { followStoredAppearance } from './live-theme';

/**
 * Mount a Solid component tree into a shadow-root UI container once the
 * stored appearance is on the container. The palette is applied before the
 * view renders, so no frame ever paints in the wrong palette.
 *
 * @param container The UI container inside the shadow root.
 * @param view Solid component returning the UI's root element.
 * @returns The disposer — removes the render tree and stops the appearance
 *   follow; the caller invokes it exactly once, when the whole shadow host
 *   leaves the page (WXT's `onRemove` wiring owns that moment).
 * @throws {@link Error} when the options read fails or the render itself
 *   fails — the appearance follow is unwound before the error rethrows, so a
 *   failed mount never leaves a storage subscription behind. Reads go
 *   through the validated wrapper, so a rejection is broken wiring, not bad
 *   page input; the callers log it as the mount failure it is.
 */
export async function mountShadowUi(
  container: HTMLElement,
  view: () => JSX.Element
): Promise<() => void> {
  const stopFollowingTheme = await followStoredAppearance(container);
  try {
    const disposeView = render(view, container);
    return () => {
      disposeView();
      stopFollowingTheme();
    };
  } catch (cause) {
    stopFollowingTheme();
    throw cause;
  }
}
