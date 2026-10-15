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
 * expanded rows (pruned to rows still present), scroll and focus. Unchanged
 * rows keep their very objects, so their DOM survives the refresh.
 *
 * Search: the in-page field and the DevTools search box drive the panel's
 * one search store (see `search-field`); the committed query filters each
 * script's searched content (an external script's URL, an inline script's
 * code), composed with the selected chip, ignoring surrounding whitespace.
 * The DevTools box cannot show text typed here — the platform has no setter.
 * A route change unmounts the page (resetting chip and expanded rows) and the
 * shell resets the search.
 */
import { sendMessage } from '../../../../lib/messaging';
import {
  loadScriptSource,
  type ScriptSourceRequest
} from '../../../../lib/messaging/script-source';
import { devtoolsInspectedTabId } from '../../state/edges';
import type { Accessor, JSX } from 'solid-js';
import { createComputed, createMemo, createSignal, on, Show } from 'solid-js';
import FileCode from 'lucide-solid/icons/file-code';
import { EmptyState } from '../../../../components/ui/empty-state';
import { FilterBar } from '../../../../components/ui/filter-bar';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { VirtualList, type VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import {
  buildScriptRows,
  filterAndSearch,
  filterCounts,
  type JsFilterId
} from '../../../../lib/panel/resources-view-model';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { cn } from '../../../../utils/cn';
import type { SearchStore } from '../../state/search';
import { useFdtData, useSearch } from '../../state/use-fdt-data';
import { NoMatches, PAGE_FILL_SCROLLER, PageFrame } from '../page-frame';
import { ScriptRow, type CodeBlockSeams } from './script-row';
import {
  JS_VIEW_RESOURCES,
  buildChips,
  estimateRowSize,
  pruneExpanded,
  resultAnnouncement,
  formatCount,
  scriptCount,
  toggleExpanded,
  type ScriptRowView
} from './script-view';
import { bindSearchField } from './search-field';
import { contentCaptures, scriptListCut } from './capture-bounds';
import { reconcileRowViews } from './script-identity';

/**
 * Rows rendered beyond the viewport. Every row holds tab stops, so a keyboard
 * walk always finds the next row already mounted (the browser scrolls it in
 * and the window follows) — sequential Tab never escapes the list.
 */
const LIST_OVERSCAN = 8;

/**
 * The search field's width: the full row when compact, a comfortable 20 rem
 * from the regular tier (the bar leaves the field at its intrinsic width).
 */
const SEARCH_FIELD_WIDTH = '[&_input[type=search]]:w-full @regular:[&_input[type=search]]:max-w-80';

/** The page's content width: the full region, capped on wide panels for line length. */
const CONTENT_WIDTH = '@wide:max-w-6xl';

/**
 * The muted note under the summary when the capture cut the list at its cap.
 *
 * @param shown The scripts received (the cap).
 */
export function listCutNote(shown: number): string {
  return `Showing the first ${formatCount(shown)} scripts — the page has more.`;
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
}

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
  const views = createMemo<readonly ScriptRowView[]>(
    (previous) =>
      reconcileRowViews(previous, buildScriptRows(delayJs()), contentCaptures(delayJs())),
    []
  );
  const listCut = createMemo(() => scriptListCut(delayJs()));
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

  const [selected, setSelected] = createSignal<JsFilterId>('all');
  const query = createMemo(() => props.search.query().trim());
  const filtered = createMemo(() =>
    filterAndSearch(views(), JS_VIEW_RESOURCES, selected(), query())
  );
  const chips = createMemo(() => buildChips(JS_VIEW_RESOURCES.filters, counts(), selected()));
  // The result count, always current; announced only when the user narrows
  // or widens the list (chip, committed query). A data refresh updates the
  // text with the region muted (`aria-live="off"` set in the same DOM update),
  // so the count stays true when read without being spoken unprompted.
  const announcement = createMemo(() =>
    resultAnnouncement(filtered().length, views().length, selected() !== 'all' || query() !== '')
  );
  const [announceQuietly, setAnnounceQuietly] = createSignal(false);
  createComputed(on(views, () => setAnnounceQuietly(true), { defer: true }));
  createComputed(on([selected, query], () => setAnnounceQuietly(false), { defer: true }));
  const selectedLabel = (): string | undefined =>
    selected() === 'all'
      ? undefined
      : JS_VIEW_RESOURCES.filters.find((filter) => filter.id === selected())?.label;

  // Expanded rows live here, keyed by script identity, not in the (virtual,
  // remounting) rows. A refresh that removes a script — or changes it under
  // the same key — forgets its flag for good: pruning is a state transition,
  // written synchronously before render rather than derived.
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  createComputed(
    on(views, (current, previous) => {
      if (previous === undefined) return;
      setExpanded((keys) => pruneExpanded(keys, previous, current));
    })
  );

  // eslint-disable-next-line solid/reactivity -- bootstrap: the shell's search store is one instance per panel run
  const field = bindSearchField(props.search);
  let filterArea: HTMLDivElement | undefined;

  /**
   * Flip a row's code; a collapse that pulls the toggle out of view brings it
   * back (nearest edge, no smooth scroll), so focus never sits off screen.
   */
  const toggleRow = (key: string, toggle: HTMLButtonElement): void => {
    const collapsing = expanded().has(key);
    setExpanded(toggleExpanded(expanded(), key));
    if (collapsing) toggle.scrollIntoView({ block: 'nearest' });
  };

  /** Esc in the search field clears the search (the panel-wide Esc rule). */
  const onFilterKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || field.value() === '') return;
    if (!(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    field.clear();
  };

  return (
    <PageFrame
      id="javascript"
      title="JavaScript"
      subtitle="How WP Rocket delays and defers each script on the page."
      fill
    >
      <div class={cn('flex w-full flex-1 flex-col gap-3', CONTENT_WIDTH)}>
        <ScriptSummary
          present={delayJs().present}
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
          <div ref={filterArea} onKeyDown={onFilterKeyDown} class={SEARCH_FIELD_WIDTH}>
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
          <div
            role="status"
            aria-live={announceQuietly() ? 'off' : 'polite'}
            class="sr-only"
            data-fdt="script-results-status"
          >
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
                onShowAll={() => setSelected('all')}
                focusAfter={(action) =>
                  action === 'clear-search'
                    ? filterArea?.querySelector<HTMLElement>('input[type="search"]')
                    : filterArea?.querySelector<HTMLElement>('[data-fdt-filter-chip="all"]')
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
              getItemKey={(index) => filtered()[index]?.key ?? String(index)}
              overscan={LIST_OVERSCAN}
              createVirtualizer={props.createVirtualizer}
              class={cn(PAGE_FILL_SCROLLER, 'rounded-md border border-line-1 bg-surface-1')}
            >
              {(item) => (
                <Show when={filtered()[item.index]} keyed>
                  {(view) => (
                    <ScriptRow
                      view={view}
                      index={item.index}
                      setSize={filtered().length}
                      inlineOrdinal={inlineOrdinals().get(view.key) ?? 0}
                      expanded={expanded().has(view.key)}
                      onToggle={(toggle) => {
                        toggleRow(view.key, toggle);
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
        </Show>
      </div>
    </PageFrame>
  );
}

/** Props of {@link ScriptSummary}. */
interface ScriptSummaryProps {
  /** Whether Delay JS runs on the page. */
  present: boolean;
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
  return (
    <div
      data-fdt="script-summary"
      class="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md border border-line-1 bg-surface-1 px-2.5 py-1.5 text-xs"
    >
      {/* Flat items, so a compact strip wraps into two lines, never three. */}
      <span class="me-0.5 font-medium text-fg-primary">{getRealOptionName('delay_js')}</span>
      <StatusBadge kind={props.present ? 'ok' : 'neutral'} icon>
        {props.present ? 'Detected' : 'Not detected'}
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
        {scriptCount(props.total, props.partial)}
      </span>
    </div>
  );
}

/**
 * Read one bounded segment from the inspected main frame, with a finite wait.
 * @param request The captured script identity and segment offset.
 * @returns The untrusted transport reply, validated by the source assembler.
 * @throws {@link Error} when no inspected tab exists or the read cannot finish.
 */
async function requestSourceChunk(request: ScriptSourceRequest): Promise<unknown> {
  const tabId = devtoolsInspectedTabId();
  if (tabId === null) throw new Error('No inspected tab for script copy.');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      sendMessage('getScriptSourceChunk', request, { tabId, frameId: 0 }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Script source read timed out.'));
        }, 5000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
