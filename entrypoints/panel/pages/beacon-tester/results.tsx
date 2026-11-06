/**
 * A beacon test's result lists, one per feature tab: the critical image
 * candidates as a table (image URL · element kind · the beacon's label, LCP
 * chip and search over every URL the record carries) and the lazy-render
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
import { createMemo, Match, Show, Switch } from 'solid-js';
import ImageIcon from 'lucide-solid/icons/image';
import Layers from 'lucide-solid/icons/layers';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ErrorState } from '../../../../components/ui/error-state';
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
import type { BeaconFeatureKey } from '../../../../lib/beacon-test/runner-bridge';
import { cn } from '../../../../utils/cn';
import { countLabel, formatCount } from '../../../../utils/format-count';
import { FilteredList } from '../resource-list/filtered-list';
import { PAGE_FILL_SCROLLER } from '../page-frame';

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
    description:
      'No element WP Rocket marked (data-rocket-location-hash) starts far enough below the fold. WP Rocket marks elements only on pages Automatic Lazy Rendering processed.'
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
  ended: 'The last test ended without results — its outcome above says why.'
} as const;

/** What every results tab shares. */
interface ResultsTabProps {
  /** A test is running (its results replace these). */
  running: boolean;
  /** A test ended (without results, when the list is undefined). */
  ended: boolean;
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
            description={props.ended ? NO_RESULTS_COPY.ended : NO_RESULTS_COPY.description}
            action={
              <Button size="sm" variant="primary" onClick={props.onRun}>
                Run test
              </Button>
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

/**
 * One candidate's row: URL, element kind, label (the LCP stands out).
 *
 * @param props.row The row.
 */
function CandidateRow(props: { row: AboveTheFoldRow }): JSX.Element {
  return (
    <div class={cn('flex min-w-0 flex-col gap-0.5', TABLE_COLUMNS, '@regular:items-center')}>
      <span
        class="min-w-0 truncate font-mono text-2xs text-fg-primary"
        title={props.row.detail === '' ? undefined : props.row.detail}
      >
        {props.row.url === '' ? 'No image URL' : props.row.url}
      </span>
      <span class="min-w-0 truncate font-mono text-2xs text-fg-secondary">{props.row.kind}</span>
      <span class="min-w-0">
        <Badge kind={props.row.label === LCP_LABEL ? 'info' : 'neutral'}>
          {props.row.label === '' ? 'No label' : props.row.label}
        </Badge>
      </span>
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
  const rows = createMemo(() => aboveTheFoldRows(props.list ?? null));
  return (
    <FeatureResults
      feature="aboveTheFold"
      list={props.list}
      running={props.running}
      ended={props.ended}
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
          estimateSize={() => 36}
          renderRow={(row) => <CandidateRow row={row} />}
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
