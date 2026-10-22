/**
 * Mounting shared by every UI a content script injects into a host page:
 * a Solid root inside a WXT shadow-root UI container, palette resolved and
 * applied to the container before the first paint — and kept on the stored
 * appearance while mounted (the live-theme leg), so an appearance change in
 * the options page or the panel's palette cycle restyles the mounted UI
 * live, no reload.
 *
 * Injection isolation the caller gets by mounting through here: everything
 * renders inside the shadow root, the root keeps the UI's input events from
 * the host page (`./event-isolation` — built in, so no UI can forget it),
 * and the container carries the appearance —
 * `data-theme="system"|"dark"|"light"` (the container contract is
 * `live-theme.ts`'s).
 */

import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { createLogger } from '../../lib/logger';
import { isolateUiEvents } from './event-isolation';
import { followStoredAppearance } from './live-theme';

const log = createLogger('injected-ui');

/**
 * Mount a Solid component tree into a shadow-root UI container once the
 * stored appearance is on the container. The palette is applied before the
 * view renders, so no frame ever paints in the wrong palette; the shadow
 * root's input events are isolated (and Solid delegated there) before
 * anything renders, so the first event is covered.
 *
 * @param container The UI container inside the shadow root.
 * @param shadow The shadow root holding the container.
 * @param view Solid component returning the UI's root element.
 * @returns The disposer — removes the render tree and stops the appearance
 *   follow; the caller invokes it exactly once, when the whole shadow host
 *   leaves the page (WXT's `onRemove` wiring owns that moment).
 * @throws {@link Error} when the render itself fails — the appearance
 *   follow is unwound before the error rethrows, so a failed mount never
 *   leaves a storage subscription behind. A refused options read does not
 *   throw: the follow degrades to the system palette (see `./live-theme`).
 */
export async function mountShadowUi(
  container: HTMLElement,
  shadow: ShadowRoot,
  view: () => JSX.Element
): Promise<() => void> {
  // The page never sees the UI's input (a delay runtime would replay it).
  isolateUiEvents(shadow);
  const stopFollowingTheme = await followStoredAppearance(container);
  try {
    const disposeView = render(view, container);
    return () => {
      disposeView();
      // The unwatch is an extension-API call that can throw in a dead context
      // (extension reloaded while the view was mounted). It must not
      // short-circuit the rest of the teardown: WXT's remove runs this
      // disposer BEFORE its own shadow-host cleanup, so a throw here would
      // leave the detached shadow host stranded in the host page.
      try {
        stopFollowingTheme();
      } catch (cause) {
        log.warn('Stopping the appearance follow failed during teardown', cause);
      }
    };
  } catch (cause) {
    // Same dead-context caveat as the disposer, folded for the unwind: the
    // original mount failure has priority — the follow must be stopped
    // (best-effort, logged loudly when it cannot be) and the real error
    // rethrown, never replaced by a secondary teardown failure.
    try {
      stopFollowingTheme();
    } catch (unwindFailure) {
      log.warn('Stopping the appearance follow failed during unwind', unwindFailure);
    }
    throw cause;
  }
}
