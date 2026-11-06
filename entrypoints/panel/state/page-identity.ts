/**
 * The inspected page's load identity, read from the shell's data state:
 * the payload's capture id, generated once per page load (a reload or
 * navigation brings a new one). Tool pages stamp what they read or ran
 * with it, so a result from an earlier page load reads as such.
 */
import type { DataState } from './fdt-state-machine';

/**
 * The page's load identity.
 *
 * @param state The shell's data state.
 * @returns The identity, or `null` without loaded data (or a payload without one).
 */
export function pageIdOf(state: DataState): string | null {
  if (state.status !== 'ready' && state.status !== 'refreshing') return null;
  return state.data.scriptSnapshotId ?? null;
}

/**
 * Whether the shell's identity is current: its data is loaded and no
 * refetch is in flight. While a refetch runs (after a reload or a
 * navigation) the shown identity can still be the previous load's.
 *
 * @param state The shell's data state.
 * @returns True once the shell holds fresh data.
 */
export function pageSettledOf(state: DataState): boolean {
  return state.status === 'ready';
}

/**
 * Whether a result measured `measured` reads as another page load than
 * `current`. An unknown load on either side proves nothing, so it never
 * reads as another load.
 *
 * @param measured The load the result measured (null when unknown).
 * @param current The load the page is on now (null when unknown).
 * @returns True when both are known and differ.
 */
export function isOtherLoad(measured: string | null, current: string | null): boolean {
  return measured !== null && current !== null && measured !== current;
}

/**
 * The page load an answer is stamped with. An ask that starts while the
 * shell refetches is answered by the page that refetch reads, so its stamp
 * is provisional until the shell settles; until then it proves nothing.
 */
export interface LoadStamp {
  /** The load measured (null when unknown or still provisional). */
  readonly page: string | null;
  /** The ask started mid-refetch: the load is the one the shell settles on. */
  readonly provisional: boolean;
}

/**
 * Stamp an ask as it starts.
 *
 * @param id The shell's identity now.
 * @param settled Whether that identity is current ({@link pageSettledOf}).
 * @returns A settled stamp, or a provisional one (page null) mid-refetch.
 */
export function stampAsk(id: string | null, settled: boolean): LoadStamp {
  return settled ? { page: id, provisional: false } : { page: null, provisional: true };
}

/**
 * Fix a provisional stamp once the shell settles; a settled stamp never
 * moves (later loads must read as other loads).
 *
 * @param stamp The stamp so far.
 * @param id The shell's identity now.
 * @param settled Whether that identity is current.
 * @returns The stamp, settled on `id` when it was provisional and the shell is settled.
 */
export function settleStamp(stamp: LoadStamp, id: string | null, settled: boolean): LoadStamp {
  return stamp.provisional && settled ? { page: id, provisional: false } : stamp;
}
