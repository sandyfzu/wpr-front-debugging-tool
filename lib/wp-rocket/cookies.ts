/**
 * The captured-cookie contract: what the capture pass may take off the page
 * and cross the extension boundary. Only cookie **names** are evidence about
 * the cache state the Headers & Cookies tooling reads (`wprocket` ..., the
 * a11y ones the plugin manages); values can carry auth tokens and session
 * ids, so they are never read at all — the parser below never even splits
 * them out into a variable, the types carry no value field, and a regression
 * test asserts nothing of the raw `document.cookie` string survives.
 *
 * Both directions of the boundary share this module: the content script's
 * capture calls {@link sampleCookieNames}, the messaging validator
 * (`parsePageCookies`) re-checks the payload shape against the same caps, so
 * a capture side and a receive side can never drift apart.
 */

/**
 * The caps shared by capture and validation. Generous by design: browsers
 * keep far fewer than 256 cookies per document and clamp cookie records to
 * ~4 KiB, so the caps are a hostile-input ceiling, not a page reality. They
 * belong to the contract here so a capture side that clips never emits a
 * payload the validation side would reject.
 */
export const COOKIE_NAME_LIMITS = {
  /** At most this many names cross the boundary. */
  count: 256,
  /** Each name is bounded in characters. */
  name: 512
} as const;

/**
 * Read the cookie **names** out of a `document.cookie` string, values cut
 * loose before they are ever materialized.
 *
 * Parsing rules: pairs are separated by `;`; a name is the `=`-before part
 * (the first `=` only — a name never contains `=`, a value may); pairs
 * without `=` or with an empty name are not cookie evidence and are skipped;
 * whitespace the separator introduced is trimmed; the first occurrence
 * wins (path-scoped duplicates of one name exist on real pages and say
 * the same thing twice). Names beyond {@link COOKIE_NAME_LIMITS.count} or
 * {@link COOKIE_NAME_LIMITS.name} are clipped/dropped — the browser's own
 * fourth-KiB-per-cookie clamp makes this unreachable on honest pages, and
 * losing a hostile entry beats rejecting a whole page's data over it (see
 * the same trade the error-word cap made at its capture side).
 *
 * Because the payload carries the **clipped** name, the dedupe key is the
 * clipped value too: two over-cap names sharing a 512-char prefix are one
 * payload name (first occurrence wins), keeping the list unique — the
 * uniqueness the {@link PageCookies} contract states.
 *
 * @param documentCookie The `document.cookie` string of the captured page.
 * @returns The unique name list, first-occurrence order, values discarded.
 */
export function sampleCookieNames(documentCookie: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const rawPair of documentCookie.split(';')) {
    // The value starts after the first `=`; it is deliberately not read.
    const eq = rawPair.indexOf('=');
    if (eq < 1) continue;
    const full = rawPair.slice(0, eq).trim();
    if (full.length === 0) continue;
    // The clip happens first, then the dedupe: what is emitted is what is
    // deduped, so a clip collision can never emit the same name twice.
    const name =
      full.length > COOKIE_NAME_LIMITS.name ? full.slice(0, COOKIE_NAME_LIMITS.name) : full;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names.length > COOKIE_NAME_LIMITS.count ? names.slice(0, COOKIE_NAME_LIMITS.count) : names;
}
