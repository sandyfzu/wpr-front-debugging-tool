/**
 * The list selection machine: which row a list's detail view shows, and
 * whether that detail sits beside the list (pane) or replaces it (drill).
 *
 * Pure and framework-free: a reducer over a closed event set. Every legal
 * state is one of four shapes (illegal combinations do not type-check), and
 * an event that changes nothing returns the very same state object, so a
 * signal or store holding it notifies nobody.
 *
 * Rows are addressed by {@link RowKey}s, never list positions, so the
 * selection survives a soft refresh, a filter or a search that reorders or
 * hides rows. The machine never holds the rows: events that need them carry
 * the current key lists.
 */
import type { DetailLayout } from './detail-layout';

/**
 * A row's selection key. Contract for every page's `rowKey(row)`:
 * - non-empty;
 * - unique among the page's rows (exact duplicates take an occurrence suffix);
 * - derived from the row's content, never its position, and stable across
 *   refreshes for the same row — a row whose key changes counts as removed
 *   (the detail shows it gone), never as a silent jump to another row.
 */
export type RowKey = string;

/**
 * Derives a row's {@link RowKey}; each list page supplies its own.
 *
 * @typeParam Row The page's row record.
 */
export type RowKeyOf<Row> = (row: Row) => RowKey;

/** What fills the list region: the rows, or (drill only) the selected row's detail. */
export type ListView = 'list' | 'detail';

/**
 * Where the selected row stands in the latest rows: `listed` (visible),
 * `unlisted` (on the page, hidden by a filter or search), `gone` (no longer
 * on the page — removed by a refresh, or its key changed).
 */
export type SelectionPresence = 'listed' | 'unlisted' | 'gone';

/**
 * How a drill list came to hold its selection, which decides what widening
 * back to the pane does: `resize` (a pane collapsed into the drill — the user
 * closed nothing, so widening restores the pane), `back` (the user left the
 * detail — widening keeps it closed: a dismissed pane never returns by itself).
 */
export type DrillListOrigin = 'resize' | 'back';

/** Nothing selected; the list shows (either layout). */
export interface NoSelection {
  readonly layout: DetailLayout;
  readonly view: 'list';
  readonly selectedId: null;
  readonly presence: null;
  readonly origin: null;
}

/** Pane layout with a selection: the pane shows it beside the list. Never `unlisted` (a hidden row closes the pane). */
export interface PaneSelection {
  readonly layout: 'pane';
  readonly view: 'list';
  readonly selectedId: RowKey;
  readonly presence: 'listed' | 'gone';
  readonly origin: null;
}

/** Drill layout back on the list: the selection is the row to scroll to and mark. Always `listed`. */
export interface DrillListSelection {
  readonly layout: 'drill';
  readonly view: 'list';
  readonly selectedId: RowKey;
  readonly presence: 'listed';
  readonly origin: DrillListOrigin;
}

/** Drill layout showing the selected row's detail in place of the list, in any presence. */
export interface DrillDetailSelection {
  readonly layout: 'drill';
  readonly view: 'detail';
  readonly selectedId: RowKey;
  readonly presence: SelectionPresence;
  readonly origin: null;
}

/** Every legal machine state; `origin` is set on a drill list only. */
export type ListSelectionState =
  NoSelection | PaneSelection | DrillListSelection | DrillDetailSelection;

/** A step through the visible rows: previous (`-1`) or next (`1`). */
export type StepDelta = -1 | 1;

/** Each event's payload, by event type (`unknown` = no payload: the event is just its `type`). */
interface EventPayloads {
  /** A row was activated (click, Enter/Space): show its detail. */
  open: { readonly id: RowKey };
  /** Dismiss the detail and drop the selection (pane close, reset). */
  close: unknown;
  /** Leave the detail (Back, Esc): a drill returns to the list keeping the row as scroll target; a pane closes. */
  back: unknown;
  /** Show the previous/next visible row's detail (↑/↓ on a pane selection or inside a drill detail). */
  step: { readonly delta: StepDelta; readonly visibleIds: readonly RowKey[] };
  /** The rows changed (refresh, filter, search): `visibleIds` in list order, `allIds` = every row on the page. */
  rowsChanged: { readonly visibleIds: readonly RowKey[]; readonly allIds: readonly RowKey[] };
  /** The list's measured content width crossed the split threshold. */
  layoutChanged: { readonly layout: DetailLayout };
}

/** One event type name. */
export type ListSelectionEventType = keyof EventPayloads;

/**
 * A machine event, discriminated by `type`.
 *
 * @typeParam K The event type(s) the value may be (default: any).
 */
export type ListSelectionEvent<K extends ListSelectionEventType = ListSelectionEventType> = {
  [P in K]: { readonly type: P } & EventPayloads[P];
}[K];

/** One event's transition: the next state, or `state` itself when nothing changes. */
type Transition<K extends ListSelectionEventType> = (
  state: ListSelectionState,
  event: ListSelectionEvent<K>
) => ListSelectionState;

/** The two layouts, for validating untyped input. */
const LAYOUTS: ReadonlySet<string> = new Set<DetailLayout>(['pane', 'drill']);

/**
 * The machine's starting state: nothing selected.
 *
 * @param layout The list's current detail layout.
 * @returns The empty selection for that layout.
 * @throws {@link TypeError} When `layout` is not a {@link DetailLayout}.
 */
export function initialListSelection(layout: DetailLayout): NoSelection {
  assertLayout(layout);
  return { layout, view: 'list', selectedId: null, presence: null, origin: null };
}

/**
 * Whether a detail is on screen — a pane holding a selection, or a drill
 * detail (what the shell's detail-presence flag publishes).
 *
 * @param state The machine state.
 * @returns `true` for a pane selection or a drill detail.
 */
export function isDetailOpen(
  state: ListSelectionState
): state is PaneSelection | DrillDetailSelection {
  return state.layout === 'pane' ? state.selectedId !== null : state.view === 'detail';
}

/**
 * The selected row's place among the visible rows, for "n of m" and for
 * disabling ↑/↓ at the ends.
 *
 * @param state The machine state.
 * @param visibleIds The visible row keys, in list order.
 * @returns The 0-based `index` and the `count` of visible rows, or `null`
 *   when nothing is selected or the selection is not visible.
 */
export function selectionPosition(
  state: ListSelectionState,
  visibleIds: readonly RowKey[]
): { readonly index: number; readonly count: number } | null {
  if (state.selectedId === null) return null;
  const index = visibleIds.indexOf(state.selectedId);
  return index === -1 ? null : { index, count: visibleIds.length };
}

/**
 * The row `delta` steps away from `id` in the visible list — the ↑/↓ target
 * from a row that has keyboard focus (which may differ from the selection;
 * the `step` event moves from the selection instead).
 *
 * @param visibleIds The visible row keys, in list order.
 * @param id The row to move from.
 * @param delta `-1` previous, `1` next.
 * @returns The neighbour's key, or `null` past either end (no wrap) or when
 *   `id` is not visible.
 * @throws {@link TypeError} When `delta` is not `1` or `-1`.
 */
export function neighborId(
  visibleIds: readonly RowKey[],
  id: RowKey,
  delta: StepDelta
): RowKey | null {
  assertDelta(delta);
  const index = visibleIds.indexOf(id);
  return index === -1 ? null : (visibleIds[index + delta] ?? null);
}

/**
 * Apply one event.
 *
 * Unknown ids are not errors: `open` trusts its id (ids come from rendered
 * rows; the next `rowsChanged` reconciles a stale one), and `step` from an
 * id the visible list lacks does nothing. Programmer errors throw: an empty
 * or non-string key, duplicate keys, a visible key missing from `allIds`, an
 * invalid delta or layout, an unknown event type.
 *
 * @param state The current state.
 * @param event The event.
 * @returns The next state — `state` itself when the event changes nothing.
 * @throws {@link TypeError} On a programmer error (see above), naming the input.
 */
export function reduceListSelection<K extends ListSelectionEventType>(
  state: ListSelectionState,
  event: ListSelectionEvent<K>
): ListSelectionState {
  if (!Object.hasOwn(TRANSITIONS, event.type)) {
    throw new TypeError(`Unknown list-selection event type ${describeValue(event.type)}.`);
  }
  const transition: Transition<K> = TRANSITIONS[event.type];
  return transition(state, event);
}

/** The transition table: one row per event type. */
const TRANSITIONS: { readonly [K in ListSelectionEventType]: Transition<K> } = {
  open(state, event) {
    assertKey(event.id, 'open id');
    return settle(state, select(state.layout, event.id));
  },

  close(state) {
    return settle(state, initialListSelection(state.layout));
  },

  back(state) {
    if (state.selectedId === null) return state;
    // A pane has nothing to go back to: Back/Esc closes it.
    if (state.layout === 'pane') return initialListSelection('pane');
    // Already on the drill list: nothing to leave.
    if (state.view === 'list') return state;
    return place(BACK_TO_LIST, state.selectedId, state.presence);
  },

  step(state, event) {
    assertDelta(event.delta);
    // The drill list's ↑/↓ move DOM focus only; its selection is just the scroll target.
    if (state.selectedId === null || (state.layout === 'drill' && state.view === 'list')) {
      return state;
    }
    const target = neighborId(event.visibleIds, state.selectedId, event.delta);
    // Past either end (no wrap) or not visible: stay.
    if (target === null) return state;
    return settle(state, select(state.layout, target));
  },

  rowsChanged(state, event) {
    const all = keySet(event.allIds, 'allIds');
    const visible = keySet(event.visibleIds, 'visibleIds');
    for (const id of visible) {
      if (!all.has(id)) throw new TypeError(`rowsChanged: visible key "${id}" is not in allIds.`);
    }
    if (state.selectedId === null) return state;
    const presence = presenceOf(state.selectedId, visible, all);
    return settle(state, place(placementOf(state), state.selectedId, presence));
  },

  layoutChanged(state, event) {
    assertLayout(event.layout);
    if (event.layout === state.layout) return state;
    if (state.selectedId === null) return initialListSelection(event.layout);
    // Pane → drill lands on the list (no full-view takeover), remembering the
    // pane was never closed.
    if (event.layout === 'drill') return place(COLLAPSED_PANE, state.selectedId, state.presence);
    // Drill → pane shows the same row beside the list — unless the user
    // dismissed that detail with Back: a closed pane never reopens by itself.
    if (state.origin === 'back') return initialListSelection('pane');
    return place(PANE, state.selectedId, state.presence);
  }
};

/**
 * Where a selection goes: the layout, plus (drill) the view and, for a drill
 * list, its origin — a shape that cannot name an illegal combination.
 */
type Placement =
  | { readonly layout: 'pane' }
  | { readonly layout: 'drill'; readonly view: 'detail' }
  | { readonly layout: 'drill'; readonly view: 'list'; readonly origin: DrillListOrigin };

/** Beside the list. */
const PANE: Placement = { layout: 'pane' };
/** The drill list, after the user left the detail. */
const BACK_TO_LIST: Placement = { layout: 'drill', view: 'list', origin: 'back' };
/** The drill list, after the pane collapsed into it. */
const COLLAPSED_PANE: Placement = { layout: 'drill', view: 'list', origin: 'resize' };
/** The drill detail. */
const DRILL_DETAIL: Placement = { layout: 'drill', view: 'detail' };

/**
 * The placement a selection already has (what `rowsChanged` keeps).
 *
 * @param state A state holding a selection.
 * @returns Its layout, view and drill-list origin as a {@link Placement}.
 */
function placementOf(state: PaneSelection | DrillListSelection | DrillDetailSelection): Placement {
  if (state.layout === 'pane') return PANE;
  return state.view === 'detail' ? DRILL_DETAIL : state;
}

/**
 * The state after activating a row: a pane shows it beside the list, a drill
 * opens its detail.
 *
 * @param layout The current layout.
 * @param id The activated row's key (visible by construction).
 * @returns The listed pane selection or drill detail of `id`.
 */
function select(layout: DetailLayout, id: RowKey): PaneSelection | DrillDetailSelection {
  return layout === 'pane'
    ? { layout, view: 'list', selectedId: id, presence: 'listed', origin: null }
    : { layout, view: 'detail', selectedId: id, presence: 'listed', origin: null };
}

/**
 * Normalize a selection into the legal state its placement allows — the one
 * rule set behind `back`, `rowsChanged` and `layoutChanged`:
 * - pane: a hidden row clears the selection; a gone row stays (pane says so);
 * - drill detail: kept in every presence (the detail says "no longer listed" / gone);
 * - drill list: kept only while listed (a scroll target must be a rendered row).
 *
 * @param placement Where the selection goes.
 * @param id The selected row's key.
 * @param presence Where that row stands in the latest rows.
 * @returns The legal state, or the placement layout's empty state.
 */
function place(placement: Placement, id: RowKey, presence: SelectionPresence): ListSelectionState {
  if (placement.layout === 'pane') {
    return presence === 'unlisted'
      ? initialListSelection('pane')
      : { layout: 'pane', view: 'list', selectedId: id, presence, origin: null };
  }
  if (placement.view === 'detail') {
    return { layout: 'drill', view: 'detail', selectedId: id, presence, origin: null };
  }
  return presence === 'listed'
    ? { layout: 'drill', view: 'list', selectedId: id, presence, origin: placement.origin }
    : initialListSelection('drill');
}

/**
 * Keep the previous object when the next state is field-for-field equal, so
 * no-op events are identity-stable (cheap equality for reactive holders).
 *
 * @param previous The state before the event.
 * @param next The candidate state.
 * @returns `previous` when equal to `next`, else `next`.
 */
function settle(previous: ListSelectionState, next: ListSelectionState): ListSelectionState {
  return previous.layout === next.layout &&
    previous.view === next.view &&
    previous.selectedId === next.selectedId &&
    previous.presence === next.presence &&
    previous.origin === next.origin
    ? previous
    : next;
}

/**
 * Classify a key against the latest rows.
 *
 * @param id The selected key.
 * @param visible The visible keys.
 * @param all Every key on the page.
 * @returns `listed`, `unlisted` or `gone`.
 */
function presenceOf(
  id: RowKey,
  visible: ReadonlySet<RowKey>,
  all: ReadonlySet<RowKey>
): SelectionPresence {
  if (visible.has(id)) return 'listed';
  return all.has(id) ? 'unlisted' : 'gone';
}

/**
 * Index a key list, rejecting what breaks the {@link RowKey} contract.
 *
 * @param ids The keys.
 * @param label The list's name, for the error.
 * @returns The keys as a set.
 * @throws {@link TypeError} On an empty/non-string key or a duplicate.
 */
function keySet(ids: readonly RowKey[], label: string): Set<RowKey> {
  const set = new Set<RowKey>();
  for (const id of ids) {
    assertKey(id, `rowsChanged ${label} entry`);
    if (set.has(id)) throw new TypeError(`rowsChanged: duplicate key "${id}" in ${label}.`);
    set.add(id);
  }
  return set;
}

/**
 * Reject an empty or non-string key (untyped callers included).
 *
 * @param id The candidate key.
 * @param label What it is, for the error.
 * @throws {@link TypeError} When it is not a non-empty string.
 */
function assertKey(id: unknown, label: string): asserts id is RowKey {
  if (typeof id !== 'string' || id === '') {
    throw new TypeError(
      `${label}: a row key must be a non-empty string, got ${describeValue(id)}.`
    );
  }
}

/**
 * Reject a delta other than ±1.
 *
 * @param delta The candidate delta.
 * @throws {@link TypeError} When it is not `1` or `-1`.
 */
function assertDelta(delta: unknown): asserts delta is StepDelta {
  if (delta !== 1 && delta !== -1) {
    throw new TypeError(`step: delta must be 1 or -1, got ${describeValue(delta)}.`);
  }
}

/**
 * Reject a value that is not a {@link DetailLayout}.
 *
 * @param layout The candidate layout.
 * @throws {@link TypeError} When it is neither `pane` nor `drill`.
 */
function assertLayout(layout: unknown): asserts layout is DetailLayout {
  if (typeof layout !== 'string' || !LAYOUTS.has(layout)) {
    throw new TypeError(`Detail layout must be "pane" or "drill", got ${describeValue(layout)}.`);
  }
}

/**
 * Render an untrusted value for an error message (strings quoted; never
 * throws, unlike `JSON.stringify` on a bigint).
 *
 * @param value Any value.
 * @returns A printable rendering.
 */
function describeValue(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}
