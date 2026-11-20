/**
 * The panel's card — the content container of every page (and the options
 * sections). `level` selects a token surface/border pair (the page background
 * counts as level 0), `look` a raised card or a dashed placeholder, and the
 * optional header/footer slots keep section chrome consistent across pages.
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '../../utils/cn';

/** The surface level a card sits on; 1–4 raise the card above the page (0). */
export type CardLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Background + border token classes per level — pairs that stay visible together.
 * Level 1, the default, is the raised card: the brightest
 * surface (`surface-2`) over the page canvas under the quietest line, so the
 * card reads by its fill and soft shadow rather than by a border.
 */
export const CARD_LEVEL_CLASSES: Record<CardLevel, { surface: string; line: string }> = {
  0: { surface: 'bg-surface-0', line: 'border-line-0' },
  1: { surface: 'bg-surface-2', line: 'border-line-1' },
  2: { surface: 'bg-surface-2', line: 'border-line-2' },
  3: { surface: 'bg-surface-3', line: 'border-line-3' },
  4: { surface: 'bg-surface-4', line: 'border-line-4' }
};

/** The frame every card shares: the 8 px card corner and a border. */
export const CARD_FRAME_CLASSES = 'rounded-lg border';

/** How a card presents itself, in registry order. */
export const CARD_LOOKS = ['raised', 'placeholder'] as const;

/** One card look. */
export type CardLook = (typeof CARD_LOOKS)[number];

/**
 * Classes per look, applied after the level pair (so they win it):
 * - `raised` (default): the level's fill under the first elevation shadow;
 * - `placeholder`: a dashed outline flush with the page canvas, no shadow —
 *   the "nothing here yet" slot a tool's empty result fills (it must never
 *   read as a card holding content).
 */
export const CARD_LOOK_CLASSES: Record<CardLook, string> = {
  raised: 'shadow-elev-1',
  placeholder: 'border-dashed bg-surface-0'
};

export interface CardProps {
  /** Which surface/line level to render (default `1` — the raised card). */
  level?: CardLevel;
  /** Raised card or dashed placeholder (default `raised`). */
  look?: CardLook;
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
 * @param props.look See {@link CARD_LOOKS} (default `raised`).
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
        CARD_FRAME_CLASSES,
        CARD_LEVEL_CLASSES[level()].surface,
        CARD_LEVEL_CLASSES[level()].line,
        CARD_LOOK_CLASSES[props.look ?? 'raised'],
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
