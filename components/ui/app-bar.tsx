/**
 * The app bar frame — the single 44 px band at the top of an extension page
 * (the devtools panel's top bar, the options page's app bar). It owns only
 * the frame: height, surface, bottom hairline and the two slots. What goes
 * inside, and how it folds at narrow widths, is the caller's.
 *
 * The start slot shrinks and clips; the end slot never shrinks. So at any
 * width the end controls stay whole and reachable, and long start content
 * elides inside its own items instead of pushing the controls out (no
 * horizontal scroll).
 */
import type { JSX } from 'solid-js';
import { cn } from '../../utils/cn';

export type AppBarProps = {
  /** The bar's `data-fdt` hook (each surface names its own bar). */
  'data-fdt': string;
  /** The landmark's accessible name (`aria-label` on the `header`). */
  label?: string;
  /** Leading content: identity and answers. Shrinks first. */
  start: JSX.Element;
  /** Trailing controls. Never shrinks. */
  end?: JSX.Element;
  /** Extra classes on the frame (placement: `sticky`, stacking), merged last. */
  class?: string;
};

/**
 * The frame: 44 px band, raised surface, bottom hairline. It clips its own
 * overflow: a caller that folds by a measured width re-renders one frame
 * after a resize, and that frame must never widen the page (no horizontal
 * scroll, not even transiently).
 */
const FRAME =
  'flex h-11 min-w-0 shrink-0 items-center gap-1.5 overflow-hidden border-b border-line-1 bg-surface-1 pr-2 pl-2.25 text-fg-primary';

/**
 * The start slot: takes the free width, clips what cannot fit. It spans the
 * band's full height (`self-stretch`) and keeps 3 px of padding at both
 * inline ends (the focus ring's 2 px outline + 1 px offset), so the clip
 * never cuts a ring or hover surface around its items — a flush first or
 * last item included (the frame's start padding is 3 px less, so content
 * still starts 12 px in). Callers keep their content fitting (the panel's
 * top bar folds by measure), so the clip is a safety net, not the layout.
 */
const START = 'flex min-w-0 flex-1 items-center gap-1.5 self-stretch overflow-hidden px-0.75';

/** The end slot: its natural width, always; toolbar-tight 2 px between controls. */
const END = 'flex shrink-0 items-center gap-0.5';

/**
 * Render the app bar frame as the page's `header` landmark.
 *
 * @param props.data-fdt The bar's hook.
 * @param props.label The landmark's accessible name (optional).
 * @param props.start Leading content (shrinks and clips first).
 * @param props.end Trailing controls (never shrink).
 * @param props.class Placement classes, merged last.
 */
export function AppBar(props: AppBarProps): JSX.Element {
  return (
    <header data-fdt={props['data-fdt']} aria-label={props.label} class={cn(FRAME, props.class)}>
      <div data-fdt-app-bar-slot="start" class={START}>
        {props.start}
      </div>
      <div data-fdt-app-bar-slot="end" class={END}>
        {props.end}
      </div>
    </header>
  );
}
