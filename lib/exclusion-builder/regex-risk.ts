/**
 * Catastrophic-backtracking guard for pattern rows: a static analysis of a
 * regex's structure that rejects the shapes known to backtrack
 * exponentially in a backtracking engine (V8's Irregexp, SpiderMonkey's).
 * It is a heuristic — it rejects the known exponential shapes; it is not a
 * proof of linear time (polynomial shapes like `.*a.*a.*a` pass), so the
 * session's wall-time budget stays the backstop.
 *
 * The source is parsed in the engine's no-flag (Annex B) syntax — the only
 * one rows compile with: escapes, character classes (`[...]`, negated,
 * ranges, escaped `]`), groups (capturing, named, non-capturing, modifier,
 * lookarounds), quantifiers (`* + ? {n} {n,} {n,m}`, lazy forms),
 * back-references. A loop is a quantifier repeating more than
 * {@link LOOP_REPEAT_LIMIT} times (or unboundedly) over a body that consumes
 * text; inside a loop it flags:
 *
 * 1. **nested repetition** — a variable-length quantifier whose characters
 *    can also start what follows it within the iteration (or the next
 *    iteration): the loop can split one run of text across iterations in
 *    exponentially many ways (`(a+)+`, `(a*)*`, `(?:a+b?)*`, `(\w+\s?)+$`).
 *    Unambiguous nesting passes (`(-[a-z]+)*`, `(\d+\.)+`, `(ab+)*`) — the
 *    refinement over plain star height, which flags those too.
 * 2. **overlapping alternation** — a looped alternation with two branches
 *    that can start with the same character (`(a|a)*`, `(a|ab)*`,
 *    `(\w|\d)+`).
 * 3. **repeated back-reference** — a back-reference inside a looped group
 *    (matching it re-runs a capture whose length varies per attempt).
 *
 * Character facts are exact over UTF-16 code units (no `i` flag; an
 * `(?i:…)` modifier group folds ASCII letters only, which can only add
 * overlaps). Anything the parser does not understand is accepted (never a
 * false rejection of a pattern the engine compiles).
 */

/** Why a pattern is risky. */
export type BacktrackingRisk =
  'nested-repetition' | 'overlapping-alternation' | 'repeated-backreference';

/** The inline reason each risk is reported with (one invalid-row reason per risk). */
export const BACKTRACKING_RISK_REASONS: Readonly<Record<BacktrackingRisk, string>> = {
  'nested-repetition':
    'Risky regular expression: a repeated group repeats something that can match the same text again (like `(a+)+`) — it can take exponential time; make the repetition unambiguous',
  'overlapping-alternation':
    'Risky regular expression: a repeated alternation has branches that can start with the same character (like `(a|ab)*`) — it can take exponential time',
  'repeated-backreference':
    'Risky regular expression: a back-reference inside a repeated group can take exponential time'
};

/**
 * Repeat counts above this make a quantifier a loop: a fixed small repeat
 * of an ambiguous body is polynomial of that degree, beyond it the cost
 * is exponential in practice.
 */
export const LOOP_REPEAT_LIMIT = 10;

// ── Character sets ───────────────────────────────────────────────────────

/** A set of UTF-16 code units: sorted, disjoint, non-adjacent inclusive ranges. */
type CharSet = readonly (readonly [number, number])[];

/** The largest code unit. */
const MAX_UNIT = 0xffff;
const NO_CHARS: CharSet = [];
const ALL_CHARS: CharSet = [[0, MAX_UNIT]];

/** Normalize ranges: sort, then merge overlapping or adjacent ones. */
function normalize(ranges: readonly (readonly [number, number])[]): CharSet {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [low, high] of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && low <= last[1] + 1) last[1] = Math.max(last[1], high);
    else merged.push([low, high]);
  }
  return merged;
}

/** The union of two sets. */
function union(a: CharSet, b: CharSet): CharSet {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  return normalize([...a, ...b]);
}

/** Every code unit not in the set. */
function complement(set: CharSet): CharSet {
  const out: [number, number][] = [];
  let next = 0;
  for (const [low, high] of set) {
    if (low > next) out.push([next, low - 1]);
    next = high + 1;
  }
  if (next <= MAX_UNIT) out.push([next, MAX_UNIT]);
  return out;
}

/** Whether two sets share a code unit. */
function intersects(a: CharSet, b: CharSet): boolean {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const [aLow, aHigh] = a[i] as readonly [number, number];
    const [bLow, bHigh] = b[j] as readonly [number, number];
    if (aLow <= bHigh && bLow <= aHigh) return true;
    if (aHigh < bHigh) i++;
    else j++;
  }
  return false;
}

/** One code unit as a set. */
function unit(code: number): CharSet {
  return [[code, code]];
}

/** Add the other ASCII case of every ASCII letter in the set (an `i` modifier). */
function foldAsciiCase(set: CharSet): CharSet {
  const extra: [number, number][] = [];
  for (const [low, high] of set) {
    for (const [from, to, shift] of [
      [0x41, 0x5a, 0x20],
      [0x61, 0x7a, -0x20]
    ] as const) {
      const start = Math.max(low, from);
      const end = Math.min(high, to);
      if (start <= end) extra.push([start + shift, end + shift]);
    }
  }
  return union(set, normalize(extra));
}

const DIGITS: CharSet = [[0x30, 0x39]];
const WORD: CharSet = [
  [0x30, 0x39],
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a]
];
/** ECMAScript WhiteSpace + LineTerminator (`\s`). */
const SPACE: CharSet = normalize([
  [0x09, 0x0d],
  [0x20, 0x20],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff]
]);
/** `.` without the `s` flag: everything but the line terminators. */
const DOT: CharSet = complement(
  normalize([
    [0x0a, 0x0a],
    [0x0d, 0x0d],
    [0x2028, 0x2029]
  ])
);

/** The class escapes (`\d \D \w \W \s \S`). */
const CLASS_ESCAPES: Readonly<Record<string, CharSet>> = {
  d: DIGITS,
  D: complement(DIGITS),
  w: WORD,
  W: complement(WORD),
  s: SPACE,
  S: complement(SPACE)
};

/** The single-character control escapes. */
const CONTROL_ESCAPES: Readonly<Record<string, number>> = {
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b
};

// ── Syntax tree with its facts ───────────────────────────────────────────

/** What every node knows about the text it can match. */
interface NodeFacts {
  /** Whether it can match the empty string. */
  readonly nullable: boolean;
  /** Code units a non-empty match can start with. */
  readonly first: CharSet;
  /** Code units it can consume anywhere. */
  readonly consumed: CharSet;
  /** Whether it contains a back-reference. */
  readonly backref: boolean;
}

/** A parsed pattern node (groups are transparent: a group is its body). */
type RegexNode =
  | (NodeFacts & { readonly kind: 'chars' })
  | (NodeFacts & { readonly kind: 'empty' })
  | (NodeFacts & { readonly kind: 'backref' })
  | (NodeFacts & { readonly kind: 'seq'; readonly items: readonly RegexNode[] })
  | (NodeFacts & { readonly kind: 'alt'; readonly branches: readonly RegexNode[] })
  | (NodeFacts & {
      readonly kind: 'repeat';
      readonly min: number;
      readonly max: number;
      readonly body: RegexNode;
    });

/** One code unit from `set`. */
function charsNode(set: CharSet): RegexNode {
  return { kind: 'chars', nullable: false, first: set, consumed: set, backref: false };
}

/** A zero-width match (anchors, `\b`, lookarounds, an empty sequence). */
const EMPTY_NODE: RegexNode = {
  kind: 'empty',
  nullable: true,
  first: NO_CHARS,
  consumed: NO_CHARS,
  backref: false
};

/** A back-reference: any text, possibly empty. */
const BACKREF_NODE: RegexNode = {
  kind: 'backref',
  nullable: true,
  first: ALL_CHARS,
  consumed: ALL_CHARS,
  backref: true
};

/** A sequence (one item collapses to itself). */
function seqNode(items: readonly RegexNode[]): RegexNode {
  if (items.length === 0) return EMPTY_NODE;
  if (items.length === 1) return items[0] as RegexNode;
  let first = NO_CHARS;
  let prefixNullable = true;
  let consumed = NO_CHARS;
  let backref = false;
  for (const item of items) {
    if (prefixNullable) first = union(first, item.first);
    prefixNullable &&= item.nullable;
    consumed = union(consumed, item.consumed);
    backref ||= item.backref;
  }
  return { kind: 'seq', items, nullable: prefixNullable, first, consumed, backref };
}

/** An alternation (one branch collapses to itself). */
function altNode(branches: readonly RegexNode[]): RegexNode {
  if (branches.length === 1) return branches[0] as RegexNode;
  return {
    kind: 'alt',
    branches,
    nullable: branches.some((branch) => branch.nullable),
    first: branches.reduce<CharSet>((set, branch) => union(set, branch.first), NO_CHARS),
    consumed: branches.reduce<CharSet>((set, branch) => union(set, branch.consumed), NO_CHARS),
    backref: branches.some((branch) => branch.backref)
  };
}

/** A quantified node. */
function repeatNode(body: RegexNode, min: number, max: number): RegexNode {
  return {
    kind: 'repeat',
    min,
    max,
    body,
    nullable: min === 0 || body.nullable,
    first: body.first,
    consumed: body.consumed,
    backref: body.backref
  };
}

// ── Parser (no-flag / Annex B syntax) ────────────────────────────────────

/** The parser gave up on syntax it does not model (the pattern is then accepted). */
class UnmodeledSyntax extends Error {
  override readonly name = 'UnmodeledSyntax';
}

const HEX_DIGITS = /^[0-9A-Fa-f]+$/;
const ASCII_LETTER = /^[A-Za-z]$/;
const QUANTIFIER_BRACES = /^\{(\d+)(?:(,)(\d*))?\}/;
const MODIFIER_GROUP = /^\(\?([ims]*)(?:-([ims]*))?:/;

/** Count the capturing groups and note named ones (decides what `\N`/`\k` mean in Annex B). */
function scanGroups(source: string): { count: number; named: boolean } {
  let count = 0;
  let named = false;
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') i++;
    else if (inClass) inClass = char !== ']';
    else if (char === '[') inClass = true;
    else if (char === '(') {
      if (source[i + 1] !== '?') count++;
      else if (source[i + 2] === '<' && source[i + 3] !== '=' && source[i + 3] !== '!') {
        count++;
        named = true;
      }
    }
  }
  return { count, named };
}

/** A recursive-descent parser over one pattern source. */
class PatternParser {
  private position = 0;
  /** Depth of active `(?i:…)` modifier groups. */
  private ignoreCase = 0;
  private readonly groups: { count: number; named: boolean };

  constructor(private readonly source: string) {
    this.groups = scanGroups(source);
  }

  /** Parse the whole pattern. */
  parse(): RegexNode {
    const node = this.alternation();
    if (this.position !== this.source.length) throw new UnmodeledSyntax('trailing input');
    return node;
  }

  private peek(offset = 0): string | undefined {
    return this.source[this.position + offset];
  }

  private rest(): string {
    return this.source.slice(this.position);
  }

  /** Characters as matched now (folded inside an `i` modifier group). */
  private chars(set: CharSet): RegexNode {
    return charsNode(this.ignoreCase > 0 ? foldAsciiCase(set) : set);
  }

  private alternation(): RegexNode {
    const branches = [this.sequence()];
    while (this.peek() === '|') {
      this.position++;
      branches.push(this.sequence());
    }
    return altNode(branches);
  }

  private sequence(): RegexNode {
    const items: RegexNode[] = [];
    for (let char = this.peek(); char !== undefined && char !== '|' && char !== ')';) {
      items.push(this.quantified(this.atom()));
      char = this.peek();
    }
    return seqNode(items);
  }

  /** An atom's quantifier, if one follows (lazy `?` included). */
  private quantified(atom: RegexNode): RegexNode {
    const char = this.peek();
    let bounds: [number, number] | null = null;
    if (char === '*') bounds = [0, Infinity];
    else if (char === '+') bounds = [1, Infinity];
    else if (char === '?') bounds = [0, 1];
    if (bounds !== null) {
      this.position++;
    } else if (char === '{') {
      const braces = QUANTIFIER_BRACES.exec(this.rest());
      if (braces === null) return atom; // a literal `{` was the atom's neighbour
      const min = Number(braces[1]);
      const max = braces[2] === undefined ? min : braces[3] === '' ? Infinity : Number(braces[3]);
      bounds = [min, max];
      this.position += braces[0].length;
    } else {
      return atom;
    }
    if (this.peek() === '?') this.position++; // lazy: same ambiguity
    return repeatNode(atom, bounds[0], bounds[1]);
  }

  private atom(): RegexNode {
    const char = this.peek();
    switch (char) {
      case '^':
      case '$':
        this.position++;
        return EMPTY_NODE;
      case '.':
        this.position++;
        return charsNode(DOT);
      case '(':
        return this.group();
      case '[':
        return this.chars(this.characterClass());
      case '\\':
        return this.atomEscape();
      default:
        this.position++;
        return this.chars(unit((char as string).charCodeAt(0)));
    }
  }

  private group(): RegexNode {
    const rest = this.rest();
    let lookaround = false;
    let modifier: { add: string; remove: string } | null = null;
    if (/^\(\?[=!]/.test(rest) || /^\(\?<[=!]/.test(rest)) {
      lookaround = true;
      this.position += rest[2] === '<' ? 4 : 3;
    } else if (rest.startsWith('(?<')) {
      const close = rest.indexOf('>');
      if (close === -1) throw new UnmodeledSyntax('unterminated group name');
      this.position += close + 1;
    } else if (rest.startsWith('(?')) {
      const match = MODIFIER_GROUP.exec(rest);
      if (match === null) throw new UnmodeledSyntax('unknown group');
      modifier = { add: match[1] ?? '', remove: match[2] ?? '' };
      this.position += match[0].length;
    } else {
      this.position++;
    }
    const folds = modifier?.add.includes('i') === true;
    const unfolds = modifier?.remove.includes('i') === true;
    const saved = this.ignoreCase;
    if (folds) this.ignoreCase++;
    if (unfolds) this.ignoreCase = 0;
    const body = this.alternation();
    this.ignoreCase = saved;
    if (this.peek() !== ')') throw new UnmodeledSyntax('unterminated group');
    this.position++;
    // A lookaround matches no text (and JS never backtracks into one).
    return lookaround ? EMPTY_NODE : body;
  }

  /** `\…` outside a class. */
  private atomEscape(): RegexNode {
    const next = this.peek(1);
    if (next === undefined) throw new UnmodeledSyntax('trailing backslash');
    const classSet = CLASS_ESCAPES[next];
    if (classSet !== undefined) {
      this.position += 2;
      return this.chars(classSet);
    }
    if (next === 'b' || next === 'B') {
      this.position += 2;
      return EMPTY_NODE;
    }
    if (/^[1-9]$/.test(next)) {
      const digits = /^\d+/.exec(this.source.slice(this.position + 1))?.[0] ?? next;
      if (Number(digits) <= this.groups.count) {
        this.position += 1 + digits.length;
        return BACKREF_NODE;
      }
    }
    if (next === 'k' && this.groups.named && this.peek(2) === '<') {
      const close = this.source.indexOf('>', this.position);
      if (close === -1) throw new UnmodeledSyntax('unterminated back-reference name');
      this.position = close + 1;
      return BACKREF_NODE;
    }
    return this.chars(this.characterEscape(false));
  }

  /**
   * A character escape (the backslash at the cursor): one code unit, or
   * all code units where Annex B's octal reading is not modeled exactly
   * (an octal escape) — a wider set can only add overlaps.
   *
   * @param inClass Whether it sits in a class (`\b` is backspace there).
   */
  private characterEscape(inClass: boolean): CharSet {
    const next = this.peek(1) as string;
    const control = CONTROL_ESCAPES[next];
    if (control !== undefined) {
      this.position += 2;
      return unit(control);
    }
    if (inClass && next === 'b') {
      this.position += 2;
      return unit(0x08);
    }
    if (next === 'c') {
      const letter = this.peek(2);
      if (letter !== undefined && ASCII_LETTER.test(letter)) {
        this.position += 3;
        return unit(letter.charCodeAt(0) % 32);
      }
      this.position++; // Annex B: a lone `\` before `c` is a literal backslash
      return unit(0x5c);
    }
    const hexLength = next === 'x' ? 2 : next === 'u' ? 4 : 0;
    if (hexLength > 0) {
      const hex = this.source.slice(this.position + 2, this.position + 2 + hexLength);
      if (hex.length === hexLength && HEX_DIGITS.test(hex)) {
        this.position += 2 + hexLength;
        return unit(parseInt(hex, 16));
      }
      this.position += 2; // Annex B: identity escape of `x` / `u`
      return unit(next.charCodeAt(0));
    }
    if (/^[0-7]$/.test(next)) {
      const octal = /^[0-7]{1,3}/.exec(this.source.slice(this.position + 1))?.[0] ?? next;
      this.position += 1 + octal.length;
      return ALL_CHARS;
    }
    this.position += 2; // identity escape (`\.`, `\/`, `\]`, `\8` …)
    return unit(next.charCodeAt(0));
  }

  /** `[…]` → its set (the cursor at `[`). */
  private characterClass(): CharSet {
    this.position++;
    const negated = this.peek() === '^';
    if (negated) this.position++;
    let set = NO_CHARS;
    while (this.peek() !== ']') {
      if (this.peek() === undefined) throw new UnmodeledSyntax('unterminated class');
      const low = this.classAtom();
      if (this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== undefined) {
        this.position++;
        const high = this.classAtom();
        const range = singleUnit(low) !== null && singleUnit(high) !== null;
        // Annex B: a class escape at either end makes `-` a literal.
        set = range
          ? union(set, [[singleUnit(low) as number, singleUnit(high) as number]])
          : union(union(set, low), union(high, unit(0x2d)));
      } else {
        set = union(set, low);
      }
    }
    this.position++;
    return negated ? complement(set) : set;
  }

  /** One class member: a code unit, or a class escape's set. */
  private classAtom(): CharSet {
    const char = this.peek() as string;
    if (char !== '\\') {
      this.position++;
      return unit(char.charCodeAt(0));
    }
    const next = this.peek(1);
    if (next === undefined) throw new UnmodeledSyntax('trailing backslash');
    const classSet = CLASS_ESCAPES[next];
    if (classSet !== undefined) {
      this.position += 2;
      return classSet;
    }
    return this.characterEscape(true);
  }
}

/** The code unit of a one-unit set, else null (class escapes are not range ends). */
function singleUnit(set: CharSet): number | null {
  const only = set.length === 1 ? set[0] : undefined;
  return only !== undefined && only[0] === only[1] ? only[0] : null;
}

// ── Analysis ─────────────────────────────────────────────────────────────

/** Whether a repeat is a loop over text (see the module doc). */
function isLoop(node: RegexNode): node is Extract<RegexNode, { kind: 'repeat' }> {
  return (
    node.kind === 'repeat' &&
    (node.max === Infinity || node.max > LOOP_REPEAT_LIMIT) &&
    node.body.consumed.length > 0
  );
}

/**
 * Whether, inside one loop iteration, a variable-length quantifier can
 * consume a character that may also come right after it (`follow`: the
 * rest of the iteration, then the next iteration's start).
 */
function hasAmbiguousRepeat(node: RegexNode, follow: CharSet): boolean {
  switch (node.kind) {
    case 'seq': {
      let after = follow;
      for (let index = node.items.length - 1; index >= 0; index--) {
        const item = node.items[index] as RegexNode;
        if (hasAmbiguousRepeat(item, after)) return true;
        after = item.nullable ? union(item.first, after) : item.first;
      }
      return false;
    }
    case 'alt':
      return node.branches.some((branch) => hasAmbiguousRepeat(branch, follow));
    case 'repeat': {
      const variable = node.max > node.min && node.body.consumed.length > 0;
      if (variable && intersects(node.body.consumed, follow)) return true;
      return hasAmbiguousRepeat(node.body, node.max > 1 ? union(node.body.first, follow) : follow);
    }
    default:
      return false;
  }
}

/** Whether two branches of an alternation can start with the same code unit. */
function hasOverlappingBranches(node: RegexNode): boolean {
  if (node.kind !== 'alt') return false;
  let seen = NO_CHARS;
  for (const branch of node.branches) {
    if (intersects(seen, branch.first)) return true;
    seen = union(seen, branch.first);
  }
  return false;
}

/** The first risk of one loop, or null. */
function loopRisk(loop: Extract<RegexNode, { kind: 'repeat' }>): BacktrackingRisk | null {
  if (loop.body.backref && loop.body.kind !== 'backref') return 'repeated-backreference';
  if (hasOverlappingBranches(loop.body)) return 'overlapping-alternation';
  if (hasAmbiguousRepeat(loop.body, loop.body.first)) return 'nested-repetition';
  return null;
}

/** The first risk anywhere in the tree (outer loops first), or null. */
function treeRisk(node: RegexNode): BacktrackingRisk | null {
  if (isLoop(node)) {
    const risk = loopRisk(node);
    if (risk !== null) return risk;
  }
  const children =
    node.kind === 'seq'
      ? node.items
      : node.kind === 'alt'
        ? node.branches
        : node.kind === 'repeat'
          ? [node.body]
          : [];
  for (const child of children) {
    const risk = treeRisk(child);
    if (risk !== null) return risk;
  }
  return null;
}

/** Bound of the per-pattern verdict memo (rows are re-validated per document). */
const RISK_MEMO_LIMIT = 512;

/** Pattern source → verdict (oldest-inserted evicted first). */
const riskMemo = new Map<string, BacktrackingRisk | null>();

/**
 * The catastrophic-backtracking risk of a pattern the engine compiles
 * (call it only after `new RegExp(source)` succeeded).
 *
 * @param source The pattern row (no flags).
 * @returns The first risk found, or null (no known exponential shape — or
 *   syntax the analysis does not model, which is accepted).
 */
export function regexBacktrackingRisk(source: string): BacktrackingRisk | null {
  const memo = riskMemo.get(source);
  if (memo !== undefined) return memo;
  let risk: BacktrackingRisk | null;
  try {
    risk = treeRisk(new PatternParser(source).parse());
  } catch (cause) {
    if (!(cause instanceof UnmodeledSyntax)) throw cause;
    risk = null;
  }
  if (riskMemo.size >= RISK_MEMO_LIMIT) {
    const oldest = riskMemo.keys().next();
    if (oldest.done !== true) riskMemo.delete(oldest.value);
  }
  riskMemo.set(source, risk);
  return risk;
}
