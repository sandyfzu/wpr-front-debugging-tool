/**
 * The panel's button — one component for every click target, with the shared
 * variants, densities and busy behavior. Interactive floor: both sizes keep
 * the WCAG 2.5.8 24×24 px minimum hit area (24px tall at `sm`).
 */
import type { ComponentProps, JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import { Show } from 'solid-js';
import LoaderCircle from 'lucide-solid/icons/loader-circle';
import { cn } from '../../utils/cn';
import { DISABLED, FOCUS_RING } from './classes';
import { STATUS_SOFT_CLASSES, STATUS_TEXT_CLASSES } from './status-badge';

/** The visual weight of a button, in registry order. */
export const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const;

/** One button variant name. */
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

/** The density of a button. */
export const BUTTON_SIZES = ['sm', 'md'] as const;

/** One button size. */
export type ButtonSize = (typeof BUTTON_SIZES)[number];

/** Resting look per variant — the single declaring site of the variants' colors. */
export const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Solid accent fill under the AA-verified `accent-strong`/`on-accent` pair.
  primary: 'border-transparent bg-accent-strong text-on-accent',
  secondary: 'border-line-2 bg-surface-2 text-fg-primary',
  ghost: 'border-transparent text-fg-secondary',
  // The vocabulary's soft error chip, consumed from `status-badge.tsx` (UX-D7
  // single source — never re-typed here): the fill/text pair stays the
  // AA-verified `status-error-soft`/`status-error`.
  danger: cn('border-transparent', STATUS_SOFT_CLASSES.error, STATUS_TEXT_CLASSES.error)
};

/**
 * Pointer feedback per variant (hover lift, press) — applied only to a live
 * button, so a held one keeps its resting look under the pointer.
 */
export const BUTTON_VARIANT_HOVER_CLASSES: Record<ButtonVariant, string> = {
  // `brightness` keeps white text on the accent fill at ≥ 4.5:1 while giving
  // a visible lift (the lighter `--accent` fill would break contrast in dark).
  primary: 'hover:brightness-110 active:brightness-95',
  secondary: 'hover:border-line-3 hover:bg-surface-3',
  ghost: 'hover:bg-surface-3 hover:text-fg-primary',
  // Emphasis through an inset ring only: a solid error fill would put white
  // text on the dark-palette error token, which fails the 4.5:1 floor.
  danger: 'hover:ring-1 hover:ring-inset hover:ring-status-error/40'
};

/**
 * Whether a button is held: natively disabled, or `aria-disabled` (a held
 * action that keeps focus). A held button shows no pointer feedback.
 *
 * @param disabled The native `disabled` state.
 * @param ariaDisabled The `aria-disabled` attribute value (boolean or string form).
 * @returns `true` when either state disables the button.
 */
export function isHeld(disabled: boolean | undefined, ariaDisabled: unknown): boolean {
  return disabled === true || ariaDisabled === true || ariaDisabled === 'true';
}

/**
 * The variant's classes for a button: its resting look, plus its pointer
 * feedback while live.
 *
 * @param variant The variant.
 * @param held Whether the button is held (see {@link isHeld}).
 * @returns The class string.
 */
export function buttonVariantClasses(variant: ButtonVariant, held: boolean): string {
  return held
    ? BUTTON_VARIANT_CLASSES[variant]
    : `${BUTTON_VARIANT_CLASSES[variant]} ${BUTTON_VARIANT_HOVER_CLASSES[variant]}`;
}

/** Class per size — both meet the 24px hit-area floor. */
const BUTTON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-6 px-2 text-2xs',
  md: 'h-7 px-2.5 text-xs'
};

export type ButtonProps = {
  /** Visual weight (default `secondary`). */
  variant?: ButtonVariant;
  /** Density (default `md`). */
  size?: ButtonSize;
  /** Busy state: disables the control and shows the spinner. */
  loading?: boolean;
} & ComponentProps<'button'>;

/**
 * Render the button used by every surface (shell and pages).
 *
 * A native `<button>` so keyboard/pointer behavior stays the platform's —
 * no headless wrapper needed for this mechanism. While `loading`, the control
 * disables itself (native single-submit guard) and labels the busy state for
 * assistive tech via `aria-busy`; the spinner is decorative (`aria-hidden`).
 * A held button (disabled, loading or `aria-disabled`) keeps its resting
 * look under the pointer — no hover lift promising an action it won't take.
 *
 * @param props.variant See {@link BUTTON_VARIANTS} (default `secondary`).
 * @param props.size See {@link BUTTON_SIZES} (default `md`).
 * @param props.loading Disables the button and swaps a spinner in front of the content.
 * @param props.class Extra classes, merged last so callers win.
 * @param props.children The label (and optional leading icon); spaced automatically.
 */
export function Button(props: ButtonProps): JSX.Element {
  const [own, rest] = splitProps(props, [
    'variant',
    'size',
    'loading',
    'disabled',
    'class',
    'children'
  ]);
  return (
    <button
      type="button"
      data-fdt="button"
      data-fdt-loading={own.loading ? '' : undefined}
      aria-busy={own.loading || undefined}
      // Native single-submit guard: a busy button cannot be clicked again.
      disabled={own.disabled || own.loading}
      class={cn(
        'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded border font-medium',
        FOCUS_RING,
        DISABLED,
        buttonVariantClasses(
          own.variant ?? 'secondary',
          isHeld(own.disabled || own.loading, rest['aria-disabled'])
        ),
        BUTTON_SIZE_CLASSES[own.size ?? 'md'],
        own.class
      )}
      {...rest}
    >
      <Show when={own.loading}>
        <LoaderCircle size={14} class="animate-spin shrink-0" aria-hidden="true" data-fdt-spinner />
      </Show>
      {own.children}
    </button>
  );
}
