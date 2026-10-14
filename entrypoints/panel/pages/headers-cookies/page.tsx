/**
 * The Headers & Cookies page — the caching-evidence trail: every captured
 * main-frame response header (caching-relevant ones first, each with its
 * plain-copy verdict hint) and the names of the cookies page scripts can
 * read. Cookie values never reach this page: the capture keeps names only,
 * and `Set-Cookie` header values are redacted before they render or copy.
 *
 * State matrix (the shell owns loading, fetch errors and render crashes —
 * this body renders only on `ready`/`refreshing`):
 * - headers captured → the fetched line + SPA note, then the inventory list;
 * - no headers (`null` or `[]`) → the empty state; the cookie section still
 *   lists when the payload carries it;
 * - payload without the cookie capture (an older content script) → the
 *   cookie section and its heading are omitted;
 * - cookie capture with no names → the section with its one-line note;
 * - neither headers nor cookies → the empty state alone.
 *
 * Timestamps are honest about what they stamp: headers carry no time of
 * their own, so the header side shows when the panel fetched the payload
 * ("Fetched …"); the cookie side shows when the page read its cookies
 * ("Captured …"). Both tick through one aging clock owned by the page.
 */
import { createMemo, Match, onCleanup, Show, Switch, type JSX } from 'solid-js';
import Cookie from 'lucide-solid/icons/cookie';
import Info from 'lucide-solid/icons/info';
import ScrollText from 'lucide-solid/icons/scroll-text';
import { Badge } from '../../../../components/ui/badge';
import { CopyButton } from '../../../../components/ui/copy-button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { KeyValue } from '../../../../components/ui/key-value';
import { Tooltip } from '../../../../components/ui/tooltip';
import { VirtualList, type VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { buildHeadersViewModel, type HeaderRowVM } from '../../../../lib/panel/headers-view-model';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { cn } from '../../../../utils/cn';
import { useFdtData } from '../../state/use-fdt-data';
import { createAgingClock, realAgingClockDeps } from '../../status-bar/aging-clock';
import { relativeAge } from '../../status-bar/relative-age';
import { PAGE_FILL_SCROLLER, PageFrame } from '../page-frame';
import { contentMeasuredVirtualizer } from './content-measured-virtualizer';
import {
  absoluteStamp,
  allHeadersCopyText,
  buildInventory,
  COOKIES_LEAD,
  estimateRowHeight,
  headerCopyText,
  heldFetchStamp,
  isoStamp,
  SECTION_TITLES,
  shownStamp,
  type InventoryRow,
  type InventorySectionId
} from './inventory';

/** The page's one-line "what am I looking at". */
export const PAGE_SUBTITLE = 'Main-frame response headers and readable cookie names';

/** The SPA limitation, stated where the fetched time is. */
export const SPA_NOTE =
  "Headers come from the last main-frame response — in-page (SPA) navigations don't refresh them.";

/** The scroller's accessible name. */
const LIST_LABEL = 'Response headers and cookies';

/**
 * Rows rendered beyond the visible window. Every header row carries a copy
 * button, so sequential Tab must always find the next row already mounted:
 * a generous buffer keeps keyboard traversal inside the list.
 */
const LIST_OVERSCAN = 24;

/** Props of {@link HeadersCookiesView}. */
export interface HeadersCookiesViewProps {
  /** The loaded payload. */
  data: FdtData;
  /** When the panel fetched the payload (ms), or null when unknown. */
  fetchedAt: number | null;
  /** The aging clock's reading (ms) the relative times age against. */
  now: number;
  /** The virtualizer seam (default: content-measured rows; tests inject a double). */
  createVirtualizer?: VirtualizerFactory;
}

/**
 * Render the page body.
 *
 * Wiring only: reads the shell's data store, holds the fetch stamp across a
 * soft refresh, and owns one aging clock for the relative times (armed for
 * the page's lifetime — a page body only exists while data is loaded —
 * and stopped on unmount).
 */
export function HeadersCookiesPage(): JSX.Element {
  const store = useFdtData();
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
      {(data) => <HeadersCookiesView data={data()} fetchedAt={fetchedAt()} now={clock.now()} />}
    </Show>
  );
}

/**
 * Render the page for one payload — the store-free half, so every state is
 * testable with plain props.
 *
 * Layout: the frame's fill mode; the fetched line, then one virtual list
 * over the flattened inventory (section headings + rows) — one scroller for
 * everything, never nested ones.
 *
 * @param props See {@link HeadersCookiesViewProps}.
 */
export function HeadersCookiesView(props: HeadersCookiesViewProps): JSX.Element {
  const inventory = createMemo(() =>
    buildInventory(buildHeadersViewModel(props.data.pageHeaders), props.data.cookies)
  );
  const rows = (): readonly InventoryRow[] => inventory().rows;
  const allHeaders = createMemo(() => allHeadersCopyText(rows()));
  // Rows wrap to any height (long values, hints), so they are measured by
  // their content — see the factory's TSDoc.
  // eslint-disable-next-line solid/reactivity -- the seam is settled once, like the list's own
  const virtualizer = props.createVirtualizer ?? contentMeasuredVirtualizer();
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
          />
        }
      >
        <p data-fdt="headers-fetched" class="flex items-start gap-1.5 text-2xs text-fg-muted">
          <Info size={12} class="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <Show when={shownStamp(props.fetchedAt)}>
              {(at) => (
                <>
                  <Stamp verb="Fetched" at={at()} now={props.now} />
                  <span aria-hidden="true"> · </span>
                </>
              )}
            </Show>
            {SPA_NOTE}
          </span>
        </p>
      </Show>
      <Show when={rows().length > 0}>
        <VirtualList
          scrollerRole="list"
          aria-label={LIST_LABEL}
          count={rows().length}
          estimateSize={(index) => {
            const row = rows()[index];
            return row === undefined ? 32 : estimateRowHeight(row);
          }}
          getItemKey={(index) => rows()[index]?.id ?? index}
          overscan={LIST_OVERSCAN}
          createVirtualizer={virtualizer}
          class={cn(PAGE_FILL_SCROLLER, '-mx-1 px-1')}
        >
          {(item) => (
            <Show when={rows()[item.index]}>
              {(row) => (
                <InventoryItem
                  row={row()}
                  position={item.index + 1}
                  total={rows().length}
                  cookiesCapturedAt={shownStamp(props.data.cookies?.capturedAt)}
                  now={props.now}
                />
              )}
            </Show>
          )}
        </VirtualList>
      </Show>
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
  /** The cookie capture's stamp (shown on the cookie heading), or null. */
  cookiesCapturedAt: number | null;
  /** The aging clock's reading. */
  now: number;
}

/**
 * Render one list row as a `listitem`, dispatching on its kind. Rows are
 * hairline-separated (a heading's line is one step stronger); the last row
 * has nothing below it to separate, so it draws none.
 *
 * @param props See {@link InventoryItemProps}.
 */
function InventoryItem(props: InventoryItemProps): JSX.Element {
  const last = (): boolean => props.position === props.total;
  // One narrowing accessor per kind: a soft refresh hands the same index a
  // new row object of the same kind, and the non-keyed branches below keep
  // their DOM (focus on a copy button included) while the values update.
  const section = () => (props.row.kind === 'section' ? props.row : undefined);
  const header = () => (props.row.kind === 'header' ? props.row : undefined);
  const cookie = () => (props.row.kind === 'cookie' ? props.row : undefined);
  const note = () => (props.row.kind === 'note' ? props.row : undefined);
  return (
    <div
      role="listitem"
      aria-setsize={props.total}
      aria-posinset={props.position}
      data-fdt-inventory-row={props.row.kind}
      class={cn(
        !last() && 'border-b',
        props.row.kind === 'section' ? 'border-line-2' : 'border-line-1'
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
        <Match when={header()}>{(row) => <HeaderItem header={row().header} />}</Match>
        <Match when={cookie()}>
          {(row) => (
            <div class="flex min-h-8 items-center gap-2 px-1 py-1.5">
              <Cookie size={12} class="shrink-0 text-fg-muted" aria-hidden="true" />
              <span class="min-w-0 font-mono text-xs break-all text-fg-primary">{row().name}</span>
            </div>
          )}
        </Match>
        <Match when={note()}>
          {(row) => (
            <p class="flex min-h-8 items-center px-1 py-1.5 text-2xs text-fg-secondary">
              {row().text}
            </p>
          )}
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
 * Render a section's heading band: the level-2 heading with its count, plus
 * — for cookies — the capture stamp and the lead line naming both limits.
 *
 * @param props See {@link SectionHeadingProps}.
 */
function SectionHeading(props: SectionHeadingProps): JSX.Element {
  const noun = (): string => {
    const singular = props.section === 'cookies' ? 'cookie' : 'header';
    return props.count === 1 ? singular : `${singular}s`;
  };
  return (
    <div class={cn('px-1 pb-1.5', props.first ? 'pt-0.5' : 'pt-5')}>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <div
          role="heading"
          aria-level="2"
          class="flex items-center gap-1.5 text-sm font-semibold text-fg-primary"
        >
          <span>{SECTION_TITLES[props.section]}</span>{' '}
          {/* The space keeps the accessible name "<title> <count> <noun>". */}
          <Badge class="tabular-nums">
            {props.count}
            <span class="sr-only"> {noun()}</span>
          </Badge>
        </div>
        <Show when={props.capturedAt}>
          {(at) => (
            <span class="ms-auto text-2xs text-fg-muted">
              <Stamp verb="Captured" at={at()} now={props.now} />
            </span>
          )}
        </Show>
      </div>
      <Show when={props.section === 'cookies'}>
        <p class="mt-0.5 text-2xs text-fg-secondary">{COOKIES_LEAD}</p>
      </Show>
    </div>
  );
}

/**
 * Render one header row: the name over its value (side by side from the
 * regular tier), the verdict hint under the value when the shared model has
 * one, and an always-visible copy control for the wire form `name: value`.
 *
 * @param props.header The (redacted where needed) header row.
 */
function HeaderItem(props: { header: HeaderRowVM }): JSX.Element {
  return (
    <div class="flex items-start gap-1 py-1.5 ps-1">
      <KeyValue
        stacked
        term={props.header.name}
        class={cn(
          'min-w-0 flex-1 gap-y-0.5 @regular:flex-row @regular:gap-x-3',
          '[&>[data-fdt-key-value-term]]:font-mono [&>[data-fdt-key-value-term]]:break-all',
          '@regular:[&>[data-fdt-key-value-term]]:w-40 @wide:[&>[data-fdt-key-value-term]]:w-56',
          '@regular:[&>[data-fdt-key-value-value]]:flex-1'
        )}
      >
        <Show
          when={props.header.value}
          fallback={<span class="block text-fg-muted italic">(no value)</span>}
        >
          {(value) => <span class="block font-mono break-all text-fg-primary">{value()}</span>}
        </Show>
        <Show when={props.header.hint}>
          {(hint) => (
            <span class="mt-0.5 flex items-start gap-1 text-2xs text-fg-secondary">
              <Info size={12} class="mt-0.5 shrink-0 text-status-info" aria-hidden="true" />
              <span>{hint()}</span>
            </span>
          )}
        </Show>
      </KeyValue>
      <CopyButton
        text={headerCopyText(props.header)}
        label={`${props.header.name} header`}
        showLabel={false}
        class="-my-0.5 shrink-0"
      />
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
 */
function Stamp(props: StampProps): JSX.Element {
  const relative = (): string => `${props.verb} ${relativeAge(props.now - props.at)}`;
  return (
    <Show when={absoluteStamp(props.at)} fallback={<span>{relative()}</span>}>
      {(absolute) => (
        <Tooltip
          content={`${props.verb} at ${absolute()}`}
          class="inline-flex min-h-0 min-w-0 rounded-sm align-baseline text-inherit underline decoration-line-3 decoration-dotted underline-offset-2 hover:text-fg-primary"
        >
          <time datetime={isoStamp(props.at)}>{relative()}</time>
        </Tooltip>
      )}
    </Show>
  );
}
