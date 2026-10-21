/**
 * The shared multi-line text field (free-text notes and the like). A native `<textarea>` wearing the same chip
 * density as `Input` so a page mixing fields and buttons composes without
 * seams.
 */
import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../../utils/cn';
import { DISABLED, FOCUS_RING } from './classes';

export type TextareaProps = {
  /** Extra classes, merged last so callers win (`h-24` for taller fields). */
  class?: string;
} & Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, 'class'>;

/**
 * Render the shared text area.
 *
 * Mono (a source editor should never render with proportional metrics) and
 * matches `Input`'s error paint: `aria-invalid` drives the treatment, which
 * assistive tech reads too. No auto-resize logic — callers state their own
 * height via classes.
 *
 * @param props.class Extra classes, merged last so callers win.
 * @param props.* All other native textarea props pass through (`value`, `onInput`, …).
 */
export function Textarea(props: TextareaProps): JSX.Element {
  const [own, rest] = splitProps(props, ['class']);
  return (
    <textarea
      data-fdt="textarea"
      class={cn(
        'w-full rounded border border-line-2 bg-surface-2 px-2 py-1 font-mono text-xs text-fg-primary placeholder:text-fg-muted',
        'hover:border-line-3',
        'aria-invalid:border-status-error aria-invalid:ring-1 aria-invalid:ring-status-error/40',
        DISABLED,
        FOCUS_RING,
        own.class
      )}
      {...rest}
    />
  );
}
