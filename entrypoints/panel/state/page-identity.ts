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
