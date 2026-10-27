/**
 * Where focus goes back when the on-page palette closes: what the page (or
 * one of this extension's other injected surfaces) had focused before the
 * open. Focus inside a shadow root reads as its host at the document level,
 * so a sibling surface's host resolves to its shadow root's own focused
 * element; the palette's own host never counts.
 */
import {
  COMMAND_PALETTE_HOST_NAME,
  INJECTED_HOST_PREFIX
} from '../../components/injected-ui/key-guard';

/**
 * The element to hand focus back to, if any can take it.
 *
 * @param doc The page's document.
 * @returns The focused page element, the focused element inside another
 *   extension surface's (open) shadow root, or null — for the body, the
 *   palette's own host, or a surface host with nothing focused inside.
 */
export function returnFocusTarget(doc: Document): HTMLElement | null {
  const active = doc.activeElement;
  if (!(active instanceof HTMLElement) || active === doc.body) return null;
  if (!active.localName.startsWith(INJECTED_HOST_PREFIX)) return active;
  if (active.localName === COMMAND_PALETTE_HOST_NAME) return null;
  const inner = active.shadowRoot?.activeElement;
  return inner instanceof HTMLElement ? inner : null;
}
