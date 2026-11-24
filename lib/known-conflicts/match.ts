/**
 * Known-conflict lookup over page text or plugin paths.
 *
 * Two modes, matching how each surface collects text:
 * - `helpscout` — ticket tables are free-form prose; a conflict name matches
 *   when it appears as a whole "word group" preceded by start-of-text or
 *   `"- "` and followed by end-of-text or `" -"` (built as a regex). Names
 *   containing regex metacharacters are escaped when interpolating: the raw
 *   interpolation would silently never match them (a name like `C++` even
 *   throws on some engines) — real DB rows exist for both cases.
 * - `wp-admin` — plugin rows concatenate into compact text; a lowercase
 *   `includes` is enough there and is what the mode always did.
 */

import type { KnownConflict } from '../storage/known-conflicts';
import { escapeRegex } from '../../utils/regex';

/** Text-collection strategy the caller has already applied. */
export type KnownConflictsMode = 'helpscout' | 'wp-admin';

/** Small scan text; every query runs below this size per call anyway. */
const MAX_TEXT_LENGTH = 2_000_000;

/**
 * Find conflicts whose name occurs in `allText` in the mode's sense.
 *
 * Matching is host-locale casefolding (`toLocaleLowerCase` on both sides —
 * exactly like the surfaces' own comparisons, as in the reference behavior);
 * rows without a usable name and url are skipped everywhere, as are rows of
 * the wrong shape entirely (corrupt storage never crashes the scan).
 * Uniqueness: an entry can match once per call. Returned rows carry their
 * name trimmed: server rows can start with a no-break space (a real row
 * does), which would otherwise indent the name on screen.
 *
 * @param allText Combined scan text (already concatenated by the caller).
 * @param db The conflict rows as read from storage — untyped deliberately:
 *   corrupt rows are a runtime reality, not a compile-time one.
 * @param mode Which surface's matching semantics to apply.
 * @returns Matching rows in DB order (copies, name trimmed).
 */
export function findKnownConflicts(
  allText: string,
  db: readonly unknown[],
  mode: KnownConflictsMode
): KnownConflict[] {
  // Upper bound defends against absurd callers; a two-million-char scan is
  // already far beyond any DOM text this tool looks at.
  const haystack = (allText.length > MAX_TEXT_LENGTH ? allText.slice(0, MAX_TEXT_LENGTH) : allText)
    .trim()
    .toLocaleLowerCase();
  const results: KnownConflict[] = [];
  for (const conflict of db) {
    if (typeof conflict !== 'object' || conflict === null) continue;
    const { name: rawName, url: rawUrl } = conflict as { name: unknown; url: unknown };
    if (typeof rawName !== 'string' || typeof rawUrl !== 'string') continue;
    const shownName = rawName.trim();
    const name = shownName.toLocaleLowerCase();
    if (name === '' || rawUrl === '') continue;
    const matched =
      mode === 'helpscout'
        ? new RegExp(`(^|- )(${escapeRegex(name)})($| -)`).test(haystack)
        : haystack.includes(name);
    if (matched) results.push({ ...(conflict as KnownConflict), name: shownName });
  }
  return results;
}
