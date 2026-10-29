/**
 * Byte lengths of decoded text — WP Rocket's regexes run without PCRE's
 * UTF option, so they count (and step over) the served bytes, not
 * characters. UTF-8 is the default measure ({@link UTF8_MEASURE}); a lone
 * surrogate counts as U+FFFD's three bytes, as `TextEncoder` writes it.
 */

/**
 * How many bytes each code unit of the decoded page stands for in the
 * encoding it was served in. The measure must be ASCII-compatible: a unit
 * below 0x80 is that one byte, and a non-ASCII character encodes to bytes
 * that are all 0x80 or above (no ASCII byte inside a character, as in
 * Shift_JIS or GBK) — WP Rocket's patterns only name ASCII, so such bytes
 * then never match a pattern character and only their count matters.
 */
export interface ByteMeasure {
  /**
   * The bytes of the code unit at `index` (a character spelled by two
   * units shares its bytes between them).
   */
  readonly unitBytes: (text: string, index: number) => number;
  /** The most bytes any one unit counts: bounds cheap upper estimates. */
  readonly maxUnitBytes: number;
}

/**
 * The UTF-8 bytes of the code unit at `index` (a surrogate pair counts two
 * per unit, so a pair is four).
 *
 * @param text The text.
 * @param index A code-unit offset inside it.
 */
export function utf8UnitBytes(text: string, index: number): number {
  const code = text.charCodeAt(index);
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = text.charCodeAt(index + 1);
    return next >= 0xdc00 && next <= 0xdfff ? 2 : 3;
  }
  if (code >= 0xdc00 && code <= 0xdfff) {
    const previous = text.charCodeAt(index - 1);
    return previous >= 0xd800 && previous <= 0xdbff ? 2 : 3;
  }
  return 3;
}

/** UTF-8, as `TextEncoder` writes decoded text: the default measure. */
export const UTF8_MEASURE: ByteMeasure = { unitBytes: utf8UnitBytes, maxUnitBytes: 3 };

/**
 * The byte length of `text[from, to)` (a slice never splits a pair here:
 * callers cut at ASCII delimiters).
 *
 * @param text The text.
 * @param from Start offset (code units).
 * @param to End offset (code units).
 * @param measure The served encoding's byte measure.
 */
export function byteLength(
  text: string,
  from = 0,
  to = text.length,
  measure: ByteMeasure = UTF8_MEASURE
): number {
  let bytes = 0;
  for (let index = from; index < to; index++) {
    // ASCII fast path: most page text.
    bytes += text.charCodeAt(index) < 0x80 ? 1 : measure.unitBytes(text, index);
  }
  return bytes;
}

/**
 * The UTF-8 length of `text[from, to)`.
 *
 * @param text The text.
 * @param from Start offset (code units).
 * @param to End offset (code units).
 */
export function utf8Length(text: string, from = 0, to = text.length): number {
  return byteLength(text, from, to, UTF8_MEASURE);
}

/** A run of non-ASCII code units. */
const NON_ASCII_RUN = /[\u0080-\uffff]+/g;

/** The byte every non-ASCII byte is written as in {@link byteView}. */
const NON_ASCII_BYTE = '\x80';

/**
 * The page as WP Rocket's byte-wise patterns read it, one unit per byte:
 * ASCII as is, each non-ASCII character as its byte count of 0x80 — for
 * patterns that only name ASCII, any byte from 0x80 up behaves the same.
 *
 * @param text The decoded page.
 * @param measure The served encoding's byte measure.
 */
export function byteView(text: string, measure: ByteMeasure = UTF8_MEASURE): string {
  return text.replace(NON_ASCII_RUN, (run: string, offset: number) =>
    NON_ASCII_BYTE.repeat(byteLength(text, offset, offset + run.length, measure))
  );
}

/**
 * Code-unit offsets of byte offsets into the text's encoding, in one
 * pass. Each byte offset must fall on a character boundary.
 *
 * @param text The text.
 * @param byteOffsets Byte offsets, ascending.
 * @param measure The served encoding's byte measure.
 * @returns The matching code-unit offsets.
 * @throws {@link Error} when an offset is not ascending, past the end, or
 *   inside a character.
 */
export function unitOffsetsOfBytes(
  text: string,
  byteOffsets: readonly number[],
  measure: ByteMeasure = UTF8_MEASURE
): number[] {
  const units: number[] = [];
  let unit = 0;
  let byte = 0;
  for (const target of byteOffsets) {
    while (byte < target && unit < text.length) {
      byte += text.charCodeAt(unit) < 0x80 ? 1 : measure.unitBytes(text, unit);
      unit++;
    }
    if (byte !== target) {
      throw new Error(`Byte offset ${String(target)} is not a character boundary of the text`);
    }
    units.push(unit);
  }
  return units;
}
