/**
 * The palette's visible trigger: the top bar's mouse entry point to the
 * command palette (the keyboard's is the chord). Two forms, one control:
 * a search-styled button ("Jump to…" with the key hint) on a full-width
 * bar, and a square search icon on a folded one.
 *
 * The shortcut hint also lives in the tooltip (mouse users get it before
 * they learn the key), and the button names itself for assistive tech
 * while carrying `aria-haspopup`/`aria-expanded` for the dialog it opens.
 */
import { Show, type JSX } from 'solid-js';
import Search from 'lucide-solid/icons/search';
import { Tooltip } from '../../../components/ui/tooltip';

export interface PaletteTriggerProps {
  /** Whether the palette is open right now (`aria-expanded`). */
  open: () => boolean;
  /** Toggle the palette (click). */
  toggle: () => void;
  /** The search-styled form (true) or the square icon (false). */
  wide: () => boolean;
  /** The fixed chord in the platform's notation (the wide form's inline hint). */
  keyHint: () => string;
}

/**
 * The wide form: a search field look (surface, hairline, muted words),
 * sized to its content — the words and the key chip always whole, whatever
 * the chip reads ("⌘K", "Ctrl+K") or the font renders — from a 7.5 rem
 * floor, nothing more: the full bar's every answer competes for the same
 * row, and the bar's fold measures this slot as laid out.
 */
const WIDE_CLASSES =
  'flex h-7 min-w-30 shrink-0 items-center gap-1 rounded-md border border-line-2 bg-surface-2 px-1.5 text-xs text-fg-muted hover:border-line-3 hover:text-fg-secondary';

/** The folded form: a 28 px ghost square. */
const ICON_CLASSES =
  'inline-grid size-7 shrink-0 place-items-center rounded-md text-fg-secondary hover:bg-surface-3 hover:text-fg-primary';

/**
 * The inline key chip. Decorative (the tooltip carries the keys): its text
 * is generated content from `data-key-hint`, so it is not part of the
 * button's visible label, which must stay inside the accessible name.
 */
const KEY_HINT =
  'rounded-sm border border-line-2 bg-surface-1 px-1 font-sans text-2xs text-fg-muted after:content-[attr(data-key-hint)]';

/** The trigger's accessible name in each form (the wide one starts with its visible words). */
export const PALETTE_TRIGGER_LABELS = {
  wide: 'Jump to… — Command palette',
  icon: 'Command palette'
} as const;

/**
 * Render the palette trigger.
 *
 * @param props.open The palette's open state accessor.
 * @param props.toggle The toggle callback.
 * @param props.wide Picks the form.
 * @param props.keyHint The inline key hint.
 */
export function PaletteTrigger(props: PaletteTriggerProps): JSX.Element {
  return (
    <Tooltip
      content={
        <>
          <span class="font-medium">Command palette</span>
          <span class="block text-2xs text-fg-secondary">Ctrl / ⌘ K</span>
        </>
      }
      placement="bottom"
      class={props.wide() ? WIDE_CLASSES : ICON_CLASSES}
      ariaLabel={props.wide() ? PALETTE_TRIGGER_LABELS.wide : PALETTE_TRIGGER_LABELS.icon}
      ariaHasPopup="dialog"
      ariaExpanded={props.open()}
      onClick={() => {
        props.toggle();
      }}
    >
      <Search size={14} aria-hidden="true" class="shrink-0" />
      <Show when={props.wide()}>
        {/* Never elided: the button grows to hold the words (`flex-1`
            only spends the floor's spare room, keeping the chip at the end). */}
        <span class="flex-1 whitespace-nowrap text-start">Jump to…</span>
        <kbd class={KEY_HINT} data-key-hint={props.keyHint()} aria-hidden="true" />
      </Show>
    </Tooltip>
  );
}
