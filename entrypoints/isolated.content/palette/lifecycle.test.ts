/**
 * The palette lifecycle, transition by transition: boot (on/off, no notice
 * for an already-off gate), open → load → attach → open-view, re-opens,
 * the load that never attached, per-load tickets (a stale settle never
 * fails a newer load), attaches refused with no open pending (stale or
 * misdirected views), the newest view winning, a failed mount noticed,
 * gate-off teardown from every live state, gate-on re-arming, and the
 * stale-injection race end to end.
 */
import { describe, expect, it } from 'vitest';
import type { PaletteViewHandle } from '../../../lib/page-commands/palette-bridge';
import {
  PALETTE_BOOTING,
  holdsView,
  paletteTransition,
  type PaletteEffect,
  type PaletteEvent,
  type PaletteLoad,
  type PaletteState
} from './lifecycle';

/** A view handle (identity is all the lifecycle reads). */
function view(): PaletteViewHandle {
  return { open: () => undefined, dispose: () => undefined };
}

const OFF: PaletteState = { kind: 'off' };
const IDLE: PaletteState = { kind: 'idle' };
const GATE_ON: PaletteEvent = { type: 'gate', enabled: true };
const GATE_OFF: PaletteEvent = { type: 'gate', enabled: false };
const OPEN: PaletteEvent = { type: 'open' };
const LOAD_FAILED: PaletteEffect = { type: 'notice', notice: 'load-failed' };

/** A loading state on a fresh ticket. */
function loading(): { state: PaletteState; load: PaletteLoad } {
  const load: PaletteLoad = Symbol('test load');
  return { state: { kind: 'loading', load }, load };
}

/**
 * Feed events in order.
 *
 * @param state The start.
 * @param events What happens.
 * @returns The end state and every effect, in order.
 */
function run(
  state: PaletteState,
  events: readonly PaletteEvent[]
): { state: PaletteState; effects: PaletteEffect[] } {
  const effects: PaletteEffect[] = [];
  let current = state;
  for (const event of events) {
    const next = paletteTransition(current, event);
    current = next.state;
    effects.push(...next.effects);
  }
  return { state: current, effects };
}

/**
 * The ticket of the load an open started.
 *
 * @param state A state right after the open.
 * @throws {@link Error} when the state is not loading.
 */
function loadOf(state: PaletteState): PaletteLoad {
  if (state.kind !== 'loading') throw new Error(`expected loading, got ${state.kind}`);
  return state.load;
}

describe('boot', () => {
  it('arms the receiver when the gate reads on', () => {
    expect(paletteTransition(PALETTE_BOOTING, GATE_ON)).toEqual({
      state: IDLE,
      effects: [{ type: 'arm-receiver' }]
    });
  });

  it('stays dark without a notice when the gate already reads off', () => {
    expect(paletteTransition(PALETTE_BOOTING, GATE_OFF)).toEqual({ state: OFF, effects: [] });
  });

  it('ignores opens and attaches before the gate is known', () => {
    expect(paletteTransition(PALETTE_BOOTING, OPEN).effects).toEqual([]);
    const handle = view();
    const attached = paletteTransition(PALETTE_BOOTING, { type: 'attach', view: handle });
    expect(attached.state).toBe(PALETTE_BOOTING);
    expect(holdsView(attached.state, handle)).toBe(false);
  });
});

describe('opening', () => {
  it('loads the view on the first open under a fresh ticket, once', () => {
    const next = paletteTransition(IDLE, OPEN);
    const load = loadOf(next.state);
    expect(next.effects).toEqual([{ type: 'load-view', load }]);
    // A second open while loading is already pending.
    expect(paletteTransition(next.state, OPEN)).toEqual({ state: next.state, effects: [] });
    // Every load gets its own ticket.
    expect(loadOf(paletteTransition(IDLE, OPEN).state)).not.toBe(load);
  });

  it('opens the attaching view right away (its load still in flight)', () => {
    const { state, load } = loading();
    const handle = view();
    const next = paletteTransition(state, { type: 'attach', view: handle });
    expect(next).toEqual({
      state: { kind: 'ready', view: handle, load },
      effects: [{ type: 'open-view', view: handle }]
    });
    expect(holdsView(next.state, handle)).toBe(true);
  });

  it('clears the in-flight load once it settles, and re-opens without loading again', () => {
    const { state, load } = loading();
    const handle = view();
    const settled = run(state, [
      { type: 'attach', view: handle },
      { type: 'load-settled', load }
    ]);
    expect(settled.state).toEqual({ kind: 'ready', view: handle, load: null });
    expect(paletteTransition(settled.state, OPEN)).toEqual({
      state: settled.state,
      effects: [{ type: 'open-view', view: handle }]
    });
  });

  it('notices a load that ended without its view attaching', () => {
    const { state, load } = loading();
    expect(paletteTransition(state, { type: 'load-settled', load })).toEqual({
      state: IDLE,
      effects: [LOAD_FAILED]
    });
  });

  it('ignores the settle of another (stale) load', () => {
    const { state } = loading();
    const stale = paletteTransition(state, { type: 'load-settled', load: Symbol('stale') });
    expect(stale).toEqual({ state, effects: [] });
    const ready: PaletteState = { kind: 'ready', view: view(), load: null };
    expect(paletteTransition(ready, { type: 'load-settled', load: Symbol('stale') })).toEqual({
      state: ready,
      effects: []
    });
  });

  it('nothing opens while the gate is off', () => {
    expect(paletteTransition(OFF, OPEN)).toEqual({ state: OFF, effects: [] });
  });
});

describe('attaches with no open pending', () => {
  it('refuses a view attaching while idle (a misdirected or stale injection)', () => {
    const handle = view();
    const next = paletteTransition(IDLE, { type: 'attach', view: handle });
    expect(next).toEqual({ state: IDLE, effects: [] });
    expect(holdsView(next.state, handle)).toBe(false);
  });

  it('refuses a second view once the held one’s load settled', () => {
    const ready: PaletteState = { kind: 'ready', view: view(), load: null };
    const other = view();
    const next = paletteTransition(ready, { type: 'attach', view: other });
    expect(next).toEqual({ state: ready, effects: [] });
    expect(holdsView(next.state, other)).toBe(false);
  });

  it('changes nothing when the held view attaches again', () => {
    const handle = view();
    const ready: PaletteState = { kind: 'ready', view: handle, load: Symbol('in flight') };
    expect(paletteTransition(ready, { type: 'attach', view: handle })).toEqual({
      state: ready,
      effects: []
    });
  });
});

describe('the newest view wins while a load is in flight', () => {
  it('replaces the held view with the newer one and opens it', () => {
    const older = view();
    const newer = view();
    const load: PaletteLoad = Symbol('in flight');
    expect(
      paletteTransition({ kind: 'ready', view: older, load }, { type: 'attach', view: newer })
    ).toEqual({
      state: { kind: 'ready', view: newer, load },
      effects: [
        { type: 'dispose-view', view: older },
        { type: 'open-view', view: newer }
      ]
    });
  });

  it('keeps the open waiting when the held view ends with its load in flight', () => {
    const handle = view();
    const load: PaletteLoad = Symbol('in flight');
    expect(
      paletteTransition(
        { kind: 'ready', view: handle, load },
        { type: 'detach', view: handle, reason: 'ended' }
      )
    ).toEqual({ state: { kind: 'loading', load }, effects: [] });
  });
});

describe('detach', () => {
  it('returns to idle quietly when the held view ends', () => {
    const handle = view();
    const ready: PaletteState = { kind: 'ready', view: handle, load: null };
    expect(paletteTransition(ready, { type: 'detach', view: handle, reason: 'ended' })).toEqual({
      state: IDLE,
      effects: []
    });
  });

  it('notices a held view that could not mount (the open never showed)', () => {
    const handle = view();
    const ready: PaletteState = { kind: 'ready', view: handle, load: null };
    expect(paletteTransition(ready, { type: 'detach', view: handle, reason: 'failed' })).toEqual({
      state: IDLE,
      effects: [LOAD_FAILED]
    });
  });

  it('reports a failed mount through its load’s settle when the load is still in flight', () => {
    const { state, load } = loading();
    const handle = view();
    const result = run(state, [
      { type: 'attach', view: handle },
      { type: 'detach', view: handle, reason: 'failed' },
      { type: 'load-settled', load }
    ]);
    expect(result.state).toEqual(IDLE);
    expect(result.effects).toEqual([{ type: 'open-view', view: handle }, LOAD_FAILED]);
  });

  it('ignores any view it does not hold', () => {
    const ready: PaletteState = { kind: 'ready', view: view(), load: null };
    expect(paletteTransition(ready, { type: 'detach', view: view(), reason: 'failed' })).toEqual({
      state: ready,
      effects: []
    });
    expect(paletteTransition(OFF, { type: 'detach', view: view(), reason: 'failed' }).state).toBe(
      OFF
    );
  });
});

describe('gate-off teardown', () => {
  it('disarms and notices from idle', () => {
    expect(paletteTransition(IDLE, GATE_OFF)).toEqual({
      state: OFF,
      effects: [{ type: 'disarm-receiver' }, { type: 'notice', notice: 'gate-off' }]
    });
  });

  it('disarms and notices from loading (the late attach is then refused)', () => {
    const next = paletteTransition(loading().state, GATE_OFF);
    expect(next.effects).toEqual([
      { type: 'disarm-receiver' },
      { type: 'notice', notice: 'gate-off' }
    ]);
    const handle = view();
    const attached = paletteTransition(next.state, { type: 'attach', view: handle });
    expect(holdsView(attached.state, handle)).toBe(false);
  });

  it('disposes a held view before the notice', () => {
    const handle = view();
    expect(paletteTransition({ kind: 'ready', view: handle, load: null }, GATE_OFF)).toEqual({
      state: OFF,
      effects: [
        { type: 'disarm-receiver' },
        { type: 'dispose-view', view: handle },
        { type: 'notice', notice: 'gate-off' }
      ]
    });
  });

  it('repeats nothing on a second off delivery', () => {
    expect(paletteTransition(OFF, GATE_OFF)).toEqual({ state: OFF, effects: [] });
  });
});

describe('gate-on', () => {
  it('re-arms the receiver from off (the view loads again on the next open)', () => {
    expect(paletteTransition(OFF, GATE_ON)).toEqual({
      state: IDLE,
      effects: [{ type: 'arm-receiver' }]
    });
  });

  it('repeats nothing while already on', () => {
    const states: PaletteState[] = [
      IDLE,
      loading().state,
      { kind: 'ready', view: view(), load: null }
    ];
    for (const state of states) {
      expect(paletteTransition(state, GATE_ON)).toEqual({ state, effects: [] });
    }
  });
});

describe('the stale-injection race', () => {
  it('opens the newest view after a gate off/on, with no false failure from the stale load', () => {
    const view1 = view();
    const view2 = view();
    // open → loading (load 1); gate off, gate on; open → loading (load 2).
    const first = paletteTransition(IDLE, OPEN);
    const load1 = loadOf(first.state);
    const reopened = run(first.state, [GATE_OFF, GATE_ON, OPEN]);
    const load2 = loadOf(reopened.state);
    expect(load2).not.toBe(load1);
    const result = run(reopened.state, [
      // Load 1's view attaches during load 2: it answers the pending open…
      { type: 'attach', view: view1 },
      // …until load 2's script ends it (a newer injection of the same page)…
      { type: 'detach', view: view1, reason: 'ended' },
      // …and load 2's view attaches and opens.
      { type: 'attach', view: view2 },
      // Both settles arrive late; the stale one changes nothing.
      { type: 'load-settled', load: load1 },
      { type: 'load-settled', load: load2 }
    ]);
    expect(result.state).toEqual({ kind: 'ready', view: view2, load: null });
    expect(result.effects).toEqual([
      { type: 'open-view', view: view1 },
      { type: 'open-view', view: view2 }
    ]);
  });

  it('drops a stale settle arriving before the newer load’s view', () => {
    const first = paletteTransition(IDLE, OPEN);
    const load1 = loadOf(first.state);
    const reopened = run(first.state, [GATE_OFF, GATE_ON, OPEN]);
    const handle = view();
    const result = run(reopened.state, [
      { type: 'load-settled', load: load1 },
      { type: 'attach', view: handle }
    ]);
    expect(result.effects).toEqual([{ type: 'open-view', view: handle }]);
    expect(holdsView(result.state, handle)).toBe(true);
  });
});
