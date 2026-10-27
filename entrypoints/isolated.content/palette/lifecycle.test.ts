/**
 * The palette lifecycle, transition by transition: boot (on/off, no notice
 * for an already-off gate), open → load → attach → open-view, re-opens,
 * the load that never attached, gate-off teardown from every live state
 * (disarm, dispose, notice), gate-on re-arming, idempotent repeats, and the
 * attach/detach edge cases.
 */
import { describe, expect, it } from 'vitest';
import type { PaletteViewHandle } from '../../../lib/page-commands/palette-bridge';
import {
  PALETTE_BOOTING,
  holdsView,
  paletteTransition,
  type PaletteEvent,
  type PaletteState
} from './lifecycle';

/** A view handle (identity is all the lifecycle reads). */
function view(): PaletteViewHandle {
  return { open: () => undefined, dispose: () => undefined };
}

const OFF: PaletteState = { kind: 'off' };
const IDLE: PaletteState = { kind: 'idle' };
const LOADING: PaletteState = { kind: 'loading' };
const GATE_ON: PaletteEvent = { type: 'gate', enabled: true };
const GATE_OFF: PaletteEvent = { type: 'gate', enabled: false };
const OPEN: PaletteEvent = { type: 'open' };

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
    const attached = paletteTransition(PALETTE_BOOTING, { type: 'attach', view: view() });
    expect(attached.state).toBe(PALETTE_BOOTING);
  });
});

describe('opening', () => {
  it('loads the view on the first open, once', () => {
    expect(paletteTransition(IDLE, OPEN)).toEqual({
      state: LOADING,
      effects: [{ type: 'load-view' }]
    });
    // A second open while loading is already pending.
    expect(paletteTransition(LOADING, OPEN)).toEqual({ state: LOADING, effects: [] });
  });

  it('opens the attaching view right away', () => {
    const handle = view();
    const next = paletteTransition(LOADING, { type: 'attach', view: handle });
    expect(next).toEqual({
      state: { kind: 'ready', view: handle },
      effects: [{ type: 'open-view', view: handle }]
    });
    expect(holdsView(next.state, handle)).toBe(true);
  });

  it('re-opens a loaded view without loading again', () => {
    const handle = view();
    const ready: PaletteState = { kind: 'ready', view: handle };
    expect(paletteTransition(ready, OPEN)).toEqual({
      state: ready,
      effects: [{ type: 'open-view', view: handle }]
    });
  });

  it('notices a load that ended without its view attaching', () => {
    expect(paletteTransition(LOADING, { type: 'load-settled' })).toEqual({
      state: IDLE,
      effects: [{ type: 'notice', notice: 'load-failed' }]
    });
  });

  it('ignores the settle of a load whose view already attached', () => {
    const ready: PaletteState = { kind: 'ready', view: view() };
    expect(paletteTransition(ready, { type: 'load-settled' })).toEqual({
      state: ready,
      effects: []
    });
  });

  it('nothing opens while the gate is off', () => {
    expect(paletteTransition(OFF, OPEN)).toEqual({ state: OFF, effects: [] });
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
    const next = paletteTransition(LOADING, GATE_OFF);
    expect(next.effects).toEqual([
      { type: 'disarm-receiver' },
      { type: 'notice', notice: 'gate-off' }
    ]);
    const handle = view();
    const attached = paletteTransition(next.state, { type: 'attach', view: handle });
    expect(holdsView(attached.state, handle)).toBe(false);
  });

  it('disposes a loaded view before the notice', () => {
    const handle = view();
    expect(paletteTransition({ kind: 'ready', view: handle }, GATE_OFF)).toEqual({
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
    for (const state of [IDLE, LOADING, { kind: 'ready', view: view() } as PaletteState]) {
      expect(paletteTransition(state, GATE_ON)).toEqual({ state, effects: [] });
    }
  });
});

describe('attach / detach edges', () => {
  it('holds an unexpected view attaching while idle (no open)', () => {
    const handle = view();
    expect(paletteTransition(IDLE, { type: 'attach', view: handle })).toEqual({
      state: { kind: 'ready', view: handle },
      effects: []
    });
  });

  it('replaces an older view with a newer one', () => {
    const older = view();
    const newer = view();
    expect(
      paletteTransition({ kind: 'ready', view: older }, { type: 'attach', view: newer })
    ).toEqual({
      state: { kind: 'ready', view: newer },
      effects: [{ type: 'dispose-view', view: older }]
    });
  });

  it('changes nothing when the same view attaches again', () => {
    const handle = view();
    const ready: PaletteState = { kind: 'ready', view: handle };
    expect(paletteTransition(ready, { type: 'attach', view: handle })).toEqual({
      state: ready,
      effects: []
    });
  });

  it('returns to idle when the held view detaches, ignores any other', () => {
    const handle = view();
    const ready: PaletteState = { kind: 'ready', view: handle };
    expect(paletteTransition(ready, { type: 'detach', view: view() }).state).toBe(ready);
    expect(paletteTransition(ready, { type: 'detach', view: handle })).toEqual({
      state: IDLE,
      effects: []
    });
    expect(paletteTransition(OFF, { type: 'detach', view: handle }).state).toBe(OFF);
  });
});
