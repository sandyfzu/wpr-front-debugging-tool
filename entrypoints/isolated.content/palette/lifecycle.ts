/**
 * The palette module's lifecycle as a pure transition function: the gate,
 * the open requests and the lazily injected view in, the effects the
 * wiring performs out. No I/O here — the wiring (`./module`) owns the
 * receiver, the background ask, the notices and the view handle calls.
 *
 * States:
 * - `booting` — the gate's first value is not known yet: nothing is armed;
 * - `off` — the gate is off: no receiver, no view (the palette is dead);
 * - `idle` — the gate is on, the receiver is armed, no view is loaded;
 * - `loading` — an open waits: the background is injecting the view;
 * - `ready` — a view is held (every later open re-shows it); `load` names
 *   an injection still in flight (an open's), or null.
 *
 * Each injection gets its own ticket: a settle names its load, so a stale
 * one (from before a gate off/on) never fails a newer load. A view attach
 * is accepted only while an injection is in flight — any other attach is a
 * stale or misdirected view (e.g. one injected into the next document after
 * a navigation) and is refused; the view then removes itself. The newest
 * attaching view wins (a newer injection's script ends an older view of
 * the same page); a held view that goes away while a load is in flight
 * leaves the open waiting for that load's view, and one that could not
 * mount with nothing in flight tells the user the open failed.
 *
 * Gate-off from any live state disarms the receiver, disposes a held view
 * and shows the gate-off notice (whatever wrote the gate — the palette's own
 * row, the menu, the options page); gate-on re-arms the receiver (the view
 * loads again on the next open). The boot read of an already-off gate shows
 * nothing: nothing was turned off on this page.
 */
import type {
  PaletteDetachReason,
  PaletteViewHandle
} from '../../../lib/page-commands/palette-bridge';

/** One view injection's identity (fresh per load, compared by identity). */
export type PaletteLoad = symbol;

/** The module's state (see the module TSDoc). */
export type PaletteState =
  | { readonly kind: 'booting' }
  | { readonly kind: 'off' }
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly load: PaletteLoad }
  | {
      readonly kind: 'ready';
      readonly view: PaletteViewHandle;
      readonly load: PaletteLoad | null;
    };

/** What happens to the module. */
export type PaletteEvent =
  /** A validated gate value (the boot read or a watch delivery). */
  | { readonly type: 'gate'; readonly enabled: boolean }
  /** Something asked for the palette (the menu's message; later the chord). */
  | { readonly type: 'open' }
  /** An injected view handed over its handle. */
  | { readonly type: 'attach'; readonly view: PaletteViewHandle }
  /** The background's injection ask for `load` settled (either way). */
  | { readonly type: 'load-settled'; readonly load: PaletteLoad }
  /** A view went away on its own. */
  | {
      readonly type: 'detach';
      readonly view: PaletteViewHandle;
      readonly reason: PaletteDetachReason;
    };

/** What the wiring must do. */
export type PaletteEffect =
  | { readonly type: 'arm-receiver' }
  | { readonly type: 'disarm-receiver' }
  | { readonly type: 'load-view'; readonly load: PaletteLoad }
  | { readonly type: 'open-view'; readonly view: PaletteViewHandle }
  | { readonly type: 'dispose-view'; readonly view: PaletteViewHandle }
  | { readonly type: 'notice'; readonly notice: 'gate-off' | 'load-failed' };

/** One transition's result. */
export interface PaletteTransition {
  readonly state: PaletteState;
  readonly effects: readonly PaletteEffect[];
}

/** The initial state. */
export const PALETTE_BOOTING: PaletteState = { kind: 'booting' };

/** The load-failed notice effect. */
const LOAD_FAILED: PaletteEffect = { type: 'notice', notice: 'load-failed' };

/** A transition that changes nothing. */
function stay(state: PaletteState): PaletteTransition {
  return { state, effects: [] };
}

/**
 * Apply a gate value.
 *
 * @param state The current state.
 * @param enabled The validated gate.
 */
function onGate(state: PaletteState, enabled: boolean): PaletteTransition {
  if (enabled) {
    // Idempotent: the watch may deliver the same value twice.
    if (state.kind !== 'booting' && state.kind !== 'off') return stay(state);
    return { state: { kind: 'idle' }, effects: [{ type: 'arm-receiver' }] };
  }
  if (state.kind === 'off') return stay(state);
  if (state.kind === 'booting') return { state: { kind: 'off' }, effects: [] };
  const effects: PaletteEffect[] = [{ type: 'disarm-receiver' }];
  if (state.kind === 'ready') effects.push({ type: 'dispose-view', view: state.view });
  effects.push({ type: 'notice', notice: 'gate-off' });
  return { state: { kind: 'off' }, effects };
}

/**
 * Apply an open request.
 *
 * @param state The current state.
 */
function onOpen(state: PaletteState): PaletteTransition {
  if (state.kind === 'idle') {
    const load: PaletteLoad = Symbol('palette view load');
    return { state: { kind: 'loading', load }, effects: [{ type: 'load-view', load }] };
  }
  if (state.kind === 'ready') return { state, effects: [{ type: 'open-view', view: state.view }] };
  // Loading: the open is already pending. Off/booting: nothing may show.
  return stay(state);
}

/**
 * Apply a view attach: accepted only while an injection is in flight.
 *
 * @param state The current state.
 * @param view The attaching view.
 */
function onAttach(state: PaletteState, view: PaletteViewHandle): PaletteTransition {
  if (state.kind === 'loading') {
    return {
      state: { kind: 'ready', view, load: state.load },
      effects: [{ type: 'open-view', view }]
    };
  }
  if (state.kind === 'ready' && state.load !== null && state.view !== view) {
    // The newest view answers the pending open; the older one goes.
    return {
      state: { kind: 'ready', view, load: state.load },
      effects: [
        { type: 'dispose-view', view: state.view },
        { type: 'open-view', view }
      ]
    };
  }
  // No injection in flight (a stale or misdirected view), off or booting:
  // refused (the view removes itself); the held view again changes nothing.
  return stay(state);
}

/**
 * Apply an injection's settle.
 *
 * @param state The current state.
 * @param load The settled injection.
 */
function onLoadSettled(state: PaletteState, load: PaletteLoad): PaletteTransition {
  // Still waiting on this load once it ended: its view never attached.
  if (state.kind === 'loading' && state.load === load) {
    return { state: { kind: 'idle' }, effects: [LOAD_FAILED] };
  }
  if (state.kind === 'ready' && state.load === load) {
    return { state: { kind: 'ready', view: state.view, load: null }, effects: [] };
  }
  // A stale load (from before a gate off/on): ignored.
  return stay(state);
}

/**
 * Apply a view's departure.
 *
 * @param state The current state.
 * @param view The departing view.
 * @param reason Why it went.
 */
function onDetach(
  state: PaletteState,
  view: PaletteViewHandle,
  reason: PaletteDetachReason
): PaletteTransition {
  if (state.kind !== 'ready' || state.view !== view) return stay(state);
  // An injection still in flight: the open waits for its view (or its
  // settle reports the failure).
  if (state.load !== null) return { state: { kind: 'loading', load: state.load }, effects: [] };
  return { state: { kind: 'idle' }, effects: reason === 'failed' ? [LOAD_FAILED] : [] };
}

/**
 * The next state and its effects.
 *
 * @param state The current state.
 * @param event What happened.
 * @returns The transition (a no-op keeps the same state object).
 */
export function paletteTransition(state: PaletteState, event: PaletteEvent): PaletteTransition {
  switch (event.type) {
    case 'gate':
      return onGate(state, event.enabled);
    case 'open':
      return onOpen(state);
    case 'attach':
      return onAttach(state, event.view);
    case 'load-settled':
      return onLoadSettled(state, event.load);
    case 'detach':
      return onDetach(state, event.view, event.reason);
  }
}

/**
 * Whether the view an `attach` handed over is the one the state now holds
 * (the bridge's `attach` answer).
 *
 * @param state The state after the attach.
 * @param view The attaching view.
 */
export function holdsView(state: PaletteState, view: PaletteViewHandle): boolean {
  return state.kind === 'ready' && state.view === view;
}
