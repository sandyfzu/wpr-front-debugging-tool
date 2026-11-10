/**
 * The JavaScript page: every script on the inspected page — delayed or not,
 * deferred or not, inline or external — counted on filter chips, searchable,
 * and listed through the virtual list (the inventory is unbounded).
 *
 * State matrix (the shell owns loading, fetch errors and crashes; this body
 * renders only on `ready`/`refreshing`):
 * - **empty** — the page has no scripts: the summary, then an empty state.
 * - **filtered-empty** — a chip and/or query leave nothing: `NoMatches`
 *   naming them, with the way back (focus lands on the search field or the
 *   "all" chip as its button leaves).
 * - **populated** — the list.
 * A soft refresh keeps everything mounted: the selected chip, the query, the
 * expanded and wrapped rows (pruned to rows still present), scroll and focus. Unchanged
 * rows keep their very objects, so their DOM survives the refresh.
 *
 * Search: the in-page field and the DevTools search box drive the panel's
 * one search store through the shared field binding (`state/search-field`);
 * the committed query filters each script's searched content (an external
 * script's URL, an inline script's code), composed with the selected chip,
 * ignoring surrounding whitespace. The DevTools box cannot show text typed
 * here — the platform has no setter. A route change unmounts the page
 * (resetting chip and expanded rows) and the shell resets the search.
 */
import {
  loadScriptSource,
  type ScriptSourceRequest
} from '../../../../lib/messaging/script-source';
import { selectTabAsks } from '../../../../lib/messaging/tab-asks';
import { devtoolsInspectedTabId } from '../../state/edges';
import { createSourceChunkReader } from './source-chunk-reader';
import type { Accessor, Component, JSX } from 'solid-js';
import { createComputed, createMemo, createSignal, on, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import FileCode from 'lucide-solid/icons/file-code';
import { EmptyState } from '../../../../components/ui/empty-state';
import { FilterBar } from '../../../../components/ui/filter-bar';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { TabPanel, Tabs } from '../../../../components/ui/tabs';
import { VirtualList, type VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { SCRIPT_NOUN } from '../../../../lib/detection/count-nouns';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import { sameScriptPageFacts, scriptPageFacts } from '../../../../lib/panel/script-states';
import {
  buildScriptRows,
  filterAndSearch,
  filterCounts,
  type JsFilterId
} from '../../../../lib/panel/resources-view-model';
import {
  countLabel,
  defaultChipId,
  fallbackRowKey,
  normalizeQuery
} from '../../../../lib/panel/list-behavior';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { cn } from '../../../../utils/cn';
import { formatCount } from '../../../../utils/format-count';
import type { SearchStore } from '../../state/search';
import { bindSearchField } from '../../state/search-field';
import { useFdtData, useSearch } from '../../state/use-fdt-data';
import { createCurrentMatch } from '../current-match';
import { NoMatches, PAGE_FILL_SCROLLER, PageFrame } from '../page-frame';
import { lazySection } from '../lazy-section';
import { createResultsAnnouncement } from '../results-announcement';
import type { RuntimeStatesSectionProps } from './runtime-section';
import { ScriptRow, type CodeBlockSeams } from './script-row';
import {
  JS_VIEW_RESOURCES,
  buildChips,
  delaySummaryBadge,
  estimateRowSize,
  pruneRowFlags,
  type ScriptBadge,
  type ScriptRowView
} from './script-view';
import { toggleRowFlag } from '../../../../lib/panel/list-behavior';
import { contentCaptures, scriptListCut } from './capture-bounds';
import { reconcileRowViews } from './script-identity';

/**
 * Rows rendered beyond the viewport. Every row holds tab stops, so a keyboard
 * walk always finds the next row already mounted (the browser scrolls it in
 * and the window follows) — sequential Tab never escapes the list.
 */
const LIST_OVERSCAN = 8;

/**
 * The muted note at the capture limit; the shared truncation mark cannot prove omitted entries.
 *
 * @param shown The scripts received (the cap).
 */
export function listCutNote(shown: number): string {
  return `Showing the first ${formatCount(shown)} scripts — more may exist.`;
}

/** Props of {@link JavaScriptView}. */
export interface JavaScriptViewProps {
  /** The loaded page data (swapped in place by a soft refresh). */
  data: Accessor<FdtData>;
  /** The panel's search store. */
  search: SearchStore;
  /** The list's virtualizer seam (default: the list's own; tests inject a double). */
  createVirtualizer?: VirtualizerFactory;
  /** Code block seams (tests only). */
  codeBlock?: CodeBlockSeams;
  /** Complete-source seam; production uses the inspected main frame. */
  readSourceChunk?: (request: ScriptSourceRequest) => Promise<unknown>;
  /** The Runtime states section (tests inject a double); absent, the lazily loaded one. */
  runtimeStates?: Component;
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
 * The JavaScript route body: reads the shell's stores and renders the view
 * while data is loaded (the shell renders bodies only then; the guard keeps
 * the contract explicit).
 */
export function JavaScriptPage(): JSX.Element {
  const store = useFdtData();
  const search = useSearch();
  const data = createMemo((): FdtData | null => {
    const state = store.state();
    return state.status === 'ready' || state.status === 'refreshing' ? state.data : null;
  });
  return <Show when={data()}>{(loaded) => <JavaScriptView data={loaded} search={search} />}</Show>;
}

/**
 * Render the page over loaded data. One memo chain: data → row views
 * (reconciled) → chip counts and filtered rows; rows only read results.
 *
 * @param props See {@link JavaScriptViewProps}.
 */
export function JavaScriptView(props: JavaScriptViewProps): JSX.Element {
  const delayJs = createMemo(() => props.data().wprDetections.delay_js);
  const deferSimulated = createMemo(
    () => props.data().wprDetections.defer_all_js.simulation === 'simulated'
  );
  // The page verdicts the Minified/Combined chips read; a changed verdict
  // changes the rows it touches, so reconciliation re-derives exactly those.
  const pageFacts = createMemo(() => scriptPageFacts(props.data().wprDetections), undefined, {
    equals: sameScriptPageFacts
  });
  // The views a pass reconciled against, with the Defer JS fact they were built under.
  let builtDeferSimulated = false;
  const views = createMemo<readonly ScriptRowView[]>((previous) => {
    const simulated = deferSimulated();
    // A changed fact re-derives every chip (reuse would keep the old words).
    const reusable = simulated === builtDeferSimulated ? previous : [];
    builtDeferSimulated = simulated;
    return reconcileRowViews(
      reusable,
      buildScriptRows(delayJs(), pageFacts()),
      contentCaptures(delayJs()),
      simulated
    );
  }, []);
  const listCut = createMemo(() => scriptListCut(delayJs()));
  const [tab, setTab] = createSignal<JavaScriptTab>('served');
  // Inline scripts are named by their ordinal among inline scripts; kept out
  // of the (reused) views, so a script added above renumbers without a
  // re-mount.
  const inlineOrdinals = createMemo(() => {
    const ordinals = new Map<string, number>();
    for (const view of views()) {
      if (view.code !== null) ordinals.set(view.key, ordinals.size + 1);
    }
    return ordinals;
  });
  const counts = createMemo(() => filterCounts(views(), JS_VIEW_RESOURCES));

  const allChip = defaultChipId(JS_VIEW_RESOURCES);
  const [selected, setSelected] = createSignal<JsFilterId>(allChip);
  const query = createMemo(() => normalizeQuery(props.search.query()));
  const filtered = createMemo(() =>
    filterAndSearch(views(), JS_VIEW_RESOURCES, selected(), query())
  );
  const chips = createMemo(() => buildChips(JS_VIEW_RESOURCES.filters, counts(), selected()));
  // The count line and its announce switch come from the shared filter-page
  // lifecycle: truthful text always; a data refresh updates it silently
  // (`aria-live="off"` in the same reactive wave), a committed filter/query
  // change announces again. Mount never announces (the region renders with
  // its initial content).
  const { text: announcement, live } = createResultsAnnouncement({
    rows: views,
    visible: filtered,
    noun: SCRIPT_NOUN,
    actions: [selected, () => query()]
  });
  const selectedLabel = (): string | undefined =>
    selected() === allChip
      ? undefined
      : JS_VIEW_RESOURCES.filters.find((filter) => filter.id === selected())?.label;

  // Expanded and wrapped rows live here, keyed by script identity, not in the
  // (virtual, remounting) rows. A refresh that removes a script — or changes
  // it under the same key — forgets its flags for good: pruning is a state
  // transition, written synchronously before render rather than derived.
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [wrapped, setWrapped] = createSignal<ReadonlySet<string>>(new Set());
  createComputed(
    on(views, (current, previous) => {
      if (previous === undefined) return;
      setExpanded((keys) => pruneRowFlags(keys, previous, current));
      setWrapped((keys) => pruneRowFlags(keys, previous, current));
    })
  );

  /**
   * Flip a row's code; a collapse that pulls the toggle out of view brings it
   * back (nearest edge, no smooth scroll), so focus never sits off screen.
   */
  const toggleRow = (key: string, toggle: HTMLButtonElement): void => {
    const collapsing = expanded().has(key);
    setExpanded(toggleRowFlag(expanded(), key));
    if (collapsing) toggle.scrollIntoView({ block: 'nearest' });
  };

  /**
   * The served list with its find bindings: the search field, the find's
   * match report and cursor. A component of its own so the bindings live
   * exactly as long as this tab's list is shown — a hidden list must not
   * keep reporting matches over the shown one (the store counts what the
   * visible list matches), and coming back reports afresh.
   */
  const ServedList = (): JSX.Element => {
    // The find's page side: the rendered list is the match set — it reports the
    // count and names the row the find's cursor sits on (highlight + scroll).
    const match = createCurrentMatch(props.search, () => filtered().length);
    const field = bindSearchField(props.search);
    let filterArea: HTMLDivElement | undefined;
    return (
      <>
        {/* The field binding owns the Esc rule; the ref targets the way-back focus. */}
        <div ref={filterArea} onKeyDown={field.onKeyDown}>
          <FilterBar
            chips={chips()}
            selected={selected()}
            onSelect={(value) => setSelected(value as JsFilterId)}
            filterLabel="Filter scripts"
            searchQuery={field.value()}
            onSearchChange={(raw) => {
              field.input(raw);
            }}
            searchPlaceholder="Search URLs and code…"
            searchLabel="Search scripts"
          />
        </div>
        <div role="status" aria-live={live()} class="sr-only" data-fdt="script-results-status">
          {announcement()}
        </div>
        <Show
          when={filtered().length > 0}
          fallback={
            <NoMatches
              chipLabel={selectedLabel()}
              query={query()}
              onClearSearch={() => {
                field.clear();
              }}
              onShowAll={() => setSelected(allChip)}
              focusAfter={(action) =>
                action === 'clear-search'
                  ? filterArea?.querySelector<HTMLElement>('input[type="search"]')
                  : filterArea?.querySelector<HTMLElement>(`[data-fdt-filter-chip="${allChip}"]`)
              }
            />
          }
        >
          <VirtualList
            scrollerRole="list"
            aria-label="Scripts"
            count={filtered().length}
            estimateSize={(index) => {
              const view = filtered()[index];
              return view === undefined ? 0 : estimateRowSize(view);
            }}
            getItemKey={(index) => filtered()[index]?.key ?? fallbackRowKey(index)}
            overscan={LIST_OVERSCAN}
            createVirtualizer={props.createVirtualizer}
            scrollTo={match.request}
            class={cn(PAGE_FILL_SCROLLER, 'rounded-md border border-line-1 bg-surface-1')}
          >
            {(item) => (
              <Show when={filtered()[item.index]} keyed>
                {(view) => (
                  <ScriptRow
                    view={view}
                    index={item.index}
                    setSize={filtered().length}
                    current={match.current() === item.index}
                    inlineOrdinal={inlineOrdinals().get(view.key) ?? 0}
                    expanded={expanded().has(view.key)}
                    onToggle={(toggle) => {
                      toggleRow(view.key, toggle);
                    }}
                    wrap={wrapped().has(view.key)}
                    onWrap={() => {
                      setWrapped(toggleRowFlag(wrapped(), view.key));
                    }}
                    codeBlock={props.codeBlock}
                    loadSource={
                      props.data().scriptSnapshotId === undefined
                        ? undefined
                        : (signal) => {
                            const snapshotId = props.data().scriptSnapshotId;
                            if (snapshotId === undefined)
                              return Promise.reject(new Error('Script snapshot unavailable.'));
                            const scriptIndex = views().indexOf(view);
                            return loadScriptSource(
                              { snapshotId, scriptIndex },
                              props.readSourceChunk ?? requestSourceChunk,
                              signal
                            );
                          }
                    }
                  />
                )}
              </Show>
            )}
          </VirtualList>
        </Show>
      </>
    );
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
          {/* Mounted only while selected; the find binds in `ServedList`, so only the shown list reports. */}
          <Show when={tab() === 'served'}>
            <div class="flex w-full min-h-0 flex-1 flex-col gap-3">
              <ScriptSummary
                present={delayJs().present}
                simulated={delayJs().simulation === 'simulated'}
                version={delayJs().version}
                total={views().length}
                partial={listCut()}
              />
              <Show when={listCut()}>
                <p data-fdt="script-list-cut" class="-mt-1.5 text-2xs text-fg-muted">
                  {listCutNote(views().length)}
                </p>
              </Show>
              <Show
                when={views().length > 0}
                fallback={
                  <EmptyState
                    icon={<FileCode size={20} aria-hidden="true" />}
                    title="No scripts on this page"
                    description="The inspected page has no script elements, so there is nothing to classify."
                  />
                }
              >
                <ServedList />
              </Show>
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
 * Per-filter counts live on the chips only — one place per number.
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
 * The production segment reader: the inspected main frame over the panel's
 * tab transport (chosen per read — the probe is a property check).
 */
const requestSourceChunk = createSourceChunkReader({
  asks: () => selectTabAsks(browser),
  inspectedTabId: devtoolsInspectedTabId
});
