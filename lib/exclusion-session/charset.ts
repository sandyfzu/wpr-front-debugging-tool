/**
 * Byte ↔ text for intercepted documents: which encoding a served HTML
 * response uses, and a lossless decode → re-encode round trip in that same
 * encoding, so a rewritten document reaches the parser as the original
 * bytes everywhere the engine did not edit.
 *
 * Resolution follows the HTML encoding sniffing order: BOM (certain), the
 * `Content-Type` charset (certain when it names a known encoding), the
 * `<meta>` prescan of the first 1024 bytes, then a default. Labels resolve
 * through `TextDecoder` (the platform's own "get an encoding").
 *
 * Re-encoding policy — the output is always in the document's own
 * encoding, never transcoded (a transcode would also change how the page's
 * charset-less scripts and styles decode, and on some backends the
 * `Content-Type` header cannot be rewritten). `TextEncoder` only emits
 * UTF-8, so:
 * - UTF-8 — `TextEncoder`, after a well-formedness check;
 * - UTF-16LE/BE — encoded code unit by code unit;
 * - every single-byte encoding of the Encoding standard — a reverse table derived from the
 *   platform decoder, byte by byte;
 * - the multi-byte CJK encodings (Shift_JIS, EUC-JP, ISO-2022-JP, GBK,
 *   gb18030, Big5, EUC-KR) and `replacement` — unsupported: no encoder
 *   exists here, and ISO-2022-JP even reuses ASCII bytes for text, so the
 *   document must be served unmodified.
 *
 * Decoding is fatal (malformed bytes fail instead of becoming U+FFFD, which
 * could never re-encode to the original bytes) and keeps every BOM-like
 * character in the text; the sniffed BOM itself is stripped and re-emitted
 * as the original bytes. Because the round trip is lossless, an undeclared
 * document's guessed encoding only affects how non-ASCII rows match —
 * never the bytes served: undeclared → UTF-8 when the bytes are valid
 * UTF-8, else windows-1252 (the common locale default, and total — every
 * byte maps to a distinct character).
 */

/** The bytes the `<meta>` prescan reads at most (the spec's recommended window). */
export const PRESCAN_BYTE_LIMIT = 1024;

/** The encodings a byte order mark identifies, with their BOM bytes. */
const BYTE_ORDER_MARKS: readonly {
  readonly encoding: string;
  readonly bytes: readonly number[];
}[] = [
  { encoding: 'utf-8', bytes: [0xef, 0xbb, 0xbf] },
  { encoding: 'utf-16be', bytes: [0xfe, 0xff] },
  { encoding: 'utf-16le', bytes: [0xff, 0xfe] }
];

/**
 * The labels of the `replacement` encoding — the platform decoder refuses
 * them, while the sniffing algorithm treats them as a known encoding that
 * decodes to one U+FFFD (so they must resolve, not fall through).
 */
const REPLACEMENT_LABELS: ReadonlySet<string> = new Set([
  'csiso2022kr',
  'hz-gb-2312',
  'iso-2022-cn',
  'iso-2022-cn-ext',
  'iso-2022-kr',
  'replacement'
]);

/**
 * The single-byte encodings (canonical names as the platform decoder
 * reports them) — each byte decodes to at most one BMP character, so a
 * byte-wise reverse table encodes them exactly.
 */
const SINGLE_BYTE_ENCODINGS: ReadonlySet<string> = new Set([
  'ibm866',
  'iso-8859-2',
  'iso-8859-3',
  'iso-8859-4',
  'iso-8859-5',
  'iso-8859-6',
  'iso-8859-7',
  'iso-8859-8',
  'iso-8859-8-i',
  'iso-8859-10',
  'iso-8859-13',
  'iso-8859-14',
  'iso-8859-15',
  'iso-8859-16',
  'koi8-r',
  'koi8-u',
  'macintosh',
  'windows-874',
  'windows-1250',
  'windows-1251',
  'windows-1252',
  'windows-1253',
  'windows-1254',
  'windows-1255',
  'windows-1256',
  'windows-1257',
  'windows-1258',
  'x-mac-cyrillic',
  'x-user-defined'
]);

/** A sniffed byte order mark. */
export interface ByteOrderMark {
  readonly encoding: string;
  /** The BOM's length in bytes (stripped before decoding, re-emitted on encode). */
  readonly length: number;
}

/**
 * Sniff a byte order mark at the start of the body (UTF-8, UTF-16BE,
 * UTF-16LE) — it overrides every declaration.
 *
 * @param bytes The response body.
 * @returns The BOM's encoding and length, or null when there is none.
 */
export function sniffByteOrderMark(bytes: Uint8Array): ByteOrderMark | null {
  const mark = BYTE_ORDER_MARKS.find((candidate) =>
    candidate.bytes.every((byte, index) => bytes[index] === byte)
  );
  return mark === undefined ? null : { encoding: mark.encoding, length: mark.bytes.length };
}

/**
 * Resolve an encoding label ("get an encoding": trimmed, case-insensitive).
 *
 * @param label The label as declared.
 * @returns The canonical encoding name (lowercase, e.g. `windows-1252` for
 *   `latin1`), `replacement` for its labels, or null for an unknown label.
 */
export function encodingForLabel(label: string): string | null {
  const normalized = label.trim().toLowerCase();
  if (REPLACEMENT_LABELS.has(normalized)) return 'replacement';
  try {
    return new TextDecoder(normalized).encoding;
  } catch {
    // RangeError: not a label of any encoding — the declaration is ignored.
    return null;
  }
}

/** HTTP whitespace (tab, LF, CR, space). */
const HTTP_WHITESPACE = /^[\t\n\r ]+|[\t\n\r ]+$/g;

/** HTTP token code points. */
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** HTTP quoted-string token code points. */
const HTTP_QUOTED_STRING_TOKEN = /^[\t -~\u0080-ÿ]*$/;

/**
 * Collect an HTTP quoted string starting at the `"` at `start`.
 *
 * @returns The unescaped value and the index just past the closing quote
 *   (or the end of input).
 */
function collectQuotedString(input: string, start: number): { value: string; end: number } {
  let value = '';
  let position = start + 1;
  while (position < input.length) {
    const char = input.charAt(position);
    position++;
    if (char === '"') return { value, end: position };
    if (char === '\\') {
      if (position >= input.length) return { value: `${value}\\`, end: position };
      value += input.charAt(position);
      position++;
    } else {
      value += char;
    }
  }
  return { value, end: position };
}

/**
 * Split a combined header value on commas outside quoted strings ("get,
 * decode, and split"), each part trimmed of tabs/spaces.
 */
function splitHeaderValues(input: string): string[] {
  const values: string[] = [];
  let current = '';
  let position = 0;
  while (position < input.length) {
    const char = input.charAt(position);
    if (char === '"') {
      const quoted = collectQuotedString(input, position);
      current += input.slice(position, quoted.end);
      position = quoted.end;
    } else if (char === ',') {
      values.push(current);
      current = '';
      position++;
    } else {
      current += char;
      position++;
    }
  }
  values.push(current);
  return values.map((value) => value.replace(/^[\t ]+|[\t ]+$/g, ''));
}

/** A parsed MIME type: its essence and its (first-wins) parameters. */
interface MimeType {
  readonly essence: string;
  readonly parameters: ReadonlyMap<string, string>;
}

/**
 * Read one MIME type parameter's value at `position`: a quoted string (with
 * anything after its closing quote up to `;` dropped) or a bare value.
 */
function readParameterValue(
  input: string,
  position: number
): { value: string; quoted: boolean; end: number } {
  if (input.charAt(position) === '"') {
    const quoted = collectQuotedString(input, position);
    const semicolon = input.indexOf(';', quoted.end);
    return { value: quoted.value, quoted: true, end: semicolon === -1 ? input.length : semicolon };
  }
  const semicolon = input.indexOf(';', position);
  const end = semicolon === -1 ? input.length : semicolon;
  return { value: input.slice(position, end).replace(/[\t\n\r ]+$/, ''), quoted: false, end };
}

/**
 * Parse a MIME type (the MIME Sniffing standard's algorithm).
 *
 * @returns The MIME type, or null when the input is not one.
 */
function parseMimeType(raw: string): MimeType | null {
  const input = raw.replace(HTTP_WHITESPACE, '');
  const slash = input.indexOf('/');
  if (slash === -1) return null;
  const type = input.slice(0, slash);
  const semicolon = input.indexOf(';', slash);
  const subtypeEnd = semicolon === -1 ? input.length : semicolon;
  const subtype = input.slice(slash + 1, subtypeEnd).replace(/[\t\n\r ]+$/, '');
  if (!HTTP_TOKEN.test(type) || !HTTP_TOKEN.test(subtype)) return null;
  const parameters = new Map<string, string>();
  let position = subtypeEnd;
  while (position < input.length) {
    position++; // past `;`
    while (/[\t\n\r ]/.test(input.charAt(position))) position++;
    let nameEnd = position;
    while (nameEnd < input.length && !/[;=]/.test(input.charAt(nameEnd))) nameEnd++;
    const name = input.slice(position, nameEnd).toLowerCase();
    position = nameEnd;
    if (position >= input.length) break;
    if (input.charAt(position) === ';') continue;
    position++; // past `=`
    if (position >= input.length) break;
    const read = readParameterValue(input, position);
    position = read.end;
    // An empty bare value is skipped; an empty quoted one (`""`) still counts.
    if (!read.quoted && read.value === '') continue;
    if (
      HTTP_TOKEN.test(name) &&
      HTTP_QUOTED_STRING_TOKEN.test(read.value) &&
      !parameters.has(name)
    ) {
      parameters.set(name, read.value);
    }
  }
  return { essence: `${type.toLowerCase()}/${subtype.toLowerCase()}`, parameters };
}

/** What a `Content-Type` value declares: its MIME type essence and charset label. */
export interface ExtractedMimeType {
  /** Type/subtype, ASCII-lowercased (e.g. `text/html`). */
  readonly essence: string;
  /** The raw charset label, or null when none is declared. */
  readonly charset: string | null;
}

/**
 * Fetch's "extract a MIME type" over a `Content-Type` value: a combined
 * multi-header value is split on commas; unparsable values and the any-type wildcard are
 * skipped; the last valid type wins, and a later type with the same
 * essence and no charset keeps the earlier charset.
 *
 * @param contentType The header value (several headers joined with `, `),
 *   or null when absent.
 * @returns The essence and charset, or null when no valid type is declared.
 */
export function extractMimeType(contentType: string | null): ExtractedMimeType | null {
  if (contentType === null) return null;
  let charset: string | null = null;
  let essence: string | null = null;
  for (const value of splitHeaderValues(contentType)) {
    const mime = parseMimeType(value);
    if (mime === null || mime.essence === '*/*') continue;
    const declared = mime.parameters.get('charset') ?? null;
    if (mime.essence !== essence) {
      charset = declared;
      essence = mime.essence;
    } else if (declared !== null) {
      charset = declared;
    }
  }
  return essence === null ? null : { essence, charset };
}

/**
 * The charset label a `Content-Type` value declares (see {@link extractMimeType}).
 *
 * @param contentType The header value, or null when absent.
 * @returns The raw label, or null when none is declared.
 */
export function contentTypeCharset(contentType: string | null): string | null {
  return extractMimeType(contentType)?.charset ?? null;
}

/** Whether a byte is HTML-prescan whitespace (TAB, LF, FF, CR, SP). */
function isPrescanSpace(byte: number | undefined): boolean {
  return byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20;
}

/** Whether a byte is an ASCII letter. */
function isAsciiLetter(byte: number | undefined): boolean {
  return byte !== undefined && ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a));
}

/** One byte as a lowercased code point (ASCII upper → lower; others as-is). */
function lowerChar(byte: number): string {
  return String.fromCharCode(byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte);
}

/** Signals the prescan ran out of bytes (the algorithm's abort). */
class PrescanEnd extends Error {
  override readonly name = 'PrescanEnd';
}

/** A byte cursor over the prescan window that aborts past its end. */
class PrescanCursor {
  position = 0;

  constructor(private readonly bytes: Uint8Array) {}

  /** The byte at the cursor; aborts the prescan past the window. */
  get byte(): number {
    const value = this.bytes[this.position];
    if (value === undefined) throw new PrescanEnd();
    return value;
  }

  /** The byte `offset` ahead, without aborting (undefined past the end). */
  peek(offset: number): number | undefined {
    return this.bytes[this.position + offset];
  }

  /** Whether the window starts with `sequence` at the cursor. */
  startsWith(sequence: readonly number[]): boolean {
    return sequence.every((byte, index) => this.bytes[this.position + index] === byte);
  }

  /** At `<!--`: move to the first `>` that ends a `-->` (the opener's dashes may count). */
  skipComment(): void {
    // The two dashes may be the opener's own (`<!-->`), so search from its dashes.
    let index = this.position + 2;
    while (index < this.bytes.length) {
      if (
        this.bytes[index] === 0x3e &&
        this.bytes[index - 1] === 0x2d &&
        this.bytes[index - 2] === 0x2d
      ) {
        this.position = index;
        return;
      }
      index++;
    }
    throw new PrescanEnd();
  }

  /** Move to the next byte matching `predicate` (aborts when none). */
  advanceTo(predicate: (byte: number) => boolean): void {
    while (!predicate(this.byte)) this.position++;
  }
}

/** One prescanned attribute. */
interface PrescanAttribute {
  readonly name: string;
  readonly value: string;
}

/**
 * The prescan's "get an attribute" step at the cursor.
 *
 * @returns The attribute, or null when the tag ends (`>`) first.
 * @throws {@link PrescanEnd} when the window runs out.
 */
function getAttribute(cursor: PrescanCursor): PrescanAttribute | null {
  while (isPrescanSpace(cursor.byte) || cursor.byte === 0x2f) cursor.position++;
  if (cursor.byte === 0x3e) return null;
  let name = '';
  let value = '';
  // Name.
  for (;;) {
    const byte = cursor.byte;
    if (byte === 0x3d && name !== '') {
      cursor.position++;
      break;
    }
    if (isPrescanSpace(byte)) {
      while (isPrescanSpace(cursor.byte)) cursor.position++;
      if (cursor.byte !== 0x3d) return { name, value: '' };
      cursor.position++;
      break;
    }
    if (byte === 0x2f || byte === 0x3e) return { name, value: '' };
    name += lowerChar(byte);
    cursor.position++;
  }
  // Value.
  while (isPrescanSpace(cursor.byte)) cursor.position++;
  const first = cursor.byte;
  if (first === 0x22 || first === 0x27) {
    for (;;) {
      cursor.position++;
      const byte = cursor.byte;
      if (byte === first) {
        cursor.position++;
        return { name, value };
      }
      value += lowerChar(byte);
    }
  }
  if (first === 0x3e) return { name, value: '' };
  value += lowerChar(first);
  cursor.position++;
  for (;;) {
    const byte = cursor.byte;
    if (isPrescanSpace(byte) || byte === 0x3e) return { name, value };
    value += lowerChar(byte);
    cursor.position++;
  }
}

/**
 * The charset a `<meta content>` value names ("extracting a character
 * encoding from a meta element").
 *
 * @returns The encoding, or null when none (or an unknown label) is named.
 */
export function metaContentCharset(content: string): string | null {
  let position = 0;
  for (;;) {
    const found = content.toLowerCase().indexOf('charset', position);
    if (found === -1) return null;
    let index = found + 'charset'.length;
    while (/[\t\n\f\r ]/.test(content.charAt(index))) index++;
    if (content.charAt(index) !== '=') {
      position = index;
      continue;
    }
    index++;
    while (/[\t\n\f\r ]/.test(content.charAt(index))) index++;
    const char = content.charAt(index);
    if (char === '"' || char === "'") {
      const close = content.indexOf(char, index + 1);
      return close === -1 ? null : encodingForLabel(content.slice(index + 1, close));
    }
    if (char === '') return null;
    const rest = content.slice(index);
    const stop = rest.search(/[\t\n\f\r ;]/);
    return encodingForLabel(stop === -1 ? rest : rest.slice(0, stop));
  }
}

/** The `<meta …>` processing outcome: an encoding, or null to keep scanning. */
function processMeta(cursor: PrescanCursor): string | null {
  const seen = new Set<string>();
  let gotPragma = false;
  let needPragma: boolean | null = null;
  // `undefined` = no charset seen yet; `null` = a charset attribute named an unknown label.
  let charset: string | null | undefined;
  for (let attribute = getAttribute(cursor); attribute !== null; attribute = getAttribute(cursor)) {
    if (seen.has(attribute.name)) continue;
    seen.add(attribute.name);
    if (attribute.name === 'http-equiv') {
      if (attribute.value === 'content-type') gotPragma = true;
    } else if (attribute.name === 'content') {
      const extracted = metaContentCharset(attribute.value);
      if (extracted !== null && charset === undefined) {
        charset = extracted;
        needPragma = true;
      }
    } else if (attribute.name === 'charset') {
      charset = encodingForLabel(attribute.value);
      needPragma = false;
    }
  }
  if (needPragma === null || (needPragma && !gotPragma)) return null;
  if (charset === null || charset === undefined) return null;
  if (charset === 'utf-16be' || charset === 'utf-16le') return 'utf-8';
  if (charset === 'x-user-defined') return 'windows-1252';
  return charset;
}

/** `<meta` (case-insensitive), checked bytewise by the caller. */
const META = [0x6d, 0x65, 0x74, 0x61];

/** Whether the cursor sits on `<meta` followed by whitespace or `/`. */
function atMetaTag(cursor: PrescanCursor): boolean {
  if (cursor.peek(0) !== 0x3c) return false;
  const nameMatches = META.every((byte, index) => {
    const value = cursor.peek(index + 1);
    return value === byte || value === byte - 0x20;
  });
  const after = cursor.peek(5);
  return nameMatches && (isPrescanSpace(after) || after === 0x2f);
}

/** Whether a string holds a code unit ≤ 0x20 (ASCII control or space). */
function hasControlOrSpace(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) <= 0x20) return true;
  }
  return false;
}

/**
 * The prescan's fallback when it runs out of bytes: an `encoding="…"` in a
 * leading `<?xml …>` declaration ("get an XML encoding").
 */
function xmlDeclarationEncoding(bytes: Uint8Array): string | null {
  const head = String.fromCharCode(...bytes);
  if (!head.startsWith('<?xml')) return null;
  const declarationEnd = head.indexOf('>');
  if (declarationEnd === -1) return null;
  const keyword = head.indexOf('encoding', 0);
  if (keyword === -1 || keyword >= declarationEnd) return null;
  let index = keyword + 'encoding'.length;
  while (head.charCodeAt(index) <= 0x20) index++;
  if (head.charAt(index) !== '=') return null;
  index++;
  while (head.charCodeAt(index) <= 0x20) index++;
  const quote = head.charAt(index);
  if (quote !== '"' && quote !== "'") return null;
  const close = head.indexOf(quote, index + 1);
  if (close === -1) return null;
  const label = head.slice(index + 1, close);
  if (label === '' || hasControlOrSpace(label)) return null;
  const encoding = encodingForLabel(label);
  return encoding === 'utf-16be' || encoding === 'utf-16le' ? 'utf-8' : encoding;
}

/**
 * Prescan the start of a document for its declared encoding (the HTML
 * standard's "prescan a byte stream to determine its encoding" over the
 * first {@link PRESCAN_BYTE_LIMIT} bytes): `<meta charset>` /
 * `http-equiv` pragmas, skipping comments and other tags' attributes, then
 * the XML-declaration fallback.
 *
 * @param bytes The response body (only the window is read).
 * @returns The encoding, or null when the window declares none.
 */
export function prescanEncoding(bytes: Uint8Array): string | null {
  const window = bytes.subarray(0, PRESCAN_BYTE_LIMIT);
  const cursor = new PrescanCursor(window);
  if (cursor.startsWith([0x3c, 0x00, 0x3f, 0x00, 0x78, 0x00])) return 'utf-16le';
  if (cursor.startsWith([0x00, 0x3c, 0x00, 0x3f, 0x00, 0x78])) return 'utf-16be';
  try {
    for (; cursor.position < window.length; cursor.position++) {
      if (cursor.startsWith([0x3c, 0x21, 0x2d, 0x2d])) {
        cursor.skipComment();
      } else if (atMetaTag(cursor)) {
        cursor.position += 5;
        const found = processMeta(cursor);
        if (found !== null) return found;
      } else if (
        cursor.byte === 0x3c &&
        (isAsciiLetter(cursor.peek(1)) ||
          (cursor.peek(1) === 0x2f && isAsciiLetter(cursor.peek(2))))
      ) {
        cursor.advanceTo((byte) => isPrescanSpace(byte) || byte === 0x3e);
        while (getAttribute(cursor) !== null) {
          // Attributes of other tags are read only to step over them.
        }
      } else if (
        cursor.byte === 0x3c &&
        (cursor.peek(1) === 0x21 || cursor.peek(1) === 0x2f || cursor.peek(1) === 0x3f)
      ) {
        cursor.position++;
        cursor.advanceTo((byte) => byte === 0x3e);
      }
    }
  } catch (cause) {
    if (!(cause instanceof PrescanEnd)) throw cause;
  }
  return xmlDeclarationEncoding(window);
}

/** Where a document's encoding came from. */
export type EncodingSource = 'bom' | 'transport' | 'prescan' | 'default';

/** A resolved document encoding. */
export interface ResolvedEncoding {
  /** The canonical encoding name, or null when nothing declared one (the default applies). */
  readonly encoding: string | null;
  readonly source: EncodingSource;
  /** BOM bytes at the start of the body (0 without one). */
  readonly bomLength: number;
}

/**
 * Resolve a document's encoding in sniffing order: BOM, the `Content-Type`
 * charset (when it names a known encoding — an unknown label is ignored),
 * the `<meta>` prescan, else the default (`encoding: null`).
 *
 * @param bytes The response body.
 * @param contentType The `Content-Type` header value, or null.
 */
export function resolveDocumentEncoding(
  bytes: Uint8Array,
  contentType: string | null
): ResolvedEncoding {
  const bom = sniffByteOrderMark(bytes);
  if (bom !== null) return { encoding: bom.encoding, source: 'bom', bomLength: bom.length };
  const label = contentTypeCharset(contentType);
  const transport = label === null ? null : encodingForLabel(label);
  if (transport !== null) return { encoding: transport, source: 'transport', bomLength: 0 };
  const declared = prescanEncoding(bytes);
  if (declared !== null) return { encoding: declared, source: 'prescan', bomLength: 0 };
  return { encoding: null, source: 'default', bomLength: 0 };
}

/** How to re-encode a decoded document back to its original bytes. */
export interface DocumentCodec {
  /** The encoding the text was decoded with (and is re-encoded in). */
  readonly encoding: string;
  /** The original BOM bytes, re-emitted ahead of the encoded text. */
  readonly bom: Uint8Array;
}

/** Why a body cannot round-trip. */
export type DecodeFailure = 'unsupported-encoding' | 'malformed-bytes';

/** The outcome of {@link decodeDocument}. */
export type DecodedDocument =
  | { readonly ok: true; readonly text: string; readonly codec: DocumentCodec }
  | { readonly ok: false; readonly reason: DecodeFailure; readonly encoding: string };

/** Whether this module can re-encode text in an encoding. */
export function isRoundTripEncoding(encoding: string): boolean {
  return (
    encoding === 'utf-8' ||
    encoding === 'utf-16le' ||
    encoding === 'utf-16be' ||
    SINGLE_BYTE_ENCODINGS.has(encoding)
  );
}

/**
 * Decode fatally (malformed input fails), keeping BOM-like characters.
 *
 * @returns The text, or null when the bytes are malformed for the encoding.
 */
function decodeStrict(bytes: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    // TypeError: the bytes are not valid in this encoding.
    return null;
  }
}

/**
 * Decode a served document for the engine, remembering how to re-encode it.
 *
 * @param bytes The response body (after any content-encoding was removed).
 * @param contentType The `Content-Type` header value, or null.
 * @returns The text and its codec, or why it cannot round-trip: its
 *   encoding has no encoder here, or its bytes are malformed for it.
 */
export function decodeDocument(bytes: Uint8Array, contentType: string | null): DecodedDocument {
  const resolved = resolveDocumentEncoding(bytes, contentType);
  const bom = bytes.slice(0, resolved.bomLength);
  const body = bytes.subarray(resolved.bomLength);
  if (resolved.encoding === null) {
    const utf8 = decodeStrict(body, 'utf-8');
    if (utf8 !== null) return { ok: true, text: utf8, codec: { encoding: 'utf-8', bom } };
    // windows-1252 maps every byte, so this decode cannot fail.
    const latin = decodeStrict(body, 'windows-1252') ?? '';
    return { ok: true, text: latin, codec: { encoding: 'windows-1252', bom } };
  }
  const encoding = resolved.encoding;
  if (!isRoundTripEncoding(encoding))
    return { ok: false, reason: 'unsupported-encoding', encoding };
  const text = decodeStrict(body, encoding);
  if (text === null) return { ok: false, reason: 'malformed-bytes', encoding };
  return { ok: true, text, codec: { encoding, bom } };
}

/** Reverse tables of the single-byte encodings, built on first use. */
const reverseTables = new Map<string, ReadonlyMap<number, number>>();

/**
 * The code unit → byte table of a single-byte encoding, derived from the
 * platform decoder (unmapped bytes are skipped; a code unit two bytes
 * decode to keeps its first byte — never the case in the standard tables).
 */
function reverseTable(encoding: string): ReadonlyMap<number, number> {
  const cached = reverseTables.get(encoding);
  if (cached !== undefined) return cached;
  const table = new Map<number, number>();
  const decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
  for (let byte = 0; byte <= 0xff; byte++) {
    let char: string;
    try {
      char = decoder.decode(Uint8Array.of(byte));
    } catch {
      continue; // An unmapped byte: nothing encodes to it.
    }
    const unit = char.charCodeAt(0);
    if (char.length === 1 && !table.has(unit)) table.set(unit, byte);
  }
  reverseTables.set(encoding, table);
  return table;
}

/** Encode in a single-byte encoding; null when a character has no byte. */
function encodeSingleByte(text: string, encoding: string): Uint8Array | null {
  const table = reverseTable(encoding);
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const byte = table.get(text.charCodeAt(index));
    if (byte === undefined) return null;
    out[index] = byte;
  }
  return out;
}

/** Encode UTF-16 code units in the given byte order. */
function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let index = 0; index < text.length; index++) {
    view.setUint16(index * 2, text.charCodeAt(index), littleEndian);
  }
  return out;
}

/** Prefix `body` with the BOM bytes. */
function withBom(bom: Uint8Array, body: Uint8Array): Uint8Array {
  if (bom.length === 0) return body;
  const out = new Uint8Array(bom.length + body.length);
  out.set(bom);
  out.set(body, bom.length);
  return out;
}

/** UTF-8 encoder (stateless, reused). */
const utf8Encoder = new TextEncoder();

/**
 * Re-encode a (rewritten) document in its original encoding, BOM included.
 *
 * @param text The document text.
 * @param codec The codec {@link decodeDocument} returned for it.
 * @returns The bytes, or null when the text holds a character the encoding
 *   cannot represent (a lone surrogate in UTF-8, an unmapped character in a
 *   single-byte encoding) or the encoding has no encoder here.
 */
export function encodeDocument(text: string, codec: DocumentCodec): Uint8Array | null {
  switch (codec.encoding) {
    case 'utf-8':
      // TextEncoder would silently turn a lone surrogate into U+FFFD.
      return text.isWellFormed() ? withBom(codec.bom, utf8Encoder.encode(text)) : null;
    case 'utf-16le':
      return withBom(codec.bom, encodeUtf16(text, true));
    case 'utf-16be':
      return withBom(codec.bom, encodeUtf16(text, false));
    default: {
      if (!SINGLE_BYTE_ENCODINGS.has(codec.encoding)) return null;
      const body = encodeSingleByte(text, codec.encoding);
      return body === null ? null : withBom(codec.bom, body);
    }
  }
}
