/**
 * A beacon test's result lists, one per feature tab: the critical image
 * candidates as a table (image URL · element kind · the beacon's label, LCP
 * chip, search over every value the record carries, and per-row Details
 * listing those values) and the lazy-render
 * element hashes as a searchable list — both through the panel's shared
 * filter/search/virtualized list.
 *
 * States per list: running (skeleton rows: a real wait), no results yet
 * (Run), the feature was not part of the run (a way back to the settings),
 * an unreadable list, empty (what would be here), populated (with a cut or
 * a skipped-records note when one applies), filtered-empty (the shared
 * `NoMatches`).
 */
import type { JSX } from 'solid-js';
import { createComputed, createMemo, createSignal, Match, on, Show, Switch } from 'solid-js';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import ImageIcon from 'lucide-solid/icons/image';
import Layers from 'lucide-solid/icons/layers';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { MOTION_TURN } from '../../../../components/ui/classes';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ErrorState } from '../../../../components/ui/error-state';
import { KeyValueList } from '../../../../components/ui/key-value';
import { Skeleton } from '../../../../components/ui/skeleton';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { BEACON_FEATURE_LABELS } from '../../../../lib/beacon-test/outcome-view';
import {
  RESULT_RECORDS_MAX,
  type AboveTheFoldCandidate,
  type FeatureList
} from '../../../../lib/beacon-test/results';
import {
  ABOVE_THE_FOLD_LIST,
  aboveTheFoldRows,
  LAZY_RENDER_LIST,
  lazyRenderRows,
  LCP_LABEL,
  sameAboveTheFoldRow,
  sameLazyRenderRow,
  type AboveTheFoldRow,
  type LazyRenderRow
} from '../../../../lib/beacon-test/results-view';
import { pruneKeyedFlags, toggleRowFlag } from '../../../../lib/panel/list-behavior';
import { capTitle } from '../../../../utils/cap-text';
import type { BeaconFeatureKey } from '../../../../lib/beacon-test/runner-bridge';
import { cn } from '../../../../utils/cn';
import { countLabel, formatCount } from '../../../../utils/format-count';
import { FilteredList } from '../resource-list/filtered-list';
import { reconcileRows } from '../resource-list/resource-list-view';
import { PAGE_FILL_SCROLLER } from '../page-frame';
import type { SettingsLoadState } from '../settings/stored-settings';

/** The table's columns: URL (takes the rest), kind, label. */
const TABLE_COLUMNS = '@regular:grid @regular:grid-cols-[minmax(0,1fr)_7rem_7rem] @regular:gap-3';

/** Each list's empty view. */
export const EMPTY_COPY: Readonly<
  Record<BeaconFeatureKey, { title: string; description: string }>
> = {
  aboveTheFold: {
    title: 'No critical image candidates',
    description:
      'No candidate element above the fold shows an image in this viewport — WP Rocket would preload nothing here.'
  },
  lazyRender: {
    title: 'No lazy-render elements',
    description: `No element WP Rocket marked (data-rocket-location-hash) starts far enough below the fold. WP Rocket marks elements only on pages ${BEACON_FEATURE_LABELS.lazyRender} processed.`
  }
};

/**
 * The note under a list: how much of it is shown and what was left out.
 *
 * @param list The validated list.
 * @returns The note, or null when the whole list is shown.
 */
export function listNote(list: FeatureList<unknown>): string | null {
  if (list.kind !== 'ok') return null;
  const parts: string[] = [];
  if (list.truncated) {
    parts.push(
      `The beacon reported more than ${formatCount(RESULT_RECORDS_MAX)}; the first ${formatCount(RESULT_RECORDS_MAX)} are listed.`
    );
  }
  if (list.dropped > 0) {
    parts.push(
      `${countLabel(list.dropped, { one: 'entry', other: 'entries' })} the beacon could not describe left out, as WP Rocket leaves them out.`
    );
  }
  return parts.length === 0 ? null : parts.join(' ');
}

/** The no-results view's words. */
export const NO_RESULTS_COPY = {
  title: 'No results yet',
  description: 'Run the test to see what the beacon finds on this page.',
  /** After a run that ended without results. */
  ended: 'The last test ended without results — its outcome above says why.',
  /** The settings could not be read, so nothing can run. */
  settingsFailed:
    "The test settings didn't load, so the test can't run yet. Open the settings to retry."
} as const;

/**
 * The no-results line.
 *
 * @param settings The settings' load status.
 * @param ended Whether a test ended (without results).
 * @returns Why there is nothing yet and what to do.
 */
export function noResultsCopy(settings: SettingsLoadState['status'], ended: boolean): string {
  if (settings === 'failed') return NO_RESULTS_COPY.settingsFailed;
  return ended ? NO_RESULTS_COPY.ended : NO_RESULTS_COPY.description;
}

/** What every results tab shares. */
interface ResultsTabProps {
  /** A test is running (its results replace these). */
  running: boolean;
  /** A test ended (without results, when the list is undefined). */
  ended: boolean;
  /** The settings' load: a test runs only once they are ready. */
  settings: SettingsLoadState['status'];
  /** Run the test. */
  onRun: () => void;
  /** Go to the settings (a feature that did not run). */
  onShowSettings: () => void;
  createVirtualizer?: VirtualizerFactory;
}

/** Props of {@link FeatureResults}. */
interface FeatureResultsProps<T> extends ResultsTabProps {
  feature: BeaconFeatureKey;
  /** The run's list: null when the feature was not part of it, undefined without results. */
  list: FeatureList<T> | null | undefined;
  /** The populated list. */
  children: (list: Extract<FeatureList<T>, { kind: 'ok' }>) => JSX.Element;
}

/**
 * A feature's list in its state: running, no results, not run, unreadable,
 * or the list (with its note).
 *
 * @param props See {@link FeatureResultsProps}.
 */
function FeatureResults<T>(props: FeatureResultsProps<T>): JSX.Element {
  const ok = () => (props.list?.kind === 'ok' ? props.list : undefined);
  return (
    <Switch>
      <Match when={props.running}>
        <div class="grid grid-cols-1 gap-2" data-fdt-beacon-results-loading>
          <Skeleton class="h-7 w-full" />
          <Skeleton class="h-8 w-full" />
          <Skeleton class="h-8 w-full" />
        </div>
      </Match>
      <Match when={props.list === undefined}>
        <div class={cn(PAGE_FILL_SCROLLER, 'grid')}>
          <EmptyState
            title={NO_RESULTS_COPY.title}
            description={noResultsCopy(props.settings, props.ended)}
            action={
              // A failed settings load leads to its Retry; a loading one holds Run.
              props.settings === 'failed' ? (
                <Button size="sm" variant="primary" onClick={props.onShowSettings}>
                  Open settings
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={props.settings !== 'ready'}
                  onClick={props.onRun}
                >
                  Run test
                </Button>
              )
            }
          />
        </div>
      </Match>
      <Match when={props.list === null}>
        <div class={cn(PAGE_FILL_SCROLLER, 'grid')}>
          <EmptyState
            title="Not part of this test"
            description={`Turn on ${BEACON_FEATURE_LABELS[props.feature]} in the settings and run again.`}
            action={
              <Button size="sm" variant="primary" onClick={props.onShowSettings}>
                Open settings
              </Button>
            }
          />
        </div>
      </Match>
      <Match when={props.list?.kind === 'malformed'}>
        <ErrorState
          title="The beacon's list was unreadable"
          message="The page answered something that is not a list. Run again; reload the page if it keeps happening."
          onRetry={props.onRun}
          retryLabel="Run again"
        />
      </Match>
      <Match when={ok()}>
        {(list) => (
          <>
            <Show when={listNote(list())}>
              {(note) => (
                <p data-fdt-beacon-list-note class="text-2xs text-fg-muted">
                  {note()}
                </p>
              )}
            </Show>
            {props.children(list())}
          </>
        )}
      </Match>
    </Switch>
  );
}

/** A candidate row's height in px, collapsed (the list measures the real one). */
const CANDIDATE_ROW_PX = 36;

/** One detail line's height in px (the seed for an open row). */
const DETAIL_LINE_PX = 18;

/**
 * A candidate row's seed height.
 *
 * @param row The row.
 * @param expanded Whether its details are open.
 * @returns px.
 */
export function estimateCandidateRow(row: AboveTheFoldRow, expanded: boolean): number {
  if (!expanded) return CANDIDATE_ROW_PX;
  const lines = row.facts.reduce((sum, fact) => sum + fact.value.split('\n').length, 0);
  return CANDIDATE_ROW_PX + 8 + Math.max(lines, 1) * DETAIL_LINE_PX;
}

/** Props of {@link CandidateRow}. */
interface CandidateRowProps {
  row: AboveTheFoldRow;
  /** Whether the details are open. */
  expanded: boolean;
  onToggle: () => void;
}

/**
 * One candidate's row: URL (with Details), element kind, label (the LCP
 * stands out); Details opens every value the record carries.
 *
 * @param props See {@link CandidateRowProps}.
 */
function CandidateRow(props: CandidateRowProps): JSX.Element {
  const detailId = () => `beacon-candidate-detail-${String(props.row.id)}`;
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <div class={cn('flex min-w-0 flex-col gap-0.5', TABLE_COLUMNS, '@regular:items-center')}>
        <span class="flex min-w-0 items-center gap-1">
          <span
            class="min-w-0 flex-1 truncate font-mono text-2xs text-fg-primary"
            title={props.row.url === '' ? undefined : capTitle(props.row.url)}
          >
            {props.row.url === '' ? 'No image URL' : props.row.url}
          </span>
          <Show when={props.row.facts.length > 0}>
            <Button
              size="sm"
              variant="ghost"
              class="shrink-0"
              aria-expanded={props.expanded}
              aria-controls={detailId()}
              data-fdt-beacon-candidate-toggle
              onClick={() => {
                props.onToggle();
              }}
            >
              <ChevronRight
                size={12}
                aria-hidden="true"
                class={cn(MOTION_TURN, props.expanded && 'rotate-90')}
              />
              Details
            </Button>
          </Show>
        </span>
        <span class="min-w-0 truncate font-mono text-2xs text-fg-secondary">{props.row.kind}</span>
        <span class="min-w-0">
          <Badge kind={props.row.label === LCP_LABEL ? 'info' : 'neutral'}>
            {props.row.label === '' ? 'No label' : props.row.label}
          </Badge>
        </span>
      </div>
      <Show when={props.expanded && props.row.facts.length > 0}>
        <div id={detailId()} data-fdt-beacon-candidate-detail class="min-w-0 pb-1">
          <KeyValueList
            items={props.row.facts.map((fact) => ({
              term: fact.term,
              value: <span class="font-mono break-all whitespace-pre-line">{fact.value}</span>
            }))}
          />
        </div>
      </Show>
    </div>
  );
}

/** The table's column heads (regular tier up; compact rows stack instead). */
function TableHead(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      class={cn(
        'hidden shrink-0 border-b border-line-1 px-2 py-1 text-2xs font-medium text-fg-muted',
        TABLE_COLUMNS
      )}
    >
      <span>Image URL</span>
      <span>Element</span>
      <span>Label</span>
    </div>
  );
}

/** Props of the critical images tab. */
export interface BeaconResultsProps extends ResultsTabProps {
  /** The run's list (null: not part of the run; undefined: no results). */
  list: FeatureList<AboveTheFoldCandidate> | null | undefined;
}

/**
 * The critical image candidates tab.
 *
 * @param props See {@link BeaconResultsProps}.
 */
export function AboveTheFoldResults(props: BeaconResultsProps): JSX.Element {
  // Reconciled here (not only in the list), so open details follow identity.
  const rows = createMemo(
    (previous: readonly AboveTheFoldRow[]) =>
      reconcileRows(previous, aboveTheFoldRows(props.list ?? null), sameAboveTheFoldRow),
    []
  );
  // Open details live here, keyed by row id; pruned to the rows still shown,
  // so every new run closes them all (running empties the rows) and another
  // candidate never opens expanded.
  const [expanded, setExpanded] = createSignal<ReadonlySet<number>>(new Set());
  createComputed(
    on(rows, (current, previous) => {
      if (previous === undefined) return;
      setExpanded((ids) => pruneKeyedFlags(ids, previous, current, (row) => row.id));
    })
  );
  return (
    <FeatureResults
      feature="aboveTheFold"
      list={props.list}
      running={props.running}
      ended={props.ended}
      settings={props.settings}
      onRun={props.onRun}
      onShowSettings={props.onShowSettings}
    >
      {() => (
        <FilteredList
          definition={ABOVE_THE_FOLD_LIST}
          rows={rows()}
          sameRow={sameAboveTheFoldRow}
          empty={
            <EmptyState
              icon={<ImageIcon size={16} aria-hidden="true" />}
              title={EMPTY_COPY.aboveTheFold.title}
              description={EMPTY_COPY.aboveTheFold.description}
            />
          }
          noun={{ one: 'candidate', other: 'candidates' }}
          listLabel="Critical image candidates"
          searchLabel="Search candidates"
          searchPlaceholder="Search URLs, elements, labels…"
          estimateSize={(row) => estimateCandidateRow(row, expanded().has(row.id))}
          renderRow={(row) => (
            <CandidateRow
              row={row}
              expanded={expanded().has(row.id)}
              onToggle={() => setExpanded((ids) => toggleRowFlag(ids, row.id))}
            />
          )}
          rowHook="beacon-candidate-row"
          head={<TableHead />}
          createVirtualizer={props.createVirtualizer}
        />
      )}
    </FeatureResults>
  );
}

/** Props of the lazy-render tab. */
export interface LazyRenderResultsProps extends ResultsTabProps {
  /** The run's list (null: not part of the run; undefined: no results). */
  list: FeatureList<string> | null | undefined;
}

/**
 * The lazy-render elements tab.
 *
 * @param props See {@link LazyRenderResultsProps}.
 */
export function LazyRenderResults(props: LazyRenderResultsProps): JSX.Element {
  const rows = createMemo(() => lazyRenderRows(props.list ?? null));
  return (
    <FeatureResults
      feature="lazyRender"
      list={props.list}
      running={props.running}
      ended={props.ended}
      settings={props.settings}
      onRun={props.onRun}
      onShowSettings={props.onShowSettings}
    >
      {() => (
        <FilteredList
          definition={LAZY_RENDER_LIST}
          rows={rows()}
          sameRow={sameLazyRenderRow}
          empty={
            <EmptyState
              icon={<Layers size={16} aria-hidden="true" />}
              title={EMPTY_COPY.lazyRender.title}
              description={EMPTY_COPY.lazyRender.description}
            />
          }
          noun={{ one: 'element', other: 'elements' }}
          listLabel="Lazy-render elements"
          searchLabel="Search hashes"
          searchPlaceholder="Search hashes…"
          estimateSize={() => 32}
          renderRow={(row: LazyRenderRow) => (
            <span class="block min-w-0 truncate font-mono text-2xs text-fg-primary">
              {row.hash}
            </span>
          )}
          rowHook="beacon-lazy-row"
          createVirtualizer={props.createVirtualizer}
        />
      )}
    </FeatureResults>
  );
}
