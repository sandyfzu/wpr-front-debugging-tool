/**
 * Byte sets: what one PCRE character position can match when a pattern runs
 * without the UTF option over a byte string (one unit per byte, 0x00–0xFF).
 * Every character class, escape and literal of a translated row reduces to
 * one of these, so matching facts are exact by construction and the JS
 * source is emitted from the set — never from PCRE syntax JS reads
 * differently. Members of the named sets are PCRE2's default (C locale)
 * tables, as observed over all 256 bytes.
 */

/** A set of bytes: index = byte, value 1 = member. Treat as immutable. */
export type ByteSet = Readonly<Uint8Array>;

/** Bytes a set may hold. */
const BYTE_COUNT = 256;

/**
 * A set of the given inclusive ranges.
 *
 * @param ranges `[low, high]` pairs, each within 0x00–0xFF.
 */
export function byteRanges(...ranges: readonly (readonly [number, number])[]): ByteSet {
  const set = new Uint8Array(BYTE_COUNT);
  for (const [low, high] of ranges) set.fill(1, low, high + 1);
  return set;
}

/** A set of single bytes. */
export function bytesOf(...bytes: readonly number[]): ByteSet {
  return byteRanges(...bytes.map((byte): [number, number] => [byte, byte]));
}

/** The union of sets. */
export function unionOf(...sets: readonly ByteSet[]): ByteSet {
  const union = new Uint8Array(BYTE_COUNT);
  for (const set of sets) set.forEach((member, byte) => (union[byte] ||= member));
  return union;
}

/** Every byte not in `set`. */
export function complementOf(set: ByteSet): ByteSet {
  return set.map((member) => 1 - member);
}

/** Whether two sets share a byte. */
export function intersects(a: ByteSet, b: ByteSet): boolean {
  return a.some((member, byte) => member === 1 && b[byte] === 1);
}

/** Number of members. */
function sizeOf(set: ByteSet): number {
  return set.reduce((count, member) => count + member, 0);
}

/** ASCII letter offset between cases. */
const CASE_OFFSET = 0x20;

/**
 * `set` plus the other case of every ASCII letter in it — PCRE's caseless
 * matching without UTF: only ASCII letters have another case (`é` never
 * folds to `É`).
 */
export function foldAsciiCase(set: ByteSet): ByteSet {
  const folded = Uint8Array.from(set);
  for (let upper = 0x41; upper <= 0x5a; upper++) {
    if (set[upper] === 1 || set[upper + CASE_OFFSET] === 1) {
      folded[upper] = 1;
      folded[upper + CASE_OFFSET] = 1;
    }
  }
  return folded;
}

/** Every byte. */
export const ANY_BYTE = byteRanges([0x00, 0xff]);

/** `\d`, `[[:digit:]]`. */
const DIGIT = byteRanges([0x30, 0x39]);
/** `[[:upper:]]`. */
const UPPER = byteRanges([0x41, 0x5a]);
/** `[[:lower:]]`. */
const LOWER = byteRanges([0x61, 0x7a]);
/** `[[:alpha:]]`. */
const ALPHA = unionOf(UPPER, LOWER);
/** `\w`, `[[:word:]]`. */
const WORD = unionOf(DIGIT, ALPHA, bytesOf(0x5f));
/** `\s`, `[[:space:]]`: tab, LF, VT, FF, CR, space. */
const SPACE = byteRanges([0x09, 0x0d], [0x20, 0x20]);
/** `[[:graph:]]`. */
const GRAPH = byteRanges([0x21, 0x7e]);
/** `[[:alnum:]]`. */
const ALNUM = unionOf(DIGIT, ALPHA);

/** The line feed — PCRE's newline here, the one byte `.` and `\N` exclude. */
export const NEWLINE = 0x0a;

/** Single-letter escapes that stand for a set, outside and inside classes. */
export const ESCAPE_SETS: Readonly<Record<string, ByteSet>> = {
  d: DIGIT,
  D: complementOf(DIGIT),
  s: SPACE,
  S: complementOf(SPACE),
  w: WORD,
  W: complementOf(WORD),
  h: bytesOf(0x09, 0x20, 0xa0),
  H: complementOf(bytesOf(0x09, 0x20, 0xa0)),
  v: byteRanges([0x0a, 0x0d], [0x85, 0x85]),
  V: complementOf(byteRanges([0x0a, 0x0d], [0x85, 0x85]))
};

/** POSIX class names inside a bracket class (`[[:alpha:]]`), negatable as `[:^alpha:]`. */
export const POSIX_SETS: Readonly<Record<string, ByteSet>> = {
  alnum: ALNUM,
  alpha: ALPHA,
  ascii: byteRanges([0x00, 0x7f]),
  blank: bytesOf(0x09, 0x20),
  cntrl: byteRanges([0x00, 0x1f], [0x7f, 0x7f]),
  digit: DIGIT,
  graph: GRAPH,
  lower: LOWER,
  print: byteRanges([0x20, 0x7e]),
  punct: GRAPH.map((member, byte) => (ALNUM[byte] === 1 ? 0 : member)),
  space: SPACE,
  upper: UPPER,
  word: WORD,
  xdigit: byteRanges([0x30, 0x39], [0x41, 0x46], [0x61, 0x66])
};

/** Bytes written as themselves in emitted JS source (inside and outside classes). */
const PLAIN = /^[A-Za-z0-9_]$/;

/** One byte as JS source text that matches exactly that unit. */
function byteSource(byte: number): string {
  const char = String.fromCharCode(byte);
  return PLAIN.test(char) ? char : `\\x${byte.toString(16).padStart(2, '0')}`;
}

/** The members of `set` as JS class body ranges (`a-z\x2d`). */
function rangesSource(set: ByteSet): string {
  let body = '';
  let byte = 0;
  while (byte < BYTE_COUNT) {
    if (set[byte] !== 1) {
      byte++;
      continue;
    }
    let end = byte;
    while (end + 1 < BYTE_COUNT && set[end + 1] === 1) end++;
    body += byte === end ? byteSource(byte) : `${byteSource(byte)}-${byteSource(end)}`;
    byte = end + 1;
  }
  return body;
}

/**
 * JS source matching exactly one unit in `set` (units are bytes): a bare
 * byte, a class, or its negation — whichever lists fewer bytes. The source
 * is valid with or without JS's `u`-less flags and never depends on `i`.
 *
 * @param set The bytes to match.
 */
export function setSource(set: ByteSet): string {
  const size = sizeOf(set);
  if (size === BYTE_COUNT) return '[\\s\\S]';
  if (size === 0) return '[^\\s\\S]';
  if (size === 1) return byteSource(set.indexOf(1));
  return size <= BYTE_COUNT / 2
    ? `[${rangesSource(set)}]`
    : `[^${rangesSource(complementOf(set))}]`;
}
