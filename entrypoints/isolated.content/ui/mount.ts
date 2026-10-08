/**
 * Mounting shared by every UI this content script injects into a host page:
 * a Solid root inside a WXT shadow-root UI container, with the palette
 * resolved and applied to the container before the first paint.
 *
 * Injection isolation the caller gets by mounting through here: everything
 * renders inside the shadow root, and the container carries the appearance
 * pin — `data-theme` only for an explicit dark/light choice, never for
 * `system` (the token stylesheet's media query rules the system case, so the
 * UI follows live OS scheme changes).
 */

import { render } from 'solid-js/web';
import { getOptions } from '../../../lib/storage/options';
import { applyTheme, type Appearance } from '../../../utils/theme';
import type { JSX } from 'solid-js';

/**
 * The palette an appearance choice pins on a container: explicit choices win
 * over the media query by attribute; `system` leaves the attribute unset.
 *
 * @param appearance The stored three-way choice.
 */
function pinnedTheme(appearance: Appearance): 'dark' | 'light' | null {
  return appearance === 'system' ? null : appearance;
}

/**
 * Mount a Solid component tree into a shadow-root UI container once the
 * choice is resolved. The palette is applied first, so no frame ever paints
 * in the wrong palette.
 *
 * The option read happens per mount — an injected UI lives for one page, so
 * the value fresh at mount is the strongest guarantee available; the
 * appearance toggle (owned by the settings surface) applies to pages opened
 * after it changes.
 *
 * @param container The UI container inside the shadow root.
 * @param view Solid component returning the UI's root element.
 * @returns The Solid disposer — the caller removes the tree exactly once,
 *   when the whole shadow host leaves the page.
 * @throws {@link Error} when the options contract fails — options are read
 *   through a validated wrapper, so a rejection is broken wiring, not bad
 *   page input.
 */
export async function mountShadowUi(
  container: HTMLElement,
  view: () => JSX.Element
): Promise<() => void> {
  const options = await getOptions();
  applyTheme(container, pinnedTheme(options.appearance));
  return render(view, container);
}
