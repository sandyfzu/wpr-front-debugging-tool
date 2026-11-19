/**
 * Relative-age formatting for the extension's freshness surfaces — the
 * panel's top bar and the options page's Known Conflicts row today; one
 * shared formatter, never per-surface copies.
 *
 * One pure bucket function — no `Intl`, no live clock inside — so the same
 * age reads identically in every locale and is trivially testable. Buckets
 * round DOWN: a displayed age never overstates how fresh the data is.
 */

/**
 * The elapsed range that reads "just now".
 *
 * Sub-five-second ages would render as a "0 s ago"-style flicker while the
 * data is in fact current; the words carry that state better than a number.
 */
export const JUST_NOW_MAX_MS = 5_000;

/**
 * Format an elapsed time as the user-facing relative age.
 *
 * Buckets (each rounds down): `< 5 s` → "just now"; `< 1 min` → seconds;
 * `< 1 h` → minutes; `< 1 day` → hours; otherwise days.
 *
 * @param elapsedMs The elapsed time (now − timestamp). Negative values (a
 *   future stamp — clock skew between the stamp's source and the reader,
 *   e.g. a server-set cache time) clamp to "just now": the age is at most
 *   zero, never a countdown.
 * @returns `just now`, `N s ago`, `N min ago`, `N h ago`, or `N d ago`.
 * @throws {@link RangeError} on a non-finite duration (a broken stamp can
 *   only come from a misconfigured wall clock — fail loud, never render a
 *   fabricated age).
 */
export function relativeAge(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs)) {
    throw new RangeError(`relativeAge: non-finite duration ${String(elapsedMs)}`);
  }
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < JUST_NOW_MAX_MS) return 'just now';
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1_000).toString()} s ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000).toString()} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000).toString()} h ago`;
  return `${Math.floor(elapsed / 86_400_000).toString()} d ago`;
}
