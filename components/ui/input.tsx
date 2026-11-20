/**
 * The panel's text field — the list search field's and the tool forms'
 * input. A native `<input>` in the search-field look (28 px, the 7 px control
 * corner, a raised fill) so every field looks, measures and focuses
 * identically across the panel and options.
 */
import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../../utils/cn';
import { DISABLED, FOCUS_RING } from './classes';

export type InputProps = {
  /** Extra classes, merged last so callers win (`w-full`, density tweaks). */
  class?: string;
} & Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'class'>;

/**
 * Render the shared text field.
 *
 * The `aria-invalid` variant paints the error state, so validation comes free
 * whenever a caller sets the attribute (which assistive tech reads too).
 * Vertical metrics and corners match the buttons (28 px, `rounded-control`) so
 * toolbars compose without seams. No key hint ever rides a field: `/` opens
 * the shortcuts overlay, not a search, so advertising a focus key would lie.
 *
 * @param props.class Extra classes, merged last so callers win.
 * @param props.* All other native input props pass through (`value`, `onInput`, …).
 */
export function Input(props: InputProps): JSX.Element {
  const [own, rest] = splitProps(props, ['class']);
  return (
    <input
      data-fdt="input"
      class={cn(
        'h-7 rounded-control border border-line-2 bg-surface-2 px-2.5 text-xs text-fg-primary placeholder:text-fg-muted',
        'hover:border-line-3',
        'aria-invalid:border-status-error aria-invalid:ring-1 aria-invalid:ring-status-error/40',
        // Same disabled treatment as every other interactive primitive: dimmed
        // but still hover-explained (no pointer-events kill).
        DISABLED,
        FOCUS_RING,
        own.class
      )}
      {...rest}
    />
  );
}
