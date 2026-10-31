/**
 * Which byte measure a simulation counts a served page's text with — WP
 * Rocket's passes run over the served bytes (PCRE without UTF), and the
 * engine's row matchers read a subject as its UTF-8 bytes. Only pages whose
 * bytes those two views reproduce exactly are simulated:
 *
 * - UTF-8 (BOM or not; WordPress's default `blog_charset`, and the bytes
 *   assumed when the session did not say) — exact;
 * - any other charset the session decodes, when the text is all ASCII —
 *   every such charset but UTF-16 writes ASCII as the same single bytes, so
 *   the bytes are the UTF-8 ones;
 * - anything else (non-ASCII text in another charset, whose characters'
 *   bytes the row matchers would misread; UTF-16, where even ASCII is two
 *   bytes) — none: the step reports `unsupported-charset` instead of an
 *   output that might differ from WP Rocket's.
 */
import type { DocumentBytes } from '../exclusion-builder/libxml/charset';
import { isUtf16Encoding } from '../exclusion-session/charset';
import { UTF8_MEASURE, type ByteMeasure } from './utf8';

/** Any UTF-16 code unit outside ASCII. */
const NON_ASCII_UNIT = /[^\u0000-\u007f]/;

/**
 * The measure to simulate a served page with.
 *
 * @param bytes How the session decoded the page (absent: UTF-8, no BOM).
 * @param html The decoded text.
 * @returns The UTF-8 measure, or null when the page's bytes cannot be
 *   counted exactly (see the module doc).
 */
export function servedByteMeasure(
  bytes: DocumentBytes | undefined,
  html: string
): ByteMeasure | null {
  const encoding = bytes?.encoding ?? 'utf-8';
  if (encoding === 'utf-8') return UTF8_MEASURE;
  if (isUtf16Encoding(encoding)) return null;
  return NON_ASCII_UNIT.test(html) ? null : UTF8_MEASURE;
}
