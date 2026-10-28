/**
 * The palette bridge: the one seam between the isolated content script's
 * palette module (always loaded: gate, receiver, executors) and the palette
 * view (a runtime content script the background injects on first open, so
 * pages pay nothing for the view until it is asked for).
 *
 * Both run in the extension's isolated world of the page's top frame
 * (content scripts of one extension share a frame's isolated world), so the
 * module publishes the bridge on that world's global and the view picks it
 * up — the page can neither read nor spoof it. The view validates what it
 * finds (two bundles meet here) and refuses anything dead or malformed.
 * The view lists its rows itself (`./palette-rows`): the bridge carries
 * only the lifecycle, the run and the chord hint.
 */

/** The bridge's global name in the isolated world. */
export const PALETTE_BRIDGE_GLOBAL = '__wprFdtCommandPalette';

/** Why a view went away (see {@link PaletteBridge.detach}). */
export type PaletteDetachReason = 'failed' | 'ended';

/** What the view hands the module once it runs. */
export interface PaletteViewHandle {
  /** Show the palette (a fresh surface: empty query, focus in the field). */
  open(): void;
  /** Remove the view from the page for good (gate off, module gone). */
  dispose(): void;
}

/** What the module offers the view. */
export interface PaletteBridge {
  /** Whether the publishing module still runs (its context valid). */
  alive(): boolean;
  /**
   * Run one row; the view has already closed. Failures surface through the
   * module (it owns the page notices), so the call never throws.
   */
  run(id: string): void;
  /**
   * Hand the module the view's handle; the module opens it right away.
   *
   * @returns False when the module refuses — dead, the gate turned off, or
   *   no open waits for a view (a stale or misdirected injection): the
   *   view must remove itself.
   */
  attach(view: PaletteViewHandle): boolean;
  /**
   * The view went away on its own (its context ended).
   *
   * @param view The departing view.
   * @param reason `failed` when it could not mount (the user's open never
   *   showed: the module says so), `ended` otherwise.
   */
  detach(view: PaletteViewHandle, reason: PaletteDetachReason): void;
  /**
   * The keyboard chord that opens the palette, in the platform's notation
   * (read per open: a rebinding shows on the next open), or null while it is
   * not resolved yet.
   */
  chordHint(): string | null;
}

/** The isolated world's global object, as the bridge reads and writes it. */
export type IsolatedWorld = Record<string, unknown>;

/**
 * Publish the module's bridge (replacing any earlier one: the newest live
 * module owns the page).
 *
 * @param world The isolated world's global.
 * @param bridge The bridge.
 */
export function publishPaletteBridge(world: IsolatedWorld, bridge: PaletteBridge): void {
  world[PALETTE_BRIDGE_GLOBAL] = bridge;
}

/**
 * Remove the module's bridge, unless a newer module replaced it already.
 *
 * @param world The isolated world's global.
 * @param bridge The bridge this module published.
 */
export function retractPaletteBridge(world: IsolatedWorld, bridge: PaletteBridge): void {
  if (world[PALETTE_BRIDGE_GLOBAL] === bridge) Reflect.deleteProperty(world, PALETTE_BRIDGE_GLOBAL);
}

/** The bridge's methods (each must be a function). */
const BRIDGE_METHODS = ['alive', 'run', 'attach', 'detach', 'chordHint'] as const;

/**
 * Find the live bridge.
 *
 * @param world The isolated world's global.
 * @returns The bridge, or null when there is none, it is malformed, its
 *   liveness check throws, or its module is dead.
 */
export function readPaletteBridge(world: IsolatedWorld): PaletteBridge | null {
  const candidate = world[PALETTE_BRIDGE_GLOBAL];
  if (typeof candidate !== 'object' || candidate === null) return null;
  const record = candidate as Record<string, unknown>;
  if (!BRIDGE_METHODS.every((name) => typeof record[name] === 'function')) return null;
  const bridge = candidate as PaletteBridge;
  try {
    return bridge.alive() ? bridge : null;
  } catch {
    // A liveness check that throws is a dead module (its context is gone).
    return null;
  }
}

/**
 * Read the module's chord hint at the view's side of the boundary: anything
 * but a non-empty string (a throwing call included) is no hint.
 *
 * @param bridge The live bridge.
 * @returns The formatted chord, or null.
 */
export function readChordHint(bridge: PaletteBridge): string | null {
  try {
    const hint: unknown = bridge.chordHint();
    return typeof hint === 'string' && hint !== '' ? hint : null;
  } catch {
    // A dead module throws here; the palette simply shows no hint.
    return null;
  }
}
