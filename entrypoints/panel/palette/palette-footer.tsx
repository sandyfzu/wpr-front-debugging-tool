/**
 * The panel palette's key footer: the three keys the open palette answers
 * most — move, run, close — taught where they are used, in the shared key
 * chips. Static words: the full list lives in the shortcuts overlay. Arrow
 * and Enter glyphs are icons, so every chip reads the same in every font.
 */
import { For, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { LucideIcon } from 'lucide-solid';
import ArrowDown from 'lucide-solid/icons/arrow-down';
import ArrowUp from 'lucide-solid/icons/arrow-up';
import CornerDownLeft from 'lucide-solid/icons/corner-down-left';
import { KEY_CHIP } from '../../../components/ui/classes';
import { cn } from '../../../utils/cn';

/** One key in a hint: an icon glyph, or a key name. */
type HintKey = LucideIcon | string;

/** One footer hint: its keys, then what they do. */
export interface PaletteFooterHint {
  readonly keys: readonly HintKey[];
  readonly action: string;
}

/** The hints, in reading order (each matches a row of the shortcuts table). */
export const PALETTE_FOOTER_HINTS: readonly PaletteFooterHint[] = [
  { keys: [ArrowUp, ArrowDown], action: 'move' },
  { keys: [CornerDownLeft], action: 'run' },
  { keys: ['Esc'], action: 'close' }
];

/**
 * One key chip: one height for glyph and name chips alike (a 10 px glyph
 * would otherwise make a shorter chip than a line of text).
 *
 * @param props.glyph The glyph icon or key name.
 */
function KeyChip(props: { glyph: HintKey }): JSX.Element {
  return (
    <kbd class={cn(KEY_CHIP, 'h-4.5')}>
      {typeof props.glyph === 'string' ? (
        props.glyph
      ) : (
        <Dynamic component={props.glyph} size={10} aria-hidden="true" />
      )}
    </kbd>
  );
}

/** Render the footer (under the palette's list, above the plate's bottom edge). */
export function PaletteFooter(): JSX.Element {
  return (
    <div
      data-fdt="palette-footer"
      class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-1 px-3 py-1.5 text-2xs text-fg-muted"
    >
      <For each={PALETTE_FOOTER_HINTS}>
        {(hint) => (
          <span class="inline-flex items-center gap-1">
            <For each={hint.keys}>{(glyph) => <KeyChip glyph={glyph} />}</For>
            {hint.action}
          </span>
        )}
      </For>
    </div>
  );
}
