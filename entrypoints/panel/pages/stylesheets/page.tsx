/**
 * The Stylesheets page: every inline style and stylesheet link on the
 * inspected page, with what WP Rocket did to each (state chips, at most
 * three then "+N"), counted on filter chips, searchable, virtualized —
 * read live from the page (the payload carries no style list), classified
 * with the detection's page facts. Loaded on first visit (its own chunk).
 *
 * State matrix (the shell owns loading, fetch errors and crashes; this body
 * renders on `ready`/`refreshing`):
 * - **loading** — the first read, or the first read of a new page load
 *   (a list of an earlier load is never shown): skeleton rows;
 * - **failed** — the read missed the page: the named miss + Retry;
 * - **no-styles** — the page has none (and the snapshot saw no critical
 *   style): an empty state;
 * - **filtered-empty** / **populated** — `FilteredList`'s (`NoMatches` with
 *   the ways back; the list);
 * - **capped** — the page has more styles than one read lists: a muted note;
 * - **refreshing** — Refresh busy, the list stays; a refresh that missed
 *   says so above the kept list.
 * A Refresh (or a payload refresh) keeps the chip, the query and unchanged
 * rows; a new page load re-reads on its own.
 */
import type { JSX } from 'solid-js';
import { createMemo, Match, Show, Switch } from 'solid-js';
import Palette from 'lucide-solid/icons/palette';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import { Button } from '../../../../components/ui/button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ErrorState } from '../../../../components/ui/error-state';
import { Skeleton } from '../../../../components/ui/skeleton';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import type { PageStylesheetsReply } from '../../../../lib/messaging/page-stylesheets';
import { countLabel } from '../../../../lib/panel/list-behavior';
import { buildStylesheetRows, CSS_PAGE_RESOURCES } from '../../../../lib/panel/stylesheet-rows';
import {
  NO_STYLESHEET_PAGE_FACTS,
  sameStylesheetPageFacts,
  stylesheetPageFacts,
  type StylesheetPageFacts
} from '../../../../lib/panel/style-states';
import { useFdtData } from '../../state/use-fdt-data';
import { PAGE_ASK_MISS_COPY } from '../page-ask-miss';
import { PageFrame } from '../page-frame';
import { FilteredList } from '../resource-list/filtered-list';
import { realStylesheetsDeps } from './real-deps';
import { createStylesheetsRead, type StylesheetsReadDeps } from './session';
import { StyleRow } from './style-row';
import {
  estimateStyleRow,
  listCutNote,
  sameStyleRow,
  STYLE_NOUN,
  styleRowViews,
  type StyleRowView
} from './style-view';

/** The page's title and one-line intro. */
export const STYLESHEETS_TITLE = 'Stylesheets';
export const STYLESHEETS_SUBTITLE =
  'Every inline style and stylesheet link on the page, and what WP Rocket did to each.';

/** Props of {@link StylesheetsPage} — test seams only; the shell passes none. */
export interface StylesheetsPageProps {
  /** The page ask (tests inject a double); absent, the inspected tab's. */
  listStylesheets?: StylesheetsReadDeps['listStylesheets'];
  /** The virtualizer seam (tests inject a layout-free double). */
  createVirtualizer?: VirtualizerFactory;
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
            />
          )}
        </Match>
      </Switch>
    </PageFrame>
  );
}

/** Props of {@link StylesheetsList}. */
interface StylesheetsListProps {
  reply: PageStylesheetsReply;
  facts: StylesheetPageFacts;
  refreshing: boolean;
  refreshMiss: keyof typeof PAGE_ASK_MISS_COPY | null;
  onRefresh: () => void;
  createVirtualizer?: VirtualizerFactory;
}

/**
 * The summary strip (the row total, Refresh, the cut and refresh-miss
 * lines) over the filter/search/list body. One memo chain: reply + facts →
 * row views; the list reconciles them by id.
 *
 * @param props See {@link StylesheetsListProps}.
 */
function StylesheetsList(props: StylesheetsListProps): JSX.Element {
  const views = createMemo((): readonly StyleRowView[] =>
    styleRowViews(buildStylesheetRows(props.reply, props.facts))
  );
  const cut = createMemo(() => listCutNote(props.reply));
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
      <FilteredList
        definition={CSS_PAGE_RESOURCES}
        rows={views()}
        sameRow={sameStyleRow}
        empty={
          <EmptyState
            class="self-center"
            icon={<Palette size={16} aria-hidden="true" />}
            title="No styles on this page"
            description="The page has no inline style or stylesheet link right now."
          />
        }
        noun={STYLE_NOUN}
        listLabel="Stylesheets"
        searchLabel="Search stylesheets"
        searchPlaceholder="Search URLs, ids and CSS…"
        estimateSize={estimateStyleRow}
        renderRow={(row) => <StyleRow view={row} />}
        rowHook="stylesheet-row"
        createVirtualizer={props.createVirtualizer}
      />
    </>
  );
}
