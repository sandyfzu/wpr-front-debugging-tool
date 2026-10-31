/**
 * Reading this extension's own `<meta>` markers in served markup as the
 * browser will: which tags the DOM will name with a marker's name (so a
 * rewrite removes every served, stale or spoofed copy before writing its
 * own) and where the end of `<head>` is (where a marker is appended). Shared
 * by the builder marker and the simulation marker writers.
 */
import { isEndTag, type ScannedTag, type ScannedToken } from './html-scan';
import { findAttribute } from './tag-edit';

/**
 * The names {@link readsAsOwnMetaName} can decide: lower-case ASCII letters
 * and hyphens, without the letter pair `fj` (see there).
 */
export const OWN_META_NAME_PATTERN = /^(?!.*fj)[a-z-]+$/;

/** A numeric character reference: decimal or hex, `;` optional (the tokenizer decodes both). */
const NUMERIC_REFERENCE = /&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?/g;

/**
 * Decode a raw attribute value's numeric character references, as far as
 * matching an ASCII name needs: an ASCII code point becomes its character;
 * any other (non-ASCII, NUL, out of range — the tokenizer maps those to
 * non-ASCII text too) becomes U+FFFD, which no ASCII name contains.
 *
 * @param raw The raw value text.
 */
function decodeNumericReferences(raw: string): string {
  return raw.replace(NUMERIC_REFERENCE, (_whole, hex?: string, decimal?: string) => {
    const codePoint =
      hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(decimal ?? '', 10);
    return codePoint > 0 && codePoint < 0x80 ? String.fromCharCode(codePoint) : '�';
  });
}

/**
 * Whether a raw `name` value reads as `name` once the DOM decodes it
 * (`name` compares case-sensitively). Only numeric character references
 * need decoding for a name of {@link OWN_META_NAME_PATTERN}: of the 2,231
 * WHATWG named references (both spellings, with and without `;`), the only
 * one whose text contains any of `a`–`z` or `-` is `&fjlig;` ("fj"), which
 * such a name lacks — so a value with a named reference can never be the
 * name, decoded or not (an undecoded one keeps its `&`, which the name
 * lacks). Numeric references decode in one pass, never re-read: a `&#38;`
 * stays the `&` the DOM gives.
 *
 * @param raw The raw `name` value, as served.
 * @param name The marker's name (matching {@link OWN_META_NAME_PATTERN}).
 * @throws {@link RangeError} when `name` is outside the pattern (a caller bug).
 */
export function readsAsOwnMetaName(raw: string, name: string): boolean {
  if (!OWN_META_NAME_PATTERN.test(name)) {
    throw new RangeError(`readsAsOwnMetaName: undecidable marker name ${JSON.stringify(name)}`);
  }
  return decodeNumericReferences(raw) === name;
}

/**
 * Whether a token is a marker of `name`: a `meta` start tag whose (first)
 * `name` attribute reads as it — the DOM's own reading (duplicate
 * attributes drop, character references decode).
 *
 * @param token One scanned token.
 * @param name The marker's name.
 */
export function isOwnMetaTag(token: ScannedToken, name: string): token is ScannedTag {
  if (isEndTag(token) || token.name !== 'meta') return false;
  const raw = findAttribute(token, 'name')?.value;
  return raw !== undefined && raw !== null && readsAsOwnMetaName(raw, name);
}

/**
 * Where the end of `<head>` is: the first `</head>`, or the `<body>` start
 * tag when the head is never closed explicitly (the parser closes it
 * there). Null when the document spells neither.
 *
 * @param tokens The document's tokens, in order.
 */
export function headEnd(tokens: readonly ScannedToken[]): number | null {
  const end = tokens.find(
    (token) =>
      (isEndTag(token) && token.name === 'head') || (!isEndTag(token) && token.name === 'body')
  );
  return end === undefined ? null : end.start;
}
