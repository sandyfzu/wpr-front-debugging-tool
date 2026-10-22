/**
 * Byte sets: what one PCRE character position can match when a pattern runs
 * without the UTF option over a byte string (one unit per byte, 0x00–0xFF).
 * Every character class, escape and literal of a translated row reduces to
 * one of these, so matching facts are exact by construction and the JS
 * source is emitted from the set — never from PCRE syntax JS reads
 * differently. Members of the named sets are PCRE2's default (C locale)
 * tables, as observed over all 256 bytes.
 *
 * Hot path: a row is mostly literals, so literal sets are shared (one per
 * byte and case mode) and each set's JS source is computed once.
 */

/** A set of bytes: index = byte, value 1 = member. Treat as immutable. */
export type ByteSet = Readonly<Uint8Array>;

/** Bytes a set may hold. */
const BYTE_COUNT = 256;

/** An empty set the caller may fill (the only mutable sets). */
export function emptySet(): Uint8Array {
  return new Uint8Array(BYTE_COUNT);
}

/**
 * A set of the given inclusive ranges.
 *
 * @param ranges `[low, high]` pairs, each within 0x00–0xFF.
 */
export function byteRanges(...ranges: readonly (readonly [number, number])[]): ByteSet {
  const set = emptySet();
  for (const [low, high] of ranges) set.fill(1, low, high + 1);
  return set;
}

/** A set of single bytes. */
export function bytesOf(...bytes: readonly number[]): ByteSet {
  const set = emptySet();
  for (const byte of bytes) set[byte] = 1;
  return set;
}

/** Add every member of `source` to `target` (in place). */
export function addAll(target: Uint8Array, source: ByteSet): void {
  for (let byte = 0; byte < BYTE_COUNT; byte++) if (source[byte] === 1) target[byte] = 1;
}

/** The union of sets. */
export function unionOf(...sets: readonly ByteSet[]): ByteSet {
  const union = emptySet();
  for (const set of sets) addAll(union, set);
  return union;
}

/** Every byte not in `set`. */
export function complementOf(set: ByteSet): ByteSet {
  const complement = emptySet();
  for (let byte = 0; byte < BYTE_COUNT; byte++) complement[byte] = 1 - (set[byte] ?? 0);
  return complement;
}

/** Whether two sets share a byte. */
export function intersects(a: ByteSet, b: ByteSet): boolean {
  for (let byte = 0; byte < BYTE_COUNT; byte++) if (a[byte] === 1 && b[byte] === 1) return true;
  return false;
}

/** ASCII letter offset between cases. */
const CASE_OFFSET = 0x20;

/**
 * Add the other case of every ASCII letter in `set` (in place) — PCRE's
 * caseless matching without UTF: only ASCII letters have another case
 * (`é` never folds to `É`).
 */
export function foldInPlace(set: Uint8Array): void {
  for (let upper = 0x41; upper <= 0x5a; upper++) {
    if (set[upper] === 1 || set[upper + CASE_OFFSET] === 1) {
      set[upper] = 1;
      set[upper + CASE_OFFSET] = 1;
    }
  }
}

/** `set` with the other case of every ASCII letter added (see {@link foldInPlace}). */
export function foldAsciiCase(set: ByteSet): ByteSet {
  const folded = Uint8Array.from(set);
  foldInPlace(folded);
  return folded;
}

/** Shared literal sets: index `byte` (exact case) and `256 + byte` (caseless). */
const LITERALS: ByteSet[] = [];

/**
 * The set of one literal byte — shared, never mutate it.
 *
 * @param byte The byte.
 * @param caseless Fold ASCII case (PCRE's `i`).
 */
export function literalSet(byte: number, caseless: boolean): ByteSet {
  const key = caseless ? BYTE_COUNT + byte : byte;
  let set = LITERALS[key];
  if (set === undefined) {
    set = caseless ? foldAsciiCase(bytesOf(byte)) : bytesOf(byte);
    LITERALS[key] = set;
  }
  return set;
}

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

/** `.` and `\N`: every byte but the newline. */
export const NOT_NEWLINE = complementOf(bytesOf(NEWLINE));

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

/**
 * POSIX class names inside a bracket class (`[[:alpha:]]`), negatable as
 * `[:^alpha:]`. Caseless, PCRE2 reads `lower` and `upper` as `alpha` before
 * negating (observed: `[[:^lower:]]` with `i` excludes `A` too) — see
 * {@link posixSet}.
 */
const POSIX_SETS: Readonly<Record<string, ByteSet>> = {
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

/**
 * A POSIX class's set, already negated when asked (`[:^name:]`), or
 * `undefined` for an unknown name.
 *
 * @param name The class name (`alpha`, …).
 * @param negated Whether it was written `[:^name:]`.
 * @param caseless PCRE's `i`: `lower`/`upper` mean `alpha`.
 */
export function posixSet(name: string, negated: boolean, caseless: boolean): ByteSet | undefined {
  const base = caseless && (name === 'lower' || name === 'upper') ? ALPHA : POSIX_SETS[name];
  if (base === undefined) return undefined;
  return negated ? complementOf(base) : base;
}

/** Bytes written as themselves in emitted JS source (inside and outside classes). */
const PLAIN = /^[A-Za-z0-9_]$/;

/** Each byte's JS source text (bare when plain, else `\xhh`). */
const BYTE_SOURCES: readonly string[] = Array.from({ length: BYTE_COUNT }, (_, byte) => {
  const char = String.fromCharCode(byte);
  return PLAIN.test(char) ? char : `\\x${byte.toString(16).padStart(2, '0')}`;
});

/** One byte as JS source text that matches exactly that unit. */
function byteSource(byte: number): string {
  return BYTE_SOURCES[byte] ?? '';
}

/** The members of `set` as JS class body ranges (`a-z\x2d`). */
function rangesSource(set: ByteSet, member: number): string {
  let body = '';
  let byte = 0;
  while (byte < BYTE_COUNT) {
    if (set[byte] !== member) {
      byte++;
      continue;
    }
    let end = byte;
    while (end + 1 < BYTE_COUNT && set[end + 1] === member) end++;
    body += byte === end ? byteSource(byte) : `${byteSource(byte)}-${byteSource(end)}`;
    byte = end + 1;
  }
  return body;
}

/** Sources already emitted, per set object (sets are immutable once built). */
const SOURCES = new WeakMap<ByteSet, string>();

/**
 * JS source matching exactly one unit in `set` (units are bytes): a bare
 * byte, a class, or its negation — whichever lists fewer bytes. The source
 * is valid with or without JS's `u`-less flags and never depends on `i`.
 *
 * @param set The bytes to match.
 */
export function setSource(set: ByteSet): string {
  const cached = SOURCES.get(set);
  if (cached !== undefined) return cached;
  let size = 0;
  for (let byte = 0; byte < BYTE_COUNT; byte++) size += set[byte] ?? 0;
  const source =
    size === BYTE_COUNT
      ? '[\\s\\S]'
      : size === 0
        ? '[^\\s\\S]'
        : size === 1
          ? byteSource(set.indexOf(1))
          : size <= BYTE_COUNT / 2
            ? `[${rangesSource(set, 1)}]`
            : `[^${rangesSource(set, 0)}]`;
  SOURCES.set(set, source);
  return source;
}
