/**
 * How libxml's HTML parser (PHP `DOMDocument::loadHTML`) turns a served
 * page's bytes into characters, rebuilt from the engine's decoded text plus
 * how the session decoded it — measured on libxml 2.9.13. libxml starts in
 * Latin-1 (UTF-8 after a UTF-8 BOM) and switches at the first `<meta>`
 * declaring a charset, for the text after it:
 * - without a BOM, to the declared charset, unless a non-ASCII byte came
 *   before the declaration (it then stays on Latin-1);
 * - after a BOM, to Latin-1 for an ISO-8859-1 / windows-1252 declaration
 *   (non-ASCII before it or not), else it stays on UTF-8.
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

/** A page's text modes: one before the switching `<meta>`, one from it on. */
export interface LibxmlTextModes {
  /** Offset of the switching `<meta>` (the page length when none switches). */
  readonly switchAt: number;
  readonly before: LibxmlTextMode;
  readonly after: LibxmlTextMode;
}

/** Any character outside ASCII (one UTF-16 code unit at a time). */
export const NON_ASCII = /[\u0080-\uffff]/;

/** A character windows-1252 decoded from 0x80–0x9F (above U+00FF). */
const ABOVE_LATIN1 = /[\u0100-\uffff]/;

/** A charset label inside a `<meta>`'s `content` attribute. */
const CONTENT_CHARSET = /charset\s*=\s*["']?([^\s;"']+)/i;

/** Labels of UTF-8, of ISO-8859-1, and of windows-1252, as libxml reads them. */
const UTF8_LABELS: ReadonlySet<string> = new Set(['utf-8', 'utf8']);
const LATIN1_LABELS: ReadonlySet<string> = new Set(['iso-8859-1', 'latin1', 'iso8859-1']);
const WINDOWS_1252_LABELS: ReadonlySet<string> = new Set(['windows-1252', 'cp1252']);

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
 * The first `<meta>` declaring a charset: its offset and label.
 *
 * @param html The page text.
 * @param tags The page's opening tags.
 */
function firstDeclaration(
  html: string,
  tags: readonly ScannedTag[]
): { readonly at: number; readonly label: string } | null {
  for (const tag of tags) {
    if (tag.name !== 'meta') continue;
    const label = metaCharsetLabel(html.slice(tag.start, tag.openingEnd));
    if (label !== null) return { at: tag.start, label };
  }
  return null;
}

/**
 * The mode after a declaration on a page without a BOM (measured).
 *
 * @param label The declared label.
 * @param encoding The session's encoding (lowercased).
 */
function declaredMode(label: string, encoding: string): LibxmlTextMode {
  if (encoding === 'utf-8') {
    if (UTF8_LABELS.has(label)) return 'utf-8';
    return LATIN1_LABELS.has(label) ? 'latin-1-of-utf-8' : 'unknown';
  }
  return encoding === SINGLE_BYTE_ENCODING && LATIN1_LABELS.has(label) ? 'latin-1' : 'unknown';
}

/**
 * The mode after a declaration on a UTF-8 BOM page (measured: Latin-1
 * labels switch, UTF-8 and unrecognized ones keep UTF-8).
 *
 * @param label The declared label.
 */
function declaredModeAfterBom(label: string): LibxmlTextMode {
  if (LATIN1_LABELS.has(label)) return 'latin-1-of-utf-8';
  // windows-1252 reads UTF-8's 0x80–0x9F continuation bytes differently from Latin-1.
  return WINDOWS_1252_LABELS.has(label) ? 'unknown' : 'utf-8';
}

/**
 * How libxml's characters relate to the engine's text, before and after
 * the page's charset declaration.
 *
 * @param html The page text (as the session decoded it).
 * @param tags The page's opening tags (`scanTags` / `scanTokens` output).
 * @param bytes How the session decoded the bytes ({@link DEFAULT_DOCUMENT_BYTES} when unknown).
 */
export function libxmlTextModes(
  html: string,
  tags: readonly ScannedTag[],
  bytes: DocumentBytes = DEFAULT_DOCUMENT_BYTES
): LibxmlTextModes {
  const encoding = bytes.encoding.toLowerCase();
  const declaration = firstDeclaration(html, tags);
  const switchAt = declaration?.at ?? html.length;
  if (bytes.bom) {
    if (encoding !== 'utf-8') return { switchAt, before: 'unknown', after: 'unknown' };
    const after = declaration === null ? 'utf-8' : declaredModeAfterBom(declaration.label);
    return { switchAt, before: 'utf-8', after };
  }
  const before: LibxmlTextMode =
    encoding === 'utf-8'
      ? 'latin-1-of-utf-8'
      : encoding === SINGLE_BYTE_ENCODING
        ? 'latin-1'
        : 'unknown';
  if (declaration === null || NON_ASCII.test(html.slice(0, declaration.at))) {
    return { switchAt, before, after: before };
  }
  return { switchAt, before, after: declaredMode(declaration.label, encoding) };
}

/**
 * The mode of the text at an offset.
 *
 * @param modes The page's {@link LibxmlTextModes}.
 * @param offset A tag's offset.
 */
export function libxmlTextModeAt(modes: LibxmlTextModes, offset: number): LibxmlTextMode {
  return offset < modes.switchAt ? modes.before : modes.after;
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
      return ABOVE_LATIN1.test(text) ? null : text;
    case 'unknown':
      return null;
  }
}
