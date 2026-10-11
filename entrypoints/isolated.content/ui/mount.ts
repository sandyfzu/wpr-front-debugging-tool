/**
 * Mounting shared by every UI this content script injects into a host page:
 * a Solid root inside a WXT shadow-root UI container, with the palette
 * resolved and applied to the container before the first paint.
 *
 * Injection isolation the caller gets by mounting through here: everything
 * renders inside the shadow root, and the container carries the appearance —
 * `data-theme="system"|"dark"|"light"`. Declaring all three (system included)
 * is required inside a shadow root: the mount's `:host { all: initial
 * !important }` isolation reset aborts the documented scheme chain, so only
 * the owned container's schema declarations rule — `system` accepts both
 * palettes and the browser follows live OS changes from there.
 */

import { render } from 'solid-js/web';
import { getOptions } from '../../../lib/storage/options';
import { applyTheme, type Appearance, type Theme } from '../../../utils/theme';
import type { JSX } from 'solid-js';

/**
 * The theme an injected container carries: the system choice is declared
 * itself (`data-theme="system"`), because inside the shadow root the `:host`
 * scheme chain is aborted by the mount's isolation reset — only an
 * on-container declaration rules. Explicit choices pin dark/light on the
 * spot.
 *
 * @param appearance The stored three-way choice.
 */
function containerTheme(appearance: Appearance): Theme | 'system' {
  return appearance === 'system' ? 'system' : appearance;
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
  applyTheme(container, containerTheme(options.appearance));
  return render(view, container);
}
