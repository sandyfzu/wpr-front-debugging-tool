/**
 * What a served minified-asset URL can still tell about the script it
 * delivered. Per-file Minify mirrors the original URL path into the cache URL
 * (`cache/min/<site-id>/<original-path>` — the cache filename is the original
 * path, `ltrim`-ed), so the original path stays recoverable text: an
 * exclusion written from it matches both the minified tag and the plain one
 * (minify off), and rides the path rather than any `?ver=` cache stamp.
 * Combined bundles name their file only by an md5 digest of the content —
 * nothing recoverable. The classifier is pure and conservative: it never
 * decodes the remainder and never invents a host.
 */

import { MINIFY_CACHE_DIR_SOURCE } from './constants';

/**
 * The minified-URL shape with both variable parts captured: group 1 is the
 * URL part before the FIRST `cache/min/<site-id>/` (lazy, so a remainder that
 * itself contains the shape is stripped once, never re-stripped) and group 2
 * is the mirrored remainder in full, still percent-encoded exactly as served.
 */
const MINIFY_CACHE_URL_RECOVERY_PATTERN = new RegExp(`^(.*?)${MINIFY_CACHE_DIR_SOURCE}(.*)$`);

/** The `.js` suffix a served script URL must end in, case-insensitively. */
const JS_SUFFIX_PATTERN = /\.js$/i;

/**
 * A combined bundle's filename is bare `md5(content…).js` — 32 hex digits,
 * no directory. Per-file minified originals always carry a path.
 */
const COMBINED_FILENAME_PATTERN = /^[0-9a-f]{32}\.js$/i;

/**
 * Default-WP path prefixes that make a mirrored original site-local. Custom
 * content-dir installs (and mirrored remote paths) start elsewhere — their
 * host is genuinely unknown from the URL alone.
 */
const SITE_LOCAL_PATH_PREFIXES = ['wp-content/', 'wp-includes/'] as const;

/** What a served script URL reveals about the code it delivered. */
export type MinifiedUrlRecovery =
  | {
      /** Per-file Minify mirrored the original URL path into the cache URL. */
      kind: 'original';
      /** The original URL path exactly as mirrored — percent-runs preserved, query ignored. */
      originalPath: string;
      /**
       * `site` — the remainder sits under the default WP layout, so the
       * pattern can be built from the inspected page's own origin; `unknown`
       * — the true host (remote mirror, custom content dir) must come from a
       * bypass map, never from this URL.
       */
      hostKnown: 'site' | 'unknown';
    }
  | {
      /** Combined bundle: the URL carries no original path — per-file exclusion is unavailable. */
      kind: 'combined';
    }
  | {
      /** No minify-cache shape: local `.min.js` files Minify skips, non-JS paths, non-http(s) or unparseable input. */
      kind: 'untouched';
    };

/**
 * Classifies a served script URL and recovers the original path when the URL carries it.
 *
 * Expected misfits are results, not errors: anything that is not an http(s)
 * URL under the minify-cache shape classifies `untouched` (or `combined` for
 * the digest filename), so callers can always build a copy payload from the
 * verdict.
 *
 * @param url Served script URL — absolute http(s); anything else classifies untouched.
 * @returns The recovery verdict — see {@link MinifiedUrlRecovery}.
 */
export function recoverOriginalScript(url: string): MinifiedUrlRecovery {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'untouched' };
  }
  // Only http(s) traverses the minify cache; other schemes (data:, javascript:) cannot.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'untouched' };
  }

  const match = parsed.pathname.match(MINIFY_CACHE_URL_RECOVERY_PATTERN);
  const remainder = match?.[2];
  if (!remainder || !JS_SUFFIX_PATTERN.test(remainder)) {
    return { kind: 'untouched' };
  }
  if (COMBINED_FILENAME_PATTERN.test(remainder)) {
    return { kind: 'combined' };
  }
  return {
    kind: 'original',
    originalPath: remainder,
    hostKnown: SITE_LOCAL_PATH_PREFIXES.some((prefix) => remainder.startsWith(prefix))
      ? 'site'
      : 'unknown'
  };
}
