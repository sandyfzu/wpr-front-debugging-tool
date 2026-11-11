/**
 * The resource-list page body shared by the Lazyload and Preloaded Resources
 * pages: one filter/search/list pattern over a page's row type, so each page
 * declares only its rows, summary, empty state and row renderer.
 *
 * Layout (a `fill` frame): header → summary strip (feature presence + row
 * total; per-filter counts live on the chips only) → the filter/search/list
 * body (`./filtered-list`, which owns the list's state matrix and search).
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { StatusBadge } from '../../../../components/ui/status-badge';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import type { ResourcePageDefinition } from '../../../../lib/panel/resources-view-model';
import { countLabel, type CountNoun } from '../../../../lib/panel/list-behavior';
import type { RouteId } from '../../routes';
import { PageFrame } from '../page-frame';
import { FilteredList, type ResourceRow } from './filtered-list';

export type { ResourceRow } from './filtered-list';

/** Props of {@link ResourceListPage}. */
export interface ResourceListPageProps<Row extends ResourceRow, Id extends string> {
  /** The route this body renders. */
  id: RouteId;
  /** The page `h1`. */
  title: string;
  /** The one-line "what am I looking at". */
  subtitle: string;
  /** The page's chips + searched field. */
  definition: ResourcePageDefinition<Row, Id>;
  /** Every row on the page (reactive: a refresh swaps it). */
  rows: readonly Row[];
  /**
   * Whether two rows with the same id carry the same content: unchanged rows
   * keep their object (and so their rendered row and focus) across a refresh.
   */
  sameRow: (a: Row, b: Row) => boolean;
  /** Muted lines under the summary strip (capped list, feature caveats). */
  notes?: readonly string[];
  /** The WP Rocket feature the page inspects, as the option map names it. */
  featureLabel: string;
  /** Whether that feature's footprint was detected on the page. */
  featurePresent: boolean;
  /** A verified simulation, not WP Rocket, runs the feature on the page (never with `featurePresent`). */
  featureSimulated?: boolean;
  /** The view shown in the list region when the page has no rows at all. */
  empty: JSX.Element;
  /** The rows' noun, for announcements. */
  noun: CountNoun;
  /** The list's accessible name ("Images"). */
  listLabel: string;
  /** The search field's accessible name. */
  searchLabel: string;
  /** The search field's placeholder. */
  searchPlaceholder: string;
  /** A row's seed height in px (measurement refines it). */
  estimateSize: (row: Row) => number;
  /** Render one row's content (the list wraps it in its `listitem`). */
  renderRow: (row: Row) => JSX.Element;
  /** A key to the rows' chips, between the filter bar and the list (shown while rows exist). */
  legend?: JSX.Element;
  /** The virtualizer seam (tests inject a layout-free double). */
  createVirtualizer?: VirtualizerFactory;
}

/**
 * Render a resource-list page body.
 *
 * @param props See {@link ResourceListPageProps}.
 */
export function ResourceListPage<Row extends ResourceRow, Id extends string>(
  props: ResourceListPageProps<Row, Id>
): JSX.Element {
  return (
    <PageFrame id={props.id} title={props.title} subtitle={props.subtitle} fill>
      <ResourceSummary
        featureLabel={props.featureLabel}
        featurePresent={props.featurePresent}
        featureSimulated={props.featureSimulated === true}
        total={props.rows.length > 0 ? countLabel(props.rows.length, props.noun) : undefined}
        notes={props.notes}
      />
      <FilteredList
        definition={props.definition}
        rows={props.rows}
        sameRow={props.sameRow}
        empty={props.empty}
        noun={props.noun}
        listLabel={props.listLabel}
        searchLabel={props.searchLabel}
        searchPlaceholder={props.searchPlaceholder}
        estimateSize={props.estimateSize}
        renderRow={props.renderRow}
        legend={props.legend}
        createVirtualizer={props.createVirtualizer}
      />
    </PageFrame>
  );
}

/** Props of {@link ResourceSummary}. */
interface ResourceSummaryProps {
  /** The feature's option-map label. */
  featureLabel: string;
  /** Whether its footprint was detected. */
  featurePresent: boolean;
  /** A verified simulation runs it instead (info: the extension's, not the site's). */
  featureSimulated: boolean;
  /** The counted row total ("24 images"); omitted when the page has none. */
  total?: string;
  /** Muted caveat lines. */
  notes?: readonly string[];
}

/**
 * The summary badge's kind: detected `ok`, simulated `info`, else `neutral`.
 *
 * @param present The feature's footprint was detected.
 * @param simulated A verified simulation runs it instead.
 */
function summaryKind(present: boolean, simulated: boolean): 'ok' | 'info' | 'neutral' {
  if (present) return 'ok';
  return simulated ? 'info' : 'neutral';
}

/**
 * The summary badge's state word after the feature's name.
 *
 * @param present The feature's footprint was detected.
 * @param simulated A verified simulation runs it instead.
 */
function summaryWord(present: boolean, simulated: boolean): string {
  if (present) return 'detected';
  return simulated ? 'simulated' : 'not detected';
}

/**
 * The summary strip: the feature's presence as a status badge whose state is
 * spelled out (never color alone), the page's row total, and any caveat notes
 * on their own lines.
 *
 * @param props See {@link ResourceSummaryProps}.
 */
function ResourceSummary(props: ResourceSummaryProps): JSX.Element {
  return (
    <div data-fdt="resource-summary" class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <StatusBadge kind={summaryKind(props.featurePresent, props.featureSimulated)} icon>
        {props.featureLabel}
        <span class="font-normal">{summaryWord(props.featurePresent, props.featureSimulated)}</span>
      </StatusBadge>
      <Show when={props.total}>
        <span data-fdt="resource-total" class="text-2xs text-fg-secondary tabular-nums">
          {props.total}
        </span>
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
