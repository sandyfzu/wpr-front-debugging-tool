/**
 * The summary strip of a resource-list page whose rows come with the page
 * data (Lazyload, Preloaded Resources): the inspected feature by its
 * plugin-settings name with its state spelled out (never color alone), the
 * row total, and the page's caveat notes on their own lines — the same
 * strip the JavaScript page draws. Per-value counts live on the facets
 * only: one place per number.
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { delaySummaryBadge } from '../javascript/script-view';

/** Props of {@link ResourceSummary}. */
export interface ResourceSummaryProps {
  /** The inspected feature's name ("LazyLoad for images"). */
  featureLabel: string;
  /** Whether its footprint was detected on the page. */
  featurePresent: boolean;
  /** A verified simulation runs it instead (never with `featurePresent`). */
  featureSimulated?: boolean;
  /** The counted row total ("24 images"); omitted when the page has none. */
  total?: string;
  /** Muted caveat lines (a capped list, a feature caveat). */
  notes?: readonly string[];
}

/**
 * Render the summary strip.
 *
 * @param props See {@link ResourceSummaryProps}.
 */
export function ResourceSummary(props: ResourceSummaryProps): JSX.Element {
  // One vocabulary with the JavaScript page's strip: Detected / Simulated / Not detected.
  const badge = () => delaySummaryBadge(props.featurePresent, props.featureSimulated === true);
  return (
    <div
      data-fdt="resource-summary"
      class="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md border border-line-1 bg-surface-1 px-2.5 py-1.5 text-xs"
    >
      {/* Flat items, so a compact strip wraps into two lines, never three. */}
      <span class="me-0.5 font-medium text-fg-primary">{props.featureLabel}</span>
      <StatusBadge kind={badge().kind} icon>
        {badge().label}
      </StatusBadge>
      <Show when={props.total}>
        {(total) => (
          <span data-fdt="resource-total" class="ms-auto ps-2 text-fg-secondary tabular-nums">
            {total()}
          </span>
        )}
      </Show>
      <For each={props.notes}>
        {(note) => (
          <p data-fdt="resource-note" class="basis-full text-2xs text-fg-muted">
            {note}
          </p>
        )}
      </For>
    </div>
  );
}
