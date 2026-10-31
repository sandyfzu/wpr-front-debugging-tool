/**
 * WordPress admin and login screens: WP Rocket never optimizes them, so a
 * simulation there shows something the site never serves. The rule reads
 * the URL's path only — `/wp-admin` at any depth (subdirectory installs:
 * `/blog/wp-admin/`) or a final `wp-login.php` — and never its query or
 * fragment (`?redirect_to=/wp-admin/` is a front-end page). A login URL a
 * plugin renamed is indistinguishable from any page and is not claimed.
 */

/** The admin directory segment (any depth). */
const ADMIN_SEGMENT = 'wp-admin';

/** The login script (last non-empty segment only: `/wp-login.php/` still serves it). */
const LOGIN_SEGMENT = 'wp-login.php';

/**
 * Percent-decode one path segment; a malformed escape keeps the raw text
 * (a URL the browser accepted is still read, never thrown on).
 *
 * @param segment One raw path segment.
 */
function decodedSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed escape (`%zz`) is not an encoded name: compare it as written.
    return segment;
  }
}

/**
 * Whether a URL is a WordPress admin or login screen.
 *
 * @param url The page URL (absolute).
 * @returns True when a path segment is `wp-admin` or the last non-empty one
 *   is `wp-login.php` (percent-decoded, ASCII case-insensitive); false for an
 *   invalid URL.
 */
export function isWordPressAdminScreen(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Not a URL: nothing to warn about.
    return false;
  }
  const segments = pathname.split('/').map((segment) => decodedSegment(segment).toLowerCase());
  const named = segments.filter((segment) => segment !== '');
  return named.includes(ADMIN_SEGMENT) || named[named.length - 1] === LOGIN_SEGMENT;
}
