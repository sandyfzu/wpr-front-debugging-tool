/**
 * Catastrophic-backtracking guard for pattern rows: a static analysis of a
 * regex's structure that rejects the shapes known to backtrack
 * exponentially in a backtracking engine (V8's Irregexp, SpiderMonkey's),
 * and fixed-count loops over ambiguous bodies (`(a+){5}`, whose cost grows
 * as n^k). It is a heuristic — it rejects those shapes only; it is not a
 * proof of linear time. Polynomial shapes written out as sequences are
 * accepted by design (owner decision): e.g. a leading `.*jquery` against a
 * 100 KiB minified inline script took 4.4 s, `\s*\s*$` against 4 KiB of
 * spaces 11.6 s, `.*.*.*.*x` against 200 chars 5.4 s (measured, Node 24). Nothing
 * else bounds such a match on Chromium: one slow match cannot be preempted
 * there, so it blocks the background (every tab) and the paused navigation
 * until it returns, and the between-step budget reports `over-budget`
 * only afterwards. A preempting worker runner (Firefox) can kill it.
 *
 * The source is parsed in the engine's no-flag (Annex B) syntax — the only
 * one rows compile with: escapes (incl. Annex B octal and `\c` forms),
 * character classes (`[...]`, negated, ranges, escaped `]`), groups
 * (capturing, named, non-capturing, `(?i:…)` modifiers, lookarounds — whose
 * bodies are analyzed as patterns of their own), quantifiers
 * (`* + ? {n} {n,} {n,m}`, lazy forms), back-references. A loop is a
 * quantifier that can repeat its body more than once
 * ({@link LOOP_REPEAT_LIMIT}) over a body that consumes text — a fixed
 * count is a loop too: an ambiguous body repeated k times costs n^k.
 * Inside a loop it flags:
 *
 * 1. **nested repetition** — a variable-length quantifier whose characters
 *    can also start what follows it within the iteration (or the next
 *    iteration): the loop can split one run of text across iterations in
 *    exponentially many ways (`(a+)+`, `(a*)*`, `(?:a+b?)*`, `(\w+\s?){8}`).
 *    Unambiguous nesting passes (`(-[a-z]+)*`, `(\d+\.)+`, `(ab+)*`) — the
 *    refinement over plain star height, which flags those too.
 * 2. **overlapping alternation** — an alternation in a loop where one
 *    branch can match a prefix of what another branch matches (`(a|a)*`,
 *    `(a|ab)*`, `(\w|\d)+`). Branches that differ at some fixed position
 *    pass (`(?:google|gtag)+`, `(?:\.min|\.slim)*`): no text can be split
 *    between them.
 * 3. **repeated back-reference** — a back-reference inside a looped group
 *    (matching it re-runs a capture whose length varies per attempt).
 * 4. **too complex** — a row past {@link REGEX_ANALYSIS_LIMITS} (length,
 *    nesting) is not analyzed, and an analysis that would spend more than
 *    its work budget (`workBase + workPerChar × length` units, counted per
 *    inner step) stops: both are rejected. So the analysis' cost is linear
 *    in the row's length by construction, whatever its shape or the
 *    machine, deterministic, and it never throws.
 *
 * Character facts are exact over UTF-16 code units for every flag a row
 * can carry: rows compile without flags, and the modifier groups' flags
 * are modeled — `(?i:…)` folds with the engine's own case
 * canonicalization, `(?s:…)` widens `.` to every unit, and `(?m:…)` only
 * changes what `^`/`$` assert (zero-width: no character facts). Where the
 * analysis approximates — a back-reference (any text), alternation heads
 * past 32 positions or across variable-length parts — it over-approximates
 * (a possible false rejection, never a missed overlap).
 * Syntax the parser does not model is accepted (never a false rejection of
 * a pattern the engine compiles).
 */
import { createBoundedMemo, stringBytes } from '../../utils/bounded-memo';

/** Why a pattern is risky. */
export type BacktrackingRisk =
  'nested-repetition' | 'overlapping-alternation' | 'repeated-backreference' | 'too-complex';

/** Bounds a pattern must stay within to be analyzed at all (declared once). */
export const REGEX_ANALYSIS_LIMITS = {
  /** Source characters. */
  chars: 4096,
  /** Nested groups (`(` depth, any kind). */
  groupDepth: 64,
  /** Work units every analysis may spend, plus… */
  workBase: 2_500,
  /** …work units per source character (see `analysisWorkBudget`). */
  workPerChar: 50
} as const;

/**
 * A quantifier whose maximum exceeds this repeats its body: with an
 * ambiguous body even `{2}` multiplies the ways to match, so any repeat
 * beyond one is a loop.
 */
export const LOOP_REPEAT_LIMIT = 1;

// ── Work accounting ──────────────────────────────────────────────────────

/** An analysis spent its work budget (the row is reported too complex). */
class WorkBudgetExceeded extends Error {
  override readonly name = 'WorkBudgetExceeded';
}

/** Work units left for the running analysis (unbounded outside one). */
let workLeft = Infinity;

/** Work units spent by the running analysis. */
let workSpent = 0;

/**
 * Charge `units` of work (one unit ≈ one inner-loop step: a range merged,
 * a node visited, a position compared) to the running analysis, before
 * the step runs — so the work done never exceeds the budget.
 *
 * @throws {@link WorkBudgetExceeded} when the step would overspend.
 */
function charge(units: number): void {
  if (units > workLeft) throw new WorkBudgetExceeded('analysis work budget spent');
  workLeft -= units;
  workSpent += units;
}

// ── Character sets ───────────────────────────────────────────────────────

/** A set of UTF-16 code units: sorted, disjoint, non-adjacent inclusive ranges. */
type CharSet = readonly (readonly [number, number])[];

/** The largest code unit. */
const MAX_UNIT = 0xffff;
const NO_CHARS: CharSet = [];
const ALL_CHARS: CharSet = [[0, MAX_UNIT]];

/** Work units of sorting `count` items (n·⌈log₂(n + 1)⌉ comparisons). */
function sortWork(count: number): number {
  return count * Math.ceil(Math.log2(count + 1));
}

/** Normalize ranges: sort, then merge overlapping or adjacent ones. */
function normalize(ranges: readonly (readonly [number, number])[]): CharSet {
  charge(sortWork(ranges.length));
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [low, high] of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && low <= last[1] + 1) last[1] = Math.max(last[1], high);
    else merged.push([low, high]);
  }
  return merged;
}

/** The union of two sets (a linear merge — both are normalized). */
function union(a: CharSet, b: CharSet): CharSet {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  charge(a.length + b.length);
  const merged: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const fromA = a[i];
    const fromB = b[j];
    const takeA = fromB === undefined || (fromA !== undefined && fromA[0] <= fromB[0]);
    const [low, high] = (takeA ? fromA : fromB) as readonly [number, number];
    if (takeA) i++;
    else j++;
    const last = merged.at(-1);
    if (last !== undefined && low <= last[1] + 1) last[1] = Math.max(last[1], high);
    else merged.push([low, high]);
  }
  return merged;
}

/** Every code unit not in the set. */
function complement(set: CharSet): CharSet {
  charge(set.length);
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
  charge(a.length + b.length);
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

/** Whether a set holds a code unit (binary search; uncharged — callers charge for it). */
function contains(set: CharSet, code: number): boolean {
  let low = 0;
  let high = set.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [from, to] = set[middle] as readonly [number, number];
    if (code < from) high = middle - 1;
    else if (code > to) low = middle + 1;
    else return true;
  }
  return false;
}

/** One code unit as a set. */
function unit(code: number): CharSet {
  return [[code, code]];
}

/**
 * The engine's case canonicalization without the `u` flag (ECMA-262
 * Canonicalize): the single-unit uppercase, unless that maps a non-ASCII
 * unit into ASCII. Two units match case-insensitively iff they agree.
 */
function canonicalize(code: number): number {
  const upper = String.fromCharCode(code).toUpperCase();
  if (upper.length !== 1) return code;
  const mapped = upper.charCodeAt(0);
  return code >= 0x80 && mapped < 0x80 ? code : mapped;
}

/** The case classes with more than one member (built on first use). */
let caseClasses: readonly (readonly number[])[] | null = null;

/** Every multi-member case class (units sharing one canonical form). */
function multiMemberCaseClasses(): readonly (readonly number[])[] {
  if (caseClasses !== null) return caseClasses;
  const byCanon = new Map<number, number[]>();
  for (let code = 0; code <= MAX_UNIT; code++) {
    const canon = canonicalize(code);
    const members = byCanon.get(canon);
    if (members === undefined) byCanon.set(canon, [code]);
    else members.push(code);
  }
  caseClasses = [...byCanon.values()].filter((members) => members.length > 1);
  return caseClasses;
}

/** One multi-member case class. */
interface CaseClass {
  /** Its units, ascending. */
  readonly members: readonly number[];
  readonly min: number;
  readonly max: number;
}

/** Units per block of the stabbing index. */
const CASE_BLOCK_UNITS = 64;

/**
 * The case-folding index: for each 64-unit block, the classes whose span
 * (lowest to highest member) overlaps it — so the classes a range boundary
 * cuts through are found without scanning every class.
 */
interface CaseIndex {
  readonly classes: readonly CaseClass[];
  /** Unit → index of its class, or -1. */
  readonly classOf: Int32Array;
  /** Every member of every class, ascending (counts and walks a range's members). */
  readonly units: Int32Array;
  readonly byBlock: readonly (readonly number[])[];
}

let caseIndex: CaseIndex | null = null;

/** The case-folding index (65 536 canonicalizations, once; not charged). */
function getCaseIndex(): CaseIndex {
  if (caseIndex !== null) return caseIndex;
  const classes: CaseClass[] = multiMemberCaseClasses().map((members) => ({
    members,
    min: members[0] as number,
    max: members.at(-1) as number
  }));
  const byBlock: number[][] = Array.from({ length: (MAX_UNIT + 1) / CASE_BLOCK_UNITS }, () => []);
  const classOf = new Int32Array(MAX_UNIT + 1).fill(-1);
  classes.forEach((caseClass, index) => {
    for (const code of caseClass.members) classOf[code] = index;
    const first = Math.floor(caseClass.min / CASE_BLOCK_UNITS);
    const last = Math.floor(caseClass.max / CASE_BLOCK_UNITS);
    for (let block = first; block <= last; block++) byBlock[block]?.push(index);
  });
  const units = Int32Array.from(classes.flatMap((caseClass) => caseClass.members)).sort();
  caseIndex = { classes, classOf, units, byBlock };
  return caseIndex;
}

/** The first index of `sorted` holding a value ≥ `value` (binary search; callers charge). */
function lowerBound(sorted: Int32Array, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] as number) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Whether a class has a member inside `[low, high]`. */
function hasMemberIn(caseClass: CaseClass, low: number, high: number): boolean {
  return caseClass.members.some((code) => code >= low && code <= high);
}

/** Units a set's complement may hold for the complement-side fold. */
const SMALL_COMPLEMENT_UNITS = 64;

/**
 * Work units charged per class examined while folding — examining one
 * costs several plain steps (its span, its members), so the budget keeps
 * tracking time.
 */
const FOLD_CANDIDATE_WORK = 4;

/** Units a set may hold for the unit-by-unit fold (literals, small classes). */
const SMALL_SET_UNITS = 64;

/**
 * Fold a small set (a literal, `[abc]`) unit by unit through the class
 * table: one lookup per unit.
 *
 * @returns The fold, or null when the set is not small.
 */
function foldUnitByUnit(set: CharSet): CharSet | null {
  charge(set.length);
  const size = set.reduce((total, [low, high]) => total + high - low + 1, 0);
  if (size > SMALL_SET_UNITS) return null;
  const { classes, classOf } = getCaseIndex();
  const extra: [number, number][] = [];
  for (const [low, high] of set) {
    for (let code = low; code <= high; code++) {
      charge(1);
      const index = classOf[code] as number;
      if (index >= 0)
        for (const member of (classes[index] as CaseClass).members) extra.push([member, member]);
    }
  }
  return extra.length === 0 ? set : union(set, normalize(extra));
}

/**
 * Fold a set whose complement holds at most {@link SMALL_COMPLEMENT_UNITS}
 * units (a negated class): a missing unit stays missing only when every
 * member of its case class is missing too.
 *
 * @returns The fold, or null when the complement is not small.
 */
function foldFromComplement(set: CharSet): CharSet | null {
  const missing = complement(set);
  charge(missing.length);
  const size = missing.reduce((total, [low, high]) => total + high - low + 1, 0);
  if (size > SMALL_COMPLEMENT_UNITS) return null;
  const { classes, classOf } = getCaseIndex();
  const stillMissing: [number, number][] = [];
  for (const [low, high] of missing) {
    for (let code = low; code <= high; code++) {
      const index = classOf[code] as number;
      const members = index < 0 ? [code] : (classes[index] as CaseClass).members;
      charge(FOLD_CANDIDATE_WORK);
      if (members.every((member) => contains(missing, member))) stillMissing.push([code, code]);
    }
  }
  return complement(normalize(stillMissing));
}

/**
 * Close a set under case-insensitive matching (what an `(?i:…)` scope
 * matches): the set plus every member of each class it touches. A class
 * touching a range adds something new only if it also has a member outside
 * it — then its span crosses one of the range's two boundaries — so only
 * the classes indexed at those two boundary blocks are examined. A set
 * missing only a few units (a negated class) folds from its complement.
 * Memoized within one analysis.
 */
function foldCase(set: CharSet): CharSet {
  // The memo key alone costs a few steps per range.
  charge(FOLD_CANDIDATE_WORK * (1 + set.length));
  const key = set.map(([low, high]) => `${String(low)}-${String(high)}`).join(',');
  const memo = analysisFolds.get(key);
  if (memo !== undefined) return memo;
  const folded = computeFold(set);
  analysisFolds.set(key, folded);
  return folded;
}

/**
 * Folds computed by the running analysis (cleared per analysis, so a
 * row's work — and verdict — never depends on rows analyzed before it).
 */
const analysisFolds = new Map<string, CharSet>();

/** {@link foldCase} without the memo. */
function computeFold(set: CharSet): CharSet {
  const fromUnits = foldUnitByUnit(set);
  if (fromUnits !== null) return fromUnits;
  const fromComplement = foldFromComplement(set);
  if (fromComplement !== null) return fromComplement;
  const extra: [number, number][] = [];
  for (const [low, high] of set) foldRange(low, high, extra);
  return extra.length === 0 ? set : union(set, normalize(extra));
}

/**
 * Collect into `extra` the members outside `[low, high]` of every case
 * class with a member inside it, by whichever is cheaper: walking the class
 * members inside the range, or examining the classes indexed at the
 * range's two boundary blocks (a class with members on both sides spans a
 * boundary).
 */
function foldRange(low: number, high: number, extra: [number, number][]): void {
  const { classes, classOf, units, byBlock } = getCaseIndex();
  charge(2);
  const from = lowerBound(units, low);
  const to = lowerBound(units, high + 1);
  const atBoundaries = [
    ...(byBlock[Math.floor(low / CASE_BLOCK_UNITS)] ?? []),
    ...(byBlock[Math.floor(high / CASE_BLOCK_UNITS)] ?? [])
  ];
  const added = new Set<CaseClass>();
  // Each class once, and only its members outside the range (the rest are in the set).
  const addOutside = (caseClass: CaseClass): void => {
    if (added.has(caseClass)) return;
    added.add(caseClass);
    for (const code of caseClass.members) if (code < low || code > high) extra.push([code, code]);
  };
  if (to - from <= FOLD_CANDIDATE_WORK * atBoundaries.length) {
    charge(to - from);
    for (let k = from; k < to; k++) {
      const caseClass = classes[classOf[units[k] as number] as number] as CaseClass;
      if (caseClass.min < low || caseClass.max > high) addOutside(caseClass);
    }
    return;
  }
  charge(FOLD_CANDIDATE_WORK * atBoundaries.length);
  for (const index of atBoundaries) {
    const caseClass = classes[index] as CaseClass;
    const cutsRange =
      (caseClass.min < low && caseClass.max >= low) ||
      (caseClass.min <= high && caseClass.max > high);
    if (cutsRange && hasMemberIn(caseClass, low, high)) addOutside(caseClass);
  }
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

/** A quantifier node. */
type RepeatNode = Extract<RegexNode, { kind: 'repeat' }>;

/** An alternation node. */
type AltNode = Extract<RegexNode, { kind: 'alt' }>;

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

/** A sequence (one item collapses to itself); its sets are normalized once. */
function seqNode(items: readonly RegexNode[]): RegexNode {
  charge(items.length);
  if (items.length === 0) return EMPTY_NODE;
  if (items.length === 1) return items[0] as RegexNode;
  const first: (readonly [number, number])[] = [];
  const consumed: (readonly [number, number])[] = [];
  let prefixNullable = true;
  let backref = false;
  for (const item of items) {
    if (prefixNullable) first.push(...item.first);
    prefixNullable &&= item.nullable;
    consumed.push(...item.consumed);
    backref ||= item.backref;
  }
  return {
    kind: 'seq',
    items,
    nullable: prefixNullable,
    first: normalize(first),
    consumed: normalize(consumed),
    backref
  };
}

/** An alternation (one branch collapses to itself). */
function altNode(branches: readonly RegexNode[]): RegexNode {
  charge(branches.length);
  if (branches.length === 1) return branches[0] as RegexNode;
  return {
    kind: 'alt',
    branches,
    nullable: branches.some((branch) => branch.nullable),
    first: normalize(branches.flatMap((branch) => branch.first)),
    consumed: normalize(branches.flatMap((branch) => branch.consumed)),
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

/** Work units of one sticky-matcher read (a native regex exec). */
const QUANTIFIER_BRACES_WORK = 4;

/** Sticky matchers read at the cursor (never slicing the source). */
const QUANTIFIER_BRACES = /\{(\d+)(?:(,)(\d*))?\}/y;
const MODIFIER_GROUP = /\(\?([ims]*)(?:-([ims]*))?:/y;
const LOOKAROUND_OPEN = /\(\?<?[=!]/y;
const DECIMAL_DIGITS = /\d+/y;
const OCTAL_DIGITS = /[0-7]{1,3}/y;
const HEX_DIGITS = /^[0-9A-Fa-f]+$/;
const ASCII_LETTER = /^[A-Za-z]$/;
/** Annex B ClassControlLetter: a letter, a digit or `_` after `\c` inside a class. */
const CLASS_CONTROL_LETTER = /^[A-Za-z0-9_]$/;

/** What the up-front scan learns: capturing groups, named ones, and nesting depth. */
interface GroupScan {
  readonly count: number;
  readonly named: boolean;
  readonly depth: number;
}

/**
 * Scan the source once: count capturing groups and note named ones (that
 * decides what `\N`/`\k` mean in Annex B), and measure the group depth.
 */
function scanGroups(source: string): GroupScan {
  charge(source.length);
  let count = 0;
  let named = false;
  let depth = 0;
  let maxDepth = 0;
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') i++;
    else if (inClass) inClass = char !== ']';
    else if (char === '[') inClass = true;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === '(') {
      maxDepth = Math.max(maxDepth, ++depth);
      if (source[i + 1] !== '?') count++;
      else if (source[i + 2] === '<' && source[i + 3] !== '=' && source[i + 3] !== '!') {
        count++;
        named = true;
      }
    }
  }
  return { count, named, depth: maxDepth };
}

/**
 * Value of an Annex B octal escape's digits: up to three digits when
 * the first is 0–3, up to two otherwise.
 */
function annexBOctal(digits: string): { value: number; length: number } {
  const length = Math.min(digits.length, /^[0-3]/.test(digits) ? 3 : 2);
  return { value: parseInt(digits.slice(0, length), 8), length };
}

/** A recursive-descent parser over one pattern source. */
class PatternParser {
  private position = 0;
  /** Whether an `(?i:…)` scope is active (case-insensitive). */
  private ignoreCase = false;
  /** Whether an `(?s:…)` scope is active (`.` matches every unit). */
  private dotAll = false;
  /** Lookaround bodies met while parsing — analyzed as patterns of their own. */
  readonly lookarounds: RegexNode[] = [];

  /**
   * @param source The pattern source.
   * @param groups The up-front scan of that source.
   */
  constructor(
    private readonly source: string,
    private readonly groups: GroupScan
  ) {}

  /** Parse the whole pattern. */
  parse(): RegexNode {
    const node = this.alternation();
    if (this.position !== this.source.length) throw new UnmodeledSyntax('trailing input');
    return node;
  }

  /** The source character `offset` past the cursor (undefined past the end). */
  private peek(offset = 0): string | undefined {
    return this.source[this.position + offset];
  }

  /** Match a sticky matcher at `position` (the cursor by default), without moving. */
  private matchAt(matcher: RegExp, position = this.position): RegExpExecArray | null {
    matcher.lastIndex = position;
    return matcher.exec(this.source);
  }

  /** Characters as matched now (closed under case inside an `i` scope). */
  private chars(set: CharSet): RegexNode {
    return charsNode(this.ignoreCase ? foldCase(set) : set);
  }

  /** `branch | branch | …` up to `)` or the end. */
  private alternation(): RegexNode {
    const branches = [this.sequence()];
    while (this.peek() === '|') {
      this.position++;
      branches.push(this.sequence());
    }
    return altNode(branches);
  }

  /** One branch: quantified atoms up to `|`, `)` or the end. */
  private sequence(): RegexNode {
    const items: RegexNode[] = [];
    for (let char = this.peek(); char !== undefined && char !== '|' && char !== ')';) {
      charge(1);
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
      charge(QUANTIFIER_BRACES_WORK);
      const braces = this.matchAt(QUANTIFIER_BRACES);
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

  /** One atom: an anchor, `.`, a group, a class, an escape, or a literal unit. */
  private atom(): RegexNode {
    const char = this.peek();
    switch (char) {
      case '^':
      case '$':
        this.position++;
        return EMPTY_NODE;
      case '.':
        this.position++;
        return charsNode(this.dotAll ? ALL_CHARS : DOT);
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

  /**
   * A group: its body, transparent. A lookaround matches no text in its
   * sequence (and JS never backtracks into one), but its body still runs
   * on every attempt — it is kept for its own analysis.
   */
  private group(): RegexNode {
    const lookaround = this.matchAt(LOOKAROUND_OPEN);
    let modifier: RegExpExecArray | null = null;
    if (lookaround !== null) {
      this.position += lookaround[0].length;
    } else if (this.peek(1) === '?' && this.peek(2) === '<') {
      const close = this.source.indexOf('>', this.position);
      if (close === -1) throw new UnmodeledSyntax('unterminated group name');
      this.position = close + 1;
    } else if (this.peek(1) === '?') {
      modifier = this.matchAt(MODIFIER_GROUP);
      if (modifier === null) throw new UnmodeledSyntax('unknown group');
      this.position += modifier[0].length;
    } else {
      this.position++;
    }
    const saved = { ignoreCase: this.ignoreCase, dotAll: this.dotAll };
    if (modifier !== null) this.applyModifiers(modifier[1] ?? '', modifier[2] ?? '');
    const body = this.alternation();
    this.ignoreCase = saved.ignoreCase;
    this.dotAll = saved.dotAll;
    if (this.peek() !== ')') throw new UnmodeledSyntax('unterminated group');
    this.position++;
    if (lookaround === null) return body;
    this.lookarounds.push(body);
    return EMPTY_NODE;
  }

  /**
   * Apply a modifier group's flags for its body (`(?is-m:…)`: add `i`, `s`;
   * remove `m`). The engine guarantees each flag appears once at most.
   * `m` only changes what `^`/`$` assert — zero-width, no character facts.
   *
   * @param add Flags turned on.
   * @param remove Flags turned off.
   */
  private applyModifiers(add: string, remove: string): void {
    if (add.includes('i')) this.ignoreCase = true;
    if (remove.includes('i')) this.ignoreCase = false;
    if (add.includes('s')) this.dotAll = true;
    if (remove.includes('s')) this.dotAll = false;
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
      const digits = this.matchAt(DECIMAL_DIGITS, this.position + 1)?.[0] ?? next;
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
   * A character escape (the backslash at the cursor) → its one code unit,
   * per Annex B: control escapes, `\cX`, `\xHH`, `\uHHHH`, Annex B octal,
   * and identity escapes (`\.`, `\8`, a lone `\x` …).
   *
   * @param inClass Whether it sits in a class (`\b` is backspace there,
   *   and `\c` also takes a digit or `_`).
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
      if (letter !== undefined && (inClass ? CLASS_CONTROL_LETTER : ASCII_LETTER).test(letter)) {
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
    const octal = this.matchAt(OCTAL_DIGITS, this.position + 1);
    if (octal !== null) {
      const { value, length } = annexBOctal(octal[0]);
      this.position += 1 + length;
      return unit(value);
    }
    this.position += 2; // identity escape (`\.`, `\/`, `\]`, `\8` …)
    return unit(next.charCodeAt(0));
  }

  /** `[…]` → its set (the cursor at `[`). */
  private characterClass(): CharSet {
    this.position++;
    const negated = this.peek() === '^';
    if (negated) this.position++;
    const members: (readonly [number, number])[] = [];
    while (this.peek() !== ']') {
      if (this.peek() === undefined) throw new UnmodeledSyntax('unterminated class');
      charge(1);
      const low = this.classAtom();
      if (this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== undefined) {
        this.position++;
        const high = this.classAtom();
        const from = singleUnit(low);
        const to = singleUnit(high);
        // Annex B: a class escape at either end makes `-` a literal.
        if (from !== null && to !== null) members.push([from, to]);
        else members.push(...low, ...high, [0x2d, 0x2d]);
      } else {
        members.push(...low);
      }
    }
    this.position++;
    const set = normalize(members);
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

/**
 * What every string a node matches starts with: `sets[i]` holds (at least)
 * every unit a string can have at position i, and every string is at
 * least `sets.length` long. `fixed` when every string is exactly that long
 * — so a sequence can keep reading positions past the node.
 */
interface Head {
  readonly sets: readonly CharSet[];
  readonly fixed: boolean;
}

/** Positions a head tracks (comparing further adds nothing for real rows). */
const HEAD_LIMIT = 32;

/** Memo: node → its head. */
const heads = new WeakMap<RegexNode, Head>();

/** A node's head (see {@link Head}), memoized. */
function headOf(node: RegexNode): Head {
  const memo = heads.get(node);
  if (memo !== undefined) return memo;
  const head = computeHead(node);
  heads.set(node, head);
  return head;
}

/** {@link headOf} without the memo. */
function computeHead(node: RegexNode): Head {
  charge(1);
  switch (node.kind) {
    case 'chars':
      return { sets: [node.first], fixed: true };
    case 'empty':
      return { sets: [], fixed: true };
    case 'backref':
      return { sets: [], fixed: false };
    case 'seq': {
      const sets: CharSet[] = [];
      for (const item of node.items) {
        const head = headOf(item);
        charge(head.sets.length);
        sets.push(...head.sets);
        if (sets.length > HEAD_LIMIT) return { sets: sets.slice(0, HEAD_LIMIT), fixed: false };
        if (!head.fixed) return { sets, fixed: false };
      }
      return { sets, fixed: true };
    }
    case 'alt': {
      // Position-wise unions over-approximate each position; the branches
      // stay aligned only when all of them have one fixed length.
      const branchHeads = node.branches.map(headOf);
      const length = Math.min(...branchHeads.map((head) => head.sets.length));
      charge(branchHeads.length * (1 + length));
      const sets = Array.from({ length }, (_, index) =>
        normalize(branchHeads.flatMap((head) => head.sets[index] ?? NO_CHARS))
      );
      const fixed = branchHeads.every((head) => head.fixed && head.sets.length === length);
      return { sets, fixed };
    }
    case 'repeat': {
      const body = headOf(node.body);
      // A zero-width body (`(?:)`, `\b`, a lookaround) adds no positions; a
      // non-fixed one only its first copy's; otherwise copies stop past the
      // limit — never work proportional to the repeat count.
      const zeroWidth = body.fixed && body.sets.length === 0;
      const copies = zeroWidth
        ? 0
        : body.fixed
          ? Math.min(node.min, HEAD_LIMIT + 1)
          : Math.min(node.min, 1);
      const sets: CharSet[] = [];
      charge(copies * body.sets.length);
      for (let copy = 0; copy < copies; copy++) sets.push(...body.sets);
      const capped = sets.length > HEAD_LIMIT;
      return {
        sets: capped ? sets.slice(0, HEAD_LIMIT) : sets,
        // Every string of a zero-width body is empty, whatever the count.
        fixed: zeroWidth || (body.fixed && node.min === node.max && !capped)
      };
    }
  }
}

/**
 * Whether some string of one head can be a prefix of (or equal to) some
 * string of the other: false only when a position both heads fix holds
 * disjoint units (sound — never a missed overlap).
 */
function mayPrefixOverlap(a: Head, b: Head): boolean {
  charge(1);
  const length = Math.min(a.sets.length, b.sets.length);
  for (let index = 0; index < length; index++) {
    if (!intersects(a.sets[index] as CharSet, b.sets[index] as CharSet)) return false;
  }
  return true;
}

/**
 * Whether every head fixes its first unit and no two share one — then no
 * branch can prefix another (one linear pass instead of every pair).
 */
function firstUnitsDisjoint(branchHeads: readonly Head[]): boolean {
  const ranges: (readonly [number, number])[] = [];
  for (const head of branchHeads) {
    const first = head.sets[0];
    if (first === undefined) return false;
    ranges.push(...first);
  }
  charge(sortWork(ranges.length));
  // Ranges of one set never overlap, so any overlap after sorting is two heads sharing a unit.
  ranges.sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < ranges.length; index++) {
    if (
      (ranges[index] as readonly [number, number])[0] <=
      (ranges[index - 1] as readonly [number, number])[1]
    )
      return false;
  }
  return true;
}

/** Memo: alternation → whether two of its branches may prefix-overlap. */
const altOverlaps = new WeakMap<AltNode, boolean>();

/** Whether two branches of an alternation may prefix-overlap (memoized). */
function hasPrefixOverlap(node: AltNode): boolean {
  const memo = altOverlaps.get(node);
  if (memo !== undefined) return memo;
  const branchHeads = node.branches.map(headOf);
  // Pairwise-disjoint first units settle it in one pass; only otherwise do
  // pairs need comparing further.
  let overlap = false;
  if (firstUnitsDisjoint(branchHeads)) {
    altOverlaps.set(node, false);
    return false;
  }
  for (let i = 0; i < branchHeads.length && !overlap; i++) {
    for (let j = i + 1; j < branchHeads.length && !overlap; j++) {
      overlap = mayPrefixOverlap(branchHeads[i] as Head, branchHeads[j] as Head);
    }
  }
  altOverlaps.set(node, overlap);
  return overlap;
}

/** Whether a repeat is a loop over text (see the module doc). */
function isLoop(node: RegexNode): node is RepeatNode {
  return node.kind === 'repeat' && node.max > LOOP_REPEAT_LIMIT && node.body.consumed.length > 0;
}

/**
 * The ambiguity inside one loop iteration: an alternation whose branches
 * may prefix-overlap, or a variable-length quantifier that can consume a
 * unit that may also come right after it (`follow`: the rest of the
 * iteration, then the next iteration's start).
 */
function iterationRisk(node: RegexNode, follow: CharSet): BacktrackingRisk | null {
  charge(1);
  switch (node.kind) {
    case 'seq': {
      let after = follow;
      for (let index = node.items.length - 1; index >= 0; index--) {
        const item = node.items[index] as RegexNode;
        const risk = iterationRisk(item, after);
        if (risk !== null) return risk;
        after = item.nullable ? union(item.first, after) : item.first;
      }
      return null;
    }
    case 'alt': {
      if (hasPrefixOverlap(node)) return 'overlapping-alternation';
      for (const branch of node.branches) {
        const risk = iterationRisk(branch, follow);
        if (risk !== null) return risk;
      }
      return null;
    }
    case 'repeat': {
      const variable = node.max > node.min && node.body.consumed.length > 0;
      if (variable && intersects(node.body.consumed, follow)) return 'nested-repetition';
      // An inner loop's own next iteration is checked when `treeRisk` analyzes
      // that loop by itself (the checks distribute over the follow's union).
      return iterationRisk(node.body, follow);
    }
    default:
      return null;
  }
}

/** The first risk of one loop, or null. */
function loopRisk(loop: RepeatNode): BacktrackingRisk | null {
  if (loop.body.backref && loop.body.kind !== 'backref') return 'repeated-backreference';
  return iterationRisk(loop.body, loop.body.first);
}

/** A node's children. */
function childrenOf(node: RegexNode): readonly RegexNode[] {
  if (node.kind === 'seq') return node.items;
  if (node.kind === 'alt') return node.branches;
  return node.kind === 'repeat' ? [node.body] : [];
}

/** The first risk anywhere in the tree (outer loops first), or null. */
function treeRisk(node: RegexNode): BacktrackingRisk | null {
  charge(1);
  if (isLoop(node)) {
    const risk = loopRisk(node);
    if (risk !== null) return risk;
  }
  for (const child of childrenOf(node)) {
    const risk = treeRisk(child);
    if (risk !== null) return risk;
  }
  return null;
}

/** One uncached analysis: the verdict and the work it spent. */
export interface RegexRiskAnalysis {
  readonly risk: BacktrackingRisk | null;
  /** Work units spent — never more than the source's {@link analysisWorkBudget}. */
  readonly work: number;
}

/**
 * The work an analysis of `source` may spend — linear in its length, so a
 * whole set's prevalidation is bounded by its character budget, whatever
 * shapes its rows take.
 *
 * @param source The pattern row.
 */
export function analysisWorkBudget(source: string): number {
  return REGEX_ANALYSIS_LIMITS.workBase + REGEX_ANALYSIS_LIMITS.workPerChar * source.length;
}

/** The analysis proper (limits checked first); throws only past the budget. */
function analyzeWithinLimits(source: string): BacktrackingRisk | null {
  if (source.length > REGEX_ANALYSIS_LIMITS.chars) return 'too-complex';
  const groups = scanGroups(source);
  if (groups.depth > REGEX_ANALYSIS_LIMITS.groupDepth) return 'too-complex';
  const parser = new PatternParser(source, groups);
  const root = parser.parse();
  for (const node of [root, ...parser.lookarounds]) {
    const risk = treeRisk(node);
    if (risk !== null) return risk;
  }
  return null;
}

/**
 * Analyze a source under its work budget, uncached; never throws.
 * Deterministic: the same source spends the same work and gets the same
 * verdict, whatever ran before it.
 *
 * @param source The pattern row (no flags).
 */
export function analyzeRegexRisk(source: string): RegexRiskAnalysis {
  workLeft = analysisWorkBudget(source);
  workSpent = 0;
  analysisFolds.clear();
  let risk: BacktrackingRisk | null;
  try {
    risk = analyzeWithinLimits(source);
  } catch (cause) {
    // Unmodeled syntax is accepted; anything else — the budget spent, a
    // stack overflow — means the row could not be checked: rejected, never thrown.
    risk = cause instanceof UnmodeledSyntax ? null : 'too-complex';
  } finally {
    workLeft = Infinity;
    analysisFolds.clear();
  }
  return { risk, work: workSpent };
}

/**
 * The per-pattern verdict memo: rows are re-validated per document. Bounded
 * by entries and by the bytes of the sources it keys on — translated
 * sources run to tens of thousands of characters, and the memo lives in
 * every realm that validates (the overlay inside host pages included).
 */
const riskMemo = createBoundedMemo<BacktrackingRisk | null>({
  maxEntries: 512,
  // Retained bytes: the source string plus its entry (measured ≤ 1 KiB).
  maxWeight: 96 * 1024,
  weigh: (source) => 1024 + stringBytes(source)
});

/**
 * The catastrophic-backtracking risk of a pattern the engine compiles
 * (call it only after `new RegExp(source)` succeeded). Never throws.
 *
 * @param source The pattern row (no flags).
 * @returns The first risk found, or null (no known exponential shape — or
 *   syntax the analysis does not model, which is accepted).
 */
export function regexBacktrackingRisk(source: string): BacktrackingRisk | null {
  return riskMemo.get(source, () => analyzeRegexRisk(source).risk);
}
