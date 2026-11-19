/**
 * The JavaScript page: every script on the inspected page — delayed or not,
 * deferred or not, inline or external — as one calm list (name, one-line
 * preview, size, two state chips) filtered by combinable facets (Delay ×
 * Defer × Type × File, Excluded) and the search, each row opening its detail
 * (side pane from the split width, drill-in below it).
 *
 * State matrix (the shell owns loading, fetch errors and crashes; this body
 * renders only on `ready`/`refreshing`):
 * - **empty** — the page has no scripts: the summary, then an empty state.
 * - **filtered-empty** — facets and/or the query leave nothing: `NoMatches`
 *   naming them, with Clear filters / Clear search.
 * - **populated** — the list, and the detail of the selected row.
 * A soft refresh keeps the facets, the query, the selection, scroll and
 * focus (the list reconciles by script identity; unchanged rows keep their
 * very objects, so their DOM survives).
 *
 * Search: the in-page field and the DevTools search box drive the panel's
 * one search store (the list's field binding); the committed query filters
 * each script's searched content (an external script's URL, an inline
 * script's code). A route change unmounts the page (resetting facets and
 * selection) and the shell resets the search.
 */
import type { Accessor, Component, JSX } from 'solid-js';
import { createMemo, createSignal, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import Code from 'lucide-solid/icons/code';
import FileCode from 'lucide-solid/icons/file-code';
import { EmptyState } from '../../../../components/ui/empty-state';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { TabPanel, Tabs } from '../../../../components/ui/tabs';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { SCRIPT_NOUN } from '../../../../lib/detection/count-nouns';
import { createLogger } from '../../../../lib/logger';
import {
  loadScriptSource,
  type ScriptSourceRequest
} from '../../../../lib/messaging/script-source';
import {
  loadServedScriptTag,
  type ServedScriptTagRequest,
  type ServedScriptTagResult
} from '../../../../lib/messaging/served-script-tag';
import { selectTabAsks } from '../../../../lib/messaging/tab-asks';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import { countLabel } from '../../../../lib/panel/list-behavior';
import { buildScriptRows } from '../../../../lib/panel/resources-view-model';
import {
  NO_SCRIPT_SIMULATION,
  sameScriptPageFacts,
  sameScriptSimulation,
  scriptPageFacts,
  scriptSimulation
} from '../../../../lib/panel/script-states';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { formatCount } from '../../../../utils/format-count';
import { devtoolsInspectedTabId } from '../../state/edges';
import { useFdtData } from '../../state/use-fdt-data';
import { lazySection } from '../lazy-section';
import { openResourceCapability, type OpenResource } from '../open-resource';
import { PageFrame } from '../page-frame';
import type { DetailCopy } from '../resource-list/master-detail';
import { CalmFilteredList } from '../resource-list/calm-list';
import {
  calmRowEstimate,
  ListRow,
  ListRowHead,
  type ListRowColumns
} from '../resource-list/list-row';
import { StateSourceLegend } from '../resource-list/state-source-legend';
import { contentCaptures, scriptListCut } from './capture-bounds';
import type { CodeBlockSeams } from './code-seams';
import type { RuntimeStatesSectionProps } from './runtime-section';
import { ScriptDetail } from './script-detail';
import { reconcileRowViews } from './script-identity';
import {
  JS_CHIP_SOURCES,
  JS_VIEW_FACETS,
  delaySummaryBadge,
  scriptKind,
  scriptName,
  scriptSearchField,
  scriptSize,
  type ScriptBadge,
  type ScriptRowView
} from './script-view';
import { createServedTagReader, createSourceChunkReader } from './source-chunk-reader';

const log = createLogger('panel');

/** The list's optional columns (rows and head share them). */
const COLUMNS: ListRowColumns = { size: true, states: true };

/** One remedy for unavailable/stale source reads; partial text is never a copy fallback. */
const SOURCE_READ_REMEDY = 'Refresh the panel and try copying again.';

/**
 * The muted note at the capture limit; the shared truncation mark cannot prove omitted entries.
 *
 * @param shown The scripts received (the cap).
 */
export function listCutNote(shown: number): string {
  return `Showing the first ${formatCount(shown)} scripts — more may exist.`;
}

/** The seams the page's reads and views take (production omits them all). */
export interface JavaScriptSeams {
  /** The list's virtualizer seam (default: the list's own; tests inject a double). */
  createVirtualizer?: VirtualizerFactory;
  /** Code block seams (tests only). */
  codeBlock?: CodeBlockSeams;
  /** Complete-source seam; production uses the inspected main frame. */
  readSourceChunk?: (request: ScriptSourceRequest) => Promise<unknown>;
  /** Served-tag seam; production uses the inspected main frame. */
  readServedTag?: (request: ServedScriptTagRequest) => Promise<unknown>;
  /** "Open in Sources" seam (`null`: none); production detects DevTools' own. */
  openResource?: OpenResource | null;
  /** The Runtime states section (tests inject a double); absent, the lazily loaded one. */
  runtimeStates?: Component;
}

/** Props of {@link JavaScriptView}. */
export interface JavaScriptViewProps extends JavaScriptSeams {
  /** The loaded page data (swapped in place by a soft refresh). */
  data: Accessor<FdtData>;
}

/** The page's two views: the scripts as served (detection's snapshot) and their live state. */
export type JavaScriptTab = 'served' | 'runtime';

/** The views' tab labels. */
export const JAVASCRIPT_TAB_LABELS: Readonly<Record<JavaScriptTab, string>> = {
  served: 'Delay & defer',
  runtime: 'Runtime states'
};

/** The Runtime states section, in its own chunk (most sessions never open it). */
const RuntimeStates = lazySection<RuntimeStatesSectionProps>(
  'Runtime states',
  async () => (await import('./runtime-states')).RuntimeStatesSection
);

/**
 * The JavaScript route body: reads the shell's store and renders the view
 * while data is loaded (the shell renders bodies only then; the guard keeps
 * the contract explicit).
 *
 * @param props The seams (tests only).
 */
export function JavaScriptPage(props: JavaScriptSeams): JSX.Element {
  const store = useFdtData();
  const data = createMemo((): FdtData | null => {
    const state = store.state();
    return state.status === 'ready' || state.status === 'refreshing' ? state.data : null;
  });
  return <Show when={data()}>{(loaded) => <JavaScriptView {...props} data={loaded} />}</Show>;
}

/**
 * Render the page over loaded data. One memo chain: data → row views
 * (reconciled) → the list, which owns facets, search, find and selection.
 *
 * @param props See {@link JavaScriptViewProps}.
 */
export function JavaScriptView(props: JavaScriptViewProps): JSX.Element {
  const delayJs = createMemo(() => props.data().wprDetections.delay_js);
  // Who produced the Delayed/Deferred states: WP Rocket or a verified simulation (or unverified).
  const simulation = createMemo(() => scriptSimulation(props.data().wprDetections), undefined, {
    equals: sameScriptSimulation
  });
  // The page verdicts the Minified/Combined chips read; a changed verdict
  // changes the rows it touches, so reconciliation re-derives exactly those.
  const pageFacts = createMemo(() => scriptPageFacts(props.data().wprDetections), undefined, {
    equals: sameScriptPageFacts
  });
  // The views a pass reconciled against, with the simulation facts they were built under.
  let builtSimulation = NO_SCRIPT_SIMULATION;
  const views = createMemo<readonly ScriptRowView[]>((previous) => {
    const current = simulation();
    // A changed fact re-derives every chip (reuse would keep the old sources).
    const reusable = sameScriptSimulation(current, builtSimulation) ? previous : [];
    builtSimulation = current;
    return reconcileRowViews(
      reusable,
      buildScriptRows(delayJs(), pageFacts()),
      contentCaptures(delayJs()),
      current
    );
  }, []);
  const listCut = createMemo(() => scriptListCut(delayJs()));
  const [tab, setTab] = createSignal<JavaScriptTab>('served');
  // Inline scripts are named by their ordinal among inline scripts; kept out
  // of the (reused) views, so a script added above renumbers in place.
  const inlineOrdinals = createMemo(() => {
    const ordinals = new Map<string, number>();
    for (const view of views()) {
      if (view.row.type === 'inline') ordinals.set(view.key, ordinals.size + 1);
    }
    return ordinals;
  });
  const ordinalOf = (view: ScriptRowView): number => inlineOrdinals().get(view.key) ?? 0;
  // String-compared, so a soft refresh of the same capture re-reads nothing.
  const snapshotId = createMemo(() => props.data().scriptSnapshotId);
  const openResource =
    // eslint-disable-next-line solid/reactivity -- read once on purpose: the seam is fixed per page
    props.openResource === undefined ? openResourceCapability(browser) : props.openResource;

  /**
   * A row's document position in the current capture (the reads' index):
   * looked up at read time, since a reused view may have moved.
   *
   * @param view The row.
   */
  const positionOf = (view: ScriptRowView): number => views().indexOf(view);

  /**
   * Read a row's complete captured source (copy and the detail's code).
   *
   * @param view The row.
   * @param signal Cancels the read when the control unmounts.
   */
  const readSource = (view: ScriptRowView, signal: AbortSignal): Promise<string> => {
    const id = snapshotId();
    if (id === undefined) return missingSnapshotSource();
    return loadScriptSource(
      { snapshotId: id, scriptIndex: positionOf(view) },
      props.readSourceChunk ?? requestSourceChunk,
      signal
    );
  };

  /**
   * The detail's served-tag read for a row, `null` without a snapshot; a new
   * function (a new read) only when the snapshot or the row object changes.
   *
   * @param view The row accessor.
   */
  const servedTagRead = (
    view: Accessor<ScriptRowView>
  ): Accessor<(() => Promise<ServedScriptTagResult>) | null> =>
    createMemo(() => {
      // eslint-disable-next-line solid/reactivity -- bound to this run's capture on purpose: a new capture builds a new read
      const id = snapshotId();
      const current = view();
      if (id === undefined) return null;
      return () =>
        loadServedScriptTag(
          { snapshotId: id, scriptIndex: positionOf(current) },
          props.readServedTag ?? requestServedTag,
          log
        );
    });

  /**
   * The detail header's copy: the URL (external) or the code (inline), the
   * exact text read from the capture when the shown one is bounded; nothing
   * for an empty `src` or a blank script.
   *
   * @param view The row.
   */
  const detailCopy = (view: ScriptRowView): DetailCopy | undefined => {
    const bounded = view.capture !== 'complete';
    const loadText = bounded
      ? // eslint-disable-next-line solid/reactivity -- runs on a copy press (an event), reading the capture then
        (signal: AbortSignal): Promise<string> => readSource(view, signal)
      : undefined;
    if (view.row.type === 'external') {
      if (view.row.content === '') return undefined;
      return {
        text: view.row.content,
        label: 'Script URL',
        loadText,
        loadFailure: SOURCE_READ_REMEDY
      };
    }
    if (!bounded && view.row.content.trim() === '') return undefined;
    return {
      text: view.row.content,
      label: 'Inline script',
      loadText,
      loadFailure: SOURCE_READ_REMEDY
    };
  };

  return (
    <PageFrame
      id="javascript"
      title="JavaScript"
      subtitle="How WP Rocket delays and defers each script on the page."
      fill
    >
      <Tabs
        items={[
          { value: 'served', label: JAVASCRIPT_TAB_LABELS.served },
          { value: 'runtime', label: JAVASCRIPT_TAB_LABELS.runtime }
        ]}
        value={tab()}
        onChange={(value) => {
          setTab(value === 'runtime' ? 'runtime' : 'served');
        }}
        label="JavaScript views"
        rootClass="flex min-h-0 w-full flex-1 flex-col gap-3"
      >
        <TabPanel value="served" class="flex min-h-0 flex-1 flex-col gap-3">
          {/* Mounted only while selected: the list's find binding reports only while shown. */}
          <Show when={tab() === 'served'}>
            <div class="flex w-full min-h-0 flex-1 flex-col gap-3">
              <ScriptSummary
                present={delayJs().present}
                simulated={simulation().delay === 'simulated'}
                version={delayJs().version}
                total={views().length}
                partial={listCut()}
              />
              <Show when={listCut()}>
                <p data-fdt="script-list-cut" class="-mt-1.5 text-2xs text-fg-muted">
                  {listCutNote(views().length)}
                </p>
              </Show>
              <CalmFilteredList
                variant="calm"
                rows={views()}
                rowKey={(view) => view.key}
                // Reconciled upstream: an unchanged script keeps its very view object.
                sameRow={(a, b) => a === b}
                facets={JS_VIEW_FACETS}
                searchField={scriptSearchField}
                noun={SCRIPT_NOUN}
                listLabel="Scripts"
                searchLabel="Search scripts"
                searchPlaceholder="Search URLs and code…"
                rowHook="script-row"
                empty={
                  <EmptyState
                    icon={<FileCode size={20} aria-hidden="true" />}
                    title="No scripts on this page"
                    description="The inspected page has no script elements, so there is nothing to classify."
                  />
                }
                head={
                  <ListRowHead
                    columns={COLUMNS}
                    icon
                    name="Script"
                    size="Chars"
                    states="WP Rocket"
                  />
                }
                legend={<StateSourceLegend sources={JS_CHIP_SOURCES} />}
                estimateSize={(view, compact) =>
                  calmRowEstimate('two', compact, view.chips.length > 0)
                }
                renderRow={(view) => (
                  <ListRow
                    columns={COLUMNS}
                    icon={view.row.type === 'inline' ? Code : FileCode}
                    name={scriptName(view, ordinalOf(view))}
                    preview={view.preview}
                    clipped={view.capture === 'clipped'}
                    size={scriptSize(view)}
                    chips={view.rowChips}
                  />
                )}
                detail={{
                  kind: scriptKind,
                  title: (view) => scriptName(view, ordinalOf(view)),
                  copy: detailCopy,
                  body: (view) => (
                    <ScriptDetail
                      view={view}
                      inlineOrdinal={() => ordinalOf(view())}
                      openResource={openResource}
                      readServedTag={servedTagRead(view)}
                      loadSource={() =>
                        snapshotId() === undefined
                          ? null
                          : // eslint-disable-next-line solid/reactivity -- run by the detail's on-demand read, reading the capture then
                            (signal: AbortSignal) => readSource(view(), signal)
                      }
                      codeBlock={props.codeBlock}
                    />
                  ),
                  backLabel: 'Scripts'
                }}
                createVirtualizer={props.createVirtualizer}
              />
            </div>
          </Show>
        </TabPanel>
        <TabPanel value="runtime" class="flex min-h-0 flex-1 flex-col gap-3">
          <Show when={tab() === 'runtime'}>
            <Dynamic component={props.runtimeStates ?? RuntimeStates} />
          </Show>
        </TabPanel>
      </Tabs>
    </PageFrame>
  );
}

/** Props of {@link ScriptSummary}. */
interface ScriptSummaryProps {
  /** Whether WP Rocket served Delay JS on the page. */
  present: boolean;
  /** Whether a verified simulation runs Delay JS here instead (never with `present`). */
  simulated: boolean;
  /** The Delay JS script's version, when it announces one. */
  version: string | null;
  /** Scripts received. */
  total: number;
  /** The list was cut at its cap (the total is a floor). */
  partial: boolean;
}

/**
 * The summary strip: whether Delay JS runs here (plugin-native name + state,
 * never color alone), its version when known, and the script total.
 * Per-value counts live on the facets only — one place per number.
 *
 * @param props See {@link ScriptSummaryProps}.
 */
function ScriptSummary(props: ScriptSummaryProps): JSX.Element {
  const state = (): ScriptBadge => delaySummaryBadge(props.present, props.simulated);
  return (
    <div
      data-fdt="script-summary"
      class="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md border border-line-1 bg-surface-1 px-2.5 py-1.5 text-xs"
    >
      {/* Flat items, so a compact strip wraps into two lines, never three. */}
      <span class="me-0.5 font-medium text-fg-primary">{getRealOptionName('delay_js')}</span>
      <StatusBadge kind={state().kind} icon>
        {state().label}
      </StatusBadge>
      <Show when={props.present && props.version}>
        {(version) => (
          <span class="ms-1 font-mono text-2xs text-fg-secondary">
            <span class="sr-only">Version </span>
            <span aria-hidden="true">v</span>
            {version()}
          </span>
        )}
      </Show>
      <span data-fdt="script-total" class="ms-auto ps-2 text-fg-secondary tabular-nums">
        {countLabel(props.total, SCRIPT_NOUN, props.partial)}
      </span>
    </div>
  );
}

/**
 * Refuse to copy a bounded preview without the capture needed to recover its source.
 * @returns A rejected read, handled by the shared copy control's refresh remedy.
 */
function missingSnapshotSource(): Promise<string> {
  return Promise.reject(new Error('Refresh the panel to capture the complete script source.'));
}

/** The production transport deps: the inspected main frame over the panel's tab asks. */
const TAB_READ_DEPS = {
  asks: () => selectTabAsks(browser),
  inspectedTabId: devtoolsInspectedTabId
};

/** The production segment reader (the probe is a property check, chosen per read). */
const requestSourceChunk = createSourceChunkReader(TAB_READ_DEPS);

/** The production served-tag reader. */
const requestServedTag = createServedTagReader(TAB_READ_DEPS);
