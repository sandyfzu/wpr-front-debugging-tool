/**
 * The summary strip of a resource-list page whose rows come with the page
 * data (JavaScript, Lazyload, Preloaded Resources): the inspected feature by
 * its plugin-settings name with its state spelled out (never color alone),
 * its version when it announces one, the row total, and the page's caveat
 * notes on their own lines. Per-value counts live on the facets only: one
 * place per number.
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { StatusBadge, type StatusKind } from '../../../../components/ui/status-badge';

/** A summary-strip state: its words and its vocabulary kind. */
export interface SummaryBadge {
  readonly label: string;
  readonly kind: StatusKind;
}

/**
 * The strip's feature state: served by WP Rocket, run by a verified
 * simulation (never "Not detected" while a runtime does the feature's work),
 * or absent.
 *
 * @param present WP Rocket's footprint of the feature was detected.
 * @param simulated A verified simulation runs the feature here instead.
 * @returns The badge's word and tone.
 */
export function featureStateBadge(present: boolean, simulated: boolean): SummaryBadge {
  if (present) return { label: 'Detected', kind: 'ok' };
  // Info, as every other "Simulated" badge: its glyph sets it apart from
  // "Not detected" (never the word alone).
  if (simulated) return { label: 'Simulated', kind: 'info' };
  return { label: 'Not detected', kind: 'neutral' };
}

/**
 * The strip's `data-fdt` hook family: `<family>-summary`, `-total`, `-note`
 * (the JavaScript page keeps its own `script-…` names).
 */
export type SummaryHookFamily = 'resource' | 'script';

/** Props of {@link ResourceSummary}. */
export interface ResourceSummaryProps {
  /** The inspected feature's name ("LazyLoad for images"). */
  featureLabel: string;
  /** Whether its footprint was detected on the page. */
  featurePresent: boolean;
  /** A verified simulation runs it instead (never with `featurePresent`). */
  featureSimulated?: boolean;
  /** The feature's announced version, shown only with a detected footprint. */
  version?: string | null;
  /** The counted row total ("24 images"); omitted when the page has none. */
  total?: string;
  /** Muted caveat lines (a capped list, a feature caveat). */
  notes?: readonly string[];
  /** The hook family (default `resource`). */
  hooks?: SummaryHookFamily;
}

/**
 * Render the summary strip.
 *
 * @param props See {@link ResourceSummaryProps}.
 */
export function ResourceSummary(props: ResourceSummaryProps): JSX.Element {
  const badge = () => featureStateBadge(props.featurePresent, props.featureSimulated === true);
  const hooks = (): SummaryHookFamily => props.hooks ?? 'resource';
  return (
    <div
      data-fdt={`${hooks()}-summary`}
      class="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md border border-line-1 bg-surface-1 px-2.5 py-1.5 text-xs"
    >
      {/* Flat items, so a compact strip wraps into two lines, never three. */}
      <span class="me-0.5 font-medium text-fg-primary">{props.featureLabel}</span>
      <StatusBadge kind={badge().kind} icon>
        {badge().label}
      </StatusBadge>
      <Show when={props.featurePresent && props.version}>
        {(version) => (
          <span class="ms-1 font-mono text-2xs text-fg-secondary">
            <span class="sr-only">Version </span>
            <span aria-hidden="true">v</span>
            {version()}
          </span>
        )}
      </Show>
      <Show when={props.total}>
        {(total) => (
          <span data-fdt={`${hooks()}-total`} class="ms-auto ps-2 text-fg-secondary tabular-nums">
            {total()}
          </span>
        )}
      </Show>
      <For each={props.notes}>
        {(note) => (
          <p data-fdt={`${hooks()}-note`} class="basis-full text-2xs text-fg-muted">
            {note}
          </p>
        )}
      </For>
    </div>
  );
}
