/**
 * The z-order rule every injected surface that must sit above the page
 * follows: render inside one `popover="manual"` element shown in the
 * browser's top layer — above every page stacking context, z-index or
 * transformed ancestor, with no z-index race to win. Within the top layer,
 * the most recently shown element paints last, so a surface re-shown on
 * open lands above every sibling surface (and page popovers) shown before.
 */
import type { Logger } from '../../lib/logger';

/**
 * Put an element in the browser's top layer (a manual popover: no light
 * dismiss, no focus move) — again on each call, which moves it above
 * whatever was shown since. Without popover support the element stays
 * where it is (its own CSS keeps a fixed, highest-z-index fallback).
 *
 * @param layer The surface's root element (inside its shadow root).
 * @param log Where a refused show is reported.
 */
export function showInTopLayer(layer: HTMLElement, log: Logger): void {
  if (typeof layer.showPopover !== 'function') return;
  layer.setAttribute('popover', 'manual');
  try {
    if (layer.matches(':popover-open')) layer.hidePopover();
    layer.showPopover();
  } catch (cause) {
    // The host document refused (e.g. detached): the fixed fallback renders it.
    log.warn('Showing the surface in the top layer failed; using the fixed fallback', cause);
    layer.removeAttribute('popover');
  }
}

/**
 * Take an element out of the top layer (it keeps its `popover` attribute,
 * so the UA style hides it until the next show).
 *
 * @param layer The surface's root element.
 * @param log Where a refused hide is reported.
 */
export function hideFromTopLayer(layer: HTMLElement, log: Logger): void {
  if (typeof layer.hidePopover !== 'function' || !layer.hasAttribute('popover')) return;
  try {
    if (layer.matches(':popover-open')) layer.hidePopover();
  } catch (cause) {
    log.warn('Hiding the surface from the top layer failed', cause);
  }
}
