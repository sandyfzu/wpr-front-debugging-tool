/**
 * The generic badge chip — counts, tags, and any label that needs a compact
 * chip shape with the shared status palette. Status *semantics* always go
 * through `StatusBadge` (UX-D7); this component is its shape-only sibling that
 * borrows the vocabulary's colors.
 */
import type { JSX } from 'solid-js';
import type { StatusKind } from './status-badge';
import { STATUS_SOFT_CLASSES, STATUS_TEXT_CLASSES } from './status-badge';
import { cn } from '../../utils/cn';

/** Visual treatment of the chip: soft fill or outlined ghost. */
export type BadgeVariant = 'soft' | 'outline';

export interface BadgeProps {
  /** Which status vocabulary colors to borrow (default `neutral`). */
  kind?: StatusKind;
  /** `soft` = token fill + token text; `outline` = neutral border + token text. */
  variant?: BadgeVariant;
  /** Extra classes, merged last so callers win. */
  class?: string;
  /** Hover text (a plain `title`: cheap on virtual rows). */
  title?: string;
  /** The badge label. */
  children: JSX.Element;
}

/**
 * Render a compact chip label.
 *
 * Non-interactive by design (a clickable badge is a button — use `Button`
 * variant `ghost`); hit-size contracts therefore do not apply, but the text
 * contrast stays AA-verified in both palettes for every `kind`.
 *
 * @param props.kind The vocabulary colors to borrow (default `neutral`).
 * @param props.variant The chip treatment (default `soft`).
 * @param props.class Extra classes for layout context.
 * @param props.title Optional hover text.
 * @param props.children The label.
 */
export function Badge(props: BadgeProps): JSX.Element {
  const kind = () => props.kind ?? 'neutral';
  return (
    <span
      data-fdt="badge"
      title={props.title}
      class={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs',
        props.variant === 'outline' ? 'border border-line-2' : STATUS_SOFT_CLASSES[kind()],
        STATUS_TEXT_CLASSES[kind()],
        props.class
      )}
    >
      {props.children}
    </span>
  );
}
