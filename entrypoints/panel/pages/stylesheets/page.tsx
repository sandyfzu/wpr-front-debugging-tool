/**
 * The Stylesheets page: every inline style and stylesheet link on the
 * inspected page as one calm list (name, one-line preview, an inline
 * style's size with its bar, two state chips + "+N") filtered by combinable
 * facets (Type × WP Rocket CSS, Async / Minified / Font) and the search,
 * each row opening its detail (side pane from the split width, drill-in
 * below it) with the full CSS read on demand — read live from the page (the
 * payload carries no style list), classified with the detection's page
 * facts. Loaded on first visit (its own chunk).
 *
 * State matrix (the shell owns loading, fetch errors and crashes; this body
 * renders on `ready`/`refreshing`):
 * - **loading** — the first read, or the first read of a new page load
 *   (a list of an earlier load is never shown): skeleton rows;
 * - **failed** — the read missed the page: the named miss + Retry;
 * - **no-styles** — the page has none (and the snapshot saw no critical
 *   style): an empty state;
 * - **filtered-empty** / **populated** — the calm list's (`NoMatches` with
 *   the ways back; the list and the selected row's detail);
 * - **capped** — the page has more styles than one read lists: a muted note;
 * - **refreshing** — Refresh busy, the list stays; a refresh that missed
 *   says so above the kept list.
 * A Refresh (or a payload refresh) keeps the facets, the query, unchanged
 * rows and the selection (rows are keyed by content, never position); a new
 * page load re-reads on its own.
 */
import type { Accessor, JSX } from 'solid-js';
import { createMemo, Match, Show, Switch } from 'solid-js';
import Code from 'lucide-solid/icons/code';
import FileCode from 'lucide-solid/icons/file-code';
import Palette from 'lucide-solid/icons/palette';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import { Button } from '../../../../components/ui/button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ErrorState } from '../../../../components/ui/error-state';
import { Skeleton } from '../../../../components/ui/skeleton';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { createLogger } from '../../../../lib/logger';
import type { PageStylesheetsReply } from '../../../../lib/messaging/page-stylesheets';
import {
  loadStyleSource,
  type StyleSourceRequest,
  type StyleSourceResult
} from '../../../../lib/messaging/style-source';
import { countLabel } from '../../../../lib/panel/list-behavior';
import { buildStylesheetRows } from '../../../../lib/panel/stylesheet-rows';
import {
  NO_STYLESHEET_PAGE_FACTS,
  sameStylesheetPageFacts,
  stylesheetPageFacts,
  type StylesheetPageFacts
} from '../../../../lib/panel/style-states';
import { useFdtData } from '../../state/use-fdt-data';
import { PAGE_ASK_MISS_COPY } from '../page-ask-miss';
import type { CodeBlockSeams } from '../javascript/code-seams';
import { openResourceCapability, type OpenResource } from '../open-resource';
import { PageFrame } from '../page-frame';
import { CalmFilteredList } from '../resource-list/calm-list';
import {
  calmRowEstimate,
  ListRow,
  ListRowHead,
  type ListRowColumns
} from '../resource-list/list-row';
import type { DetailCopy } from '../resource-list/master-detail';
import { StateSourceLegend } from '../resource-list/state-source-legend';
import { INLINE_CSS_LABEL, NO_STYLES_COPY } from '../resource-list/style-words';
import { realStylesheetsDeps, requestStyleSourceChunk } from './real-deps';
import { createStylesheetsRead, type StylesheetsReadDeps } from './session';
import { StyleDetail } from './style-detail';
import {
  CSS_CHIP_SOURCES,
  CSS_VIEW_FACETS,
  listCutNote,
  sameStyleView,
  STYLE_NOUN,
  styleKind,
  styleRowViews,
  styleSearchField,
  type StyleRowView
} from './style-view';

const log = createLogger('stylesheets');

/** The list's optional columns (rows and head share them). */
const COLUMNS: ListRowColumns = { size: true, states: true };

/** The copy failure's remedy (the CSS is read when copied). */
const COPY_REMEDY = 'Refresh the list and try copying again.';

/** The page's title and one-line intro. */
export const STYLESHEETS_TITLE = 'Stylesheets';
export const STYLESHEETS_SUBTITLE =
  'Every inline style and stylesheet link on the page, and what WP Rocket did to each.';

/** The seams the list and its detail take (production omits them all). */
interface StylesheetsListSeams {
  /** The virtualizer seam (tests inject a layout-free double). */
  createVirtualizer?: VirtualizerFactory;
  /** One CSS chunk read (default: the inspected tab's top frame). */
  readStyleChunk?: (request: StyleSourceRequest) => Promise<unknown>;
  /** "Open in Sources" seam (`null`: none); production detects DevTools' own. */
  openResource?: OpenResource | null;
  /** Code block seams (tests only). */
  codeBlock?: CodeBlockSeams;
}

/** Props of {@link StylesheetsPage} — test seams only; the shell passes none. */
export interface StylesheetsPageProps extends StylesheetsListSeams {
  /** The page ask (tests inject a double); absent, the inspected tab's. */
  listStylesheets?: StylesheetsReadDeps['listStylesheets'];
}

/**
 * The Stylesheets route's page body.
 *
 * @param props See {@link StylesheetsPageProps}.
 */
export function StylesheetsPage(props: StylesheetsPageProps): JSX.Element {
  const store = useFdtData();
  // Created once per mount: the read lives as long as the body.
  const deps = realStylesheetsDeps({ state: store.state });
  const read = createStylesheetsRead({
    ...deps,
    // eslint-disable-next-line solid/reactivity -- read once on purpose: a test seam, fixed per mount
    listStylesheets: props.listStylesheets ?? deps.listStylesheets
  });
  // The verdicts the Minified/Critical chips read; an unchanged set never re-classifies.
  const facts = createMemo(
    (): StylesheetPageFacts => {
      const state = store.state();
      return state.status === 'ready' || state.status === 'refreshing'
        ? stylesheetPageFacts(state.data.wprDetections)
        : NO_STYLESHEET_PAGE_FACTS;
    },
    undefined,
    { equals: sameStylesheetPageFacts }
  );
  const failedMiss = () => {
    const view = read.view();
    return view.status === 'failed' ? view.miss : undefined;
  };
  const ready = () => {
    const view = read.view();
    return view.status === 'ready' ? view : undefined;
  };

  return (
    <PageFrame id="stylesheets" title={STYLESHEETS_TITLE} subtitle={STYLESHEETS_SUBTITLE} fill>
      <Switch>
        <Match when={read.view().status === 'loading'}>
          <div data-fdt="stylesheets-loading" class="grid grid-cols-1 gap-2">
            <Skeleton class="h-6 w-48 max-w-full" />
            <Skeleton class="h-12 w-full" />
            <Skeleton class="h-12 w-full" />
            <Skeleton class="h-12 w-full" />
          </div>
        </Match>
        <Match when={failedMiss()}>
          {(miss) => (
            <ErrorState
              title="Couldn't read the page's stylesheets"
              message={PAGE_ASK_MISS_COPY[miss()]}
              onRetry={read.refresh}
            />
          )}
        </Match>
        <Match when={ready()}>
          {(view) => (
            <StylesheetsList
              reply={view().reply}
              facts={facts()}
              refreshing={view().refreshing}
              refreshMiss={view().refreshMiss}
              onRefresh={read.refresh}
              createVirtualizer={props.createVirtualizer}
              readStyleChunk={props.readStyleChunk}
              openResource={props.openResource}
              codeBlock={props.codeBlock}
            />
          )}
        </Match>
      </Switch>
    </PageFrame>
  );
}

/** Props of {@link StylesheetsList}. */
interface StylesheetsListProps extends StylesheetsListSeams {
  reply: PageStylesheetsReply;
  facts: StylesheetPageFacts;
  refreshing: boolean;
  refreshMiss: keyof typeof PAGE_ASK_MISS_COPY | null;
  onRefresh: () => void;
}

/**
 * The summary strip (the row total, Refresh, the cut and refresh-miss
 * lines) over the facets/search/list body. One memo chain: reply + facts →
 * row views; the list reconciles them by content key.
 *
 * @param props See {@link StylesheetsListProps}.
 */
function StylesheetsList(props: StylesheetsListProps): JSX.Element {
  const views = createMemo((): readonly StyleRowView[] =>
    styleRowViews(buildStylesheetRows(props.reply, props.facts))
  );
  const cut = createMemo(() => listCutNote(props.reply));
  const openResource =
    // eslint-disable-next-line solid/reactivity -- read once on purpose: the seam is fixed per page
    props.openResource === undefined ? openResourceCapability(browser) : props.openResource;

  /**
   * Read a live inline style's CSS from the list it came from.
   *
   * @param view The row.
   * @param snapshotId The list's snapshot.
   * @param signal Cancels between chunks (the detail closed or moved, the copy ended).
   */
  const loadCss = (
    view: StyleRowView,
    snapshotId: string,
    signal: AbortSignal
  ): Promise<StyleSourceResult> =>
    loadStyleSource(
      { snapshotId, styleIndex: view.row.id },
      props.readStyleChunk ?? requestStyleSourceChunk,
      log,
      signal
    );

  /**
   * The detail's CSS read for a row: `null` for a link or the snapshot row;
   * a new read per list (snapshot) and per row object (a moved row is a new one).
   *
   * @param view The row accessor.
   */
  const cssRead = (
    view: Accessor<StyleRowView>
  ): Accessor<((signal: AbortSignal) => Promise<StyleSourceResult>) | null> =>
    createMemo(() => {
      const current = view();
      // Tracked: every new list (snapshot) is a new read of the row.
      const snapshotId = props.reply.snapshotId;
      if (current.row.type !== 'inline' || current.row.source !== 'live') return null;
      return (signal) => loadCss(current, snapshotId, signal);
    });

  /**
   * The detail header's copy: a link's URL, an inline style's full CSS
   * (read when copied); nothing for the snapshot row or an empty style.
   *
   * @param view The row.
   */
  const detailCopy = (view: StyleRowView): DetailCopy | undefined => {
    if (view.row.source === 'snapshot') return undefined;
    if (view.row.type === 'external') {
      return view.row.href === '' ? undefined : { text: view.row.href, label: 'Stylesheet URL' };
    }
    if (view.row.chars === 0) return undefined;
    return {
      text: view.row.preview,
      label: INLINE_CSS_LABEL,
      loadText: async (signal) => {
        const result = await loadCss(view, props.reply.snapshotId, signal);
        if (result.status !== 'ok')
          throw new Error(`The style's CSS could not be read (${result.status}).`);
        return result.text;
      },
      loadFailure: COPY_REMEDY
    };
  };
  return (
    <>
      <div
        data-fdt="stylesheets-summary"
        class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-line-1 bg-surface-1 px-2.5 py-1.5"
      >
        <span data-fdt="stylesheets-total" class="text-xs text-fg-secondary tabular-nums">
          {countLabel(views().length, STYLE_NOUN, cut() !== null)}
        </span>
        <Button
          size="sm"
          variant="secondary"
          busy={props.refreshing}
          data-fdt="stylesheets-refresh"
          onClick={props.onRefresh}
          class="ms-auto"
        >
          <Show when={!props.refreshing}>
            <RefreshCw size={12} aria-hidden="true" />
          </Show>
          Refresh
        </Button>
        <Show when={cut()}>
          {(note) => (
            <p data-fdt="stylesheets-cut" class="basis-full text-2xs text-fg-muted">
              {note()}
            </p>
          )}
        </Show>
        <Show when={props.refreshMiss}>
          {(miss) => (
            <p data-fdt="stylesheets-refresh-miss" class="basis-full text-2xs text-status-warn">
              Couldn't refresh the list: {PAGE_ASK_MISS_COPY[miss()]}
            </p>
          )}
        </Show>
      </div>
      <CalmFilteredList
        rows={views()}
        rowKey={(view) => view.key}
        sameRow={sameStyleView}
        facets={CSS_VIEW_FACETS}
        searchField={styleSearchField}
        empty={
          <EmptyState
            class="self-center"
            icon={<Palette size={16} aria-hidden="true" />}
            title={NO_STYLES_COPY.title}
            description={NO_STYLES_COPY.description}
          />
        }
        noun={STYLE_NOUN}
        listLabel="Stylesheets"
        searchLabel="Search stylesheets"
        searchPlaceholder="Search URLs, ids and CSS…"
        rowHook="stylesheet-row"
        head={<ListRowHead columns={COLUMNS} icon name="Style" size="Chars" states="WP Rocket" />}
        legend={<StateSourceLegend sources={CSS_CHIP_SOURCES} />}
        estimateSize={(view, compact) => calmRowEstimate('two', compact, view.chips.length > 0)}
        renderRow={(view) => (
          <ListRow
            columns={COLUMNS}
            // The JavaScript page's icon pair (already on the panel's start: no new bytes).
            icon={view.row.type === 'inline' ? Code : FileCode}
            name={view.name}
            mono={view.monoName}
            preview={view.preview}
            size={view.size}
            sizeShare={view.sizeShare}
            chips={view.rowChips}
          />
        )}
        detail={{
          kind: styleKind,
          title: (view) => view.name,
          copy: detailCopy,
          body: (view) => (
            <StyleDetail
              view={view}
              openResource={openResource}
              readSource={cssRead(view)}
              codeBlock={props.codeBlock}
            />
          ),
          backLabel: 'Stylesheets'
        }}
        createVirtualizer={props.createVirtualizer}
      />
    </>
  );
}
