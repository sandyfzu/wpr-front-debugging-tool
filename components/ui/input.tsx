/**
 * The panel's text field — the command palette's and the filter bars' single
 * input. A native `<input>` in the shared chip density so every field looks,
 * measures and focuses identically across surfaces.
 */
import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './classes';

export type InputProps = {
  /** Extra classes, merged last so callers win (`w-full`, density tweaks). */
  class?: string;
} & Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'class'>;

/**
 * Render the shared text field.
 *
 * The `aria-invalid` variant paints the error state, so validation comes free
 * whenever a caller sets the attribute (which assistive tech reads too).
 * Vertical metrics match the buttons (28px) so toolbars compose without seams.
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
        'h-7 rounded border border-line-2 bg-surface-2 px-2 text-xs text-fg-primary placeholder:text-fg-muted',
        'hover:border-line-3',
        'aria-invalid:border-status-error aria-invalid:ring-1 aria-invalid:ring-status-error/40',
        FOCUS_RING,
        own.class
      )}
      {...rest}
    />
  );
}
