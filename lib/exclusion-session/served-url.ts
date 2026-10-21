/**
 * The two URL facts a served-document identity keeps — never the URL's
 * query or fragment (they may carry personal data): its origin + path, and
 * a SHA-256 digest of the whole URL so a surface holding the page's own
 * `location.href` can still tell whether the record is for that page.
 */
import { SERVED_DOCUMENT_LIMITS } from '../messaging/exclusion-session';
import { parseUrl } from '../../utils/urls';

/** A document URL reduced to what a record may hold. */
export interface ServedUrl {
  /** Origin + path (cut at `SERVED_DOCUMENT_LIMITS.urlPathChars`). */
  readonly urlPath: string;
  /** SHA-256 of the URL without its fragment, lowercase hex. */
  readonly urlDigest: string;
}

/** Lowercase hex of bytes. */
function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Reduce a document URL to its record form. The digest is over the URL as
 * the platform serializes it, fragment removed — the same string a page
 * gets from `location.href` without its `#…` part.
 *
 * @param url The document's absolute URL.
 * @returns The record form, or null when `url` is not an absolute URL.
 */
export async function servedUrl(url: string): Promise<ServedUrl | null> {
  const parsed = parseUrl(url);
  if (parsed === null) return null;
  parsed.hash = '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parsed.href));
  return {
    urlPath: `${parsed.origin}${parsed.pathname}`.slice(0, SERVED_DOCUMENT_LIMITS.urlPathChars),
    urlDigest: hex(digest)
  };
}
