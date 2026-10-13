/**
 * The palette's visible trigger: the shell's icon button for mouse users,
 * placed in the header's top block beside the brand mark. The rail is the
 * interim header geometry (the band redesign is a later phase's committed
 * pass), and this top block is where keyboard users' entry point — the
 * shortcut — and mouse users' entry point belong in the same spot: the
 * palette button is the rail's first control above the nav rows.
 *
 * The shortcut hint lives in the tooltip (mouse users get it before they
 * learn the key), and the button names itself for assistive tech while
 * carrying `aria-haspopup`/`aria-expanded` for the dialog it opens.
 */
import type { JSX } from 'solid-js';
import Command from 'lucide-solid/icons/command';
import { Tooltip } from '../../../components/ui/tooltip';
import { FOCUS_RING } from '../../../components/ui/classes';
import { cn } from '../../../utils/cn';

export interface PaletteTriggerProps {
  /** Whether the palette is open right now (`aria-expanded`). */
  open: () => boolean;
  /** Toggle the palette (click). */
  toggle: () => void;
}

/** The trigger: a 24px-floor icon button in the brand row. */
const TRIGGER_CLASSES =
  'inline-grid size-6 shrink-0 place-items-center rounded text-fg-secondary hover:bg-surface-3 hover:text-fg-primary';

/**
 * Render the palette trigger.
 *
 * The tooltip names + keys (the unobtrusive reiteration; the button's own
 * `aria-label` is what assistive tech reads), and the tooltip floats to the
 * row's right like every other rail control.
 *
 * @param props.open The palette's open state accessor.
 * @param props.toggle The toggle callback.
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
      placement="right"
      class={cn(TRIGGER_CLASSES, FOCUS_RING)}
      aria-haspopup="dialog"
      aria-expanded={props.open()}
      aria-label="Command palette"
      data-fdt="palette-trigger"
    >
      <Command size={14} aria-hidden="true" />
    </Tooltip>
  );
}
