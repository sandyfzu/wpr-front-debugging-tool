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
 * Stop an appearance follow without letting a dead-context throw escape:
 * the unwatch is an extension-API call that throws once the extension
 * reloaded under a mounted view, and the teardown step after it (the view's
 * disposal, WXT's shadow-host cleanup, a rethrown mount failure) must still
 * run.
 *
 * @param stop The follow's stop handle.
 * @param moment The teardown moment, for the warning.
 */
function stopFollowQuietly(stop: () => void, moment: string): void {
  try {
    stop();
  } catch (cause) {
    log.warn(`Stopping the appearance follow failed during ${moment}`, cause);
  }
}

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
 * @param signal The mount's removal signal: aborted while the appearance
 *   read is in flight (the host left the page first), nothing renders, the
 *   follow stops at once and a no-op disposer resolves.
 * @returns The disposer — removes the render tree and stops the appearance
 *   follow; the caller invokes it exactly once, when the host leaves the page.
 * @throws {@link Error} when the render itself fails — the appearance
 *   follow is unwound before the error rethrows, so a failed mount never
 *   leaves a storage subscription behind. A refused options read does not
 *   throw: the follow degrades to the system palette (see `./live-theme`).
 */
export async function mountShadowUi(
  container: HTMLElement,
  shadow: ShadowRoot,
  view: () => JSX.Element,
  signal?: AbortSignal
): Promise<() => void> {
  // The page never sees the UI's input (a delay runtime would replay it).
  isolateUiEvents(shadow);
  // A call, re-read per check: the await below is exactly where it flips.
  const removed = (): boolean => signal?.aborted === true;
  if (removed()) return noRender;
  const stopFollowingTheme = await followStoredAppearance(container);
  if (removed()) {
    // Removed during the read: no render work for a host already gone.
    stopFollowQuietly(stopFollowingTheme, 'a removed mount');
    return noRender;
  }
  try {
    const disposeView = render(view, container);
    return () => {
      disposeView();
      // Never short-circuits the rest: WXT's remove runs this disposer BEFORE
      // its own shadow-host cleanup.
      stopFollowQuietly(stopFollowingTheme, 'teardown');
    };
  } catch (cause) {
    // The original mount failure has priority: the follow is stopped
    // (best-effort) and the real error rethrown, never replaced.
    stopFollowQuietly(stopFollowingTheme, 'unwind');
    throw cause;
  }
}

/** The disposer of a mount that never rendered (nothing to undo). */
function noRender(): void {
  // Intentionally empty: the aborted mount armed nothing that outlives it.
}
