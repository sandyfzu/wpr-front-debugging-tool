/**
 * How libxml's HTML parser (PHP `DOMDocument::loadHTML`) turns a served
 * page's bytes into characters, rebuilt from the engine's decoded text plus
 * how the session decoded it — measured on libxml 2.9.13: the first `<meta>`
 * declaring a charset decides, unless a non-ASCII byte comes before it (libxml
 * then stays on Latin-1); no declaration means Latin-1; a leading UTF-8 BOM
 * means UTF-8.
 */
import { parseTagAt, type ScannedTag } from '../html-scan';
import { findAttribute } from '../tag-edit';

/** How the session decoded the page: its WHATWG encoding name, and whether a BOM led the bytes. */
export interface DocumentBytes {
  readonly encoding: string;
  readonly bom: boolean;
}

/**
 * The bytes assumed when the caller does not say: UTF-8 without a BOM —
 * WordPress's default `blog_charset`.
 */
export const DEFAULT_DOCUMENT_BYTES: DocumentBytes = { encoding: 'utf-8', bom: false };

/**
 * How libxml's characters relate to the engine's text:
 * - `utf-8` — the same characters;
 * - `latin-1-of-utf-8` — UTF-8 bytes read as Latin-1 (every byte one character: `é` → `Ã©`);
 * - `latin-1` — single-byte bytes read as Latin-1 (the same characters while all are ≤ U+00FF);
 * - `unknown` — a combination this module does not model (non-ASCII text is not reproducible).
 */
export type LibxmlTextMode = 'utf-8' | 'latin-1-of-utf-8' | 'latin-1' | 'unknown';

/** What a page's `<meta>` declarations make libxml read. */
type Declared = 'utf-8' | 'latin-1' | 'unknown';

/** Any character outside ASCII (one UTF-16 code unit at a time). */
export const NON_ASCII = /[\u0080-￿]/;

/** A charset label inside a `<meta>`'s `content` attribute. */
const CONTENT_CHARSET = /charset\s*=\s*["']?([^\s;"']+)/i;

/** Labels of UTF-8, and of ISO-8859-1, as libxml reads them. */
const UTF8_LABELS: ReadonlySet<string> = new Set(['utf-8', 'utf8']);
const LATIN1_LABELS: ReadonlySet<string> = new Set(['iso-8859-1', 'latin1', 'iso8859-1']);

/** The single-byte encoding the session decodes Latin-1 labels with (WHATWG). */
const SINGLE_BYTE_ENCODING = 'windows-1252';

/**
 * The charset label one `<meta>` declares, or `null`: its `charset`
 * attribute, or `http-equiv="Content-Type"` with a `charset=` in `content`.
 *
 * @param tagText The meta tag's text.
 */
function metaCharsetLabel(tagText: string): string | null {
  const tag = parseTagAt(tagText, 0);
  const charset = findAttribute(tag, 'charset')?.value;
  if (charset !== undefined && charset !== null) return charset.trim().toLowerCase();
  const httpEquiv = findAttribute(tag, 'http-equiv')?.value?.trim().toLowerCase();
  if (httpEquiv !== 'content-type') return null;
  const content = findAttribute(tag, 'content')?.value ?? '';
  return CONTENT_CHARSET.exec(content)?.[1]?.toLowerCase() ?? null;
}

/**
 * What the page's own declarations make libxml read (measured).
 *
 * @param html The page text.
 * @param tags The page's opening tags.
 */
function declaredCharset(html: string, tags: readonly ScannedTag[]): Declared {
  for (const tag of tags) {
    if (tag.name !== 'meta') continue;
    const label = metaCharsetLabel(html.slice(tag.start, tag.openingEnd));
    if (label === null) continue;
    if (NON_ASCII.test(html.slice(0, tag.start))) return 'latin-1';
    if (UTF8_LABELS.has(label)) return 'utf-8';
    return LATIN1_LABELS.has(label) ? 'latin-1' : 'unknown';
  }
  return 'latin-1';
}

/**
 * How libxml's characters relate to the engine's text for one page.
 *
 * @param html The page text (as the session decoded it).
 * @param tags The page's opening tags (`scanTags` / `scanTokens` output).
 * @param bytes How the session decoded the bytes ({@link DEFAULT_DOCUMENT_BYTES} when unknown).
 */
export function libxmlTextMode(
  html: string,
  tags: readonly ScannedTag[],
  bytes: DocumentBytes = DEFAULT_DOCUMENT_BYTES
): LibxmlTextMode {
  const encoding = bytes.encoding.toLowerCase();
  if (bytes.bom) return encoding === 'utf-8' ? 'utf-8' : 'unknown';
  const declared = declaredCharset(html, tags);
  if (declared === 'unknown') return 'unknown';
  if (encoding === 'utf-8') return declared === 'utf-8' ? 'utf-8' : 'latin-1-of-utf-8';
  return declared === 'latin-1' && encoding === SINGLE_BYTE_ENCODING ? 'latin-1' : 'unknown';
}

/**
 * The characters libxml reads for a piece of the engine's text, or `null`
 * when they cannot be rebuilt.
 *
 * @param text Engine text (one tag).
 * @param mode The page's {@link LibxmlTextMode}.
 */
export function libxmlCharacters(text: string, mode: LibxmlTextMode): string | null {
  if (!NON_ASCII.test(text)) return text;
  switch (mode) {
    case 'utf-8':
      return text;
    case 'latin-1-of-utf-8': {
      let out = '';
      for (const byte of new TextEncoder().encode(text)) out += String.fromCharCode(byte);
      return out;
    }
    case 'latin-1':
      // windows-1252 decoded these bytes: a character above U+00FF came from 0x80–0x9F.
      return /[Ā-￿]/.test(text) ? null : text;
    case 'unknown':
      return null;
  }
}
