/**
 * The palette module's lifecycle as a pure transition function: the gate,
 * the open requests and the lazily injected view in, the effects the
 * wiring performs out. No I/O here — the wiring (`./index`) owns the
 * receiver, the background ask, the notices and the view handle calls.
 *
 * States:
 * - `booting` — the gate's first value is not known yet: nothing is armed;
 * - `off` — the gate is off: no receiver, no view (the palette is dead);
 * - `idle` — the gate is on, the receiver is armed, no view is loaded;
 * - `loading` — an open asked the background to inject the view;
 * - `ready` — the view attached (it opens on every later request).
 *
 * Gate-off from any live state disarms the receiver, disposes a loaded
 * view and shows the gate-off notice (whatever wrote the gate — the
 * palette's own row, the menu, the options page); gate-on re-arms the
 * receiver (the view loads again on the next open). The boot read of an
 * already-off gate shows nothing: nothing was turned off on this page.
 */
import type { PaletteViewHandle } from '../../../lib/page-commands/palette-bridge';

/** The module's state (see the module TSDoc). */
export type PaletteState =
  | { readonly kind: 'booting' }
  | { readonly kind: 'off' }
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly view: PaletteViewHandle };

/** What happens to the module. */
export type PaletteEvent =
  /** A validated gate value (the boot read or a watch delivery). */
  | { readonly type: 'gate'; readonly enabled: boolean }
  /** Something asked for the palette (the menu's message; later the chord). */
  | { readonly type: 'open' }
  /** The injected view handed over its handle. */
  | { readonly type: 'attach'; readonly view: PaletteViewHandle }
  /** The background's injection ask settled (either way). */
  | { readonly type: 'load-settled' }
  /** The view went away on its own. */
  | { readonly type: 'detach'; readonly view: PaletteViewHandle };

/** What the wiring must do. */
export type PaletteEffect =
  | { readonly type: 'arm-receiver' }
  | { readonly type: 'disarm-receiver' }
  | { readonly type: 'load-view' }
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
      if (state.kind === 'idle') {
        return { state: { kind: 'loading' }, effects: [{ type: 'load-view' }] };
      }
      if (state.kind === 'ready') {
        return { state, effects: [{ type: 'open-view', view: state.view }] };
      }
      // Loading: the open is already pending. Off/booting: nothing may show.
      return stay(state);
    case 'attach':
      if (state.kind === 'loading') {
        return {
          state: { kind: 'ready', view: event.view },
          effects: [{ type: 'open-view', view: event.view }]
        };
      }
      if (state.kind === 'idle') return { state: { kind: 'ready', view: event.view }, effects: [] };
      if (state.kind === 'ready' && state.view !== event.view) {
        // One view per page: a newer one replaces the older.
        return {
          state: { kind: 'ready', view: event.view },
          effects: [{ type: 'dispose-view', view: state.view }]
        };
      }
      // Off/booting refuse (the view removes itself); the same view again changes nothing.
      return stay(state);
    case 'load-settled':
      // Still loading once the injection ended: the view never attached.
      if (state.kind === 'loading') {
        return {
          state: { kind: 'idle' },
          effects: [{ type: 'notice', notice: 'load-failed' }]
        };
      }
      return stay(state);
    case 'detach':
      if (state.kind === 'ready' && state.view === event.view) {
        return { state: { kind: 'idle' }, effects: [] };
      }
      return stay(state);
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
