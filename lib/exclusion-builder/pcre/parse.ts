/**
 * PCRE2 pattern parser for WP Rocket's regex rows, as its runtime compiles
 * them: no UTF option, so the pattern and the subject are byte strings (one
 * UTF-16 unit per byte, 0x00–0xFF — see `toByteString`). It builds the tree
 * the translator emits JS from and records every construct it does not
 * translate, by what is known of it:
 *
 * - `invalid` — PCRE2 rejects the pattern at compile time. Only shapes
 *   observed failing on both PCRE2 10.44 and 10.49 are claimed (an unproven
 *   claim would say WP Rocket drops a row it keeps);
 * - `untranslated` — PCRE2 accepts it (observed on both) but no JS
 *   equivalent is proven;
 * - `unknown` — whether PCRE2 accepts it is not modeled (or differs between
 *   versions). Anything this parser does not recognize lands here (fail
 *   closed); a construct whose extent it cannot tell stops the parse
 *   (`complete` false).
 *
 * Every character position reduces to a {@link ByteSet}; caseless matching
 * (PCRE's `i`: ASCII letters only) is folded into the sets as they are built,
 * before a class is negated — as PCRE does.
 */
import {
  ESCAPE_SETS,
  NOT_NEWLINE,
  addAll,
  bytesOf,
  emptySet,
  foldInPlace,
  literalSet,
  posixSet,
  setSize,
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
  /** An unscoped option setting `(?…)`; `noop` when it only sets `i`/`J` (matching unchanged). */
  | { readonly type: 'option'; readonly noop: boolean }
  /** A PCRE-only atom (`\p{…}`, a subroutine call…): matching unknown. */
  | { readonly type: 'opaque' };

/** How much is known about a construct the parser does not translate. */
export type IssueKind = 'invalid' | 'untranslated' | 'unknown';

/** A construct the parser does not translate, located in the parsed text. */
export interface ParseIssue {
  readonly kind: IssueKind;
  /** The construct as written (a slice of the parsed text). */
  readonly construct: string;
  /** What is wrong, for the reason text. */
  readonly detail: string;
  /** A subroutine call: its `unknown` (recursion) leaves the group facts trustworthy. */
  readonly call?: true;
  /**
   * An `invalid` issue other rows may repair once WP Rocket joins every Defer
   * row into `#(r1|r2|…)#`: a group reference (the wrapper and other rows
   * add groups and names), a parenthesis imbalance, or a repeated name (an
   * earlier row's `J` can license it).
   */
  readonly join?: JoinRepair;
  /** The construct runs to the end of the pattern (joined, the next row may complete it). */
  readonly atEnd?: true;
}

/** How a joined pattern can repair an invalid row (see {@link ParseIssue}). */
export type JoinRepair = 'reference' | 'parens' | 'names';

/** Extra facts an issue may carry. */
interface IssueTags {
  readonly call?: true;
  readonly join?: JoinRepair;
}

/**
 * A group name declaration, with the `J` option (duplicate names allowed)
 * in force there: `true`/`false` when set earlier in the pattern, `null`
 * when the pattern never set it — joined after other rows it inherits
 * theirs.
 */
export interface NameDeclaration {
  readonly name: string;
  readonly duplicatesAllowed: boolean | null;
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
  /** Group name declarations, in source order. */
  readonly names: readonly NameDeclaration[];
  /** The top-level `J` state at the end (`null` = never set): it leaks into a joined pattern's later rows. */
  readonly duplicatesAllowedAtEnd: boolean | null;
  /**
   * A `\Q` runs to the end of the pattern: joined into a larger pattern it
   * would quote the rest (WP Rocket's Defer wrapper `)` included).
   */
  readonly unterminatedQuote: boolean;
  /**
   * Parenthesis balance: `net` = groups opened minus closed (unmatched `)`
   * count −1), `min` = the lowest running depth — what joining needs to
   * tell whether the rows' parentheses balance out.
   */
  readonly parens: { readonly net: number; readonly min: number };
}

/** Largest `{n,m}` count PCRE2 accepts. */
const MAX_REPEAT = 65_535;
/** Longest lookbehind branch PCRE2 accepts when a branch varies in length. */
const MAX_VARIABLE_LOOKBEHIND = 255;
/** Longest fixed-length lookbehind branch PCRE2 accepts. */
const MAX_FIXED_LOOKBEHIND = 65_535;
/** Largest byte value an octal or hex escape may carry without UTF. */
const MAX_BYTE = 0xff;

/**
 * Errors of a construct still open at the pattern's end: joined, the text
 * after it (`|`, the next row, the wrapper's `)`) may complete it — `[a` +
 * `|b]`, `\c` + `|`, `(?i` + `)`. Self-contained errors (`\i`, `a**`) are
 * not listed.
 */
const OPEN_AT_END = new Set([
  '\\ at end of pattern',
  '\\c needs a printable ASCII character',
  'missing terminating ] for character class',
  '\\N{…} without UTF',
  'unterminated \\p{…}',
  'malformed \\p property',
  '\\o without {…}',
  'malformed braced character code',
  'malformed group name',
  'unrecognized character after (?P',
  'unrecognized character after (?',
  'malformed \\g reference',
  '\\k is not followed by a group name',
  'unrecognized option setting',
  'malformed subroutine call'
]);

/** Longest construct text a stopped parse names. */
const STOP_CONSTRUCT_LENGTH = 16;

/**
 * PCRE2's parenthesis nesting limit (observed 250 on 10.44 and 10.49: 251
 * open groups fail to compile). A group this deep stops the parse as
 * unknown: one level is Defer JS's joined wrapper (a row 250 deep is kept
 * at save yet breaks the joined pattern), and the bound keeps the
 * recursive parse and its consumers off the call stack's limit.
 */
const PCRE_NEST_LIMIT = 250;
/** Letter escapes PCRE2 rejects, inside and outside classes (observed). */
const UNKNOWN_LETTER_ESCAPES = new Set('ijlmquyFIJLMOTUY');
/** Escapes valid outside classes that PCRE2 rejects inside one (observed). */
const OUTSIDE_ONLY_ESCAPES = new Set('ABCGKNRXZz');
/** Characters after `(?` that PCRE2 rejects outright (observed). */
const INVALID_AFTER_GROUP_QUERY = new Set(' "$%,./;?@\\]_`{}~');

/**
 * PCRE2's backtracking verbs (bare or with a `:NAME` argument). Past the
 * pattern's start (where its start-of-pattern options such as `(*UTF)` are
 * read) any other upper-case `(*NAME` fails to compile — "(*VERB) not
 * recognized" on 10.44 and 10.49 alike (observed); lower-case names are alpha
 * assertions, whose list grows between versions, so they stay unmodeled.
 */
const BACKTRACKING_VERBS = new Set([
  'ACCEPT',
  'FAIL',
  'F',
  'COMMIT',
  'PRUNE',
  'SKIP',
  'THEN',
  'MARK'
]);

/** An upper-case `(*NAME` name (read after the `*`). */
const VERB_NAME = /^[A-Z][A-Z0-9_]*/;
/** Single-character escapes for control bytes. */
const CONTROL_ESCAPES: Readonly<Record<string, number>> = {
  a: 0x07,
  e: 0x1b,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09
};

/**
 * A `{…}` quantifier without spaces (`{n}`, `{n,}`, `{n,m}`, `{,m}`). The
 * `{,m}` form and inner spaces are quantifiers since PCRE2 10.43 only
 * (literal text on 10.42, which PHP 8.3 bundles) — the reference versions
 * here are 10.44 and 10.49.
 */
const BRACE_QUANTIFIER = /\{(?:(\d+)(,(\d*))?|,(\d+))\}/y;
/** A brace that PCRE2 ≥ 10.43 reads as a quantifier only thanks to inner spaces. */
const SPACED_BRACE_QUANTIFIER =
  /\{[ \t]*(?:(\d+)[ \t]*(,[ \t]*(\d*)[ \t]*)?|,[ \t]*(\d+)[ \t]*)\}/y;

/**
 * A sticky regex's match exactly at `pos` (no window: a quantifier's
 * digits may run past any fixed length — `x{0…01}` is `x{1}` to PCRE).
 *
 * @param regex A sticky (`y`) regex.
 * @param text The text.
 * @param pos Where the match must start.
 */
function matchAt(regex: RegExp, text: string, pos: number): RegExpExecArray | null {
  regex.lastIndex = pos;
  return regex.exec(text);
}
/** A group name. */
const GROUP_NAME = /^[A-Za-z_][A-Za-z0-9_]*/;
/**
 * Option letters PCRE2 10.44/10.49 accept (observed): `i m n s x J U r a`,
 * `x` repeatable, `a` optionally followed by one of `D S W P T`; `^` only
 * first and never with `-`; at most one `-`.
 */
const OPTION_LETTERS = '(?:[imnsxJUr]|a[DSWPT]?)*';
/** A whole valid option specification (see {@link OPTION_LETTERS}). */
const OPTION_SPEC = new RegExp(
  `^(?:\\^${OPTION_LETTERS}|${OPTION_LETTERS}(?:-${OPTION_LETTERS})?)$`
);

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
  /** Open branch reset groups `(?|…)` around the current position. */
  private branchResetDepth = 0;
  private unterminatedQuote = false;
  /** Running parenthesis depth and its minimum (see {@link ParsedPattern}). */
  private depth = 0;
  private minDepth = 0;
  /** Open lookaround groups around the current position. */
  private lookarounds = 0;
  /** The `J` option per open group (index 0 = top level); `null` = not set in this pattern. */
  private readonly duplicates: (boolean | null)[] = [null];
  private readonly issues: ParseIssue[] = [];
  private readonly names: NameDeclaration[] = [];
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
      alternatives = this.alternatives();
      while (this.pos < this.src.length) {
        // Only an unmatched `)` ends the top level early.
        this.issue('invalid', this.pos, this.pos + 1, 'unmatched closing parenthesis', {
          join: 'parens'
        });
        this.pos++;
        this.depth--;
        this.minDepth = Math.min(this.minDepth, this.depth);
        alternatives.push(...this.alternatives());
      }
      this.checkReferences();
      if (compiledSize(alternatives) > COMPILED_SIZE_BOUND) {
        const shown = Math.min(this.src.length, STOP_CONSTRUCT_LENGTH);
        this.issue('unknown', 0, shown, COMPILED_SIZE_DETAIL);
      }
      if (nullableRepeats(alternatives, 1) >= NULLABLE_REPEAT_BOUND) {
        const shown = Math.min(this.src.length, STOP_CONSTRUCT_LENGTH);
        this.issue('unknown', 0, shown, 'repeats an item that can match empty many times');
      }
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
      duplicatesAllowedAtEnd: this.duplicates[0] ?? null,
      unterminatedQuote: this.unterminatedQuote,
      parens: { net: this.depth, min: this.minDepth }
    };
  }

  /** Record an issue for `src[start, end)`, with its tags (see {@link ParseIssue}). */
  private issue(
    kind: IssueKind,
    start: number,
    end: number,
    detail: string,
    tags: IssueTags = {}
  ): void {
    this.issues.push({
      kind,
      construct: this.src.slice(start, end),
      detail,
      ...tags,
      ...(end >= this.src.length && OPEN_AT_END.has(detail) ? { atEnd: true as const } : {})
    });
  }

  /**
   * Record a construct of unknown extent and validity, and stop. The
   * construct is named up to its first `)` (at most a few characters).
   */
  private stop(start: number, detail: string): never {
    const close = this.src.indexOf(')', start);
    const end = close === -1 || close - start > STOP_CONSTRUCT_LENGTH ? start + 3 : close + 1;
    this.issue('unknown', start, Math.min(this.src.length, end), detail);
    throw new StopParse();
  }

  /**
   * Record a construct that fails to compile whatever follows it, and stop
   * (the row is dropped; its extent need not be known).
   */
  private reject(start: number, detail: string): never {
    const close = this.src.indexOf(')', start);
    const end = close === -1 || close - start > STOP_CONSTRUCT_LENGTH ? start + 3 : close + 1;
    this.issue('invalid', start, Math.min(this.src.length, end), detail);
    throw new StopParse();
  }

  /**
   * Reject a `(*` construct PCRE2 never compiles (pos is on the `*`):
   * `(**`, or an upper-case name that is no backtracking verb past the
   * pattern's start (a start-of-pattern option such as `(*UTF)` there, a
   * typo). Returns when the construct may compile.
   */
  private rejectVerb(start: number): void {
    if (this.peek(1) === '*') this.reject(start, 'unrecognized (*VERB)');
    if (start === 0) return;
    const name = VERB_NAME.exec(this.src.slice(this.pos + 1, this.pos + 1 + STOP_CONSTRUCT_LENGTH));
    if (name !== null && !BACKTRACKING_VERBS.has(name[0])) {
      this.reject(start, 'unrecognized (*VERB) (options such as (*UTF) only lead a pattern)');
    }
  }

  /**
   * A conditional group (pos is on the `(` after `(?`). Conditionals are not
   * modeled; only the two condition shapes that fail on 10.44 and 10.49
   * alike (observed) are rejected: `(?(` ending the pattern (joined, the
   * text after it may still close it) and the empty condition `(?()`.
   */
  private conditionStart(start: number): never {
    const next = this.peek(1);
    if (next === '') {
      this.pos = this.src.length;
      this.issue('invalid', start, this.pos, 'missing closing parenthesis', { join: 'parens' });
      throw new StopParse();
    }
    if (next === ')') this.reject(start, 'subpattern name expected in a condition');
    this.stop(start, 'conditional group');
  }

  /** The character at `pos + offset` (`''` past the end). */
  private peek(offset = 0): string {
    return this.src.charAt(this.pos + offset);
  }

  /** A literal byte as a set (case-folded when caseless). */
  private literal(byte: number): PatternNode {
    return { type: 'set', set: literalSet(byte, this.caseless) };
  }

  /** Alternatives up to a `)` (not consumed) or the end. */
  private alternatives(): PatternNode[][] {
    const alternatives = [this.sequence()];
    while (this.peek() === '|') {
      this.pos++;
      alternatives.push(this.sequence());
    }
    return alternatives;
  }

  /**
   * One alternative: atoms, each optionally quantified. `\Q…\E` literal
   * runs and stray `\E` add no atom of their own, so a quantifier after them
   * applies to the atom before.
   */
  private sequence(): PatternNode[] {
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
      const node = this.atom();
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
    return (
      matchAt(BRACE_QUANTIFIER, this.src, this.pos) !== null ||
      matchAt(SPACED_BRACE_QUANTIFIER, this.src, this.pos) !== null
    );
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
      this.issue('untranslated', start, this.pos, 'possessive quantifier');
    }
    if (bounds !== null) {
      // A possessive repeat keeps its node (its lengths still count); the issue blocks emission.
      nodes[nodes.length - 1] = { type: 'repeat', node: target, ...bounds, lazy };
      if (target.type === 'group' && bounds.max === 0) {
        // PCRE's start-of-match optimization reads a group (assertions too)
        // skipped with `{0}`: `(?=(?:a|b){0})` matches only some subjects
        // there (observed), all in JS — so no translation and no `match-all`.
        this.issue('untranslated', start, this.pos, 'group repeated zero times');
      } else if (target.type === 'group' && isLookaround(target.kind)) {
        this.issue('untranslated', start, this.pos, 'quantified assertion');
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
   * Consume a quantifier's bounds; `null` when they are out of range
   * (recorded as invalid). Spaced braces are recorded as untranslated.
   */
  private bounds(): { min: number; max: number | null } | null {
    const char = this.src.charAt(this.pos++);
    if (char === '*') return { min: 0, max: null };
    if (char === '+') return { min: 1, max: null };
    if (char === '?') return { min: 0, max: 1 };
    const start = this.pos - 1;
    const plain = matchAt(BRACE_QUANTIFIER, this.src, start);
    const match = plain ?? matchAt(SPACED_BRACE_QUANTIFIER, this.src, start);
    if (match === null) return null;
    this.pos = start + match[0].length;
    if (plain === null) this.issue('untranslated', start, this.pos, 'quantifier with spaces');
    const [, minText, comma, maxText, onlyMax] = match;
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
  private atom(): PatternNode {
    const char = this.peek();
    if (char === '(') return this.group();
    if (char === '[') return this.characterClass();
    if (char === '\\') return this.escape();
    this.pos++;
    if (char === '.') return { type: 'set', set: NOT_NEWLINE };
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
        if (this.peek() === '{' && !this.quantifierAhead()) {
          // `\N{U+…}` needs UTF mode: rejected on both versions (observed);
          // `\N{2}` is `\N` repeated.
          const close = this.src.indexOf('}', this.pos);
          this.pos = close === -1 ? this.src.length : close + 1;
          this.issue('invalid', start, this.pos, '\\N{…} without UTF');
          return { type: 'opaque' };
        }
        return { type: 'set', set: NOT_NEWLINE };
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
        if (this.lookarounds > 0) {
          // In an assertion `\K` can move the match start past its end; a
          // `preg_replace` then fails (observed): not modeled.
          this.issue('untranslated', start, this.pos, '\\K inside an assertion');
        }
        return { type: 'keep' };
      case 'g':
        return this.gReference(start);
      case 'k':
        return this.namedReference(start);
      case 'p':
      case 'P':
        return this.property(start);
      case 'X':
      case 'C':
        this.issue('untranslated', start, this.pos, `\\${char}`);
        return { type: 'opaque' };
    }
    // Every letter is handled above; only the digits 1–9 remain.
    return this.numericEscape(start);
  }

  /**
   * `\p…`/`\P…`: a Unicode property. Its names are not modeled (unknown);
   * a bare `\p`, a non-letter after it, or an unclosed `{` is rejected
   * (observed).
   */
  private property(start: number): PatternNode {
    const next = this.peek();
    if (next === '{') {
      const close = this.src.indexOf('}', this.pos);
      if (close === -1) {
        this.pos = this.src.length;
        this.issue('invalid', start, this.pos, 'unterminated \\p{…}');
        return { type: 'opaque' };
      }
      this.pos = close + 1;
    } else if (/^[A-Za-z]$/.test(next)) {
      this.pos++;
    } else {
      this.issue('invalid', start, this.pos, 'malformed \\p property');
      return { type: 'opaque' };
    }
    this.issue('unknown', start, this.pos, 'Unicode property');
    return { type: 'opaque' };
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
      const hex = /^[0-9A-Fa-f]{1,2}/.exec(this.src.slice(this.pos, this.pos + 2))?.[0];
      if (hex === undefined) {
        // NUL on PCRE2 10.44, an error on 10.49 (observed).
        this.issue(
          'unknown',
          start,
          this.pos,
          '\\x without hexadecimal digits (version-dependent)'
        );
        return null;
      }
      this.pos += hex.length;
      return parseInt(hex, 16);
    }
    if (char === 'c') {
      const target = this.src.charCodeAt(this.pos);
      if (!(target >= 0x20 && target <= 0x7e)) {
        const end = Math.min(this.pos + 1, this.src.length);
        this.issue('invalid', start, end, '\\c needs a printable ASCII character');
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
      // A relative reference before the first group finds the joined wrapper.
      this.issue('invalid', start, this.pos, 'reference to group 0 or before the first group', {
        ...(absolute ? {} : { join: 'reference' as const })
      });
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
      const construct = this.src.slice(start, this.pos);
      this.pending.push({ by: 'name', name: named[1] ?? '', construct });
      this.issue('untranslated', start, this.pos, 'named back-reference');
      return { type: 'opaque' };
    }
    const subroutine = /^(?:<[^>]*>|'[^']*'|\{\+\d+\}|\+\d+)/.exec(rest);
    if (subroutine !== null) {
      this.pos += subroutine[0].length;
      this.issue('unknown', start, this.pos, 'subroutine call or relative reference');
      return { type: 'opaque' };
    }
    this.issue('invalid', start, this.pos, 'malformed \\g reference');
    return { type: 'opaque' };
  }

  /** `\k<n>`, `\k'n'`, `\k{n}`: named back-references; bare `\k` is an error. */
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
    this.issue('untranslated', start, this.pos, 'named back-reference');
    return { type: 'opaque' };
  }

  /** A bracket class. */
  private characterClass(): PatternNode {
    const start = this.pos;
    this.pos++;
    if (/^[:.=]/.test(this.peek())) {
      // `[:alpha:]` at the top level is an error, `[:a]` is not: not modeled.
      this.issue('unknown', start, this.pos + 1, 'class starting like a POSIX class');
    }
    const negated = this.peek() === '^';
    if (negated) this.pos++;
    const members = emptySet();
    let first = true;
    let quoting = false;
    while (this.pos < this.src.length && (quoting || first || this.peek() !== ']')) {
      // `\E` is ignored and `\Q…\E` quotes literally inside a class too (a
      // `]` after a leading `\E` is still the first character, so literal).
      if (this.src.startsWith('\\E', this.pos)) {
        quoting = false;
        this.pos += 2;
        continue;
      }
      if (quoting || this.src.startsWith('\\Q', this.pos)) {
        if (!quoting) {
          quoting = true;
          this.pos += 2;
          continue;
        }
        // A quoted range is not modeled: quoted characters are taken one by one.
        if (this.peek(1) === '-') {
          this.issue('unknown', start, this.pos + 2, 'range inside \\Q…\\E in a class');
        }
        members[this.src.charCodeAt(this.pos++)] = 1;
        first = false;
        continue;
      }
      first = false;
      const item = this.classItem();
      if (item === null) continue;
      const rangeAhead = this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== '';
      if (item.byte !== null && rangeAhead) {
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
        members.fill(1, item.byte, high.byte + 1);
        continue;
      }
      if (item.byte === null && rangeAhead) {
        this.issue('invalid', start, this.pos + 1, 'invalid range in character class');
      }
      addAll(members, item.set);
    }
    if (this.pos >= this.src.length) {
      this.issue('invalid', start, this.pos, 'missing terminating ] for character class');
      return { type: 'opaque' };
    }
    this.pos++;
    if (this.caseless) foldInPlace(members);
    if (negated)
      for (let byte = 0; byte < members.length; byte++) members[byte] = 1 - (members[byte] ?? 0);
    return { type: 'set', set: members };
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
    this.issue('unknown', escapeStart, this.pos, `\\${letter} in a character class`);
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
    const set = posixSet(negated ? body.slice(1) : body, negated, this.caseless);
    if (set === undefined) {
      this.issue('invalid', itemStart, this.pos, 'unknown POSIX class name');
      return null;
    }
    return set;
  }

  /** A parenthesized construct at `pos`. */
  private group(): PatternNode {
    const start = this.pos;
    this.pos++;
    if (this.peek() === '*') {
      if (this.peek(1) === ')') {
        this.pos += 2;
        this.issue('invalid', start, this.pos, '(*) is not a verb');
        return { type: 'opaque' };
      }
      this.rejectVerb(start);
      this.stop(start, 'backtracking verb or alpha assertion');
    }
    if (this.peek() !== '?') {
      this.groupCount++;
      return this.groupBody(start, 'capture', this.groupCount);
    }
    this.pos++;
    const char = this.peek();
    const next = this.peek(1);
    if (char === '') {
      this.issue('invalid', start, this.pos, 'missing closing parenthesis', { join: 'parens' });
      this.depth++;
      return { type: 'opaque' };
    }
    const simple = SIMPLE_GROUPS[char === '<' ? `<${next}` : char];
    if (simple !== undefined) {
      this.pos += simple.skip;
      if (simple.issue !== undefined) this.issue('untranslated', start, this.pos, simple.issue);
      if (char !== '|') return this.groupBody(start, simple.kind, null);
      this.branchResetDepth++;
      const node = this.groupBody(start, simple.kind, null);
      this.branchResetDepth--;
      return node;
    }
    if (char === '<') return this.namedGroup(start, 1, '>', false);
    if (char === "'") return this.namedGroup(start, 1, "'", true);
    if (char === 'P') return this.pythonGroup(start);
    if (char === '&') return this.namedCall(start, 1, 'unknown');
    if (char === 'R' && next === ')') {
      this.pos += 2;
      this.issue('unknown', start, this.pos, 'recursion');
      return { type: 'opaque' };
    }
    if (/[0-9]/.test(char) || ((char === '+' || char === '-') && /[0-9]/.test(next))) {
      return this.numberedCall(start);
    }
    if (char === '(') this.conditionStart(start);
    // Perl extended class: PCRE2 10.47+ compiles some (`(?[[:alpha:]])`),
    // 10.44 rejects them all (observed) — its fate is not modeled.
    if (char === '[') this.stop(start, 'extended character class');
    if (char === 'C') this.stop(start, 'callout');
    if (char === '+' || INVALID_AFTER_GROUP_QUERY.has(char)) {
      this.pos++;
      this.issue('invalid', start, this.pos, `unrecognized character after (?`);
      return { type: 'opaque' };
    }
    return this.optionSetting(start);
  }

  /**
   * A group's alternatives and its closing `)`, with its own `J` scope.
   *
   * @param duplicates The `J` state inside the group (default: inherited).
   */
  private groupBody(
    start: number,
    kind: GroupKind,
    capture: number | null,
    duplicates: boolean | null = this.duplicates.at(-1) ?? null
  ): PatternNode {
    if (this.depth + 1 >= PCRE_NEST_LIMIT) this.stop(start, 'parentheses nested near PCRE’s limit');
    this.duplicates.push(duplicates);
    this.depth++;
    const assertion = isLookaround(kind);
    if (assertion) this.lookarounds++;
    const alternatives = this.alternatives();
    if (assertion) this.lookarounds--;
    this.duplicates.pop();
    if (this.peek() !== ')') {
      this.issue('invalid', start, this.pos, 'missing closing parenthesis', { join: 'parens' });
      return { type: 'group', kind, capture, alternatives };
    }
    this.pos++;
    this.depth--;
    if (kind === 'lookbehind' || kind === 'negative-lookbehind') {
      this.checkLookbehind(start, alternatives);
    }
    return { type: 'group', kind, capture, alternatives };
  }

  /**
   * PCRE2's lookbehind limits (observed on both versions): an unbounded
   * branch is rejected; when some branch varies in length, every branch
   * must be at most 255 bytes; fixed-length branches may reach 65 535.
   * A branch holding a back-reference or a PCRE-only atom is not measured.
   * Repeats of zero-length items count too (see {@link zeroLengthRepeat}).
   */
  private checkLookbehind(start: number, alternatives: readonly (readonly PatternNode[])[]): void {
    const repeat = zeroLengthRepeat(alternatives);
    if (repeat !== null) {
      if (repeat === 'unbounded') {
        this.issue('invalid', start, this.pos, 'lookbehind repeats an empty item without bound');
      } else {
        this.issue('unknown', start, this.pos, 'lookbehind repeats an empty item many times');
      }
      return;
    }
    const lengths = alternatives.map((nodes) => sequenceLength(nodes));
    if (lengths.some(({ min, max }) => Number.isNaN(min) || Number.isNaN(max))) {
      this.issue('unknown', start, this.pos, 'lookbehind of unmeasured length');
      return;
    }
    const variable = lengths.some(({ min, max }) => min !== max);
    const limit = variable ? MAX_VARIABLE_LOOKBEHIND : MAX_FIXED_LOOKBEHIND;
    if (lengths.some(({ max }) => max > limit)) {
      this.issue('invalid', start, this.pos, 'lookbehind assertion is unbounded or too long');
    }
  }

  /**
   * A named capture `(?<n>…)` / `(?P<n>…)` (translated) or `(?'n'…)`
   * (untranslated); a bad or unterminated name is an error.
   */
  private namedGroup(
    start: number,
    skip: number,
    terminator: string,
    quoted: boolean
  ): PatternNode {
    this.pos += skip;
    const name = GROUP_NAME.exec(this.src.slice(this.pos))?.[0];
    if (name === undefined || this.peek(name.length) !== terminator) {
      this.pos = Math.min(this.src.length, this.pos + (name?.length ?? 0) + 1);
      this.issue('invalid', start, this.pos, 'malformed group name');
      return { type: 'opaque' };
    }
    this.pos += name.length + 1;
    this.names.push({ name, duplicatesAllowed: this.duplicates.at(-1) ?? null });
    if (this.branchResetDepth > 0) {
      // Names share numbers across a branch reset's alternatives: not modeled.
      this.issue('unknown', start, this.pos, 'named group inside a branch reset');
    }
    this.groupCount++;
    if (quoted) this.issue('untranslated', start, this.pos, "(?'name'…) group");
    return this.groupBody(start, 'capture', this.groupCount);
  }

  /** `(?P<n>…)`, `(?P=n)`, `(?P>n)`; any other `(?P` is an error. */
  private pythonGroup(start: number): PatternNode {
    const kind = this.peek(1);
    if (kind === '<') return this.namedGroup(start, 2, '>', false);
    if (kind === '=') return this.namedCall(start, 2, 'untranslated');
    if (kind === '>') return this.namedCall(start, 2, 'unknown');
    this.pos++;
    this.issue('invalid', start, this.pos, 'unrecognized character after (?P');
    return { type: 'opaque' };
  }

  /**
   * `(?P=n)` (a named back-reference: valid once `n` exists) and the named
   * subroutine calls `(?&n)`, `(?P>n)` (validity not modeled: a call can
   * recurse forever); a malformed or unknown name is an error.
   */
  private namedCall(start: number, skip: number, kind: IssueKind): PatternNode {
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
    this.issue(kind, start, this.pos, 'named reference or subroutine call', { call: true });
    return { type: 'opaque' };
  }

  /** `(?n)`, `(?+n)`, `(?-n)`: subroutine calls; `(?0)` recurses (validity not modeled). */
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
    if (number !== 0 && target < 1) {
      // A missing group is a compile error: before the call's own `unknown`.
      this.issue('invalid', start, this.pos, 'reference to a group that does not exist', {
        join: 'reference'
      });
    }
    this.issue('unknown', start, this.pos, number === 0 ? 'recursion' : 'subroutine call', {
      call: true
    });
    if (number !== 0 && target >= 1) {
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
   * unscoped, or `(?…:…)` scoped. Letters are checked against what PCRE2
   * accepts; only `i` is translated (both features already match
   * caselessly).
   */
  private optionSetting(start: number): PatternNode {
    const spec = /^[\^A-Za-z-]*/.exec(this.src.slice(this.pos))?.[0] ?? '';
    this.pos += spec.length;
    const end = this.peek();
    if (!OPTION_SPEC.test(spec) || (end !== ')' && end !== ':')) {
      this.pos = Math.min(this.src.length, this.pos + 1);
      this.issue('invalid', start, this.pos, 'unrecognized option setting');
      return { type: 'opaque' };
    }
    this.pos++;
    const duplicates = duplicatesAfter(spec, this.duplicates.at(-1) ?? null);
    // `i` is already on (both features run caselessly) and `J` only licenses
    // repeated names: neither changes what the pattern matches.
    const noop = /^[iJ]+$/.test(spec);
    // `x`/`xx` (spaces and `#` comments ignored) and `n` (plain groups do not
    // capture) change how the rest parses: not modeled.
    const reparses = /[xn]/.test(spec.split('-')[0] ?? '');
    if (reparses) this.issue('unknown', start, this.pos, 'option changing the pattern syntax');
    if (end === ')') {
      this.duplicates[this.duplicates.length - 1] = duplicates;
      if (!noop) this.issue('untranslated', start, this.pos, 'option setting');
      return { type: 'option', noop };
    }
    if (noop) return this.groupBody(start, 'group', null, duplicates);
    this.issue('untranslated', start, this.pos, 'scoped option setting');
    return this.groupBody(start, 'opaque', null, duplicates);
  }

  /** Check every reference against the whole pattern's groups and names, then repeated names. */
  private checkReferences(): void {
    const missing: ParseIssue[] = [];
    for (const reference of this.pending) {
      const absent =
        reference.by === 'number'
          ? reference.group > this.groupCount
          : !this.names.some(({ name }) => name === reference.name);
      if (absent) {
        missing.push({
          kind: 'invalid',
          construct: reference.construct,
          detail: 'reference to a group that does not exist',
          join: 'reference'
        });
      }
    }
    // A missing group is a compile error wherever the reference sits, so with
    // nothing unknown in the pattern it leads the list (it outranks a
    // subroutine call's own `unknown`); otherwise the groups seen may be off.
    const trusted = !this.issues.some((issue) => issue.kind === 'unknown' && !issue.call);
    if (trusted) this.issues.unshift(...missing);
    else this.issues.push(...missing);
    this.checkRepeatedNames();
  }

  /**
   * A name declared twice is an error unless `J` is in force at the second
   * declaration (inside a branch reset it can be legal: such names are
   * already `unknown`, which outranks this).
   */
  private checkRepeatedNames(): void {
    const seen = new Set<string>();
    for (const { name, duplicatesAllowed } of this.names) {
      if (seen.has(name) && duplicatesAllowed !== true) {
        this.issues.push({
          kind: 'invalid',
          construct: name,
          detail: 'two groups share a name',
          join: 'names'
        });
        return;
      }
      seen.add(name);
    }
  }
}

/** Fixed-prefix groups: the `(?` continuation → kind, characters to skip, untranslated issue. */
const SIMPLE_GROUPS: Readonly<
  Record<string, { readonly kind: GroupKind; readonly skip: number; readonly issue?: string }>
> = {
  ':': { kind: 'group', skip: 1 },
  '=': { kind: 'lookahead', skip: 1 },
  '!': { kind: 'negative-lookahead', skip: 1 },
  '<=': { kind: 'lookbehind', skip: 2 },
  '<!': { kind: 'negative-lookbehind', skip: 2 },
  '>': { kind: 'opaque', skip: 1, issue: 'atomic group' },
  '|': { kind: 'opaque', skip: 1, issue: 'branch reset group' },
  // A lookahead (zero-width), but not atomic: never translated.
  '*': { kind: 'lookahead', skip: 1, issue: 'non-atomic lookahead' }
};

/**
 * The `J` state after an option spec: `^` resets every option (so `J` is
 * on only if listed after it); `J` before `-` sets it, after `-` clears it.
 */
function duplicatesAfter(spec: string, current: boolean | null): boolean | null {
  const [on = '', off = ''] = spec.split('-');
  if (on.startsWith('^')) return on.includes('J');
  if (on.includes('J')) return true;
  if (off.includes('J')) return false;
  return current;
}

/** Whether a group kind is a lookaround assertion. */
function isLookaround(kind: GroupKind): boolean {
  return kind !== 'capture' && kind !== 'group' && kind !== 'opaque';
}

/**
 * Estimated compiled size past which a pattern's verdict is not claimed.
 * PCRE2 (link size 2) caps compiled code near 64 K units, and a counted
 * repeat of a group compiles one copy per count: `(?:a){65535}` is
 * rejected on both versions (observed) while `a{65535}` — one item, one
 * counted opcode — is kept. Half the cap, with a deliberately high per-node
 * estimate, keeps every claim on the safe side.
 */
const COMPILED_SIZE_BOUND = 30_000;

/** The detail of the issue a pattern past {@link COMPILED_SIZE_BOUND} carries. */
const COMPILED_SIZE_DETAIL = 'may exceed PCRE’s compiled pattern size';

/**
 * Nested repeat counts over items that can match empty, from which a
 * pattern's verdict is not claimed. PCRE2 rejects some such patterns at
 * compile time — `(?:|){20}`, `(?:(?:|){5}){4}`, `((?:|){4}){5}` — and
 * keeps others (`(?:|){19}`, `x(?:|){100}`, `(?:a?){999}`): observed on
 * both versions, the rule is not modeled; 16 stays below every rejection seen.
 */
const NULLABLE_REPEAT_BOUND = 16;

/**
 * The largest product of nested repeat counts (`max`, else `min` for an
 * open repeat) over items that can match empty (or are not measured).
 *
 * @param alternatives The branches to scan.
 * @param outer The product of the enclosing nullable repeats.
 */
function nullableRepeats(alternatives: readonly (readonly PatternNode[])[], outer: number): number {
  let largest = outer;
  for (const nodes of alternatives) {
    for (const node of nodes) largest = Math.max(largest, nullableRepeatsIn(node, outer));
  }
  return largest;
}

/** {@link nullableRepeats} for one node. */
function nullableRepeatsIn(node: PatternNode, outer: number): number {
  if (node.type === 'group') return nullableRepeats(node.alternatives, outer);
  if (node.type !== 'repeat') return outer;
  const min = nodeLength(node.node).min;
  const nullable = !(min > 0);
  const product = nullable ? outer * Math.max(1, node.max ?? node.min) : outer;
  return Math.max(product, nullableRepeatsIn(node.node, product));
}

/** Estimated compiled units per node kind (see {@link COMPILED_SIZE_BOUND}). */
const UNITS = { item: 3, class: 33, group: 6 } as const;

/** A sequence list's estimated compiled size. */
function compiledSize(alternatives: readonly (readonly PatternNode[])[]): number {
  let size = 0;
  for (const nodes of alternatives) for (const node of nodes) size += nodeSize(node);
  return size;
}

/** One node's estimated compiled size: a repeated group counts once per copy. */
function nodeSize(node: PatternNode): number {
  switch (node.type) {
    case 'set':
      return setSize(node.set) <= 2 ? UNITS.item : UNITS.class;
    case 'group':
      return UNITS.group + compiledSize(node.alternatives);
    case 'repeat': {
      const body = nodeSize(node.node);
      if (node.node.type !== 'group') return body + UNITS.item;
      // PCRE copies a group `max` times, or `min + 1` for an open repeat.
      const copies = node.max ?? node.min + 1;
      return Math.max(1, copies) * body;
    }
    default:
      return UNITS.item;
  }
}

/** The largest count a lookbehind may repeat an empty item with, as observed accepted (10 001 kept; 30 000 dropped). */
const LARGEST_EMPTY_REPEAT = 10_001;

/**
 * A repeat of a zero-length item inside a lookbehind (not inside a nested
 * lookaround, which is measured on its own): PCRE2 rejects one without an
 * upper bound (`(?<=x(?:)*)`, `(?<=\b+)`, `(?<=(?<=a)*)`, observed on both
 * versions) — except a repeated lookahead (`(?<=(?=a)*)` compiles) — and
 * past {@link LARGEST_EMPTY_REPEAT} its verdict is not proven.
 *
 * @returns `'unbounded'` (rejected), `'large'` (not proven), or `null`.
 */
function zeroLengthRepeat(
  alternatives: readonly (readonly PatternNode[])[]
): 'unbounded' | 'large' | null {
  for (const nodes of alternatives) {
    for (const node of nodes) {
      const found = zeroLengthRepeatIn(node);
      if (found !== null) return found;
    }
  }
  return null;
}

/** {@link zeroLengthRepeat} for one node and what it holds. */
function zeroLengthRepeatIn(node: PatternNode): 'unbounded' | 'large' | null {
  if (node.type === 'group') {
    return isLookaround(node.kind) ? null : zeroLengthRepeat(node.alternatives);
  }
  if (node.type !== 'repeat') return null;
  const body = node.node;
  const lookahead =
    body.type === 'group' && (body.kind === 'lookahead' || body.kind === 'negative-lookahead');
  if (nodeLength(body).max === 0) {
    // `(?=a)*` compiles, `(?=a){20000}` does not: for a lookahead only the count matters.
    if (node.max === null) {
      if (!lookahead) return 'unbounded';
    } else if (node.max > LARGEST_EMPTY_REPEAT) {
      return 'large';
    }
  }
  return zeroLengthRepeatIn(body);
}

/** Whether PCRE lets a quantifier follow this node. */
function isQuantifiable(node: PatternNode): boolean {
  return node.type !== 'assert' && node.type !== 'keep' && node.type !== 'option';
}

/** The shortest and longest text a match can span, in bytes. */
export interface Length {
  readonly min: number;
  /** `Infinity` when unbounded. */
  readonly max: number;
}

/** Unknown length (a back-reference or a PCRE-only atom). */
const UNMEASURED: Length = { min: NaN, max: NaN };

/** A sequence's length: the sum of its nodes'. */
export function sequenceLength(nodes: readonly PatternNode[]): Length {
  let min = 0;
  let max = 0;
  for (const node of nodes) {
    const length = nodeLength(node);
    min += length.min;
    max += length.max;
  }
  return { min, max };
}

/**
 * A node's length (see {@link Length}); lookarounds and assertions span
 * nothing, back-references and opaque atoms are unmeasured (NaN).
 *
 * @param node The node.
 */
function nodeLength(node: PatternNode): Length {
  switch (node.type) {
    case 'set':
      return { min: 1, max: 1 };
    case 'linebreak':
      return { min: 1, max: 2 };
    case 'assert':
    case 'keep':
    case 'option':
      return { min: 0, max: 0 };
    case 'group': {
      if (isLookaround(node.kind)) return { min: 0, max: 0 };
      const lengths = node.alternatives.map((nodes) => sequenceLength(nodes));
      return {
        min: Math.min(...lengths.map(({ min }) => min)),
        max: Math.max(...lengths.map(({ max }) => max))
      };
    }
    case 'repeat': {
      const body = nodeLength(node.node);
      if (Number.isNaN(body.max)) return UNMEASURED;
      const max = node.max === null ? (body.max === 0 ? 0 : Infinity) : body.max * node.max;
      return { min: body.min * node.min, max };
    }
    case 'backref':
    case 'opaque':
      return UNMEASURED;
  }
}

/**
 * Whether PCRE2 is claimed to compile a pattern within its compiled-size
 * cap: the whole pattern parsed and its estimate within
 * {@link COMPILED_SIZE_BOUND} (half the cap, a deliberately high estimate).
 * `false` claims nothing either way.
 *
 * @param src The pattern between its delimiters, as a byte string.
 * @param caseless Whether it runs with PCRE's `i`.
 */
export function compiledSizeClaimed(src: string, caseless: boolean): boolean {
  const parsed = parsePcre(src, caseless);
  return parsed.complete && !parsed.issues.some((issue) => issue.detail === COMPILED_SIZE_DETAIL);
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
