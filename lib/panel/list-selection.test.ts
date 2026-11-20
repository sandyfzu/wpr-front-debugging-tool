/** The list selection machine: every transition in both layouts, its fail-fast edges and its invariants. */
import { describe, expect, it } from 'vitest';
import type { DetailLayout } from './detail-layout';
import {
  initialListSelection,
  isDetailOpen,
  neighborId,
  reduceListSelection,
  selectionPosition,
  type DrillListOrigin,
  type ListSelectionEvent,
  type ListSelectionState,
  type RowKey,
  type SelectionPresence
} from './list-selection';

const ROWS: readonly RowKey[] = ['a', 'b', 'c'];

/**
 * Run events from a starting state.
 *
 * @param state The start.
 * @param events The events, in order.
 */
function run(state: ListSelectionState, ...events: ListSelectionEvent[]): ListSelectionState {
  return events.reduce(reduceListSelection, state);
}

/** Start in `layout` and fold the given events over it. */
function from(layout: DetailLayout, ...events: ListSelectionEvent[]): ListSelectionState {
  return run(initialListSelection(layout), ...events);
}

const open = (id: RowKey): ListSelectionEvent => ({ type: 'open', id });
const close: ListSelectionEvent = { type: 'close' };
const back: ListSelectionEvent = { type: 'back' };
const step = (delta: -1 | 1, visibleIds: readonly RowKey[] = ROWS): ListSelectionEvent => ({
  type: 'step',
  delta,
  visibleIds
});
const rows = (
  visibleIds: readonly RowKey[],
  allIds: readonly RowKey[] = ROWS
): ListSelectionEvent => ({
  type: 'rowsChanged',
  visibleIds,
  allIds
});
const layout = (to: DetailLayout): ListSelectionEvent => ({ type: 'layoutChanged', layout: to });

/** The expected state, spelled out (`origin` only for a drill list). */
function expected(
  at: DetailLayout,
  view: 'list' | 'detail',
  selectedId: RowKey | null,
  presence: SelectionPresence | null,
  origin: DrillListOrigin | null = null
): ListSelectionState {
  return { layout: at, view, selectedId, presence, origin } as ListSelectionState;
}

/** The empty state of a layout. */
const idle = (at: DetailLayout): ListSelectionState => expected(at, 'list', null, null);

describe('initialListSelection', () => {
  it.each(['pane', 'drill'] as const)('%s: nothing selected, on the list', (at) => {
    expect(initialListSelection(at)).toEqual(idle(at));
  });

  it.each([undefined, '', 'side', 1, null])('rejects a non-layout (%s)', (bad) => {
    expect(() => initialListSelection(bad as DetailLayout)).toThrow(TypeError);
    expect(() => initialListSelection(bad as DetailLayout)).toThrow(/Detail layout/);
  });
});

describe('open', () => {
  it('pane: selects the row and keeps the list (the pane shows it)', () => {
    expect(from('pane', open('b'))).toEqual(expected('pane', 'list', 'b', 'listed'));
  });

  it('drill: opens the row detail in place of the list', () => {
    expect(from('drill', open('b'))).toEqual(expected('drill', 'detail', 'b', 'listed'));
  });

  it('replaces another selection (pane) and reopens a drill-list scroll target', () => {
    expect(from('pane', open('a'), open('c'))).toEqual(expected('pane', 'list', 'c', 'listed'));
    expect(from('drill', open('a'), back, open('a'))).toEqual(
      expected('drill', 'detail', 'a', 'listed')
    );
  });

  it.each(['pane', 'drill'] as const)(
    '%s: reopening the shown row returns the same object',
    (at) => {
      const state = from(at, open('a'));
      expect(reduceListSelection(state, open('a'))).toBe(state);
    }
  );

  it('trusts an id the rows have not reported yet; the next rowsChanged reconciles it', () => {
    // Ids come from rendered rows, so the machine never second-guesses them…
    const opened = from('drill', open('zz'));
    expect(opened).toEqual(expected('drill', 'detail', 'zz', 'listed'));
    // …and a stale one surfaces as gone instead of jumping elsewhere.
    expect(run(opened, rows(ROWS))).toEqual(expected('drill', 'detail', 'zz', 'gone'));
  });

  it.each(['', 1, null, undefined])('rejects a non-key id (%s)', (bad) => {
    const event = { type: 'open', id: bad } as unknown as ListSelectionEvent;
    expect(() => from('pane', event)).toThrow(TypeError);
    expect(() => from('pane', event)).toThrow(/open id: a row key must be a non-empty string/);
  });
});

describe('close', () => {
  it.each([
    ['pane selection', from('pane', open('a'))],
    ['pane gone', from('pane', open('a'), rows(['b'], ['b']))],
    ['drill detail', from('drill', open('a'))],
    ['drill unlisted detail', from('drill', open('a'), rows(['b']))],
    ['drill list target', from('drill', open('a'), back)]
  ])('%s → nothing selected, same layout', (_name, state) => {
    expect(reduceListSelection(state, close)).toEqual(idle(state.layout));
  });

  it.each(['pane', 'drill'] as const)('%s: closing nothing returns the same object', (at) => {
    const state = initialListSelection(at);
    expect(reduceListSelection(state, close)).toBe(state);
  });
});

describe('back', () => {
  it('drill detail → list, keeping the row as the scroll-restore target', () => {
    expect(from('drill', open('b'), back)).toEqual(
      expected('drill', 'list', 'b', 'listed', 'back')
    );
  });

  it.each([
    ['no longer listed', rows(['a', 'c'])],
    ['gone', rows(['a', 'c'], ['a', 'c'])]
  ])('drill detail %s → list with nothing selected (no row to restore to)', (_name, change) => {
    expect(from('drill', open('b'), change, back)).toEqual(idle('drill'));
  });

  it('pane: Back/Esc closes the pane', () => {
    expect(from('pane', open('b'), back)).toEqual(idle('pane'));
    expect(from('pane', open('b'), rows([], []), back)).toEqual(idle('pane'));
  });

  it('is a no-op (same object) on the drill list and with nothing selected', () => {
    // Both drill-list origins: back must not turn a collapsed pane into a dismissed one.
    for (const target of [
      from('drill', open('b'), back),
      from('pane', open('b'), layout('drill'))
    ]) {
      expect(reduceListSelection(target, back)).toBe(target);
    }
    for (const at of ['pane', 'drill'] as const) {
      const empty = initialListSelection(at);
      expect(reduceListSelection(empty, back)).toBe(empty);
    }
  });
});

describe('step', () => {
  it.each(['pane', 'drill'] as const)('%s: moves to the neighbour in visible order', (at) => {
    const view = at === 'pane' ? 'list' : 'detail';
    expect(from(at, open('b'), step(1))).toEqual(expected(at, view, 'c', 'listed'));
    expect(from(at, open('b'), step(-1))).toEqual(expected(at, view, 'a', 'listed'));
    // Order comes from the event's visible list, not from the page order.
    expect(from(at, open('b'), step(1, ['c', 'b', 'a']))).toEqual(
      expected(at, view, 'a', 'listed')
    );
  });

  it.each(['pane', 'drill'] as const)('%s: stops at both ends (no wrap), same object', (at) => {
    const first = from(at, open('a'));
    const last = from(at, open('c'));
    expect(reduceListSelection(first, step(-1))).toBe(first);
    expect(reduceListSelection(last, step(1))).toBe(last);
    const only = from(at, open('a'));
    expect(reduceListSelection(only, step(1, ['a']))).toBe(only);
    expect(reduceListSelection(only, step(-1, ['a']))).toBe(only);
  });

  it.each([
    ['nothing selected (pane)', initialListSelection('pane')],
    ['nothing selected (drill)', initialListSelection('drill')],
    ['drill list (↑/↓ move DOM focus only)', from('drill', open('b'), back)],
    ['a selection the visible list lacks', from('drill', open('b'), rows(['a', 'c']))],
    ['a gone selection', from('pane', open('b'), rows(['a'], ['a']))]
  ])('is a no-op on %s', (_name, state) => {
    expect(reduceListSelection(state, step(1, ['a', 'c']))).toBe(state);
    expect(reduceListSelection(state, step(-1, ['a', 'c']))).toBe(state);
  });

  it.each([
    ['dismissed', from('drill', open('b'), back)],
    ['collapsed pane', from('pane', open('b'), layout('drill'))]
  ])('is a no-op on a drill list (%s) whose row is visible', (_name, state) => {
    // The selection is in the list, so only the drill-list rule keeps it put.
    expect(reduceListSelection(state, step(1))).toBe(state);
    expect(reduceListSelection(state, step(-1))).toBe(state);
  });

  it('is a no-op on an empty list', () => {
    const state = from('pane', open('a'));
    expect(reduceListSelection(state, step(1, []))).toBe(state);
  });

  it.each([0, 2, -2, Number.NaN, '1'])('rejects a delta other than ±1 (%s)', (bad) => {
    const event = { type: 'step', delta: bad, visibleIds: ROWS } as unknown as ListSelectionEvent;
    expect(() => from('pane', open('a'), event)).toThrow(/step: delta must be 1 or -1/);
    // Fail fast even where the step would do nothing.
    expect(() => from('pane', event)).toThrow(TypeError);
  });
});

describe('rowsChanged', () => {
  it.each(['pane', 'drill'] as const)('%s: nothing selected → same object', (at) => {
    const state = initialListSelection(at);
    expect(reduceListSelection(state, rows(['a']))).toBe(state);
  });

  it.each([
    ['pane', from('pane', open('b'))],
    ['drill detail', from('drill', open('b'))],
    ['drill list', from('drill', open('b'), back)]
  ])('%s: a still-visible selection survives a refresh (same object)', (_name, state) => {
    expect(reduceListSelection(state, rows(['c', 'b']))).toBe(state);
  });

  describe('filtered out (still on the page)', () => {
    it('pane: clears the selection', () => {
      expect(from('pane', open('b'), rows(['a', 'c']))).toEqual(idle('pane'));
    });

    it('drill detail: keeps the detail in the "no longer listed" state', () => {
      expect(from('drill', open('b'), rows(['a', 'c']))).toEqual(
        expected('drill', 'detail', 'b', 'unlisted')
      );
    });

    it('drill list: drops the scroll target', () => {
      expect(from('drill', open('b'), back, rows(['a']))).toEqual(idle('drill'));
    });

    it('drill detail recovers when the row is listed again', () => {
      expect(from('drill', open('b'), rows(['a']), rows(ROWS))).toEqual(
        expected('drill', 'detail', 'b', 'listed')
      );
    });

    it('empty visible list, rows still on the page', () => {
      expect(from('pane', open('b'), rows([]))).toEqual(idle('pane'));
      expect(from('drill', open('b'), rows([]))).toEqual(
        expected('drill', 'detail', 'b', 'unlisted')
      );
    });
  });

  describe('gone from the page (refresh removed it, or its key changed)', () => {
    it.each([
      ['pane', 'list'],
      ['drill', 'detail']
    ] as const)('%s: keeps showing the row as gone', (at, view) => {
      expect(from(at, open('b'), rows(['a'], ['a']))).toEqual(expected(at, view, 'b', 'gone'));
      expect(from(at, open('b'), rows([], []))).toEqual(expected(at, view, 'b', 'gone'));
    });

    it('drill list: drops the scroll target', () => {
      expect(from('drill', open('b'), back, rows(['a'], ['a']))).toEqual(idle('drill'));
    });

    it('gone wins over filtered: a removed row is gone whatever the filter', () => {
      expect(from('drill', open('b'), rows(['a']), rows(['a'], ['a']))).toEqual(
        expected('drill', 'detail', 'b', 'gone')
      );
    });

    it.each(['pane', 'drill'] as const)(
      '%s: recovers when a later refresh lists the row again',
      (at) => {
        const view = at === 'pane' ? 'list' : 'detail';
        expect(from(at, open('b'), rows([], []), rows(ROWS))).toEqual(
          expected(at, view, 'b', 'listed')
        );
      }
    );

    it('back on the page but filtered: pane clears, drill shows "no longer listed"', () => {
      expect(from('pane', open('b'), rows([], []), rows(['a']))).toEqual(idle('pane'));
      expect(from('drill', open('b'), rows([], []), rows(['a']))).toEqual(
        expected('drill', 'detail', 'b', 'unlisted')
      );
    });

    it('repeating the same change returns the same object', () => {
      const gone = from('pane', open('b'), rows(['a'], ['a']));
      expect(reduceListSelection(gone, rows(['a'], ['a']))).toBe(gone);
      const unlisted = from('drill', open('b'), rows(['a']));
      expect(reduceListSelection(unlisted, rows(['a']))).toBe(unlisted);
    });
  });

  describe('rejects key lists that break the row-key contract (even with nothing selected)', () => {
    it.each([
      ['a duplicate in allIds', rows(['a'], ['a', 'b', 'a']), /duplicate key "a" in allIds/],
      ['a duplicate in visibleIds', rows(['a', 'a']), /duplicate key "a" in visibleIds/],
      ['a visible key missing from allIds', rows(['x']), /visible key "x" is not in allIds/],
      ['an empty key', rows([], ['a', '']), /allIds entry: a row key must be a non-empty string/],
      [
        'a non-string key',
        rows([1 as unknown as RowKey], ROWS),
        /visibleIds entry: a row key must be a non-empty string, got 1/
      ]
    ])('%s', (_name, event, message) => {
      expect(() => from('pane', event)).toThrow(message);
      expect(() => from('drill', open('a'), event)).toThrow(TypeError);
    });
  });
});

describe('layoutChanged', () => {
  it.each(['pane', 'drill'] as const)('%s → same layout: same object', (at) => {
    for (const state of [initialListSelection(at), from(at, open('a'))]) {
      expect(reduceListSelection(state, layout(at))).toBe(state);
    }
  });

  it('nothing selected follows the layout both ways', () => {
    expect(from('pane', layout('drill'))).toEqual(idle('drill'));
    expect(from('drill', layout('pane'))).toEqual(idle('pane'));
  });

  describe('pane → drill', () => {
    it('a selection stays on the list as the scroll target (no full-view takeover)', () => {
      expect(from('pane', open('b'), layout('drill'))).toEqual(
        expected('drill', 'list', 'b', 'listed', 'resize')
      );
    });

    it('the collapsed pane keeps its origin through refreshes, drops it when unlisted', () => {
      const collapsed = from('pane', open('b'), layout('drill'));
      expect(reduceListSelection(collapsed, rows(['c', 'b']))).toBe(collapsed);
      expect(run(collapsed, rows(['a']))).toEqual(idle('drill'));
    });

    it('a gone selection is dropped (no row to scroll to)', () => {
      expect(from('pane', open('b'), rows([], []), layout('drill'))).toEqual(idle('drill'));
    });
  });

  describe('drill → pane', () => {
    it('an open detail: the pane shows the same row', () => {
      expect(from('drill', open('b'), layout('pane'))).toEqual(
        expected('pane', 'list', 'b', 'listed')
      );
    });

    it('a gone detail: the pane shows it gone', () => {
      expect(from('drill', open('b'), rows([], []), layout('pane'))).toEqual(
        expected('pane', 'list', 'b', 'gone')
      );
    });

    it('a "no longer listed" detail: cleared, as a pane never shows a hidden row', () => {
      expect(from('drill', open('b'), rows(['a']), layout('pane'))).toEqual(idle('pane'));
    });

    it('a collapsed pane (never closed): the pane comes back with the same row', () => {
      expect(from('pane', open('b'), layout('drill'), layout('pane'))).toEqual(
        expected('pane', 'list', 'b', 'listed')
      );
    });

    it('a detail the user left with Back: stays closed (a dismissed pane never reopens)', () => {
      expect(from('drill', open('b'), back, layout('pane'))).toEqual(idle('pane'));
    });
  });

  it('round trips: a collapsed pane survives every splitter crossing; a dismissed one never returns', () => {
    const pane = from('pane', open('b'));
    const dragged = run(pane, layout('drill'), layout('pane'), layout('drill'), layout('pane'));
    expect(dragged).toEqual(pane);
    // Pane → drill, user opens a row and goes Back: now dismissed.
    expect(run(pane, layout('drill'), open('c'), back, layout('pane'))).toEqual(idle('pane'));
    // Pane → drill → opened detail (not dismissed) → pane shows it.
    expect(run(pane, layout('drill'), open('c'), layout('pane'))).toEqual(
      expected('pane', 'list', 'c', 'listed')
    );
    // A dismissed detail stays dismissed through further crossings.
    expect(from('drill', open('b'), back, layout('pane'), layout('drill'))).toEqual(idle('drill'));
  });

  it.each(['split', '', undefined])('rejects a non-layout (%s)', (bad) => {
    const event = { type: 'layoutChanged', layout: bad } as unknown as ListSelectionEvent;
    expect(() => from('pane', event)).toThrow(/Detail layout must be "pane" or "drill"/);
  });
});

describe('reduceListSelection', () => {
  it.each(['select', 'toString', '__proto__'])('rejects an unknown event type (%s)', (type) => {
    const event = { type } as unknown as ListSelectionEvent;
    expect(() => from('pane', event)).toThrow(/Unknown list-selection event type/);
  });
});

describe('isDetailOpen', () => {
  it.each([
    ['pane, nothing selected', initialListSelection('pane'), false],
    ['pane, selection', from('pane', open('a')), true],
    ['pane, gone', from('pane', open('a'), rows([], [])), true],
    ['drill, nothing selected', initialListSelection('drill'), false],
    ['drill, list target', from('drill', open('a'), back), false],
    ['drill, detail', from('drill', open('a')), true],
    ['drill, unlisted detail', from('drill', open('a'), rows(['b'])), true]
  ])('%s → %s', (_name, state, open) => {
    expect(isDetailOpen(state)).toBe(open);
  });
});

describe('neighborId', () => {
  it('returns the previous/next key in the given order', () => {
    expect(neighborId(ROWS, 'b', 1)).toBe('c');
    expect(neighborId(ROWS, 'b', -1)).toBe('a');
    expect(neighborId(['c', 'b', 'a'], 'b', 1)).toBe('a');
  });

  it('is null past either end (no wrap), for an id not visible, and on an empty list', () => {
    expect(neighborId(ROWS, 'a', -1)).toBeNull();
    expect(neighborId(ROWS, 'c', 1)).toBeNull();
    expect(neighborId(['a'], 'a', 1)).toBeNull();
    expect(neighborId(ROWS, 'zz', 1)).toBeNull();
    expect(neighborId([], 'a', -1)).toBeNull();
  });

  it.each([0, 2, Number.NaN])('rejects a delta other than ±1 (%s)', (bad) => {
    expect(() => neighborId(ROWS, 'b', bad as 1)).toThrow(/step: delta must be 1 or -1/);
  });
});

describe('selectionPosition', () => {
  it('reports the 0-based index and the visible count', () => {
    expect(selectionPosition(from('pane', open('a')), ROWS)).toEqual({ index: 0, count: 3 });
    expect(selectionPosition(from('drill', open('c')), ROWS)).toEqual({ index: 2, count: 3 });
  });

  it('is null with nothing selected or a selection the visible list lacks', () => {
    expect(selectionPosition(initialListSelection('pane'), ROWS)).toBeNull();
    expect(selectionPosition(from('drill', open('b')), ['a', 'c'])).toBeNull();
    expect(selectionPosition(from('drill', open('b')), [])).toBeNull();
  });
});

describe('invariants under random event sequences', () => {
  /**
   * A deterministic 32-bit LCG, so a failure replays exactly.
   *
   * @param seed The start value.
   */
  function lcg(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 2 ** 32;
    };
  }

  /** Whether a state is one of the four legal shapes. */
  function isLegal(state: ListSelectionState): boolean {
    // Widened on purpose: the types already forbid illegal shapes, the
    // runtime values are what this checks.
    const loose: {
      layout: string;
      view: string;
      selectedId: string | null;
      presence: string | null;
      origin: string | null;
    } = state;
    const drillList =
      loose.layout === 'drill' && loose.view === 'list' && loose.selectedId !== null;
    // Only a drill list carries an origin, and it always does.
    if (drillList !== (loose.origin === 'resize' || loose.origin === 'back')) return false;
    if (loose.selectedId === null) return loose.view === 'list' && loose.presence === null;
    if (loose.layout === 'pane') return loose.view === 'list' && loose.presence !== 'unlisted';
    return loose.view === 'detail' || loose.presence === 'listed';
  }

  it('every reachable state is legal and every repeated event is identity-stable', () => {
    const random = lcg(0x5eed);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const universe = ['a', 'b', 'c', 'd', 'e'];
    let state: ListSelectionState = initialListSelection('pane');
    for (let turn = 0; turn < 3000; turn += 1) {
      const all = universe.filter(() => random() < 0.8);
      const visible = all.filter(() => random() < 0.7);
      const event = pick<ListSelectionEvent>([
        open(pick(universe)),
        close,
        back,
        step(pick([-1, 1] as const), visible),
        rows(visible, all),
        layout(pick(['pane', 'drill'] as const))
      ]);
      state = reduceListSelection(state, event);
      expect(isLegal(state), JSON.stringify({ turn, event, state })).toBe(true);
      // Applying an idempotent event twice changes nothing the second time.
      if (event.type !== 'step') expect(reduceListSelection(state, event)).toBe(state);
    }
  });
});
