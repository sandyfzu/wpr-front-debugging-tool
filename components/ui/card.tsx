/**
 * The panel's card — the content container of every page. `level` selects a
 * token surface/border pair (the page background counts as level 0), and the
 * optional header/footer slots keep section chrome consistent across pages.
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '../../utils/cn';

/** The surface level a card sits on; 1–4 raise the card above the page (0). */
export type CardLevel = 0 | 1 | 2 | 3 | 4;

/** Background + border token classes per level — pairs that stay visible together. */
export const CARD_LEVEL_CLASSES: Record<CardLevel, { surface: string; line: string }> = {
  0: { surface: 'bg-surface-0', line: 'border-line-0' },
  1: { surface: 'bg-surface-1', line: 'border-line-1' },
  2: { surface: 'bg-surface-2', line: 'border-line-2' },
  3: { surface: 'bg-surface-3', line: 'border-line-3' },
  4: { surface: 'bg-surface-4', line: 'border-line-4' }
};

export interface CardProps {
  /** Which surface/line level to render (default `1` — a quiet raised card). */
  level?: CardLevel;
  /** Optional header content (label row above the body). */
  header?: JSX.Element;
  /** Optional footer content (actions row below the body). */
  footer?: JSX.Element;
  /** Extra classes, merged last so callers win. */
  class?: string;
  /** The card's body content. */
  children: JSX.Element;
}

/**
 * Render a card with optional header/footer slots.
 *
 * The header and footer get the same level-matched hairline and padding, so
 * pages never re-derive section chrome; the body is the unpadded default —
 * dense grids pass `p-0` styling through `class` when they need edge-to-edge
 * content.
 *
 * @param props.level Surface elevation (default `1`).
 * @param props.header Slot above the body, inside the matching hairline.
 * @param props.footer Slot below the body, inside the matching hairline.
 * @param props.class Extra classes on the card frame.
 * @param props.children The body content.
 */
export function Card(props: CardProps): JSX.Element {
  const level = () => props.level ?? 1;
  return (
    <div
      data-fdt="card"
      class={cn(
        'rounded-md border',
        CARD_LEVEL_CLASSES[level()].surface,
        CARD_LEVEL_CLASSES[level()].line,
        props.class
      )}
    >
      {/* Callback form: a JSX prop is a getter, so reading it again would build it twice. */}
      <Show when={props.header}>
        {(header) => (
          <div
            data-fdt="card-header"
            class={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 border-b',
              CARD_LEVEL_CLASSES[level()].line
            )}
          >
            {header()}
          </div>
        )}
      </Show>
      <div data-fdt="card-body" class="p-2.5 text-xs text-fg-primary">
        {props.children}
      </div>
      <Show when={props.footer}>
        {(footer) => (
          <div
            data-fdt="card-footer"
            class={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 border-t',
              CARD_LEVEL_CLASSES[level()].line
            )}
          >
            {footer()}
          </div>
        )}
      </Show>
    </div>
  );
}
