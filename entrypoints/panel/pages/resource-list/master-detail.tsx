/**
 * The calm list's master–detail: which row is selected, where its detail
 * shows, and how keys, focus and scroll follow.
 *
 * - **Layout** from the list's own measured width (`detailLayout`): a 350 px
 *   side pane from the split width on, else a drill-in view that replaces
 *   the list (Back, ↑/↓ between rows, "n of m", the primary actions — in the
 *   bar, or a bottom bar on a compact list).
 * - **Selection** is the list-selection machine keyed by row key: refreshes
 *   keep it, a filter/search hiding it clears the pane or marks the drill
 *   "no longer listed", a refresh dropping it shows "no longer on the page".
 * - **Keys** (rows): ↑/↓ open the neighbor row and focus it (pane) or only
 *   move focus (drill); Esc closes the pane. In a detail Esc closes / goes
 *   Back. Enter/Space are the row button's native click. Keys typed into
 *   editable fields are never taken.
 * - **Scroll**: Back brings the row back into view through the list's one
 *   scroll request, merged with the find's (latest wins, instant). A find
 *   event while the drill detail shows returns to the list first.
 * - **Focus** follows the user's move: the drill's Back button on open, the
 *   selected row whenever a closing detail took focus with it — or a drill
 *   detail that widened into the pane did (its Back button left with it):
 *   the row anchors the pane (↑/↓ step it, Esc closes it), and the pane's
 *   close button takes focus when the row is gone from the page.
 * - **Presence**: while a detail is open the shell knows (`detailOpen`, the
 *   sidebar folds) — through the list's own claim, written on change only
 *   and released on cleanup, so lists sharing a page never overwrite each
 *   other.
 *
 * Motion (M-2): the pane enters by opacity + 8 px `translateX`; the drill
 * swap plays the page-mount keyframe on the view that appears. Reduced
 * motion collapses both through the tokens.
 */
import type { Accessor, JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack
} from 'solid-js';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import ChevronLeft from 'lucide-solid/icons/chevron-left';
import ChevronUp from 'lucide-solid/icons/chevron-up';
import X from 'lucide-solid/icons/x';
import { Button } from '../../../../components/ui/button';
import { CopyButton } from '../../../../components/ui/copy-button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { IconButton } from '../../../../components/ui/icon-button';
import type { VirtualScrollRequest } from '../../../../components/ui/virtual-list';
import { detailLayout, type DetailLayout } from '../../../../lib/panel/detail-layout';
import {
  initialListSelection,
  isDetailOpen,
  neighborId,
  reduceListSelection,
  selectionPosition,
  type ListSelectionEvent,
  type ListSelectionState,
  type RowKey,
  type StepDelta
} from '../../../../lib/panel/list-selection';
import { cn } from '../../../../utils/cn';
import { formatCount, type CountNoun } from '../../../../utils/format-count';
import { useDetailPresence } from '../../state/detail-presence';
import { PAGE_CANVAS } from '../page-frame';
import { listKeyIntent } from './list-keys';
import { createRowFocus, type RowFocus } from './row-focus';
import { mergeScrollRequests, type ScrollRequests } from './scroll-requests';

/** What a detail header's copy button copies. */
export interface DetailCopy {
  /** The clipboard text. */
  readonly text: string;
  /** The control's accessible name and toast noun ("Script URL"). */
  readonly label: string;
  /** Read the exact text when `text` is a bounded stand-in (the copy control's `loadText`). */
  readonly loadText?: (signal: AbortSignal) => Promise<string>;
  /** The failure toast's remedy when `loadText` fails. */
  readonly loadFailure?: string;
}

/**
 * How a page's rows open: the detail's header, body and primary actions.
 * Called with the selected row; `body`/`actions` get an accessor, so a
 * refresh that changes the row's content updates the view in place.
 */
export interface ListDetail<Row> {
  /** The caps label over the title ("External script"). */
  readonly kind: (row: Row) => string;
  /** The detail's title (its `h2`). */
  readonly title: (row: Row) => string;
  /** The header's copy action, if the row has one. */
  readonly copy?: (row: Row) => DetailCopy | undefined;
  /** The detail body (attributes, source tile, code…). */
  readonly body: (row: Accessor<Row>) => JSX.Element;
  /** The primary actions (pane: after the body; drill: in the bar, a bottom bar when compact). */
  readonly actions?: (row: Accessor<Row>) => JSX.Element;
  /** The drill's Back label — the list's plural name ("Scripts"). */
  readonly backLabel: string;
}

/** What {@link createMasterDetail} reads. */
export interface MasterDetailOptions {
  /** The list root's measured content width. */
  readonly width: Accessor<number>;
  /** The rendered (filtered + searched) row keys, in list order. */
  readonly visibleIds: Accessor<readonly RowKey[]>;
  /** Every row key (unfiltered). */
  readonly allIds: Accessor<readonly RowKey[]>;
  /**
   * Whether the list region renders rows (not its empty / filtered-empty
   * view, which replace the rows and the pane): a selection the machine keeps
   * through such a moment (a refresh that removed every row) is not shown,
   * so it is not published either.
   */
  readonly rowsShown: Accessor<boolean>;
  /** Whether the list has any row at all (the drill detail lays over the list's view). */
  readonly hasRows: Accessor<boolean>;
  /** The find's scroll request (merged into the list's one request). */
  readonly findRequest: Accessor<VirtualScrollRequest | null>;
  /** Rows open a detail (publishes detail presence); `false` = keys move focus only. */
  readonly detailEnabled: boolean;
  /** Where focus goes when a closing detail took it and the row is not listed (the search field). */
  readonly focusFallback: () => HTMLElement | null | undefined;
}

/** The selection, layout and handlers one calm list renders from. */
export interface MasterDetailController {
  readonly state: Accessor<ListSelectionState>;
  readonly layout: Accessor<DetailLayout>;
  readonly selectedId: Accessor<RowKey | null>;
  /** The side pane shows a selection (beside rendered rows). */
  readonly paneOpen: Accessor<boolean>;
  /** The drill-in detail replaces the list (which has rows). */
  readonly drillOpen: Accessor<boolean>;
  /** The selection's place in the rendered list (`null`: not listed). */
  readonly position: Accessor<{ readonly index: number; readonly count: number } | null>;
  /** The list came back from a drill detail (its re-entry plays the view keyframe). */
  readonly returned: Accessor<boolean>;
  /** The list's merged scroll request + its own entry. */
  readonly scroll: ScrollRequests;
  /** Focus by row key. */
  readonly focus: RowFocus;
  /** Ref for the pane's close button (focus target once a drill detail widened into the pane). */
  paneCloseRef(element: HTMLElement): void;
  open(key: RowKey): void;
  close(): void;
  back(): void;
  step(delta: StepDelta): void;
  /** Rows' key handler (bind on the element around the virtual list). */
  onListKeyDown(event: KeyboardEvent): void;
  /** A detail view's key handler (Esc closes / goes Back). */
  onDetailKeyDown(event: KeyboardEvent): void;
}

/** The row-key attribute every rendered row surface carries. */
export const ROW_KEY_ATTRIBUTE = 'data-fdt-row-key';

/**
 * The row key of the row an event came from.
 *
 * @param target The event target.
 * @returns The key, or null outside a row.
 */
export function rowKeyOf(target: EventTarget | null): RowKey | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${ROW_KEY_ATTRIBUTE}]`)?.getAttribute(ROW_KEY_ATTRIBUTE) ?? null;
}

/**
 * Whether focus fell out of the view (to the body or nowhere) — the moment
 * a closing detail took it along.
 *
 * @returns True when nothing meaningful holds focus.
 */
function focusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}

/**
 * Whether a transition swapped a drill-in detail for the side pane (a
 * widening with the detail open): the drill view, and the focus it held,
 * unmounts while a detail stays open.
 *
 * @param previous The state before.
 * @param next The state after.
 * @returns True for DrillDetail → Pane.
 */
export function drillWidenedToPane(
  previous: ListSelectionState,
  next: ListSelectionState
): boolean {
  return previous.view === 'detail' && next.layout === 'pane' && isDetailOpen(next);
}

/**
 * Create the master–detail controller. Must run inside the list's owner.
 *
 * @param options See {@link MasterDetailOptions}.
 * @returns The controller.
 */
export function createMasterDetail(options: MasterDetailOptions): MasterDetailController {
  const layout = createMemo(() => detailLayout(options.width()));
  const [state, setState] = createSignal<ListSelectionState>(initialListSelection(untrack(layout)));
  /** Feed the machine; a no-op returns the same object, so nothing re-renders. */
  const dispatch = (event: ListSelectionEvent): void => {
    setState((current) => reduceListSelection(current, event));
  };
  const scroll = mergeScrollRequests(options.findRequest);
  const focus = createRowFocus();
  onCleanup(() => {
    focus.cancel();
  });
  const [returned, setReturned] = createSignal(false);
  const paneOpen = (): boolean =>
    state().layout === 'pane' && state().selectedId !== null && options.rowsShown();
  const drillOpen = (): boolean => state().view === 'detail' && options.hasRows();

  createEffect(
    on(
      layout,
      (next) => {
        dispatch({ type: 'layoutChanged', layout: next });
      },
      { defer: true }
    )
  );
  createEffect(() => {
    dispatch({ type: 'rowsChanged', visibleIds: options.visibleIds(), allIds: options.allIds() });
  });

  if (options.detailEnabled) {
    const presence = useDetailPresence().claim();
    // What is on screen, not only what the machine holds (see `rowsShown`);
    // a memo so a step or a refresh that keeps a detail open writes nothing.
    const shown = createMemo(() => paneOpen() || drillOpen());
    createEffect(() => {
      presence.set(shown());
    });
    onCleanup(() => {
      presence.release();
    });
  }
  let paneClose: HTMLElement | undefined;

  /** Bring a listed row into view and focus it (waits for a virtual row to mount). */
  const reveal = (key: RowKey): void => {
    scroll.scrollTo(untrack(options.visibleIds).indexOf(key));
    focus.focus(key);
  };

  // A detail that closed with focus inside it (Back, Close, Esc, a layout
  // flip, a find) leaves focus on the body: hand it to the selected row, or
  // the fallback when the row is no longer listed. A drill detail widening
  // into the pane drops its Back button's focus too: the row (scrolled in)
  // anchors the pane, its close button when the row is gone.
  createEffect(
    on(
      state,
      (next, previous) => {
        if (previous === undefined || !isDetailOpen(previous)) return;
        const widened = drillWidenedToPane(previous, next);
        if (isDetailOpen(next) && !widened) return;
        queueMicrotask(() => {
          if (!focusLost()) return;
          const key = previous.selectedId;
          const listed = untrack(options.visibleIds).includes(key);
          if (widened) {
            if (listed) reveal(key);
            else if (paneClose?.isConnected === true) paneClose.focus({ preventScroll: true });
          } else if (listed) focus.focus(key);
          else options.focusFallback()?.focus();
        });
      },
      { defer: true }
    )
  );

  // A find event while the drill detail shows: back to the list first (the
  // row is kept), so the find's own scroll lands on a visible list.
  createEffect(
    on(
      options.findRequest,
      (request) => {
        if (request !== null && untrack(state).view === 'detail') {
          setReturned(true);
          dispatch({ type: 'back' });
        }
      },
      { defer: true }
    )
  );

  const back = (): void => {
    const before = state();
    dispatch({ type: 'back' });
    const after = state();
    if (before.view !== 'detail') return;
    setReturned(true);
    // DrillDetail(listed) → DrillList: the row is the scroll target.
    if (after.view === 'list' && after.selectedId !== null) reveal(after.selectedId);
  };

  return {
    state,
    layout,
    selectedId: () => state().selectedId,
    paneOpen,
    drillOpen,
    position: () => selectionPosition(state(), options.visibleIds()),
    returned,
    scroll,
    focus,
    paneCloseRef(element) {
      paneClose = element;
    },
    open(key) {
      if (!options.detailEnabled) return;
      focus.cancel();
      dispatch({ type: 'open', id: key });
    },
    close() {
      dispatch({ type: 'close' });
    },
    back,
    step(delta) {
      dispatch({ type: 'step', delta, visibleIds: options.visibleIds() });
    },
    onListKeyDown(event) {
      const intent = listKeyIntent(event, event.target);
      const key = rowKeyOf(event.target);
      if (intent === null || key === null) return;
      if (intent.type === 'dismiss') {
        if (state().layout !== 'pane' || state().selectedId === null) return;
        event.preventDefault();
        dispatch({ type: 'close' });
        return;
      }
      // The arrows are the list's now: never the scroller's own line scroll.
      event.preventDefault();
      const to = neighborId(options.visibleIds(), key, intent.delta);
      if (to === null) return;
      if (options.detailEnabled && state().layout === 'pane') dispatch({ type: 'open', id: to });
      reveal(to);
    },
    onDetailKeyDown(event) {
      const intent = listKeyIntent(event, event.target);
      if (intent?.type !== 'dismiss') return;
      event.preventDefault();
      if (state().view === 'detail') back();
      else dispatch({ type: 'close' });
    }
  };
}

/** The pane's entrance (M-2): opacity + 8 px from the end edge, base duration, entrance easing. */
const PANE_ENTER =
  'transition-[opacity,translate] duration-[var(--motion-base)] ease-[var(--ease-entrance)] starting:translate-x-2 starting:opacity-0';

/** Props shared by both detail views. */
interface DetailViewProps<Row> {
  /** The list's controller. */
  readonly controller: MasterDetailController;
  /** The selected row (the last known one once a refresh dropped it). */
  readonly row: Accessor<Row | undefined>;
  /** How the page's rows open. */
  readonly detail: ListDetail<Row>;
  /** The rows' noun ("script"). */
  readonly noun: CountNoun;
  /** Clears the list's filters + search (offered on a "no longer listed" detail), when any narrows. */
  readonly onClearFilters?: () => void;
}

/**
 * The detail's title block: caps kind, `h2` title, optional copy.
 *
 * @param props.row The row.
 * @param props.detail The page's detail spec.
 * @param props.end Controls after the copy button (the pane's close).
 */
function DetailHeading<Row>(props: {
  row: Row;
  detail: ListDetail<Row>;
  end?: JSX.Element;
}): JSX.Element {
  const copy = (): DetailCopy | undefined => props.detail.copy?.(props.row);
  return (
    <div data-fdt="detail-heading" class="flex items-start gap-2">
      <div class="min-w-0 flex-1">
        <div
          data-fdt="detail-kind"
          class="text-2xs font-semibold tracking-wide text-fg-muted uppercase"
        >
          {props.detail.kind(props.row)}
        </div>
        <h2
          data-fdt="detail-title"
          class="mt-1 text-sm font-semibold wrap-anywhere text-fg-primary"
        >
          {props.detail.title(props.row)}
        </h2>
      </div>
      <Show when={copy()}>
        {(action) => (
          <CopyButton
            text={action().text}
            loadText={action().loadText}
            sourceFailureDescription={action().loadFailure}
            label={action().label}
            showLabel={false}
          />
        )}
      </Show>
      {props.end}
    </div>
  );
}

/**
 * The detail's body by the selection's presence: the page's body while the
 * row is listed; a "no longer listed" or "no longer on the page" state (S-3:
 * title + one sentence + a way forward) otherwise.
 *
 * @param props See {@link DetailViewProps}.
 */
function DetailBody<Row>(props: DetailViewProps<Row> & { row: Accessor<Row> }): JSX.Element {
  const presence = (): string | null => props.controller.state().presence;
  return (
    <Switch>
      <Match when={presence() === 'gone'}>
        <div data-fdt="detail-gone">
          <EmptyState
            title="No longer on the page"
            description={`The latest page data has no such ${props.noun.one}.`}
          />
        </div>
      </Match>
      <Match when={presence() === 'unlisted'}>
        <div data-fdt="detail-unlisted">
          <EmptyState
            title="No longer listed"
            description={`The current filters or search hide this ${props.noun.one}.`}
            action={
              props.onClearFilters === undefined ? undefined : (
                <Button
                  size="sm"
                  data-fdt="detail-clear-filters"
                  onClick={() => props.onClearFilters?.()}
                >
                  Clear filters
                </Button>
              )
            }
          />
        </div>
      </Match>
      <Match when={presence() === 'listed'}>
        {/* Keyed by row key: each row gets a fresh body; a same-key refresh updates in place. */}
        <Show when={props.controller.selectedId()} keyed>
          {(key: RowKey) => <DetailBodyFor key={key} body={props.detail.body} row={props.row} />}
        </Show>
      </Match>
    </Switch>
  );
}

/**
 * One row's page body, built once per key (the keyed `Show` remounts it for
 * the next row).
 *
 * @param props.key The row key (the remount trigger; unused in the render).
 * @param props.body The page's body renderer.
 * @param props.row The row accessor.
 */
function DetailBodyFor<Row>(props: {
  key: RowKey;
  body: ListDetail<Row>['body'];
  row: Accessor<Row>;
}): JSX.Element {
  // eslint-disable-next-line solid/reactivity -- built once per key on purpose; the row accessor stays live
  return props.body(props.row);
}

/**
 * The 350 px side pane (from the split width on): header with close, the
 * body, then the primary actions. Its own scroller; it returns to the top
 * when the selection changes.
 *
 * @param props See {@link DetailViewProps}.
 */
export function DetailPane<Row>(props: DetailViewProps<Row>): JSX.Element {
  let scroller: HTMLElement | undefined;
  createEffect(
    on(
      () => props.controller.selectedId(),
      () => {
        if (scroller !== undefined) scroller.scrollTop = 0;
      },
      { defer: true }
    )
  );
  return (
    <Show when={props.row()}>
      {(row) => (
        <aside
          ref={scroller}
          data-fdt="detail-pane"
          aria-label={`${props.detail.title(row())} details`}
          onKeyDown={(event) => {
            props.controller.onDetailKeyDown(event);
          }}
          class={cn(
            'flex w-87.5 shrink-0 flex-col gap-3.5 overflow-y-auto border-s border-line-1 bg-surface-1 p-4',
            PANE_ENTER
          )}
        >
          <DetailHeading
            row={row()}
            detail={props.detail}
            end={
              <IconButton
                ref={(element: HTMLButtonElement) => {
                  props.controller.paneCloseRef(element);
                }}
                label="Close details"
                data-fdt="detail-close"
                onClick={() => {
                  props.controller.close();
                }}
              >
                <X size={14} aria-hidden="true" />
              </IconButton>
            }
          />
          <DetailBody {...props} row={row} />
          <Show when={props.controller.state().presence === 'listed' && props.detail.actions}>
            {(actions) => (
              <div data-fdt="detail-actions" class="flex flex-wrap gap-1.5">
                {actions()(row)}
              </div>
            )}
          </Show>
        </aside>
      )}
    </Show>
  );
}

/**
 * Format a position as "n of m".
 *
 * @param position The selection's 0-based index and the list length.
 * @returns The label.
 */
export function positionLabel(position: {
  readonly index: number;
  readonly count: number;
}): string {
  return `${formatCount(position.index + 1)} of ${formatCount(position.count)}`;
}

/**
 * The drill-in detail (below the split width): replaces the list. The bar
 * holds Back, ↑/↓ and "n of m"; the actions sit at the bar's end, or in a
 * bottom bar on a compact list (grid areas switch on the list's tier). Back
 * takes focus on open; the body scroller returns to the top on each step.
 *
 * @param props See {@link DetailViewProps}.
 */
export function DrillDetail<Row>(props: DetailViewProps<Row>): JSX.Element {
  let backButton: HTMLButtonElement | undefined;
  let scroller: HTMLDivElement | undefined;
  onMount(() => backButton?.focus({ preventScroll: true }));
  createEffect(
    on(
      () => props.controller.selectedId(),
      () => {
        if (scroller !== undefined) scroller.scrollTop = 0;
      },
      { defer: true }
    )
  );
  const position = (): ReturnType<MasterDetailController['position']> =>
    props.controller.position();
  const atStart = (): boolean => (position()?.index ?? 0) <= 0;
  const atEnd = (): boolean => {
    const at = position();
    return at === null || at.index >= at.count - 1;
  };
  return (
    <Show when={props.row()}>
      {(row) => (
        <div
          data-fdt="drill-detail"
          data-fdt-view-enter
          onKeyDown={(event) => {
            props.controller.onDetailKeyDown(event);
          }}
          // Opaque: it covers the list it replaces (laid out and inert beneath).
          class={cn(
            "absolute inset-0 grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] [grid-template-areas:'bar'_'body'_'actions'] @regular:grid-cols-[minmax(0,1fr)_auto] @regular:grid-rows-[auto_minmax(0,1fr)] @regular:[grid-template-areas:'bar_actions'_'body_body']",
            PAGE_CANVAS
          )}
        >
          <div
            data-fdt="drill-bar"
            class="flex min-w-0 items-center gap-1 border-b border-line-1 pb-2 [grid-area:bar]"
          >
            <Button
              ref={backButton}
              variant="ghost"
              data-fdt="drill-back"
              onClick={() => {
                props.controller.back();
              }}
            >
              <ChevronLeft size={14} aria-hidden="true" />
              {props.detail.backLabel}
            </Button>
            <span aria-hidden="true" class="mx-1 h-4 w-px shrink-0 bg-line-2" />
            <IconButton
              label={`Previous ${props.noun.one}`}
              data-fdt="drill-previous"
              aria-disabled={atStart() ? 'true' : undefined}
              class="aria-disabled:cursor-not-allowed aria-disabled:text-fg-muted"
              onClick={() => {
                if (!atStart()) props.controller.step(-1);
              }}
            >
              <ChevronUp size={14} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={`Next ${props.noun.one}`}
              data-fdt="drill-next"
              aria-disabled={atEnd() ? 'true' : undefined}
              class="aria-disabled:cursor-not-allowed aria-disabled:text-fg-muted"
              onClick={() => {
                if (!atEnd()) props.controller.step(1);
              }}
            >
              <ChevronDown size={14} aria-hidden="true" />
            </IconButton>
            <Show when={position()}>
              {(at) => (
                <span data-fdt="drill-position" class="ms-1 text-2xs text-fg-muted tabular-nums">
                  {positionLabel(at())}
                </span>
              )}
            </Show>
          </div>
          <Show when={props.controller.state().presence === 'listed' && props.detail.actions}>
            {(actions) => (
              <div
                data-fdt="detail-actions"
                class="flex flex-wrap items-center gap-1.5 border-t border-line-1 pt-2 [grid-area:actions] @regular:justify-end @regular:border-t-0 @regular:border-b @regular:pt-0 @regular:pb-2"
              >
                {actions()(row)}
              </div>
            )}
          </Show>
          <div
            ref={scroller}
            data-fdt="drill-body"
            class="flex min-h-0 flex-col gap-3.5 overflow-y-auto py-3 [grid-area:body]"
          >
            <DetailHeading row={row()} detail={props.detail} />
            <DetailBody {...props} row={row} />
          </div>
        </div>
      )}
    </Show>
  );
}
