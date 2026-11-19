/**
 * The page-style inventory: the inspected page's `style` and stylesheet
 * `link` elements as they are now (the ones a test strips) as calm rows —
 * the Stylesheets page's row look (icon tile, name, one muted preview line
 * holding what a keep rule matches, an inline style's characters, the "Test
 * result" chip) — read on demand from the page, refreshed after each
 * applied test. Rows are static: the Stylesheets page holds each style's
 * detail.
 *
 * States: idle (one action: read them), loading (skeleton rows), failed
 * (named miss + retry), empty (no styles), populated (virtual list under a
 * column header; a cut list says how many the page has).
 */
import type { JSX } from 'solid-js';
import { createMemo, Match, Show, Switch } from 'solid-js';
import Code from 'lucide-solid/icons/code';
import FileCode from 'lucide-solid/icons/file-code';
import RotateCw from 'lucide-solid/icons/rotate-cw';
import { Button } from '../../../../components/ui/button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ErrorState } from '../../../../components/ui/error-state';
import { Skeleton } from '../../../../components/ui/skeleton';
import { VirtualList, type VirtualizerFactory } from '../../../../components/ui/virtual-list';
import type { PageStylesReply } from '../../../../lib/messaging/page-styles';
import { cn } from '../../../../utils/cn';
import { countLabel, formatCount } from '../../../../utils/format-count';
import { PAGE_ASK_MISS_COPY } from '../page-ask-miss';
import { PAGE_CANVAS, PAGE_FILL_SCROLLER } from '../page-frame';
import {
  CALM_ROW_ESTIMATES,
  CALM_ROW_GAP,
  calmRowClass,
  ListRow,
  ListRowHead,
  type ListRowColumns
} from '../resource-list/list-row';
import type { InventoryState } from './session';
import { inventoryRowViews, type InventoryRowView } from './styles-view';

/** The inventory's noun. */
const STYLE_NOUN = { one: 'style', other: 'styles' } as const;

/** The idle state's words. */
export const INVENTORY_IDLE = {
  title: "See this page's styles",
  description:
    'Lists every inline style and stylesheet link on the page now — the ones a test removes or keeps.'
} as const;

/**
 * The inventory's counts line.
 *
 * @param reply The inventory.
 * @returns E.g. "12 styles · 4 inline · 8 stylesheet links", with the cut stated.
 */
export function inventorySummary(reply: PageStylesReply): string {
  const inline = reply.styles.filter((style) => style.kind === 'inline').length;
  const links = reply.styles.length - inline;
  const head = countLabel(reply.total, STYLE_NOUN);
  const cut =
    reply.total > reply.styles.length ? ` (first ${formatCount(reply.styles.length)} listed)` : '';
  return `${head}${cut} · ${formatCount(inline)} inline · ${countLabel(links, { one: 'stylesheet link', other: 'stylesheet links' })}`;
}

/** The rows' optional columns (rows and head share them). */
const COLUMNS: ListRowColumns = { size: true, states: true };

/** The static row surface (no detail: no hover, no selection — K-6). */
const ROW_SURFACE = calmRowClass({
  lines: 'two',
  interactive: false,
  selected: false,
  current: false
});

/**
 * One inventory row: the list kit's calm row with the Stylesheets page's
 * icons (inline / link).
 *
 * @param props.view The row's view.
 */
function StyleRow(props: { view: InventoryRowView }): JSX.Element {
  return (
    <ListRow
      columns={COLUMNS}
      icon={props.view.kind === 'inline' ? Code : FileCode}
      name={props.view.name}
      mono={props.view.monoName}
      preview={props.view.preview}
      size={props.view.size}
      chips={props.view.chips}
    />
  );
}

/**
 * The populated list: the column header above a virtual list of calm rows
 * (views built once per reply). The scroller is painted in the canvas color,
 * so rows past the visible window keep a resolvable text background.
 *
 * @param props.reply The inventory (at least one style).
 * @param props.createVirtualizer The virtualizer seam.
 */
function StyleRows(props: {
  reply: PageStylesReply;
  createVirtualizer?: VirtualizerFactory;
}): JSX.Element {
  const views = createMemo(() => inventoryRowViews(props.reply.styles));
  return (
    <div data-fdt="rucss-styles-rows" class={cn(PAGE_FILL_SCROLLER, 'flex flex-col')}>
      <ListRowHead columns={COLUMNS} icon name="Style" size="Chars" states="Test" />
      <VirtualList
        scrollerRole="list"
        aria-label="Page styles"
        count={views().length}
        // The calm floor; measurement refines it (a compact row with a chip stacks taller).
        estimateSize={() => CALM_ROW_ESTIMATES.twoLine}
        gap={CALM_ROW_GAP}
        createVirtualizer={props.createVirtualizer}
        class={cn('min-h-0 flex-1', PAGE_CANVAS)}
      >
        {(item) => (
          <Show when={views()[item.index]}>
            {(view) => (
              <div role="listitem" data-fdt="rucss-style-row" class={ROW_SURFACE}>
                <StyleRow view={view()} />
              </div>
            )}
          </Show>
        )}
      </VirtualList>
    </div>
  );
}

/** Props of {@link StylesList}. */
export interface StylesListProps {
  state: InventoryState;
  /** Read (or re-read) the page's styles. */
  onInspect: () => void;
  /** The virtualizer seam (tests inject a double). */
  createVirtualizer?: VirtualizerFactory;
}

/**
 * Render the inventory in its current state.
 *
 * @param props See {@link StylesListProps}.
 */
export function StylesList(props: StylesListProps): JSX.Element {
  const ready = () => (props.state.status === 'ready' ? props.state.reply : undefined);
  const failed = () => (props.state.status === 'failed' ? props.state.miss : undefined);
  return (
    // Its own container: the rows' columns read the list's width.
    <div data-fdt="rucss-styles" class="@container flex min-h-0 flex-1 flex-col gap-3">
      <Switch>
        <Match when={props.state.status === 'idle'}>
          <EmptyState
            icon={<FileCode size={16} aria-hidden="true" />}
            title={INVENTORY_IDLE.title}
            description={INVENTORY_IDLE.description}
            action={
              <Button size="sm" variant="primary" data-fdt-rucss-inspect onClick={props.onInspect}>
                Inspect page styles
              </Button>
            }
          />
        </Match>
        <Match when={props.state.status === 'loading'}>
          <div class="grid grid-cols-1 gap-1" data-fdt-rucss-styles-loading>
            <Skeleton class="mb-2 h-4 w-48 max-w-full" />
            <Skeleton class="h-14.5 w-full rounded-lg" />
            <Skeleton class="h-14.5 w-full rounded-lg" />
            <Skeleton class="h-14.5 w-full rounded-lg" />
          </div>
        </Match>
        <Match when={failed()}>
          {(miss) => (
            <ErrorState
              title="Couldn't read the page's styles"
              message={PAGE_ASK_MISS_COPY[miss()]}
              onRetry={props.onInspect}
            />
          )}
        </Match>
        <Match when={ready()}>
          {(reply) => (
            <>
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p data-fdt-rucss-styles-summary class="min-w-0 flex-1 text-2xs text-fg-secondary">
                  {inventorySummary(reply())}
                </p>
                <Button size="sm" variant="secondary" onClick={props.onInspect}>
                  <RotateCw size={12} aria-hidden="true" />
                  Refresh
                </Button>
              </div>
              <Show
                when={reply().styles.length > 0}
                fallback={
                  <EmptyState
                    title="No styles on this page"
                    description="The page has no inline style or stylesheet link right now."
                  />
                }
              >
                <StyleRows reply={reply()} createVirtualizer={props.createVirtualizer} />
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}
