/**
 * The Headers & Cookies page — the caching-evidence trail: every captured
 * main-frame response header (caching-relevant ones first, each with its
 * plain-copy verdict hint and its evidence tone) and the names of the
 * cookies page scripts can read. What this page shows and copies never
 * carries a secret: the cookie capture keeps names only, and secret-bearing
 * header values (`Set-Cookie`, credentials, tokens, secret URL query
 * values) are withheld by the panel's one redaction rule before they render
 * or copy — on top of the capture's own redaction (the background stores
 * redacted rows only), so the page re-applying it is a second safety net.
 *
 * State matrix (the shell owns loading, fetch errors and render crashes —
 * this body renders only on `ready`/`refreshing`):
 * - headers captured → the fetched line + SPA note, the filter field, then
 *   the inventory list;
 * - no headers (`null` or `[]`) → the empty state; the cookie section still
 *   lists when the payload carries it;
 * - payload without the cookie capture (an older content script) → the
 *   cookie section and its heading are omitted;
 * - cookie capture with no names → the section with its one-line note;
 * - neither headers nor cookies → the empty state alone;
 * - an all-empty payload landing under a live query → the empty/scaffold
 *   state alone: with no searchable rows the filter does not apply (the
 *   filtered-empty view is reserved for a filter that hides rows that exist).
 *
 * The filter narrows the list by name — header names and cookie names,
 * never a value — and it is the page's side of the panel-wide find: the
 * DevTools find bar (Cmd/Ctrl+F) drives the same store, so its query
 * filters here, its Enter/Shift+Enter walk the matching rows (marker +
 * scroll), and its Esc clears. The store is the shell's one search store
 * (`useSearch`), shared with every list page; the route reset clears it by
 * the standing rule.
 *
 * Timestamps are honest about what they stamp: headers carry no time of
 * their own, so the header side shows when the panel fetched the payload
 * ("Fetched …"); the cookie side shows when the page read its cookies
 * ("Captured …"). Both tick through one aging clock owned by the page.
 */
import { createMemo, Match, onCleanup, Show, Switch, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import Cookie from 'lucide-solid/icons/cookie';
import Info from 'lucide-solid/icons/info';
import RotateCw from 'lucide-solid/icons/rotate-cw';
import ScrollText from 'lucide-solid/icons/scroll-text';
import { Button } from '../../../../components/ui/button';
import { CopyButton } from '../../../../components/ui/copy-button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { SearchField } from '../../../../components/ui/search-field';
import { KeyValue } from '../../../../components/ui/key-value';
import { STATUS_ICONS, STATUS_TEXT_CLASSES } from '../../../../components/ui/status-badge';
import { Tooltip } from '../../../../components/ui/tooltip';
import { VirtualList, type VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { absoluteStampFromMs } from '../../../../lib/detection/describe';
import type { ShownHeader } from '../../../../lib/panel/shown-header';
import {
  buildHeadersViewModel,
  headersTruncationNote
} from '../../../../lib/panel/headers-view-model';
import { fallbackRowKey, normalizeQuery } from '../../../../lib/panel/list-behavior';
import { countNoun } from '../../../../utils/format-count';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { cn } from '../../../../utils/cn';
import { useFdtData, useSearch } from '../../state/use-fdt-data';
import { bindSearchField } from '../../state/search-field';
import type { SearchStore } from '../../state/search';
import { createAgingClock, realAgingClockDeps } from '../../state/aging-clock';
import { relativeAge } from '../../../../utils/relative-age';
import { CURRENT_MATCH_ROW, createCurrentMatch } from '../current-match';
import { NoMatches, PAGE_CANVAS, PAGE_FILL_SCROLLER, PageFrame } from '../page-frame';
import { CALM_ROW_GAP } from '../resource-list/list-row';
import { createResultsAnnouncement } from '../results-announcement';
import { WithheldLegend, WithheldValue } from '../withheld-value';
import { inspectedReloadAction } from '../reload-inspected';
import {
  allHeadersCopyText,
  buildInventory,
  estimateRowHeight,
  filterInventory,
  headerCopyLabel,
  headerCopyText,
  heldFetchStamp,
  INVENTORY_NOUN,
  inventoryItemName,
  isoStamp,
  SECTION_NOUNS,
  SECTION_TITLES,
  sectionIndexes,
  shownStamp,
  type InventoryRow,
  type InventorySectionId
} from './inventory';

/** The page's one-line "what am I looking at". */
export const PAGE_SUBTITLE = 'Main-frame response headers and readable cookie names.';

/** The SPA limitation, stated where the fetched time is. */
export const SPA_NOTE =
  "Headers come from the last main-frame response — in-page (SPA) navigations don't refresh them.";

/**
 * The filter field's accessible name — it declares the searched fields, so
 * the name itself answers "search what?".
 */
export const SEARCH_LABEL = 'Search header and cookie names';

/** The filter field's placeholder (the same declared fields, command form). */
export const SEARCH_PLACEHOLDER = 'Search header and cookie names…';

/** The scroller's accessible name. */
const LIST_LABEL = 'Response headers and cookies';

/**
 * Rows rendered beyond the visible window. Every header row carries a copy
 * button, so sequential Tab must always find the next row already mounted:
 * a generous buffer keeps keyboard traversal inside the list.
 */
const LIST_OVERSCAN = 24;

/**
 * A section heading band's box, each part's class beside its painted size
 * (Tailwind's 4 px spacing step) so the scroll padding sums what renders:
 * the fixed heading line, and the separation above every heading but the
 * first (painted by the band, so it stays part of a stuck band).
 */
export const SECTION_BAND = {
  line: { class: 'h-9', px: 36 },
  gap: { class: 'pt-3', px: 12 }
} as const;

/**
 * The tallest stuck section band (px): a later heading's line plus its gap.
 * Scrolled rows (find requests and focus alike) land this far down, never
 * under the band; under the first heading (36 px) they sit 12 px clear of it.
 */
export const STUCK_BAND_PX = SECTION_BAND.line.px + SECTION_BAND.gap.px;

/** A list row's box (T-3): 36 px one-line floor, 14 px inline padding, no hairlines. */
const ROW_BOX = 'min-h-9 px-3.5';

/** Props of {@link HeadersCookiesView}. */
export interface HeadersCookiesViewProps {
  /** The loaded payload. */
  data: FdtData;
  /**
   * The panel's search store — the one the DevTools find bar drives. The
   * page's name filter is its page side: the field binds it, the list
   * reports the matching rows and names the cursor's row.
   */
  search: SearchStore;
  /** When the panel fetched the payload (ms), or null when unknown. */
  fetchedAt: number | null;
  /** The aging clock's reading (ms) the relative times age against. */
  now: number;
  /** The virtualizer seam, forwarded to the list (tests inject a double). */
  createVirtualizer?: VirtualizerFactory;
  /**
   * Reloads the inspected page (the empty state's remedy); absent where the
   * context cannot (a standalone extension page), which hides the action.
   */
  reloadInspectedPage?: () => void;
}

/** Props of {@link HeadersCookiesPage}. */
export interface HeadersCookiesPageProps {
  /** The virtualizer seam, forwarded to the list (tests inject a double). */
  createVirtualizer?: VirtualizerFactory;
}

/**
 * Render the page body.
 *
 * Wiring only: reads the shell's data store, holds the fetch stamp across a
 * soft refresh, and owns one aging clock for the relative times (armed for
 * the page's lifetime — a page body only exists while data is loaded —
 * and stopped on unmount).
 *
 * @returns The page body, or nothing outside the loaded states.
 */
export function HeadersCookiesPage(props: HeadersCookiesPageProps = {}): JSX.Element {
  const store = useFdtData();
  const search = useSearch();
  const clock = createAgingClock(realAgingClockDeps());
  clock.setLoaded(true);
  onCleanup(() => {
    clock.stop();
  });
  const payload = createMemo((): FdtData | null => {
    const state = store.state();
    return state.status === 'ready' || state.status === 'refreshing' ? state.data : null;
  });
  const fetchedAt = createMemo<number | null>(
    (previous) => heldFetchStamp(store.state(), previous),
    null
  );
  return (
    <Show when={payload()}>
      {(data) => (
        <HeadersCookiesView
          data={data()}
          search={search}
          fetchedAt={fetchedAt()}
          now={clock.now()}
          createVirtualizer={props.createVirtualizer}
          reloadInspectedPage={inspectedReloadAction(browser)}
        />
      )}
    </Show>
  );
}

/**
 * Render the page for one payload — the messaging-free half (the store
 * arrives as a prop), so every state is testable with plain props.
 *
 * Layout: the frame's fill mode; the fetched line, then the filter field,
 * then one virtual list over the flattened inventory (section headings +
 * rows) — one scroller for everything, never nested ones; each section's
 * heading sticks to the list's top while its rows scroll. The list renders
 * the query's matches; a query that matches nothing lands on the shared
 * filtered-empty view with its one-click way back.
 *
 * The find's page side: the rendered item rows under the query are the
 * match set (reported to the store), and the find's cursor names one of
 * them — the marker plus the scroll request land on the mapped row;
 * scaffolding (headings, notes) never matches, having no name.
 *
 * @param props See {@link HeadersCookiesViewProps}.
 * @returns The page frame with its sections.
 */
export function HeadersCookiesView(props: HeadersCookiesViewProps): JSX.Element {
  const inventory = createMemo(() =>
    buildInventory(buildHeadersViewModel(props.data.pageHeaders), props.data.cookies)
  );
  // The shared field binding: raw echo, the shell's one store, the Esc
  // rule — the DevTools find bar drives the same store. The store prop is
  // read once: its identity is stable for the mounted view (the shell
  // provides one), and the reactivity lives in its signals, which the
  // memos below track.
  // eslint-disable-next-line solid/reactivity -- read once on purpose
  const search = props.search;
  const field = bindSearchField(search);
  const query = createMemo(() => normalizeQuery(search.query()));
  const rows = (): readonly InventoryRow[] => inventory().rows;
  // The searched rows (headers + cookie names) — the scaffold rows (headings,
  // notes) are never counted by the shared count line.
  const isItem = (row: InventoryRow): boolean => inventoryItemName(row) !== null;
  const items = createMemo(() => rows().filter(isItem));
  // The filtered rows: name evidence only (headers and cookie names — never
  // a value), section counts restated to what survives. With no searchable
  // rows the filter does not apply: a stale query over a scaffold-only list
  // renders the scaffold (section + note), never NoMatches beside the
  // EmptyState (the filtered-empty view is reserved for a filter that hides
  // rows that exist).
  const visible = createMemo(() =>
    items().length === 0 ? rows() : filterInventory(rows(), query())
  );
  const visibleItems = createMemo(() => visible().filter(isItem));
  // The find's page side: the filtered item rows are the match set — their
  // positions in the rendered list (scaffold rows never match, having no
  // name) — and the cursor's row is the marker + scroll target.
  const matchIndices = createMemo(() =>
    visible().flatMap((row, index) => (isItem(row) ? [index] : []))
  );
  const match = createCurrentMatch(search, () => matchIndices().length, matchIndices);
  const allHeaders = createMemo(() => allHeadersCopyText(rows()));
  // The legend is page-level meta (it names the lock-marker vocabulary for
  // the whole capture), so it reads the full inventory and never flips with
  // the filter — it mounts once, where every user can read it.
  const hasWithheld = createMemo(() =>
    rows().some((row) => row.kind === 'header' && row.header.redacted)
  );
  // The section headings stick to the list's top while their rows scroll.
  const stuck = createMemo(() => sectionIndexes(visible()));
  let controls: HTMLDivElement | undefined;
  /** Where focus lands after the filtered-empty view's way back clears the field. */
  const focusAfter = (): HTMLElement | null | undefined =>
    controls?.querySelector<HTMLElement>('input[type="search"]');
  // The shared count line: truthful text always; a data refresh updates it
  // silently, a committed query change announces again (never per keystroke,
  // never on mount).
  const { text: announcement, live } = createResultsAnnouncement({
    rows: items,
    visible: visibleItems,
    noun: INVENTORY_NOUN,
    actions: [query]
  });
  // The stamps as `Show` conditions: an object, so a stamp of 0 still shows.
  const fetched = (): { at: number } | undefined => {
    const at = shownStamp(props.fetchedAt);
    return at === null ? undefined : { at };
  };
  const cookiesCapturedAt = (): number | null => shownStamp(props.data.cookies?.capturedAt);
  return (
    <PageFrame
      id="headers-cookies"
      title="Headers & Cookies"
      subtitle={PAGE_SUBTITLE}
      fill
      actions={
        <Show when={inventory().hasHeaders}>
          <CopyButton text={allHeaders()} label="All headers" variant="secondary" />
        </Show>
      }
    >
      <Show
        when={inventory().hasHeaders}
        fallback={
          <EmptyState
            icon={<ScrollText size={16} aria-hidden="true" />}
            title="No response headers captured"
            description="The capture reads the page's main-frame response — reload the inspected page to capture it."
            // Beside the cookie list, the state sits as a left-aligned lead
            // block instead of a centred void above it.
            class={inventory().hasCookies ? 'items-start py-2 text-start' : undefined}
            action={
              props.reloadInspectedPage === undefined ? undefined : (
                <Button
                  size="sm"
                  onClick={() => {
                    props.reloadInspectedPage?.();
                  }}
                >
                  <RotateCw size={12} aria-hidden="true" />
                  Reload inspected page
                </Button>
              )
            }
          />
        }
      >
        <p data-fdt="headers-fetched" class="flex items-start gap-1.5 text-2xs text-fg-muted">
          <Info size={12} class="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <Show when={fetched()}>
              {(stamp) => (
                <>
                  <Stamp verb="Fetched" at={stamp().at} now={props.now} />
                  <span aria-hidden="true"> · </span>
                </>
              )}
            </Show>
            {SPA_NOTE}
          </span>
        </p>
        <Show
          when={headersTruncationNote(
            props.data.pageHeaders ?? [],
            props.data.pageHeadersTruncated
          )}
        >
          {(note) => (
            <p data-fdt="headers-truncated" class="-mt-2 ps-[1.125rem] text-2xs text-fg-muted">
              {note()}
            </p>
          )}
        </Show>
        <Show when={hasWithheld()}>
          <WithheldLegend class="-mt-2" />
        </Show>
      </Show>
      <Show when={items().length > 0}>
        {/* Esc in the field is the binding's rule; the ref targets the way-back focus. */}
        <div ref={controls} onKeyDown={field.onKeyDown}>
          <SearchField
            value={field.value()}
            onValueChange={(raw) => {
              field.input(raw);
            }}
            label={SEARCH_LABEL}
            placeholder={SEARCH_PLACEHOLDER}
          />
        </div>
      </Show>
      <Show when={rows().length > 0}>
        <Show
          when={visible().length > 0}
          fallback={
            <div class={cn(PAGE_FILL_SCROLLER, 'grid place-items-center')}>
              <NoMatches
                query={query()}
                onClearSearch={() => {
                  field.clear();
                }}
                focusAfter={focusAfter}
              />
            </div>
          }
        >
          <VirtualList
            scrollerRole="list"
            aria-label={LIST_LABEL}
            count={visible().length}
            estimateSize={(index) => {
              const row = visible()[index];
              return row === undefined ? 36 : estimateRowHeight(row);
            }}
            getItemKey={(index) => visible()[index]?.id ?? fallbackRowKey(index)}
            overscan={LIST_OVERSCAN}
            gap={CALM_ROW_GAP}
            stickyIndexes={stuck()}
            scrollPaddingStart={STUCK_BAND_PX}
            createVirtualizer={props.createVirtualizer}
            scrollTo={match.request}
            // Opaque in the canvas's own color (no visible change): overscan
            // rows past the visible window then resolve their text background
            // to it, and the stuck band paints the same canvas over the rows.
            class={cn(PAGE_FILL_SCROLLER, PAGE_CANVAS)}
          >
            {(item) => (
              <Show when={visible()[item.index]}>
                {(row) => (
                  <InventoryItem
                    row={row()}
                    position={item.index + 1}
                    total={visible().length}
                    matched={match.current() === item.index}
                    cookiesCapturedAt={cookiesCapturedAt()}
                    now={props.now}
                  />
                )}
              </Show>
            )}
          </VirtualList>
        </Show>
      </Show>
      <div role="status" aria-live={live()} class="sr-only" data-fdt="headers-results-status">
        {announcement()}
      </div>
    </PageFrame>
  );
}

/** Props of {@link InventoryItem}. */
interface InventoryItemProps {
  /** The row to render. */
  row: InventoryRow;
  /** 1-based position in the list (`aria-posinset`). */
  position: number;
  /** The list's length (`aria-setsize` — virtual rows are not all in the DOM). */
  total: number;
  /** Whether the find's cursor names this row (the active match). */
  matched: boolean;
  /** The cookie capture's stamp (shown on the cookie heading), or null. */
  cookiesCapturedAt: number | null;
  /** The aging clock's reading. */
  now: number;
}

/**
 * Render one list row as a `listitem`, dispatching on its kind. Rows sit on
 * the list's 4 px gap with no hairlines (T-3): item rows tint on hover and
 * while their control has focus (instant — no transition), the section
 * heading paints the canvas so it can stick over the rows. The find's
 * active match renders the shared current-row marker (a start-edge rail +
 * wash, with `aria-current` — shape, never color alone); only item rows can
 * match, the scaffolding never does.
 *
 * @param props See {@link InventoryItemProps}.
 * @returns The `listitem`.
 */
function InventoryItem(props: InventoryItemProps): JSX.Element {
  // One narrowing accessor per kind: a soft refresh hands the same index a
  // new row object of the same kind, and the non-keyed branches below keep
  // their DOM (focus on a copy button included) while the values update.
  const section = () => (props.row.kind === 'section' ? props.row : undefined);
  const header = () => (props.row.kind === 'header' ? props.row : undefined);
  const cookie = () => (props.row.kind === 'cookie' ? props.row : undefined);
  const note = () => (props.row.kind === 'note' ? props.row : undefined);
  const lead = () => (props.row.kind === 'lead' ? props.row : undefined);
  return (
    <div
      role="listitem"
      aria-setsize={props.total}
      aria-posinset={props.position}
      data-fdt-inventory-row={props.row.kind}
      aria-current={props.matched ? 'true' : undefined}
      class={cn(
        (props.row.kind === 'header' || props.row.kind === 'cookie') &&
          'rounded-lg focus-within:bg-surface-2 hover:bg-surface-2',
        props.matched && CURRENT_MATCH_ROW
      )}
    >
      <Switch>
        <Match when={section()}>
          {(row) => (
            <SectionHeading
              section={row().section}
              count={row().count}
              first={props.position === 1}
              capturedAt={row().section === 'cookies' ? props.cookiesCapturedAt : null}
              now={props.now}
            />
          )}
        </Match>
        <Match when={header()}>
          {(row) => <HeaderItem header={row().header} copyLabel={headerCopyLabel(row())} />}
        </Match>
        <Match when={cookie()}>
          {(row) => (
            <div class={cn(ROW_BOX, 'flex items-center gap-2 py-1.5')}>
              <Cookie size={12} class="shrink-0 text-fg-muted" aria-hidden="true" />
              <span class="min-w-0 font-mono text-xs break-all text-fg-primary">{row().name}</span>
            </div>
          )}
        </Match>
        <Match when={note()}>
          {(row) => (
            // The capture's own callout (what its absence says): a tinted
            // note row, so it never reads as one more item.
            <p
              data-fdt="headers-note"
              class={cn(
                ROW_BOX,
                'flex items-center gap-1.5 rounded-lg bg-status-info-soft py-2 text-2xs text-fg-secondary'
              )}
            >
              <Info size={12} class="shrink-0 text-status-info" aria-hidden="true" />
              <span>{row().text}</span>
            </p>
          )}
        </Match>
        <Match when={lead()}>
          {(row) => <p class="px-3.5 pb-1 text-2xs text-fg-secondary">{row().text}</p>}
        </Match>
      </Switch>
    </div>
  );
}

/** Props of {@link SectionHeading}. */
interface SectionHeadingProps {
  /** Which section the heading opens. */
  section: InventorySectionId;
  /** The section's item count. */
  count: number;
  /** Whether the heading opens the list (no separation space above it). */
  first: boolean;
  /** The cookie capture's stamp (cookie section only), or null. */
  capturedAt: number | null;
  /** The aging clock's reading. */
  now: number;
}

/**
 * Render a section's sticky heading band: one 36 px line with the level-2
 * caps heading and its tabular count, plus — for cookies — the capture
 * stamp at the end (truncating, never wrapping: the band's height is the
 * list's scroll padding). The band paints the canvas, so the rows scrolling
 * under it while it is stuck stay hidden.
 *
 * @param props See {@link SectionHeadingProps}.
 * @returns The heading band.
 */
function SectionHeading(props: SectionHeadingProps): JSX.Element {
  const noun = (): string => countNoun(props.count, SECTION_NOUNS[props.section]);
  return (
    <div class={cn(PAGE_CANVAS, 'px-3.5', !props.first && SECTION_BAND.gap.class)}>
      <div class={cn(SECTION_BAND.line.class, 'flex min-w-0 items-center gap-3')}>
        <div
          role="heading"
          aria-level="2"
          class="flex shrink-0 items-center gap-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase"
        >
          <span>{SECTION_TITLES[props.section]}</span>{' '}
          {/* The space keeps the accessible name "<title> <count> <noun>". */}
          <span data-fdt="headers-section-count" class="text-fg-secondary tabular-nums">
            {props.count}
            <span class="sr-only"> {noun()}</span>
          </span>
        </div>
        <Show when={props.capturedAt !== null ? props.capturedAt : undefined}>
          {(at) => (
            <span class="ms-auto min-w-0 truncate text-2xs text-fg-muted">
              <Stamp verb="Captured" at={at()} now={props.now} plain />
            </span>
          )}
        </Show>
      </div>
    </div>
  );
}

/** Props of {@link HeaderItem}. */
interface HeaderItemProps {
  /** The (redacted where needed) header row. */
  header: ShownHeader;
  /** The copy control's name, disambiguated among same-name rows. */
  copyLabel: string;
}

/**
 * Render one header row: one key-value line (the name in a fixed column
 * beside its value from the regular tier, stacked above it when compact;
 * values break anywhere, so a long one wraps inside its column), the
 * verdict hint under the value when the shared model has one — its
 * status-vocabulary icon carries the verdict's tone (shape + color; the
 * wording always states the meaning) — and an always-visible, muted copy
 * control for the wire form `name: value`. A withheld value renders through
 * the shared `WithheldValue` (lock + marker; the reason on hover and for
 * screen readers). The text's 4 px inset centres its first line on the
 * 24 px control, which stays at the top beside a wrapped value.
 *
 * @param props See {@link HeaderItemProps}.
 * @returns The header row.
 */
function HeaderItem(props: HeaderItemProps): JSX.Element {
  return (
    <div class={cn(ROW_BOX, 'flex items-start gap-2 py-1.5')}>
      <KeyValue
        stacked
        term={props.header.name}
        class={cn(
          'min-w-0 flex-1 gap-y-0.5 py-1 @regular:flex-row @regular:gap-x-3.5',
          '[&>[data-fdt-key-value-term]]:font-mono [&>[data-fdt-key-value-term]]:break-all',
          '@regular:[&>[data-fdt-key-value-term]]:w-40 @wide:[&>[data-fdt-key-value-term]]:w-56',
          '@regular:[&>[data-fdt-key-value-value]]:flex-1'
        )}
      >
        <Show
          when={props.header.value}
          fallback={<span class="block text-fg-muted italic">(no value)</span>}
        >
          {(value) => (
            <Show when={!props.header.redacted} fallback={<WithheldValue value={value()} />}>
              <span class="block font-mono break-all text-fg-primary">{value()}</span>
            </Show>
          )}
        </Show>
        <Show when={props.header.hint}>
          {(hint) => (
            <span class="mt-0.5 flex items-start gap-1 text-2xs text-fg-secondary">
              <Dynamic
                component={STATUS_ICONS[hint().tone]}
                size={12}
                class={cn('mt-0.5 shrink-0', STATUS_TEXT_CLASSES[hint().tone])}
                aria-hidden="true"
              />
              <span>{hint().text}</span>
            </span>
          )}
        </Show>
      </KeyValue>
      {/* The wrapper's title names the icon-only control on hover (no
          per-row tooltip component inside a virtual row). */}
      <span class="shrink-0" title={`Copy ${props.copyLabel}`}>
        <CopyButton
          text={headerCopyText(props.header)}
          label={props.copyLabel}
          showLabel={false}
          class="text-fg-muted"
        />
      </span>
    </div>
  );
}

/** Props of {@link Stamp}. */
interface StampProps {
  /** What happened at the instant — "Fetched" or "Captured". */
  verb: 'Fetched' | 'Captured';
  /** The instant (ms). */
  at: number;
  /** The aging clock's reading (ms). */
  now: number;
  /**
   * The plain form for virtual rows: a `title` plus an sr-only absolute time
   * instead of a tooltip component (rows remount on scroll; no per-row
   * floating UI).
   */
  plain?: boolean;
}

/**
 * Render a relative time ("Fetched 2 min ago") whose tooltip carries the
 * absolute UTC instant. Callers pass only shown stamps (`shownStamp`); a
 * stamp without an absolute form would still degrade to the bare relative
 * text rather than throw. The trigger sits inside a line of text, so it
 * keeps the line's height (WCAG 2.5.8's inline exception) instead of the
 * tooltip's 24 px block floor.
 *
 * @param props See {@link StampProps}.
 * @returns The stamp text (with its tooltip or title).
 */
function Stamp(props: StampProps): JSX.Element {
  const relative = (): string => `${props.verb} ${relativeAge(props.now - props.at)}`;
  const absolute = (): string | null => absoluteStampFromMs(props.at);
  return (
    <Show when={absolute()} fallback={<span>{relative()}</span>}>
      {(stamp) => (
        <Show
          when={!props.plain}
          fallback={
            <time datetime={isoStamp(props.at)} title={`${props.verb} at ${stamp()}`}>
              {relative()}
              <span class="sr-only"> ({stamp()})</span>
            </time>
          }
        >
          <Tooltip
            content={`${props.verb} at ${stamp()}`}
            class="inline-flex min-h-0 min-w-0 rounded-sm align-baseline text-inherit underline decoration-line-3 decoration-dotted underline-offset-2 hover:text-fg-primary"
          >
            <time datetime={isoStamp(props.at)}>{relative()}</time>
          </Tooltip>
        </Show>
      )}
    </Show>
  );
}
