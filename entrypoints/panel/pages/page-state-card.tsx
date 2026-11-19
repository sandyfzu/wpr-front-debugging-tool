/**
 * The frame of a view that replaces a whole page — the data error, the
 * "no page data here" view, a page chunk that failed to load and the render
 * crash: one raised card, centered on the page canvas at a reading width,
 * so a page-level state reads as a deliberate surface (the same card the
 * page's own content sits on), never as words floating on an empty canvas.
 */
import type { JSX } from 'solid-js';
import { Card } from '../../../components/ui/card';

/** The card's width: centered, at most 28 rem, the full column below that. */
export const PAGE_STATE_CARD_CLASSES = 'mx-auto w-full max-w-md';

/** Props of {@link PageStateCard}. */
export interface PageStateCardProps {
  /** The state view (`ErrorState` with `pageHeading`, `DataUnavailable`). */
  children: JSX.Element;
}

/**
 * Render the frame.
 *
 * @param props See {@link PageStateCardProps}.
 */
export function PageStateCard(props: PageStateCardProps): JSX.Element {
  return (
    <div data-fdt="page-state-card" class="contents">
      <Card class={PAGE_STATE_CARD_CLASSES}>{props.children}</Card>
    </div>
  );
}
