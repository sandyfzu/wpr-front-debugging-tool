/**
 * A beacon test's result lists, one per feature tab, on the panel's calm
 * list: the critical image candidates (image file name, element kind · URL,
 * the beacon's label with the LCP standing out; a Label facet, search over
 * every value the record carries; a row opens its detail — the URL's tile
 * and every value) and the lazy-render element hashes (one-line rows,
 * search only, no detail).
 *
 * States per list: running (skeleton rows: a real wait), no results yet
 * (what a run lists here — Run sits in the run bar above), the feature was
 * not part of the run (a way to its switch),
 * an unreadable list, empty (what would be here), populated (with a cut or
 * a skipped-records note when one applies), filtered-empty (the shared
 * `NoMatches`, with Clear filters).
 */
import type { Accessor, JSX } from 'solid-js';
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
  ABOVE_THE_FOLD_FACETS,
  aboveTheFoldSearchField,
  aboveTheFoldRows,
  LAZY_RENDER_FACETS,
  lazyRenderSearchField,
  lazyRenderRows,
  LCP_LABEL,
  sameAboveTheFoldRow,
  sameLazyRenderRow,
  type AboveTheFoldRow,
  type LazyRenderRow
} from '../../../../lib/beacon-test/results-view';
import type { BeaconFeatureKey } from '../../../../lib/beacon-test/runner-bridge';
import { countLabel, formatCount } from '../../../../utils/format-count';
import { openResourceCapability, type OpenResource } from '../open-resource';
import { CalmFilteredList } from '../resource-list/calm-list';
import { FactList, type DetailFact } from '../resource-list/detail-section';
import { ListRow, ListRowHead, type ListRowColumns } from '../resource-list/list-row';
import { resourceName, urlPreview } from '../resource-list/resource-list-view';
import { SourceLink } from '../resource-list/source-link';
import { ToolEmptyCard } from '../tool-empty-card';
import type { SettingsLoadState } from '../settings/stored-settings';

/** The candidates' noun (announcements, counts). */
const CANDIDATE_NOUN = { one: 'candidate', other: 'candidates' } as const;

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
  /** Before any test: what a run lists in each tab. */
  description: {
    aboveTheFold:
      'Run the test to list the above-the-fold images WP Rocket would preload, the LCP image first.',
    lazyRender:
      'Run the test to list the elements far enough below the fold for WP Rocket to render lazily.'
  } satisfies Readonly<Record<BeaconFeatureKey, string>>,
  /** After a run that ended without results. */
  ended: 'The last test ended without results — its outcome above says why.',
  /** The settings could not be read, so nothing can run. */
  settingsFailed:
    "The test settings didn't load, so the test can't run yet. Retry them under Settings."
} as const;

/** The action leading to the settings (they sit beside or under the results). */
export const SHOW_SETTINGS_LABEL = 'Go to settings';

/**
 * The no-results line.
 *
 * @param settings The settings' load status.
 * @param ended Whether a test ended (without results).
 * @param feature The tab's feature.
 * @returns Why there is nothing yet and what to do.
 */
export function noResultsCopy(
  settings: SettingsLoadState['status'],
  ended: boolean,
  feature: BeaconFeatureKey
): string {
  if (settings === 'failed') return NO_RESULTS_COPY.settingsFailed;
  return ended ? NO_RESULTS_COPY.ended : NO_RESULTS_COPY.description[feature];
}

/** Each tab's icon (its rows and its empty views). */
const FEATURE_ICONS = { aboveTheFold: ImageIcon, lazyRender: Layers } as const;

/** What every results tab shares. */
interface ResultsTabProps {
  /** A test is running (its results replace these). */
  running: boolean;
  /** A test ended (without results, when the list is undefined). */
  ended: boolean;
  /** The settings' load: a test runs only once they are ready. */
  settings: SettingsLoadState['status'];
  /** Run the test (an unreadable list's Run again). */
  onRun: () => void;
  /** Go to the settings: the feature's switch, or their Retry when they failed to load. */
  onShowSettings: (feature: BeaconFeatureKey) => void;
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
        {/* Run sits in the run bar right above: the card says what a run lists here. */}
        <ToolEmptyCard
          hook="beacon-results-empty"
          icon={FEATURE_ICONS[props.feature]}
          title={NO_RESULTS_COPY.title}
          description={noResultsCopy(props.settings, props.ended, props.feature)}
          action={
            props.settings === 'failed' ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  props.onShowSettings(props.feature);
                }}
              >
                {SHOW_SETTINGS_LABEL}
              </Button>
            ) : undefined
          }
          fill
        />
      </Match>
      <Match when={props.list === null}>
        <ToolEmptyCard
          hook="beacon-results-off"
          icon={FEATURE_ICONS[props.feature]}
          title="Not part of this test"
          description={`Turn on ${BEACON_FEATURE_LABELS[props.feature]} in the settings and run again.`}
          action={
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                props.onShowSettings(props.feature);
              }}
            >
              {SHOW_SETTINGS_LABEL}
            </Button>
          }
          fill
        />
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

/** The candidate list's columns (rows and head share them): the label, no size. */
const CANDIDATE_COLUMNS: ListRowColumns = { size: false, states: true };

/** The hash list's columns: the hash only. */
const HASH_COLUMNS: ListRowColumns = { size: false, states: false };

/** The candidate detail's caps label. */
export const CANDIDATE_KIND = 'Critical image candidate';

/** The name and words of a candidate without an image URL. */
export const NO_IMAGE_URL = 'No image URL';

/**
 * A candidate row's name: its image's file name (a `data:` URL by its type),
 * or the no-URL words.
 *
 * @param row The row.
 * @returns The name.
 */
export function candidateName(row: AboveTheFoldRow): string {
  return row.url === '' ? NO_IMAGE_URL : resourceName(row.url) || row.url;
}

/**
 * A candidate row's preview: the beacon's element kind, then the URL
 * without its scheme.
 *
 * @param row The row.
 * @returns The line.
 */
export function candidatePreview(row: AboveTheFoldRow): string {
  return row.url === '' ? row.kind : `${row.kind} · ${urlPreview(row.url)}`;
}

/**
 * The detail's facts: the element kind, then every value the record carries
 * (a `<source>`'s attributes one per line) — except a value that is exactly
 * the tile's URL, which the tile above already shows (a different value, such
 * as a browser-picked URL other than `src`, stays).
 *
 * @param row The row.
 * @returns The facts, in reading order.
 */
export function candidateDetailFacts(row: AboveTheFoldRow): DetailFact[] {
  return [
    { label: 'Element', value: row.kind, mono: true },
    ...row.facts
      // Facts are never empty, so a row without a URL (no tile) keeps them all.
      .filter((fact) => fact.value !== row.url)
      .map((fact) => ({
        label: fact.term,
        value: fact.value,
        mono: true,
        multiline: fact.value.includes('\n')
      }))
  ];
}

/**
 * The beacon's label as a badge (the LCP stands out).
 *
 * @param props.label The beacon's label.
 */
function LabelBadge(props: { label: string }): JSX.Element {
  return (
    <Badge kind={props.label === LCP_LABEL ? 'info' : 'neutral'}>
      {props.label === '' ? 'No label' : props.label}
    </Badge>
  );
}

/**
 * One candidate's detail body: its label, the image URL as a source-link
 * tile, every value the record carries.
 *
 * @param props.row The selected row.
 * @param props.openResource "Open in Sources" (null: the tile opens a new tab).
 */
function CandidateDetail(props: {
  row: Accessor<AboveTheFoldRow>;
  openResource: OpenResource | null;
}): JSX.Element {
  return (
    <div
      data-fdt="beacon-candidate-detail"
      data-fdt-beacon-candidate-detail
      class="flex min-w-0 flex-col gap-3.5"
    >
      <div class="flex flex-wrap items-center gap-1">
        <LabelBadge label={props.row().label} />
      </div>
      <Show
        when={props.row().url !== ''}
        fallback={<p class="text-2xs text-fg-muted">{NO_IMAGE_URL}</p>}
      >
        <SourceLink url={props.row().url} openResource={props.openResource} />
      </Show>
      <FactList facts={candidateDetailFacts(props.row())} hook="beacon-candidate-facts" />
    </div>
  );
}

/** Props of the critical images tab. */
export interface BeaconResultsProps extends ResultsTabProps {
  /** The run's list (null: not part of the run; undefined: no results). */
  list: FeatureList<AboveTheFoldCandidate> | null | undefined;
  /** "Open in Sources" (tests; `null`: none); absent, DevTools' own when available. */
  openResource?: OpenResource | null;
}

/**
 * The critical image candidates tab.
 *
 * @param props See {@link BeaconResultsProps}.
 */
export function AboveTheFoldResults(props: BeaconResultsProps): JSX.Element {
  // Rebuilt per run; the list reconciles by key (a running test unmounts it).
  const rows = createMemo(() => aboveTheFoldRows(props.list ?? null));
  const openResource =
    // eslint-disable-next-line solid/reactivity -- read once on purpose: the seam is fixed per mount
    props.openResource === undefined ? openResourceCapability(browser) : props.openResource;
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
        <CalmFilteredList
          rows={rows()}
          rowKey={(row) => row.key}
          sameRow={sameAboveTheFoldRow}
          facets={ABOVE_THE_FOLD_FACETS}
          searchField={aboveTheFoldSearchField}
          empty={
            <EmptyState
              icon={<ImageIcon size={16} aria-hidden="true" />}
              title={EMPTY_COPY.aboveTheFold.title}
              description={EMPTY_COPY.aboveTheFold.description}
            />
          }
          noun={CANDIDATE_NOUN}
          listLabel="Critical image candidates"
          searchLabel="Search candidates"
          searchPlaceholder="Search URLs, elements, labels…"
          rowHook="beacon-candidate-row"
          head={<ListRowHead columns={CANDIDATE_COLUMNS} icon name="Image" states="Label" />}
          renderRow={(row) => (
            <ListRow
              columns={CANDIDATE_COLUMNS}
              icon={ImageIcon}
              name={candidateName(row)}
              preview={candidatePreview(row)}
              stateContent={<LabelBadge label={row.label} />}
            />
          )}
          detail={{
            kind: () => CANDIDATE_KIND,
            title: candidateName,
            copy: (row) => (row.url === '' ? undefined : { text: row.url, label: 'Image URL' }),
            body: (row) => <CandidateDetail row={row} openResource={openResource} />,
            backLabel: 'Candidates'
          }}
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
        <CalmFilteredList
          rows={rows()}
          rowKey={(row) => row.key}
          sameRow={sameLazyRenderRow}
          facets={LAZY_RENDER_FACETS}
          searchField={lazyRenderSearchField}
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
          rowHook="beacon-lazy-row"
          lines="one"
          renderRow={(row: LazyRenderRow) => (
            <ListRow lines="one" columns={HASH_COLUMNS} name={row.hash} mono />
          )}
          createVirtualizer={props.createVirtualizer}
        />
      )}
    </FeatureResults>
  );
}
