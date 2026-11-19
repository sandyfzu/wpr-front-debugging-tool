/**
 * The single source of the status vocabulary's colors and icons (UX-D7).
 *
 * Exactly five kinds — `ok / warn / error / info / neutral` — rendered either
 * as soft chips (token `*-soft` background + matching token text) or as bare
 * token-colored text/icons. Every pair below sits on an AA-verified token pair
 * from the committed contrast table. Nothing else may hardcode a status color:
 * consumers import these tables (badges, toasts, nav live-state) so the panel,
 * the strip and the toolbar badge speak the same five colors.
 */
import type { LucideIcon } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import CircleCheck from 'lucide-solid/icons/circle-check';
import CircleMinus from 'lucide-solid/icons/circle-minus';
import CircleX from 'lucide-solid/icons/circle-x';
import Info from 'lucide-solid/icons/info';
import TriangleAlert from 'lucide-solid/icons/triangle-alert';
import { cn } from '../../utils/cn';

/** The exact vocabulary kinds, in registry order. */
export const STATUS_KINDS = ['ok', 'warn', 'error', 'info', 'neutral'] as const;

/** One kind of the status vocabulary. */
export type StatusKind = (typeof STATUS_KINDS)[number];

/**
 * Text/icon color class per kind — the status token consumed as text or icon
 * color over any AA-verified status/surface background.
 */
export const STATUS_TEXT_CLASSES: Record<StatusKind, string> = {
  ok: 'text-status-ok',
  warn: 'text-status-warn',
  error: 'text-status-error',
  info: 'text-status-info',
  neutral: 'text-status-neutral'
};

/** Soft chip background class per kind — the matching `*-soft` token. */
export const STATUS_SOFT_CLASSES: Record<StatusKind, string> = {
  ok: 'bg-status-ok-soft',
  warn: 'bg-status-warn-soft',
  error: 'bg-status-error-soft',
  info: 'bg-status-info-soft',
  neutral: 'bg-status-neutral-soft'
};

/** The vocabulary's icon per kind — declared beside the colors it recolors. */
export const STATUS_ICONS: Record<StatusKind, LucideIcon> = {
  ok: CircleCheck,
  warn: TriangleAlert,
  error: CircleX,
  info: Info,
  neutral: CircleMinus
};

export interface StatusBadgeProps {
  /** The vocabulary kind to render. */
  kind: StatusKind;
  /** Whether to lead the label with the kind's vocabulary icon. */
  icon?: boolean;
  /** Extra classes, merged last so callers win. */
  class?: string;
  /** Hover text with the state's detail (a plain `title`: cheap on virtual rows). */
  title?: string;
  /** The badge label. */
  children: JSX.Element;
}

/**
 * Render a status label in the vocabulary's colors.
 *
 * The soft chip form: kind background + kind text (+ optional kind icon),
 * compact enough to sit inline in cards and nav rows. Non-interactive by
 * design — it conveys state, it never takes clicks.
 *
 * @param props.kind The kind; colors and icon come from the tables above.
 * @param props.icon Whether to lead with the kind's icon (default: plain text).
 * @param props.class Extra classes for layout context.
 * @param props.title Optional hover text.
 * @param props.children The label.
 */
export function StatusBadge(props: StatusBadgeProps): JSX.Element {
  return (
    <span
      data-fdt="status-badge"
      title={props.title}
      class={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium',
        STATUS_SOFT_CLASSES[props.kind],
        STATUS_TEXT_CLASSES[props.kind],
        props.class
      )}
    >
      <Show when={props.icon}>
        <Dynamic
          component={STATUS_ICONS[props.kind]}
          size={12}
          class="shrink-0"
          aria-hidden="true"
        />
      </Show>
      {props.children}
    </span>
  );
}

/** Props of {@link StatusDot}. */
export interface StatusDotProps {
  /** The vocabulary kind (its token color). */
  kind: StatusKind;
  /** Placement classes (position, offsets), merged last. */
  class?: string;
  /** A test/inspection hook. */
  'data-fdt'?: string;
}

/**
 * Render a 6 px dot in a kind's color: the glance marker an icon-only
 * control wears for a state it folded away (e.g. a menu holding a stale
 * marker). Decorative by contract — the control's accessible name must
 * carry the state's words, so the color never speaks alone.
 *
 * @param props.kind The kind; the color comes from {@link STATUS_TEXT_CLASSES}.
 * @param props.class Placement classes.
 */
export function StatusDot(props: StatusDotProps): JSX.Element {
  return (
    <span
      data-fdt={props['data-fdt']}
      aria-hidden="true"
      class={cn('size-1.5 rounded-full bg-current', STATUS_TEXT_CLASSES[props.kind], props.class)}
    />
  );
}
