/**
 * PCRE2 pattern parser for WP Rocket's regex rows, as its runtime compiles
 * them: no UTF option, so the pattern and the subject are byte strings (one
 * UTF-16 unit per byte, 0x00–0xFF — see `toByteString`). It builds the tree
 * the translator emits JS from and records every construct it does not
 * translate:
 *
 * - `invalid` — PCRE2 rejects the pattern at compile time. Only shapes
 *   observed failing on PCRE2 10.44 and 10.49 are claimed (an unproven claim
 *   would say WP Rocket drops a row it keeps);
 * - `pcre-only` — valid or unknown PCRE syntax with no proven JS equivalent.
 *   Anything this parser does not recognize lands here (fail closed); a
 *   construct whose extent it cannot tell stops the parse (`complete` false).
 *
 * Every character position reduces to a {@link ByteSet}; caseless matching
 * (PCRE's `i`: ASCII letters only) is folded into the sets as they are built,
 * before a class is negated — as PCRE does.
 */
import {
  ESCAPE_SETS,
  NEWLINE,
  POSIX_SETS,
  bytesOf,
  byteRanges,
  complementOf,
  foldAsciiCase,
  unionOf,
  type ByteSet
} from './byte-set';

/** A zero-width assertion, by meaning (each PCRE spelling maps to one). */
export type Assertion =
  | 'subject-start'
  | 'search-start'
  | 'end-or-final-newline'
  | 'subject-end'
  | 'word-boundary'
  | 'not-word-boundary';

/** What a parenthesized group does. `opaque` = a PCRE-only group (atomic, branch reset…). */
export type GroupKind =
  | 'capture'
  | 'group'
  | 'lookahead'
  | 'negative-lookahead'
  | 'lookbehind'
  | 'negative-lookbehind'
  | 'opaque';

/** One element of a parsed pattern. */
export type PatternNode =
  | { readonly type: 'set'; readonly set: ByteSet }
  | { readonly type: 'assert'; readonly assertion: Assertion }
  /** `\R`: CRLF, or one of LF VT FF CR NEL — atomically. */
  | { readonly type: 'linebreak' }
  | {
      readonly type: 'group';
      readonly kind: GroupKind;
      /** The capture number (`capture` groups only). */
      readonly capture: number | null;
      readonly alternatives: readonly (readonly PatternNode[])[];
    }
  /** A numbered back-reference; `absolute` false for the relative `\g{-n}` forms. */
  | { readonly type: 'backref'; readonly group: number; readonly absolute: boolean }
  | {
      readonly type: 'repeat';
      readonly node: PatternNode;
      readonly min: number;
      /** `null` = unbounded. */
      readonly max: number | null;
      readonly lazy: boolean;
    }
  /** `\K`: resets the reported match start. */
  | { readonly type: 'keep' }
  /** An unscoped option setting `(?…)`; `caseless` when it only sets `i`. */
  | { readonly type: 'option'; readonly caselessOnly: boolean }
  /** A PCRE-only atom (`\p{…}`, a subroutine call…): matching unknown. */
  | { readonly type: 'opaque' };

/** A construct the parser does not translate, located in the parsed text. */
export interface ParseIssue {
  readonly kind: 'invalid' | 'pcre-only';
  /** The construct as written (a slice of the parsed text). */
  readonly construct: string;
  /** What is wrong, for the reason text. */
  readonly detail: string;
}

/** The parse of one pattern. */
export interface ParsedPattern {
  /** Top-level alternatives. */
  readonly alternatives: readonly (readonly PatternNode[])[];
  /** Every issue, in source order (reference checks last). */
  readonly issues: readonly ParseIssue[];
  /** `false` when a construct of unknown extent stopped the parse early. */
  readonly complete: boolean;
  /** Capture groups opened. */
  readonly groupCount: number;
  /** Group names, in source order (with repeats). */
  readonly names: readonly string[];
  /** The pattern can legitimately repeat a name (`(?J)`, or a branch reset `(?|`). */
  readonly allowsDuplicateNames: boolean;
  /**
   * A `\Q` runs to the end of the pattern: joined into a larger pattern it
   * would quote the rest (WP Rocket's Defer wrapper `)` included).
   */
  readonly unterminatedQuote: boolean;
}

/** Largest `{n,m}` count PCRE2 accepts. */
const MAX_REPEAT = 65_535;
/** Longest lookbehind PCRE2 accepts (its default `max_varlookbehind`). */
const MAX_LOOKBEHIND = 255;
/** Largest byte value an octal or hex escape may carry without UTF. */
const MAX_BYTE = 0xff;

/** Longest construct text a stopped parse names. */
const STOP_CONSTRUCT_LENGTH = 16;
/** Letter escapes PCRE2 rejects, inside and outside classes (observed). */
const UNKNOWN_LETTER_ESCAPES = new Set('ijlmquyFIJLMOTUY');
/** Escapes valid outside classes that PCRE2 rejects inside one (observed). */
const OUTSIDE_ONLY_ESCAPES = new Set('ABCGKNRXZz');
/** Characters after `(?` that PCRE2 rejects outright (observed). */
const INVALID_AFTER_GROUP_QUERY = new Set(' "$%,./;?@[\\]_`{}~');
/** Single-character escapes for control bytes. */
const CONTROL_ESCAPES: Readonly<Record<string, number>> = {
  a: 0x07,
  e: 0x1b,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09
};

/** A `{…}` quantifier without spaces (`{n}`, `{n,}`, `{n,m}`, `{,m}`). */
const BRACE_QUANTIFIER = /^\{(?:(\d+)(,(\d*))?|,(\d+))\}/;
/** A brace that PCRE2 ≥ 10.43 reads as a quantifier only thanks to inner spaces. */
const SPACED_BRACE_QUANTIFIER = /^\{[ \t]*(?:\d+[ \t]*(?:,[ \t]*\d*[ \t]*)?|,[ \t]*\d+[ \t]*)\}/;
/** A group name. */
const GROUP_NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

/** Thrown to stop parsing at a construct of unknown extent (caught by {@link parsePcre}). */
class StopParse extends Error {}

/** A reference whose target can only be checked once the whole pattern is parsed. */
type PendingReference =
  | { readonly by: 'number'; readonly group: number; readonly construct: string }
  | { readonly by: 'name'; readonly name: string; readonly construct: string };

/** Parsing state for one pattern (see {@link parsePcre}). */
class Parser {
  private pos = 0;
  private groupCount = 0;
  private allowsDuplicateNames = false;
  private unterminatedQuote = false;
  private readonly issues: ParseIssue[] = [];
  private readonly names: string[] = [];
  private readonly pending: PendingReference[] = [];

  /**
   * @param src The pattern as a byte string, between its delimiters.
   * @param caseless Fold ASCII case into every set (PCRE's `i`).
   */
  constructor(
    private readonly src: string,
    private readonly caseless: boolean
  ) {}

  /** Parse the whole pattern. */
  run(): ParsedPattern {
    let alternatives: PatternNode[][] = [];
    let complete = true;
    try {
      alternatives = this.alternatives(0);
      while (this.pos < this.src.length) {
        // Only an unmatched `)` ends the top level early.
        this.issue('invalid', this.pos, this.pos + 1, 'unmatched closing parenthesis');
        this.pos++;
        alternatives.push(...this.alternatives(0));
      }
      this.checkReferences();
    } catch (error) {
      if (!(error instanceof StopParse)) throw error;
      complete = false;
    }
    return {
      alternatives,
      issues: this.issues,
      complete,
      groupCount: this.groupCount,
      names: this.names,
      allowsDuplicateNames: this.allowsDuplicateNames,
      unterminatedQuote: this.unterminatedQuote
    };
  }

  /** Record an issue for `src[start, end)`. */
  private issue(kind: ParseIssue['kind'], start: number, end: number, detail: string): void {
    this.issues.push({ kind, construct: this.src.slice(start, end), detail });
  }

  /**
   * Record a PCRE-only construct whose extent is unknown, and stop. The
   * construct is named up to its first `)` (at most a few characters).
   */
  private stop(start: number, detail: string): never {
    const close = this.src.indexOf(')', start);
    const end = close === -1 || close - start > STOP_CONSTRUCT_LENGTH ? start + 3 : close + 1;
    this.issue('pcre-only', start, Math.min(this.src.length, end), detail);
    throw new StopParse();
  }

  /** The character at `pos + offset` (`''` past the end). */
  private peek(offset = 0): string {
    return this.src.charAt(this.pos + offset);
  }

  /** A literal byte as a set (case-folded when caseless). */
  private literal(byte: number): PatternNode {
    return { type: 'set', set: this.fold(bytesOf(byte)) };
  }

  /** Fold a set when caseless. */
  private fold(set: ByteSet): ByteSet {
    return this.caseless ? foldAsciiCase(set) : set;
  }

  /** Alternatives up to a `)` (not consumed) or the end. */
  private alternatives(depth: number): PatternNode[][] {
    const alternatives = [this.sequence(depth)];
    while (this.peek() === '|') {
      this.pos++;
      alternatives.push(this.sequence(depth));
    }
    return alternatives;
  }

  /**
   * One alternative: atoms, each optionally quantified. `\Q…\E` literal
   * runs and stray `\E` add no atom of their own, so a quantifier after them
   * applies to the atom before.
   */
  private sequence(depth: number): PatternNode[] {
    const nodes: PatternNode[] = [];
    // Whether the last node may take a quantifier now.
    let quantifiable = false;
    let quoting = false;
    while (this.pos < this.src.length) {
      const char = this.peek();
      if (quoting) {
        if (char === '\\' && this.peek(1) === 'E') {
          quoting = false;
          this.pos += 2;
        } else {
          nodes.push(this.literal(this.src.charCodeAt(this.pos++)));
          quantifiable = true;
        }
        continue;
      }
      if (char === '|' || char === ')') break;
      if (char === '\\' && this.peek(1) === 'Q') {
        quoting = true;
        this.pos += 2;
        continue;
      }
      if (char === '\\' && this.peek(1) === 'E') {
        this.pos += 2;
        continue;
      }
      if (this.quantifierAhead()) {
        this.quantify(nodes, quantifiable);
        quantifiable = false;
        continue;
      }
      const node = this.atom(depth);
      nodes.push(node);
      quantifiable = isQuantifiable(node);
    }
    if (quoting) this.unterminatedQuote = true;
    return nodes;
  }

  /**
   * Skip `\E` and empty `\Q\E` markers: PCRE reads a quantifier's lazy or
   * possessive suffix, and any quantifier after it, across them.
   */
  private skipQuoteMarkers(): void {
    for (;;) {
      if (this.src.startsWith('\\E', this.pos)) this.pos += 2;
      else if (this.src.startsWith('\\Q\\E', this.pos)) this.pos += 4;
      else return;
    }
  }

  /** Whether a quantifier starts at `pos`. */
  private quantifierAhead(): boolean {
    const char = this.peek();
    if (char === '*' || char === '+' || char === '?') return true;
    if (char !== '{') return false;
    const rest = this.src.slice(this.pos);
    return BRACE_QUANTIFIER.test(rest) || SPACED_BRACE_QUANTIFIER.test(rest);
  }

  /** Parse the quantifier at `pos` and apply it to the last node. */
  private quantify(nodes: PatternNode[], quantifiable: boolean): void {
    const start = this.pos;
    const bounds = this.bounds();
    const target = nodes.at(-1);
    if (!quantifiable || target === undefined) {
      this.issue('invalid', start, this.pos, 'quantifier with nothing to repeat');
      return;
    }
    let lazy = false;
    this.skipQuoteMarkers();
    if (this.peek() === '?') {
      lazy = true;
      this.pos++;
    } else if (this.peek() === '+') {
      this.pos++;
      this.issue('pcre-only', start, this.pos, 'possessive quantifier');
      nodes[nodes.length - 1] = { type: 'opaque' };
      this.rejectFollowingQuantifier();
      return;
    }
    if (bounds !== null) {
      nodes[nodes.length - 1] = { type: 'repeat', node: target, ...bounds, lazy };
      if (target.type === 'group' && isLookaround(target.kind)) {
        this.issue('pcre-only', start, this.pos, 'quantified assertion');
      }
    }
    this.rejectFollowingQuantifier();
  }

  /** A quantifier right after a complete one is a PCRE compile error. */
  private rejectFollowingQuantifier(): void {
    this.skipQuoteMarkers();
    if (!this.quantifierAhead()) return;
    const start = this.pos;
    this.bounds();
    this.issue('invalid', start, this.pos, 'quantifier following a quantifier');
  }

  /**
   * Consume a quantifier's bounds; `null` when they are not translatable
   * (spaced braces — recorded as PCRE-only — or out-of-range counts —
   * recorded as invalid).
   */
  private bounds(): { min: number; max: number | null } | null {
    const char = this.src.charAt(this.pos++);
    if (char === '*') return { min: 0, max: null };
    if (char === '+') return { min: 1, max: null };
    if (char === '?') return { min: 0, max: 1 };
    const start = this.pos - 1;
    const rest = this.src.slice(start);
    const plain = BRACE_QUANTIFIER.exec(rest);
    if (plain === null) {
      this.pos = start + (SPACED_BRACE_QUANTIFIER.exec(rest)?.[0].length ?? 1);
      this.issue('pcre-only', start, this.pos, 'quantifier with spaces');
      return null;
    }
    this.pos = start + plain[0].length;
    const [, minText, comma, maxText, onlyMax] = plain;
    const min = minText === undefined ? 0 : Number(minText);
    const max =
      onlyMax !== undefined
        ? Number(onlyMax)
        : comma === undefined
          ? min
          : maxText === ''
            ? null
            : Number(maxText);
    if (min > MAX_REPEAT || (max !== null && max > MAX_REPEAT)) {
      this.issue('invalid', start, this.pos, 'number too big in {} quantifier');
      return null;
    }
    if (max !== null && max < min) {
      this.issue('invalid', start, this.pos, 'numbers out of order in {} quantifier');
      return null;
    }
    return { min, max };
  }

  /** One atom at `pos` (never a quantifier). */
  private atom(depth: number): PatternNode {
    const char = this.peek();
    if (char === '(') return this.group(depth);
    if (char === '[') return this.characterClass();
    if (char === '\\') return this.escape();
    this.pos++;
    if (char === '.') return { type: 'set', set: complementOf(bytesOf(NEWLINE)) };
    if (char === '^') return { type: 'assert', assertion: 'subject-start' };
    if (char === '$') return { type: 'assert', assertion: 'end-or-final-newline' };
    return this.literal(char.charCodeAt(0));
  }

  /** An escape outside a class. */
  private escape(): PatternNode {
    const start = this.pos;
    this.pos++;
    if (this.pos >= this.src.length) {
      this.issue('invalid', start, this.pos, '\\ at end of pattern');
      return { type: 'opaque' };
    }
    const char = this.src.charAt(this.pos++);
    const byte = this.byteEscape(char, start, false);
    if (byte !== undefined) return byte === null ? { type: 'opaque' } : this.literal(byte);
    const set = ESCAPE_SETS[char];
    if (set !== undefined) return { type: 'set', set };
    switch (char) {
      case 'N':
        if (this.peek() === '{') this.stop(start, '\\N{…}');
        return { type: 'set', set: complementOf(bytesOf(NEWLINE)) };
      case 'R':
        return { type: 'linebreak' };
      case 'b':
        return { type: 'assert', assertion: 'word-boundary' };
      case 'B':
        return { type: 'assert', assertion: 'not-word-boundary' };
      case 'A':
        return { type: 'assert', assertion: 'subject-start' };
      case 'z':
        return { type: 'assert', assertion: 'subject-end' };
      case 'Z':
        return { type: 'assert', assertion: 'end-or-final-newline' };
      case 'G':
        return { type: 'assert', assertion: 'search-start' };
      case 'K':
        return { type: 'keep' };
      case 'g':
        return this.gReference(start);
      case 'k':
        return this.namedReference(start);
      case 'p':
      case 'P':
        if (this.peek() === '{') this.skipPast('}', start);
        else this.pos++;
        this.issue('pcre-only', start, this.pos, 'Unicode property');
        return { type: 'opaque' };
      case 'X':
      case 'C':
        this.issue('pcre-only', start, this.pos, `\\${char}`);
        return { type: 'opaque' };
    }
    // Every letter is handled above; only the digits 1–9 remain.
    return this.numericEscape(start);
  }

  /**
   * Escapes that stand for one byte, shared by classes and the top level:
   * controls, `\0` octal, `\o{…}`, `\x…`, `\cX`, and every unknown or
   * non-alphanumeric escape. Returns the byte, `null` after recording an
   * issue, or `undefined` when `char` is not such an escape.
   */
  private byteEscape(char: string, start: number, inClass: boolean): number | null | undefined {
    const control = CONTROL_ESCAPES[char];
    if (control !== undefined) return control;
    if (char === '0') return this.octalDigits(2, 0);
    if (char === 'o') return this.bracedNumber(start, 8);
    if (char === 'x') {
      if (this.peek() === '{') return this.bracedNumber(start, 16);
      const hex = /^[0-9A-Fa-f]{1,2}/.exec(this.src.slice(this.pos))?.[0];
      if (hex === undefined) {
        this.issue('invalid', start, this.pos, '\\x without hexadecimal digits');
        return null;
      }
      this.pos += hex.length;
      return parseInt(hex, 16);
    }
    if (char === 'c') {
      const target = this.src.charCodeAt(this.pos);
      if (!(target >= 0x20 && target <= 0x7e)) {
        this.issue(
          'invalid',
          start,
          Math.min(this.pos + 1, this.src.length),
          '\\c needs a printable ASCII character'
        );
        return null;
      }
      this.pos++;
      // Lower case is upper-cased first, then bit 6 flips (`\ca` = `\cA` = 0x01).
      const upper = target >= 0x61 && target <= 0x7a ? target - 0x20 : target;
      return upper ^ 0x40;
    }
    if (UNKNOWN_LETTER_ESCAPES.has(char) || (inClass && OUTSIDE_ONLY_ESCAPES.has(char))) {
      this.issue('invalid', start, this.pos, `unrecognized escape \\${char}`);
      return null;
    }
    // Any other non-alphanumeric character (ASCII or not) stands for itself.
    if (!/[A-Za-z0-9]/.test(char)) return char.charCodeAt(0);
    return undefined;
  }

  /** Up to `count` more octal digits after a leading digit worth `value`. */
  private octalDigits(count: number, value: number): number {
    let result = value;
    for (let i = 0; i < count && /[0-7]/.test(this.peek()); i++) {
      result = result * 8 + Number(this.src.charAt(this.pos++));
    }
    return result;
  }

  /** `\o{…}` / `\x{…}`: a braced number in `radix`, at most 0xFF without UTF. */
  private bracedNumber(start: number, radix: 8 | 16): number | null {
    if (this.peek() !== '{') {
      this.issue('invalid', start, this.pos, '\\o without {…}');
      return null;
    }
    const digits = radix === 8 ? /^\{([0-7]+)\}/ : /^\{([0-9A-Fa-f]+)\}/;
    const match = digits.exec(this.src.slice(this.pos));
    if (match === null) {
      const close = this.src.indexOf('}', this.pos);
      const empty = this.peek(1) === '}';
      if (close === -1 || empty || radix === 8) {
        this.pos = close === -1 ? this.src.length : close + 1;
        this.issue('invalid', start, this.pos, 'malformed braced character code');
        return null;
      }
      this.stop(start, 'braced character code');
    }
    this.pos += match[0].length;
    const value = parseInt(match[1] ?? '', radix);
    if (value > MAX_BYTE) {
      this.issue('invalid', start, this.pos, 'character code above \\xff without UTF');
      return null;
    }
    return value;
  }

  /**
   * `\1`…`\9…` outside a class: a back-reference when the number is below
   * 10, starts with 8 or 9, or no greater than the groups opened so far;
   * otherwise up to three octal digits (above \377 is an error).
   */
  private numericEscape(start: number): PatternNode {
    const digits = /^\d+/.exec(this.src.slice(start + 1))?.[0] ?? '';
    const number = Number(digits);
    if (number < 10 || /^[89]/.test(digits) || number <= this.groupCount) {
      this.pos = start + 1 + digits.length;
      return this.numberedReference(number, true, start);
    }
    this.pos = start + 1;
    const value = this.octalDigits(3, 0);
    if (value > MAX_BYTE) {
      this.issue('invalid', start, this.pos, 'octal value above \\377');
      return { type: 'opaque' };
    }
    return this.literal(value);
  }

  /** A numbered back-reference, checked against the total group count at the end. */
  private numberedReference(group: number, absolute: boolean, start: number): PatternNode {
    const construct = this.src.slice(start, this.pos);
    if (group < 1) {
      this.issue('invalid', start, this.pos, 'reference to group 0 or before the first group');
      return { type: 'opaque' };
    }
    this.pending.push({ by: 'number', group, construct });
    return { type: 'backref', group, absolute };
  }

  /** `\g…`: numbered (absolute or relative) back-reference, or PCRE-only forms. */
  private gReference(start: number): PatternNode {
    const rest = this.src.slice(this.pos);
    const braced = /^\{(-?)(\d+)\}/.exec(rest) ?? /^(-?)(\d+)/.exec(rest);
    if (braced !== null) {
      this.pos += braced[0].length;
      const [, minus, digits] = braced;
      const number = Number(digits);
      if (minus === '') return this.numberedReference(number, true, start);
      return this.numberedReference(this.groupCount - number + 1, false, start);
    }
    const named = /^\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(rest);
    if (named !== null) {
      this.pos += named[0].length;
      this.pending.push({
        by: 'name',
        name: named[1] ?? '',
        construct: this.src.slice(start, this.pos)
      });
      this.issue('pcre-only', start, this.pos, 'named back-reference');
      return { type: 'opaque' };
    }
    const subroutine = /^(?:<[^>]*>|'[^']*'|\{\+\d+\}|\+\d+)/.exec(rest);
    if (subroutine !== null) {
      this.pos += subroutine[0].length;
      this.issue('pcre-only', start, this.pos, 'subroutine call or relative reference');
      return { type: 'opaque' };
    }
    this.issue('invalid', start, this.pos, 'malformed \\g reference');
    return { type: 'opaque' };
  }

  /** `\k<n>`, `\k'n'`, `\k{n}`: named back-references (PCRE-only); bare `\k` is an error. */
  private namedReference(start: number): PatternNode {
    const named = /^(?:<([A-Za-z_]\w*)>|'([A-Za-z_]\w*)'|\{([A-Za-z_]\w*)\})/.exec(
      this.src.slice(this.pos)
    );
    if (named === null) {
      if (!/^[<'{]/.test(this.peek())) {
        this.issue('invalid', start, this.pos, '\\k is not followed by a group name');
        return { type: 'opaque' };
      }
      this.stop(start, 'named back-reference');
    }
    this.pos += named[0].length;
    const name = named[1] ?? named[2] ?? named[3] ?? '';
    this.pending.push({ by: 'name', name, construct: this.src.slice(start, this.pos) });
    this.issue('pcre-only', start, this.pos, 'named back-reference');
    return { type: 'opaque' };
  }

  /** Move past the next `char`, or stop when there is none. */
  private skipPast(char: string, start: number): void {
    const index = this.src.indexOf(char, this.pos);
    if (index === -1) this.stop(start, 'unterminated construct');
    this.pos = index + 1;
  }

  /** A bracket class. */
  private characterClass(): PatternNode {
    const start = this.pos;
    this.pos++;
    if (/^[:.=]/.test(this.peek())) {
      // `[:alpha:]` at the top level is an error, `[:a]` is not: not modeled.
      this.issue('pcre-only', start, this.pos + 1, 'class starting like a POSIX class');
    }
    const negated = this.peek() === '^';
    if (negated) this.pos++;
    let members: ByteSet = new Uint8Array(256);
    let first = true;
    while (this.pos < this.src.length && (first || this.peek() !== ']')) {
      first = false;
      const item = this.classItem();
      if (item === null) continue;
      if (
        item.byte !== null &&
        this.peek() === '-' &&
        this.peek(1) !== ']' &&
        this.peek(1) !== ''
      ) {
        this.pos++;
        const high = this.classItem();
        if (high === null) continue;
        if (high.byte === null) {
          this.issue('invalid', start, this.pos, 'invalid range in character class');
          continue;
        }
        if (high.byte < item.byte) {
          this.issue('invalid', start, this.pos, 'range out of order in character class');
          continue;
        }
        members = unionOf(members, byteRanges([item.byte, high.byte]));
        continue;
      }
      if (
        item.byte === null &&
        this.peek() === '-' &&
        this.peek(1) !== ']' &&
        this.peek(1) !== ''
      ) {
        this.issue('invalid', start, this.pos + 1, 'invalid range in character class');
      }
      members = unionOf(members, item.set);
    }
    if (this.pos >= this.src.length) {
      this.issue('invalid', start, this.pos, 'missing terminating ] for character class');
      return { type: 'opaque' };
    }
    this.pos++;
    const folded = this.fold(members);
    return { type: 'set', set: negated ? complementOf(folded) : folded };
  }

  /**
   * One class member: a single byte (`byte` set, may start a range) or a
   * multi-byte set (`byte` null). `null` after an issue.
   */
  private classItem(): { byte: number | null; set: ByteSet } | null {
    const char = this.peek();
    if (char === '[' && /^[:.=]/.test(this.peek(1))) {
      const posix = this.posixClass();
      if (posix !== undefined) return posix === null ? null : { byte: null, set: posix };
    }
    this.pos++;
    if (char !== '\\') return { byte: char.charCodeAt(0), set: bytesOf(char.charCodeAt(0)) };
    const escapeStart = this.pos - 1;
    const letter = this.src.charAt(this.pos++);
    if (letter === '') return null;
    if (letter === 'b') return { byte: 0x08, set: bytesOf(0x08) };
    const set = ESCAPE_SETS[letter];
    if (set !== undefined) return { byte: null, set };
    if (/[1-7]/.test(letter)) {
      const value = this.octalDigits(2, Number(letter));
      if (value > MAX_BYTE) {
        this.issue('invalid', escapeStart, this.pos, 'octal value above \\377');
        return null;
      }
      return { byte: value, set: bytesOf(value) };
    }
    if (letter === '8' || letter === '9') {
      return { byte: letter.charCodeAt(0), set: bytesOf(letter.charCodeAt(0)) };
    }
    const byte = this.byteEscape(letter, escapeStart, true);
    if (byte === null) return null;
    if (byte !== undefined) return { byte, set: bytesOf(byte) };
    this.issue('pcre-only', escapeStart, this.pos, `\\${letter} in a character class`);
    return null;
  }

  /**
   * A POSIX item `[:name:]` / `[:^name:]` inside a class: its set, `null`
   * after an issue, or `undefined` when the text is not POSIX syntax (no
   * matching terminator before the next `]` — then `[` is a literal).
   */
  private posixClass(): ByteSet | null | undefined {
    const kind = this.peek(1);
    const close = this.src.indexOf(']', this.pos + 2);
    if (close === -1 || close - 1 < this.pos + 2 || this.src.charAt(close - 1) !== kind) {
      return undefined;
    }
    const itemStart = this.pos;
    this.pos = close + 1;
    if (kind !== ':') {
      this.issue('invalid', itemStart, this.pos, 'POSIX collating elements are not supported');
      return null;
    }
    const body = this.src.slice(itemStart + 2, close - 1);
    const negated = body.startsWith('^');
    const set = POSIX_SETS[negated ? body.slice(1) : body];
    if (set === undefined) {
      this.issue('invalid', itemStart, this.pos, 'unknown POSIX class name');
      return null;
    }
    return negated ? complementOf(set) : set;
  }

  /** A parenthesized construct at `pos`. */
  private group(depth: number): PatternNode {
    const start = this.pos;
    this.pos++;
    if (this.peek() === '*') {
      if (this.peek(1) === ')') {
        this.pos += 2;
        this.issue('invalid', start, this.pos, '(*) is not a verb');
        return { type: 'opaque' };
      }
      this.stop(start, 'backtracking verb or alpha assertion');
    }
    if (this.peek() !== '?') {
      this.groupCount++;
      return this.groupBody(start, depth, 'capture', this.groupCount);
    }
    this.pos++;
    const char = this.peek();
    const next = this.peek(1);
    if (char === '') {
      this.issue('invalid', start, this.pos, 'missing closing parenthesis');
      return { type: 'opaque' };
    }
    if (char === ':') return this.consumeThen(1, () => this.groupBody(start, depth, 'group', null));
    if (char === '=')
      return this.consumeThen(1, () => this.groupBody(start, depth, 'lookahead', null));
    if (char === '!') {
      return this.consumeThen(1, () => this.groupBody(start, depth, 'negative-lookahead', null));
    }
    if (char === '<' && next === '=') {
      return this.consumeThen(2, () => this.groupBody(start, depth, 'lookbehind', null));
    }
    if (char === '<' && next === '!') {
      return this.consumeThen(2, () => this.groupBody(start, depth, 'negative-lookbehind', null));
    }
    if (char === '<') return this.namedGroup(start, depth, 1, '>', false);
    if (char === "'") return this.namedGroup(start, depth, 1, "'", true);
    if (char === 'P') return this.pythonGroup(start, depth);
    if (char === '>' || char === '|' || char === '*') {
      if (char === '|') this.allowsDuplicateNames = true;
      this.pos++;
      this.issue(
        'pcre-only',
        start,
        this.pos,
        char === '>' ? 'atomic group' : char === '|' ? 'branch reset group' : 'non-atomic lookahead'
      );
      return this.groupBody(start, depth, 'opaque', null);
    }
    if (char === '&') return this.namedCall(start, 1);
    if (char === 'R' && next === ')') {
      this.pos += 2;
      this.issue('pcre-only', start, this.pos, 'recursion');
      return { type: 'opaque' };
    }
    if (/[0-9]/.test(char) || ((char === '+' || char === '-') && /[0-9]/.test(next))) {
      return this.numberedCall(start);
    }
    if (char === '(') this.stop(start, 'conditional group');
    if (char === 'C') this.stop(start, 'callout');
    if (char === '+' || INVALID_AFTER_GROUP_QUERY.has(char)) {
      this.pos++;
      this.issue('invalid', start, this.pos, `unrecognized character after (?`);
      return { type: 'opaque' };
    }
    return this.optionSetting(start, depth);
  }

  /** Skip `count` characters, then run `then`. */
  private consumeThen(count: number, then: () => PatternNode): PatternNode {
    this.pos += count;
    return then();
  }

  /** A group's alternatives and its closing `)`. */
  private groupBody(
    start: number,
    depth: number,
    kind: GroupKind,
    capture: number | null
  ): PatternNode {
    const alternatives = this.alternatives(depth + 1);
    if (this.peek() !== ')') {
      this.issue('invalid', start, this.pos, 'missing closing parenthesis');
      return { type: 'group', kind, capture, alternatives };
    }
    this.pos++;
    const node: PatternNode = { type: 'group', kind, capture, alternatives };
    if (kind === 'lookbehind' || kind === 'negative-lookbehind') this.checkLookbehind(start, node);
    return node;
  }

  /** PCRE2 rejects a lookbehind longer than 255 bytes, or unbounded. */
  private checkLookbehind(start: number, node: PatternNode & { type: 'group' }): void {
    const length = alternativesMaxLength(node.alternatives);
    if (length > MAX_LOOKBEHIND) {
      this.issue(
        'invalid',
        start,
        this.pos,
        'lookbehind assertion is unbounded or longer than 255'
      );
    }
  }

  /**
   * A named capture `(?<n>…)` / `(?P<n>…)` (translated) or `(?'n'…)`
   * (PCRE-only); a bad or unterminated name is an error.
   */
  private namedGroup(
    start: number,
    depth: number,
    skip: number,
    terminator: string,
    pcreOnly: boolean
  ): PatternNode {
    this.pos += skip;
    const name = GROUP_NAME.exec(this.src.slice(this.pos))?.[0];
    if (name === undefined || this.peek(name.length) !== terminator) {
      this.pos = Math.min(this.src.length, this.pos + (name?.length ?? 0) + 1);
      this.issue('invalid', start, this.pos, 'malformed group name');
      return { type: 'opaque' };
    }
    this.pos += name.length + 1;
    this.names.push(name);
    this.groupCount++;
    if (pcreOnly) this.issue('pcre-only', start, this.pos, "(?'name'…) group");
    return this.groupBody(start, depth, 'capture', this.groupCount);
  }

  /** `(?P<n>…)`, `(?P=n)`, `(?P>n)`; any other `(?P` is an error. */
  private pythonGroup(start: number, depth: number): PatternNode {
    const kind = this.peek(1);
    if (kind === '<') return this.namedGroup(start, depth, 2, '>', false);
    if (kind === '=' || kind === '>') return this.namedCall(start, 2);
    this.pos++;
    this.issue('invalid', start, this.pos, 'unrecognized character after (?P');
    return { type: 'opaque' };
  }

  /** `(?&n)`, `(?P=n)`, `(?P>n)`: PCRE-only; a malformed or unknown name is an error. */
  private namedCall(start: number, skip: number): PatternNode {
    this.pos += skip;
    const name = GROUP_NAME.exec(this.src.slice(this.pos))?.[0];
    if (name === undefined || this.peek(name.length) !== ')') {
      this.pos = Math.min(this.src.length, this.pos + (name?.length ?? 0) + 1);
      this.issue('invalid', start, this.pos, 'malformed group name');
      return { type: 'opaque' };
    }
    this.pos += name.length + 1;
    const construct = this.src.slice(start, this.pos);
    this.pending.push({ by: 'name', name, construct });
    this.issue('pcre-only', start, this.pos, 'named reference or subroutine call');
    return { type: 'opaque' };
  }

  /** `(?n)`, `(?+n)`, `(?-n)`: subroutine calls (PCRE-only); `(?0)` recurses. */
  private numberedCall(start: number): PatternNode {
    const call = /^([+-]?)(\d+)/.exec(this.src.slice(this.pos));
    const sign = call?.[1] ?? '';
    const digits = call?.[2] ?? '';
    this.pos += sign.length + digits.length;
    if (this.peek() !== ')') {
      this.issue('invalid', start, this.pos, 'malformed subroutine call');
      return { type: 'opaque' };
    }
    this.pos++;
    const number = Number(digits);
    const target =
      sign === '+'
        ? this.groupCount + number
        : sign === '-'
          ? this.groupCount - number + 1
          : number;
    this.issue('pcre-only', start, this.pos, number === 0 ? 'recursion' : 'subroutine call');
    if (number !== 0) {
      if (target < 1)
        this.issue('invalid', start, this.pos, 'reference to a group that does not exist');
      else
        this.pending.push({
          by: 'number',
          group: target,
          construct: this.src.slice(start, this.pos)
        });
    }
    return { type: 'opaque' };
  }

  /**
   * An option setting: `(?letters)` / `(?letters-letters)` / `(?^…)`
   * unscoped, or `(?…:…)` scoped. Only `i` is translated (both features
   * already match caselessly); everything else is PCRE-only.
   */
  private optionSetting(start: number, depth: number): PatternNode {
    const letters = /^\^?[A-Za-z]*(?:-[A-Za-z]*)?/.exec(this.src.slice(this.pos))?.[0] ?? '';
    this.pos += letters.length;
    const end = this.peek();
    if (end === '') {
      this.issue('invalid', start, this.pos, 'missing closing parenthesis');
      return { type: 'opaque' };
    }
    if (end !== ')' && end !== ':') this.stop(start, 'option setting');
    this.pos++;
    if (/J/.test(letters.split('-')[0] ?? '')) this.allowsDuplicateNames = true;
    const caselessOnly = letters === 'i';
    if (end === ')') {
      if (!caselessOnly) this.issue('pcre-only', start, this.pos, 'option setting');
      return { type: 'option', caselessOnly };
    }
    if (caselessOnly) return this.groupBody(start, depth, 'group', null);
    this.issue('pcre-only', start, this.pos, 'scoped option setting');
    return this.groupBody(start, depth, 'opaque', null);
  }

  /** Check every reference against the whole pattern's groups and names. */
  private checkReferences(): void {
    for (const reference of this.pending) {
      const missing =
        reference.by === 'number'
          ? reference.group > this.groupCount
          : !this.names.includes(reference.name);
      if (missing) {
        this.issues.push({
          kind: 'invalid',
          construct: reference.construct,
          detail: 'reference to a group that does not exist'
        });
      }
    }
    if (this.allowsDuplicateNames) return;
    const repeated = this.names.find((name, index) => this.names.indexOf(name) !== index);
    if (repeated !== undefined) {
      this.issues.push({
        kind: 'invalid',
        construct: repeated,
        detail: 'two groups share a name'
      });
    }
  }
}

/** Whether a group kind is a lookaround assertion. */
export function isLookaround(kind: GroupKind): boolean {
  return kind !== 'capture' && kind !== 'group' && kind !== 'opaque';
}

/** Whether PCRE lets a quantifier follow this node. */
function isQuantifiable(node: PatternNode): boolean {
  return node.type !== 'assert' && node.type !== 'keep' && node.type !== 'option';
}

/**
 * The longest text a node can match, in bytes (`Infinity` when unbounded;
 * an opaque or back-reference node counts as unbounded, so a lookbehind
 * holding one is never wrongly accepted — only reported if it is also
 * provably too long, see the caller).
 */
export function maxLength(node: PatternNode): number {
  switch (node.type) {
    case 'set':
      return 1;
    case 'linebreak':
      return 2;
    case 'assert':
    case 'keep':
    case 'option':
      return 0;
    case 'group':
      return isLookaround(node.kind) ? 0 : alternativesMaxLength(node.alternatives);
    case 'repeat': {
      const body = maxLength(node.node);
      if (body === 0 || Number.isNaN(body)) return body;
      return node.max === null ? Infinity : body * node.max;
    }
    case 'backref':
    case 'opaque':
      return NaN;
  }
}

/** The longest text any of `alternatives` can match (see {@link maxLength}). */
function alternativesMaxLength(alternatives: readonly (readonly PatternNode[])[]): number {
  return Math.max(
    ...alternatives.map((nodes) => nodes.reduce((sum, child) => sum + maxLength(child), 0))
  );
}

/**
 * Parse a pattern as PCRE2 compiles it without UTF.
 *
 * @param src The pattern between its delimiters, as a byte string.
 * @param caseless Whether it runs with PCRE's `i`.
 * @returns The tree, the issues, and the group facts.
 */
export function parsePcre(src: string, caseless: boolean): ParsedPattern {
  return new Parser(src, caseless).run();
}
