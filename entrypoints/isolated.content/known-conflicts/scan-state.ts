/**
 * Scan-state decisions for the Known Conflicts widget: accumulate findings
 * across a page's scan passes (HelpScout conversations load messages lazily,
 * and conflict mentions may appear long after the first pass), clear them
 * only when the surface changes (a different ticket is a different scan),
 * and arbitrate what the widget shows — the DB verdict, the loading copy and
 * the empty state — through named rules both the owner module and the view
 * call, so no render path can contradict the state machine.
 */

import type { KnownConflict } from '../../../lib/storage/known-conflicts';

/**
 * Which surface a scan pass is running against (the modes `extract` detects).
 */
export type ScanSurfaceMode = 'helpscout' | 'wp-admin';

/**
 * Whether the database bootstrap produced a usable verdict: an array with at
 * least one row. Zero rows keep the loading state — an unserved DB is not a
 * scan verdict, so neither the badge count nor the empty state may act on it
 * — and a structurally unusable value (`null`, a partial write's non-array)
 * counts as "not served" the same way.
 *
 * @param rows What the DB bootstrap resolved with.
 * @returns `true` only for a loaded, non-empty row set.
 */
export function dbRowsUsable(rows: unknown): boolean {
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Merge one scan's results into the accumulated rows: DB order preserved
 * overall (existing rows stay in front), a row appears at most once, keyed
 * by `id` (the DB's stable row identity; duplicate names with distinct ids
 * are distinct rows).
 *
 * @param accumulated Rows found so far on this page state.
 * @param found This pass's rows (DB order).
 * @returns The merged row list, first-seen order first.
 */
export function mergeFindings(
  accumulated: readonly KnownConflict[],
  found: readonly KnownConflict[]
): readonly KnownConflict[] {
  const seen = new Set(accumulated.map((row) => row.id));
  return [...accumulated, ...found.filter((row) => !seen.has(row.id))];
}

/**
 * Whether this surface's pass flow has closed, so a zero-finding pass may
 * show the empty state as final.
 *
 * A HelpScout pass settles on completion (the rescan keeps refreshing the
 * same conversation); the plugins screen settles only once its bounded late
 * pass has RUN — settling it when the pass is merely scheduled would let a
 * database write arriving in that window render the empty state as final
 * before the late pass had its chance.
 *
 * @param mode The surface the pass ran against.
 * @param latePassRan Whether the plugins screen's late pass has completed.
 * @returns `true` when the surface has no more passes pending.
 */
export function passSettled(mode: ScanSurfaceMode, latePassRan: boolean): boolean {
  return mode === 'helpscout' || latePassRan;
}

/**
 * Whether the empty state may render after a completed pass.
 *
 * `settled` is the pass-flow verdict from {@link passSettled}; `dbLoading`
 * gates the whole decision while the database is still being resolved — a
 * scan over an unserved DB finds nothing and that is not a scan verdict, so
 * "no conflicts" may never render over a missing database.
 *
 * @param findings The accumulated rows.
 * @param settled Whether this surface's pass flow has closed (`passSettled`,
 *   or the already-stored verdict flag when re-deriving in the view).
 * @param dbLoading Whether the DB is still being resolved (the loading state).
 * @returns `true` only when zero findings are legitimately final.
 */
export function emptyStateVisible(
  findings: readonly unknown[],
  settled: boolean,
  dbLoading: boolean
): boolean {
  return findings.length === 0 && settled && !dbLoading;
}

/**
 * Whether the list panel shows the loading copy instead of scan content:
 * the DB is still resolving and nothing competes with it yet — first
 * findings outrank the loading copy the moment they exist.
 *
 * @param dbLoading Whether the DB is still being resolved (the loading state).
 * @param findings The accumulated rows.
 */
export function loadingCopyVisible(dbLoading: boolean, findings: readonly unknown[]): boolean {
  return dbLoading && findings.length === 0;
}

/**
 * Whether a URL change means the scan surface itself changed (a fresh
 * ticket/screen). Compared on the pathname, like the surface's navigation —
 * query changes within one conversation re-scan without clearing, a real
 * conversation switch clears.
 *
 * @param previousPathname The pathname running up to this pass.
 * @param pathname The pathname this pass runs against.
 */
export function surfaceChanged(previousPathname: string, pathname: string): boolean {
  return previousPathname !== pathname;
}

/**
 * What the floating marker expresses, from the scan state alone:
 *
 * - `alert` — findings exist (the module's reason to exist: show their count
 *   in the status-error vocabulary);
 * - `clear` — a usable DB answered and the surface scanned empty: the zero
 *   state is a good result, shown calm;
 * - `pending` — the DB is still resolving, so no verdict exists (the marker
 *   pulses; a zero count here would read as a false all-clear).
 *
 * @param findings The accumulated rows.
 * @param dbLoading Whether the DB is still being resolved (the loading state).
 */
export function markerMood(
  findings: readonly unknown[],
  dbLoading: boolean
): 'alert' | 'clear' | 'pending' {
  if (findings.length > 0) return 'alert';
  return dbLoading ? 'pending' : 'clear';
}
