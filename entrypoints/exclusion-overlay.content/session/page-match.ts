/**
 * Whether the session's recorded document is the page the overlay is
 * looking at. The record never holds the raw URL — only a SHA-256 digest of
 * it without its fragment — so the overlay hashes its own addresses the
 * same way and compares. A navigation the session did not intercept (a
 * cached or prefetched load, a reload that bypassed it) leaves an older
 * record, which must read as "not intercepted", never as applied.
 */
import type { ExclusionServedDocument } from '../../../lib/messaging/exclusion-session';
import { parseUrl } from '../../../utils/urls';
import { sha256Hex } from '../../../utils/sha256';

/**
 * - `this-page` — the record is this document's.
 * - `other-page` — the record is another document's: this one was not
 *   intercepted.
 * - `cant-tell` — no verdict is honest (no identity in the record, the
 *   page's own document URL unknown after a history-API address change, or
 *   a matching record older than this document).
 */
export type PageMatch = 'this-page' | 'other-page' | 'cant-tell';

/** The page facts the comparison reads (from `location` and the Performance API). */
export interface PageFacts {
  /** `location.href` now (may have moved by `history.pushState`/`replaceState`). */
  readonly href: string;
  /**
   * The document's own URL — the navigation timing entry's `name`, which
   * history-API address changes do not touch; `null` when unavailable.
   */
  readonly documentUrl: string | null;
  /** `performance.timeOrigin`: epoch ms the navigation to this document started. */
  readonly timeOrigin: number;
}

/**
 * How much earlier than this document's navigation start a matching record
 * may have been received and still be trusted as this document's: the
 * background's and the page's clocks are separate monotonic clocks anchored
 * to the wall clock, so a small skew is expected. A record received further
 * back is a previous load of the same URL.
 */
export const RECORD_CLOCK_SKEW_MS = 2_000;

/**
 * The record digest of a URL: lowercase hex SHA-256 of its UTF-8
 * serialization with the fragment removed (the session's served-document
 * contract).
 *
 * @param href An absolute URL.
 * @returns The digest, or null when `href` is not an absolute URL.
 */
export function documentDigest(href: string): string | null {
  const parsed = parseUrl(href);
  if (parsed === null) return null;
  parsed.hash = '';
  return sha256Hex(parsed.href);
}

/**
 * Compare the recorded served document with this page.
 *
 * @param served The record's identity (absent when the backend gave none).
 * @param page This page's facts.
 * @returns The verdict (see {@link PageMatch}).
 */
export function matchServedDocument(
  served: ExclusionServedDocument | undefined,
  page: PageFacts
): PageMatch {
  if (served === undefined) return 'cant-tell';
  const documentAddress = page.documentUrl === null ? null : documentDigest(page.documentUrl);
  const matches =
    served.urlDigest === documentDigest(page.href) || served.urlDigest === documentAddress;
  if (matches) {
    return served.receivedAt < page.timeOrigin - RECORD_CLOCK_SKEW_MS ? 'cant-tell' : 'this-page';
  }
  // The document's own address is known and differs: the record is another
  // document's. Unknown, the mismatch may only be a history-API move.
  return documentAddress === null ? 'cant-tell' : 'other-page';
}
