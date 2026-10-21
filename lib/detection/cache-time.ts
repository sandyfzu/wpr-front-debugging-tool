/**
 * Page-derived timestamps: the one home of the representability guard and the
 * absolute UTC form every cache/stamp surface prints. Keeping these here (not
 * in the page-analysis report) lets the cache-state vocabulary and the report
 * share them without an import cycle.
 */

import { MAX_CACHE_STAMP_SECONDS } from '../wp-rocket/constants';

/**
 * The largest instant `new Date`/`toISOString` can represent (ECMA-262's
 * ± 100,000,000 days from the epoch, in ms). A page-derived stamp beyond it
 * is not a time, only a crash waiting for `toISOString` — callers see null.
 *
 * This remains the ceiling for machine stamps carried by the messaging
 * boundary (cookie capture times, header inventory); the cache display
 * contract is narrower — see {@link MAX_CACHE_STAMP_SECONDS}.
 */
export const MAX_REPRESENTABLE_MS = 8.64e15;

/**
 * Whether a page-derived epoch-seconds stamp is in the cache display domain:
 * a non-negative safe integer no later than 9999-12-31 23:59:59 UTC. The
 * concept's one home: the formatter consumes this answer and callers that
 * matter-gate on the stamp (a relative age beside it) gate on it too, so a
 * wild page-crafted digit run renders as an unstamped cache — never as a
 * made-up countdown beside a missing stamp.
 *
 * @param seconds The stamp to judge (null is simply absent).
 */
export function isRepresentableCacheStamp(seconds: number | null): seconds is number {
  return (
    seconds !== null &&
    Number.isInteger(seconds) &&
    seconds >= 0 &&
    seconds <= MAX_CACHE_STAMP_SECONDS
  );
}

/**
 * Format the cache timestamp: UTC-stamped and locale-independent, so the same
 * support conversation reads identically on every contributor's console.
 *
 * The stamp is page-derived text through and through (the debug comment the
 * engine parses), so it is gated by {@link isRepresentableCacheStamp}: the
 * output is always exactly `YYYY-MM-DD HH:MM:SS UTC` with a four-digit year,
 * or null. No slice of an expanded ISO year can leak malformed text.
 *
 * @param seconds The debug comment's epoch seconds, or null when absent.
 * @returns `YYYY-MM-DD HH:MM:SS UTC`, or null outside the display domain.
 */
export function formatCacheTimestamp(seconds: number | null): string | null {
  if (!isRepresentableCacheStamp(seconds)) return null;
  return new Date(seconds * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
}

/**
 * Whether a wall-clock millisecond stamp names a real, representable instant
 * (finite, within the platform date range). The millisecond twin of the
 * platform boundary: a caller that shows one must degrade to "no stamp" for a
 * wild value — never construct a garbage `Date`.
 *
 * @param ms The stamp to judge.
 */
export function isRepresentableStampMs(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_REPRESENTABLE_MS;
}

/**
 * Format a wall-clock millisecond stamp in the panel's absolute UTC form —
 * the one spelling the status bar's freshness detail and the header
 * inventory's Fetched/Captured stamps share, so two surfaces never disagree
 * about one instant. Same guard family as {@link formatCacheTimestamp}: a
 * stamp that names no representable instant renders as its absence (null) —
 * never a made-up time beside a missing one — and the whole-second rounding
 * is declared here, not re-derived per consumer.
 *
 * @param ms The stamp (epoch milliseconds).
 * @returns `YYYY-MM-DD HH:MM:SS UTC`, or null for a stamp that names no
 *   representable instant (including the platform's expanded-year edges).
 */
export function absoluteStampFromMs(ms: number): string | null {
  if (!isRepresentableStampMs(ms)) return null;
  return formatCacheTimestamp(Math.round(ms / 1000));
}
