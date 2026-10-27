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
 */

import { commandDisabledNote, paletteCommands, type PageCommandFacts } from './commands';

/** The bridge's global name in the isolated world. */
export const PALETTE_BRIDGE_GLOBAL = '__wprFdtCommandPalette';

/** One row as the view renders it (labels from the vocabulary, availability resolved). */
export interface PaletteRowView {
  readonly id: string;
  readonly label: string;
  readonly keywords: readonly string[];
  /** Why the row cannot run here, or null. */
  readonly disabledNote: string | null;
  /** The confirm step the row asks for before running, or null. */
  readonly confirm: {
    readonly title: string;
    readonly body: string;
    readonly action: string;
  } | null;
}

/**
 * The rows the view lists for a page: the vocabulary's palette rows, their
 * availability resolved against the page facts.
 *
 * @param facts The page facts.
 */
export function paletteRowViews(facts: PageCommandFacts): PaletteRowView[] {
  return paletteCommands().map((row) => ({
    id: row.id,
    label: row.label,
    keywords: row.keywords,
    disabledNote: commandDisabledNote(row, facts),
    confirm: row.confirm ?? null
  }));
}

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
  /** The rows to list right now. */
  rows(): readonly PaletteRowView[];
  /**
   * Run one row; the view has already closed. Failures surface through the
   * module (it owns the page notices), so the call never throws.
   */
  run(id: string): void;
  /**
   * Hand the module the view's handle; the module opens it right away when
   * an open is pending.
   *
   * @returns False when the module refuses (dead, or the gate turned off):
   *   the view must remove itself.
   */
  attach(view: PaletteViewHandle): boolean;
  /** The view went away on its own (its context ended). */
  detach(view: PaletteViewHandle): void;
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
const BRIDGE_METHODS = ['alive', 'rows', 'run', 'attach', 'detach'] as const;

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
