/**
 * The one presentation of a header value the panel withheld (a cookie,
 * credential or token — see `lib/panel/redaction`), shared by every page
 * that lists headers so the same header never reads differently on two
 * pages: a lock plus the marker text, muted and italic so it never passes
 * for a value; the reason rides the `title` and screen-reader text, which
 * keeps repeated rows on one line at narrow widths. A surface with any
 * withheld value also renders {@link WithheldLegend} once, so the reason is
 * visible to touch and keyboard users without a per-row line.
 */
import type { JSX } from 'solid-js';
import Lock from 'lucide-solid/icons/lock';
import { cn } from '../../../utils/cn';

/** Why a value is withheld (the hover title and screen-reader text). */
export const WITHHELD_NOTE = 'Withheld — this header can carry credentials';

/** The one visible line explaining the lock markers of a list. */
export const WITHHELD_LEGEND =
  'Values marked with a lock are withheld — those headers can carry credentials.';

/** Props of {@link WithheldLegend}. */
export interface WithheldLegendProps {
  /** Extra classes, merged last so callers win. */
  class?: string;
}

/**
 * Render the legend for a list holding withheld values — once per list,
 * where every user can read it.
 *
 * @param props See {@link WithheldLegendProps}.
 * @returns The legend line.
 */
export function WithheldLegend(props: WithheldLegendProps): JSX.Element {
  return (
    <p
      data-fdt="withheld-legend"
      class={cn('flex items-start gap-1.5 text-2xs text-fg-muted', props.class)}
    >
      <Lock size={12} class="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{WITHHELD_LEGEND}</span>
    </p>
  );
}

/** Props of {@link WithheldValue}. */
export interface WithheldValueProps {
  /** The marker text the redaction produced (`(value redacted)`, `name=(value redacted)`). */
  value: string;
  /** Extra classes, merged last so callers win. */
  class?: string;
}

/**
 * Render a withheld header value.
 *
 * @param props See {@link WithheldValueProps}.
 * @returns The marked value.
 */
export function WithheldValue(props: WithheldValueProps): JSX.Element {
  return (
    <span
      data-fdt-redacted=""
      title={WITHHELD_NOTE}
      class={cn('flex items-start gap-1 font-mono text-fg-muted italic', props.class)}
    >
      <Lock size={12} class="mt-0.5 shrink-0" aria-hidden="true" />
      <span class="min-w-0 wrap-anywhere">{props.value}</span>
      <span class="sr-only"> — {WITHHELD_NOTE}</span>
    </span>
  );
}
