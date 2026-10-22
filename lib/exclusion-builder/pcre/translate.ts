/**
 * PCRE→JS translation of one stored regex row, as WP Rocket runs it:
 * `preg_match('#' . escaped_row . '#i', subject)` with the feature's own
 * escapes applied first (Delay JS: `+` → `\+`, `?ver` → `\?ver`, `#` → `\#`;
 * Defer JS: `#` → `\#`). The result is a JS source that, compiled without
 * flags and run over the subject's **byte string** ({@link toByteString}),
 * matches exactly when PCRE does — or the reason it cannot be.
 *
 * Why bytes: WP Rocket's patterns run without PCRE's UTF option, so `.`,
 * classes and quantifiers see UTF-8 bytes, not characters (`^.$` misses
 * `é`, two bytes). Pattern and subject are both encoded the same way, one
 * byte → one UTF-16 unit (0x00–0xFF). Case: PCRE's `i` folds ASCII letters
 * only; JS's `i` would also fold bytes 0xC0–0xDE with 0xE0–0xFE, so it is
 * never used — letters are expanded in the sets (`a` → `[Aa]`) instead.
 */
import { regexBacktrackingRisk, type BacktrackingRisk } from '../regex-risk';
import type { ExclusionFeatureId } from '../set';
import { intersects, byteRanges, setSource, unionOf, type ByteSet } from './byte-set';
import {
  parsePcre,
  sequenceLength,
  type Assertion,
  type GroupKind,
  type JoinRepair,
  type ParseIssue,
  type NameDeclaration,
  type ParsedPattern,
  type PatternNode
} from './parse';

/**
 * The translator's work bounds, declared once. Parsing and emission are
 * linear in a row's bytes, so capping the bytes caps a row's work (the
 * wire caps a row at 2 048 characters — at most 6 144 UTF-8 bytes); the
 * Defer pre-check replay is capped in regex executions. Past a bound the
 * answer is "not checked here", never a guess.
 */
export const PCRE_LIMITS = {
  /** UTF-8 bytes of one row. */
  rowBytes: 8_192,
  /**
   * UTF-8 bytes of one set (rows past it are not checked). The wire caps a
   * set at 64 K characters (≤ 192 KiB), so a wire-valid set never reaches it.
   */
  setBytes: 512 * 1024,
  /** Regex executions of one `dummy-string` replay (a 500-row set needs ~13 000). */
  replayExecs: 200_000
} as const;

/** The features whose rows are PCRE patterns. */
export type RegexFeatureId = Extract<ExclusionFeatureId, 'delay_js' | 'defer_all_js'>;

/** One PCRE construct the translator reports, named for the row note. */
export interface PcreConstruct {
  /** The construct as WP Rocket's runtime sees it (after its escapes). */
  readonly construct: string;
  /** What is wrong with it. */
  readonly detail: string;
}

/** Everything learned about one row on its own (no set context). */
export interface RowAnalysis {
  /**
   * The row was not analyzed: past {@link PCRE_LIMITS}`.rowBytes`, or past
   * the set's `setBytes` budget (the save outcome's `detail` says which).
   */
  readonly unchecked: boolean;
  /** The row's UTF-8 length in bytes (the work it cost). */
  readonly bytes: number;
  /** What WP Rocket's settings save does with the row (its `#…#` check, no `i`). */
  readonly save: SaveOutcome;
  /** A dropped row: how joining may repair each of its proven errors (see {@link DropRepair}). */
  readonly dropRepairs: readonly DropRepair[];
  /** Parenthesis balance (net, lowest depth) of the row as joined; `null` when unknown. */
  readonly parens: { readonly net: number; readonly min: number } | null;
  /**
   * Why the runtime pattern has no proven JS translation: a PCRE-only or
   * unmodeled construct, or one PCRE rejects only at runtime (Delay's `+`
   * escape can break a row the save accepted).
   */
  readonly pcreOnly: PcreConstruct | null;
  /** The row can match the empty string at any position: it matches every subject. */
  readonly matchesAll: boolean;
  /** JS source equivalent to the runtime pattern (absent with `invalidAtSave`/`pcreOnly`). */
  readonly source: string | null;
  /** The backtracking-risk guard's verdict on {@link source}. */
  readonly risk: BacktrackingRisk | null;
  /** Defer joining: an unscoped option setting at the top level (it leaks into later rows). */
  readonly topLevelOption: PcreConstruct | null;
  /** Defer joining: a numbered absolute back-reference (the joined wrapper group shifts it). */
  readonly absoluteBackreference: PcreConstruct | null;
  /** Group names the row declares, with the `J` (duplicate names) state at each. */
  readonly names: readonly NameDeclaration[];
  /** The top-level `J` state the row leaves behind (`null` = never set). */
  readonly duplicatesAllowedAtEnd: boolean | null;
  /** The fewest bytes a match spans (`NaN` when not measured): no shorter text can match. */
  readonly minLength: number;
  /** `\G` or `\K`: the `preg_replace` replay needs a per-offset source (see {@link EmitOptions}). */
  readonly searchDependent: boolean;
  /** Defer joining: a `\Q` left open quotes the wrapper's `)`, so the joined pattern cannot compile. */
  readonly breaksJoin: boolean;
}

/**
 * What the settings save does with a row: `kept`, `dropped` (PCRE rejects
 * it — observed on PCRE2 10.44 and 10.49), or `unknown` (its validity is
 * not modeled, or differs between those versions).
 */
export type SaveOutcome =
  { readonly outcome: 'kept' } | ({ readonly outcome: 'dropped' | 'unknown' } & PcreConstruct);

/** How the JS source is emitted. */
export interface EmitOptions {
  /**
   * Emit for `preg_replace`'s scan instead of one `preg_match`: `\G` asserts
   * this search offset (not the subject start), and every `\K` becomes an
   * empty capture group (its position tells where the replaced text starts).
   */
  readonly searchStart?: number;
}

/** A translated row: JS source plus, in replace mode, the `\K` marker groups. */
export interface Emitted {
  readonly source: string;
  /** JS group numbers of the `\K` markers (replace mode only). */
  readonly keepGroups: readonly number[];
}

/** WP Rocket's runtime escapes, per feature, applied in order (`str_replace` with arrays). */
const RUNTIME_ESCAPES: Readonly<Record<RegexFeatureId, readonly (readonly [string, string])[]>> = {
  delay_js: [
    ['+', '\\+'],
    ['?ver', '\\?ver'],
    ['#', '\\#']
  ],
  defer_all_js: [['#', '\\#']]
};

/** The settings save's validation escape (`rocket_pre_main_option`, no `i`, no runtime escapes). */
const SAVE_ESCAPES: readonly (readonly [string, string])[] = [['#', '\\#']];

/** Bytes JS's `i` folds although PCRE's does not (Latin-1 letters as single units). */
const JS_ONLY_FOLDED = byteRanges([0xc0, 0xd6], [0xd8, 0xde], [0xe0, 0xf6], [0xf8, 0xfe]);

/** `\R` without its atomicity problem: CR is a line break alone only when no LF follows. */
const LINEBREAK_SOURCE = '(?:\\r\\n|\\r(?!\\n)|[\\n\\x0b\\f\\x85])';

/**
 * A string's UTF-8 bytes as a byte string: one UTF-16 unit (0x00–0xFF) per
 * byte — the form translated sources match against. Exact for text decoded
 * from UTF-8 (WordPress's default `blog_charset`); a lone surrogate encodes
 * as U+FFFD's bytes, as `TextEncoder` does.
 *
 * @param text The subject or pattern text.
 */
export function toByteString(text: string): string {
  let bytes = '';
  const encoded = new TextEncoder().encode(text);
  // Chunked: spreading a huge array into fromCharCode overflows the stack.
  for (let index = 0; index < encoded.length; index += 0x8000) {
    bytes += String.fromCharCode(...encoded.subarray(index, index + 0x8000));
  }
  return bytes;
}

/** A byte string back to text, for naming constructs (invalid UTF-8 → U+FFFD). */
function fromByteString(bytes: string): string {
  return new TextDecoder().decode(Uint8Array.from(bytes, (char) => char.charCodeAt(0)));
}

/** Apply `str_replace(search[], replace[])` semantics: each pair over the whole result so far. */
function applyEscapes(row: string, escapes: readonly (readonly [string, string])[]): string {
  return escapes.reduce((text, [search, replace]) => text.replaceAll(search, replace), row);
}

/**
 * PHP's delimiter scan over `#pattern#`: a backslash skips the next
 * character, so an escaped row that ends in `\` (the closing `#` escaped)
 * or holds `\\#` (a `#` that ends the pattern early) does not compile.
 *
 * @param pattern The escaped pattern, between its delimiters.
 * @returns The problem, or `null` when the delimiters frame the whole pattern.
 */
function delimiterProblem(pattern: string): PcreConstruct | null {
  let index = 0;
  while (index < pattern.length) {
    const char = pattern.charAt(index);
    if (char === '\0') {
      // PHP < 8.2 stops at a NUL byte; later versions do not — not modeled.
      return { construct: '\\0', detail: 'NUL byte (PHP-version dependent)' };
    }
    if (char === '#') return { construct: '\\#', detail: '`#` ends the pattern early' };
    if (char === '\\') {
      if (index === pattern.length - 1) {
        return { construct: '\\', detail: 'a trailing `\\` escapes the closing delimiter' };
      }
      index += 2;
      continue;
    }
    index++;
  }
  return null;
}

/**
 * Why a row the save drops may still compile once WP Rocket joins every
 * Defer row into `#(r1|r2|…)#i`: `fixed` (it cannot — the error survives
 * any join), `open-end` (a construct runs to the row's end: the next row can
 * complete it), or a {@link JoinRepair} kind.
 */
export type DropRepair = JoinRepair | 'open-end' | 'fixed';

/** The save check with what the Defer join needs to know. */
interface SaveCheck {
  readonly outcome: SaveOutcome;
  /** For a dropped row: how each proven error may be repaired by joining. */
  readonly repairs: readonly DropRepair[];
  /** Parenthesis balance of the save form (`null` when not fully parsed). */
  readonly parens: { readonly net: number; readonly min: number } | null;
}

/** How a joined pattern may repair one proven error. */
function repairOf(issue: ParseIssue): DropRepair {
  return issue.join ?? (issue.atEnd === true ? 'open-end' : 'fixed');
}

/** WP Rocket's save check on a row (see {@link saveOutcome}), with the join facts. */
function saveCheck(bytes: string): SaveCheck {
  const pattern = applyEscapes(bytes, SAVE_ESCAPES);
  const delimiter = delimiterProblem(pattern);
  if (delimiter !== null) {
    const nul = delimiter.construct === '\\0';
    return {
      outcome: { outcome: nul ? 'unknown' : 'dropped', ...delimiter },
      // A trailing `\` escapes whatever follows it: joined, the next `|`.
      repairs: delimiter.construct === '\\' ? ['open-end'] : ['fixed'],
      parens: null
    };
  }
  const parsed = parsePcre(pattern, false);
  // Issues are in source order: past an unknown construct the parse is no
  // longer trusted, so only an invalid one before it proves a drop.
  const firstUnknown = parsed.issues.findIndex((issue) => issue.kind === 'unknown');
  const trusted = firstUnknown === -1 ? parsed.issues : parsed.issues.slice(0, firstUnknown);
  const proven = trusted.filter((issue) => issue.kind === 'invalid');
  const parens = parsed.complete ? parsed.parens : null;
  const first = proven[0] ?? parsed.issues[firstUnknown];
  if (first === undefined) return { outcome: { outcome: 'kept' }, repairs: [], parens };
  return {
    outcome: {
      outcome: first.kind === 'invalid' ? 'dropped' : 'unknown',
      construct: fromByteString(first.construct),
      detail: first.detail
    },
    repairs: proven.map(repairOf),
    parens
  };
}

/**
 * What WP Rocket's settings save does with a row: its validation compiles
 * `#row#` (`#` escaped, no `i`) and removes rows PCRE rejects. Only
 * rejections observed on both reference PCRE2 versions are claimed;
 * syntax whose validity is not modeled is `unknown`, never `kept`.
 *
 * @param row A stored-form row (text).
 */
export function saveOutcome(row: string): SaveOutcome {
  return saveCheck(toByteString(row)).outcome;
}

/** Whether a node can match the empty string wherever it is tried. */
function alwaysNullable(node: PatternNode): boolean {
  switch (node.type) {
    case 'keep':
    case 'option':
      return true;
    case 'repeat':
      return node.min === 0 || alwaysNullable(node.node);
    case 'group':
      return (
        (node.kind === 'capture' || node.kind === 'group') &&
        node.alternatives.some((nodes) => nodes.every(alwaysNullable))
      );
    default:
      return false;
  }
}

/** The unscoped option settings at a row's top level that change matching (not a bare `i`). */
function hasTopLevelOption(parsed: ParsedPattern): boolean {
  return parsed.alternatives.some((nodes) =>
    nodes.some((node) => node.type === 'option' && !node.noop)
  );
}

/** Visit every node of a tree, depth first. */
function walk(nodes: readonly PatternNode[], into: PatternNode[] = []): PatternNode[] {
  for (const node of nodes) {
    into.push(node);
    if (node.type === 'group') for (const branch of node.alternatives) walk(branch, into);
    if (node.type === 'repeat') walk([node.node], into);
  }
  return into;
}

/**
 * Bytes a subtree can consume (its sets' union), or `null` when it holds
 * something whose text is not a plain set sequence (a back-reference or an
 * opaque construct).
 */
function bytesConsumed(nodes: readonly PatternNode[]): ByteSet | null {
  const sets: ByteSet[] = [];
  for (const node of walk(nodes)) {
    if (node.type === 'set') sets.push(node.set);
    if (node.type === 'linebreak') sets.push(byteRanges([0x0a, 0x0d], [0x85, 0x85]));
    if (node.type === 'backref' || node.type === 'opaque') return null;
  }
  return unionOf(...sets);
}

/** The emitter's state: one translation of one parsed row. */
class Emitter {
  private jsGroups = 0;
  private readonly groupMap = new Map<number, number>();
  private readonly keepGroups: number[] = [];

  /**
   * @param parsed The runtime-form parse (complete, no issues; both
   *   features run caselessly, so back-references compare caselessly).
   * @param options Replace-mode settings.
   */
  constructor(
    private readonly parsed: ParsedPattern,
    private readonly options: EmitOptions
  ) {}

  /** The whole row, or the construct that blocks an exact translation. */
  run(): Emitted | PcreConstruct {
    const certain = this.certainGroups();
    for (const branch of this.parsed.alternatives) {
      const blocker = this.check(branch, certain.get(branch) ?? new Map<number, number>());
      if (blocker !== null) return blocker;
    }
    const source = this.parsed.alternatives.map((branch) => this.sequence(branch)).join('|');
    return { source, keepGroups: this.keepGroups };
  }

  /**
   * Per top-level branch: the capture groups certain to be set, and the
   * index of the branch element closing each. A back-reference is
   * translated only to one of these, from a later element: JS matches an
   * unset or not-yet-closed group as empty where PCRE fails, and JS resets
   * captures on each iteration of an enclosing loop where PCRE keeps them.
   */
  private certainGroups(): Map<readonly PatternNode[], Map<number, number>> {
    const certain = new Map<readonly PatternNode[], Map<number, number>>();
    for (const branch of this.parsed.alternatives) {
      const groups = new Map<number, number>();
      branch.forEach((node, index) => {
        if (node.type === 'group' && node.kind === 'capture' && node.capture !== null) {
          groups.set(node.capture, index);
        }
      });
      certain.set(branch, groups);
    }
    return certain;
  }

  /**
   * The first construct in a top-level branch that cannot be emitted
   * exactly: a back-reference that is not to a certain group (or, caseless,
   * whose group can capture bytes JS folds differently), and a lookbehind
   * holding a capture, a back-reference or `\K` (JS evaluates lookbehinds
   * backwards, so their captures differ).
   */
  private check(
    branch: readonly PatternNode[],
    certain: ReadonlyMap<number, number>
  ): PcreConstruct | null {
    for (const [index, node] of branch.entries()) {
      for (const inner of walk([node])) {
        if (inner.type === 'backref') {
          const closedAt = certain.get(inner.group);
          if (closedAt === undefined || closedAt >= index) {
            return {
              construct: `\\${String(inner.group)}`,
              detail: 'back-reference to a group that may be unset'
            };
          }
          const group = branch[closedAt];
          const bytes = group?.type === 'group' ? bytesConsumed(group.alternatives.flat()) : null;
          if (bytes === null || intersects(bytes, JS_ONLY_FOLDED)) {
            return {
              construct: `\\${String(inner.group)}`,
              detail: 'caseless back-reference to non-ASCII text'
            };
          }
        }
        if (
          inner.type === 'group' &&
          (inner.kind === 'lookbehind' || inner.kind === 'negative-lookbehind')
        ) {
          const holdsState = walk(inner.alternatives.flat()).some(
            (child) =>
              child.type === 'backref' ||
              child.type === 'keep' ||
              (child.type === 'group' && child.kind === 'capture')
          );
          // PCRE matches a variable-length branch forwards from each start, JS
          // backwards: only fixed-length branches are proven equal (`\R` spans
          // 1–2 bytes: `(?<=\R)[^a]` matches "\r\n" in PCRE only, observed).
          const variable = inner.alternatives.some((branch) => {
            const { min, max } = sequenceLength(branch);
            return min !== max;
          });
          if (variable) {
            return { construct: '(?<=', detail: 'variable-length lookbehind' };
          }
          if (holdsState)
            return {
              construct: '(?<=',
              detail: 'lookbehind holding a group, back-reference or \\K'
            };
        }
      }
    }
    return null;
  }

  /** A sequence's source. */
  private sequence(nodes: readonly PatternNode[]): string {
    return nodes.map((node) => this.node(node)).join('');
  }

  /** One node's source. */
  private node(node: PatternNode): string {
    switch (node.type) {
      case 'set':
        return setSource(node.set);
      case 'linebreak':
        return LINEBREAK_SOURCE;
      case 'assert':
        return this.assertion(node.assertion);
      case 'keep':
        if (this.options.searchStart === undefined) return '';
        this.keepGroups.push(++this.jsGroups);
        return '()';
      case 'option':
        return '';
      case 'backref': {
        const target = this.groupMap.get(node.group) ?? node.group;
        // Caseless like PCRE's (ASCII only: the group holds no byte JS folds
        // differently), and wrapped so a following digit never extends the number.
        return `(?i:\\${String(target)})`;
      }
      case 'repeat':
        return this.node(node.node) + quantifierSource(node.min, node.max, node.lazy);
      case 'group':
        return this.group(node);
      case 'opaque':
        // Unreachable: a row with an opaque node is PCRE-only and never emitted.
        throw new Error('[WPR FDT] opaque PCRE node reached the emitter');
    }
  }

  /** A group's source, keeping JS capture numbers in step with PCRE's. */
  private group(node: PatternNode & { type: 'group' }): string {
    let open: string;
    if (node.kind === 'capture') {
      this.jsGroups++;
      if (node.capture !== null) this.groupMap.set(node.capture, this.jsGroups);
      open = '(';
    } else if (node.kind === 'opaque') {
      // Unreachable: an opaque group always comes with a PCRE-only issue.
      throw new Error('[WPR FDT] opaque PCRE group reached the emitter');
    } else {
      open = GROUP_OPENERS[node.kind];
    }
    return `${open}${node.alternatives.map((branch) => this.sequence(branch)).join('|')})`;
  }

  /** An assertion's source. */
  private assertion(assertion: Assertion): string {
    switch (assertion) {
      case 'subject-start':
        return '^';
      case 'search-start': {
        const offset = this.options.searchStart ?? 0;
        return offset === 0 ? '^' : `(?<=^[\\s\\S]{${String(offset)}})`;
      }
      case 'end-or-final-newline':
        return '(?=\\n?$)';
      case 'subject-end':
        return '$';
      case 'word-boundary':
        return '\\b';
      case 'not-word-boundary':
        return '\\B';
    }
  }
}

/** Openers of the non-capturing group kinds the emitter writes. */
const GROUP_OPENERS: Readonly<Record<Exclude<GroupKind, 'capture' | 'opaque'>, string>> = {
  group: '(?:',
  lookahead: '(?=',
  'negative-lookahead': '(?!',
  lookbehind: '(?<=',
  'negative-lookbehind': '(?<!'
};

/** A quantifier's source. */
function quantifierSource(min: number, max: number | null, lazy: boolean): string {
  const base =
    max === null
      ? min === 0
        ? '*'
        : min === 1
          ? '+'
          : `{${String(min)},}`
      : min === 0 && max === 1
        ? '?'
        : min === max
          ? `{${String(min)}}`
          : `{${String(min)},${String(max)}}`;
  return lazy ? `${base}?` : base;
}

/** The runtime pattern of a row for a feature, as a byte string. */
function runtimePattern(feature: RegexFeatureId, row: string): string {
  return runtimeEscapes(feature, toByteString(row));
}

/** WP Rocket's runtime escapes applied to a row's byte string. */
function runtimeEscapes(feature: RegexFeatureId, bytes: string): string {
  return applyEscapes(bytes, RUNTIME_ESCAPES[feature]);
}

/**
 * Emit the JS source of a row's runtime pattern, or the construct that
 * blocks it.
 *
 * @param feature The row's feature (decides the runtime escapes).
 * @param row The stored row.
 * @param options Replace-mode settings (default: one `preg_match`).
 */
export function emitRow(
  feature: RegexFeatureId,
  row: string,
  options: EmitOptions = {}
): Emitted | PcreConstruct {
  const pattern = runtimePattern(feature, row);
  return delimiterProblem(pattern) ?? emitParsed(parsePcre(pattern, true), options);
}

/** Emit a parsed runtime pattern, or name its first issue. */
function emitParsed(parsed: ParsedPattern, options: EmitOptions): Emitted | PcreConstruct {
  // An incomplete parse always records the construct that stopped it.
  const issue = parsed.issues[0];
  if (issue !== undefined) {
    return { construct: fromByteString(issue.construct), detail: issue.detail };
  }
  return new Emitter(parsed, options).run();
}

/** Whether an emit result is a translation. */
export function isEmitted(result: Emitted | PcreConstruct): result is Emitted {
  return 'source' in result;
}

/**
 * Analyze one stored row of a regex feature on its own: what WP Rocket's
 * save does with it, how its runtime pattern translates, and the facts the
 * Defer joined checks need.
 *
 * @param feature The row's feature.
 * @param row The stored row.
 */
export function analyzeRow(feature: RegexFeatureId, row: string): RowAnalysis {
  // Every character is at least one byte: an over-long row is not even encoded.
  const tooLong = `longer than ${String(PCRE_LIMITS.rowBytes)} bytes`;
  if (row.length > PCRE_LIMITS.rowBytes) return uncheckedRow(row, row.length, tooLong);
  const bytes = toByteString(row);
  if (bytes.length > PCRE_LIMITS.rowBytes) return uncheckedRow(row, bytes.length, tooLong);
  const pattern = runtimeEscapes(feature, bytes);
  const parsed = parsePcre(pattern, true);
  const delimiter = delimiterProblem(pattern);
  const emitted = delimiter ?? emitParsed(parsed, {});
  const { outcome: save, repairs: dropRepairs, parens } = saveCheck(bytes);
  const nodes = walk(parsed.alternatives.flat());
  const source = isEmitted(emitted) ? emitted.source : null;
  const option = parsed.issues.find((issue) => issue.detail === 'option setting');
  const absolute = nodes.find((node) => node.type === 'backref' && node.absolute);
  return {
    unchecked: false,
    bytes: bytes.length,
    save,
    dropRepairs,
    parens,
    pcreOnly: isEmitted(emitted) ? null : emitted,
    // A `{0}` group can stop PCRE matching at some starts (see the parser): no claim.
    matchesAll:
      parsed.complete &&
      !parsed.issues.some(({ detail }) => detail === 'group repeated zero times') &&
      parsed.alternatives.some((nodes) => nodes.every(alwaysNullable)),
    source,
    risk: source === null ? null : regexBacktrackingRisk(source),
    topLevelOption:
      option !== undefined && hasTopLevelOption(parsed)
        ? { construct: fromByteString(option.construct), detail: option.detail }
        : null,
    absoluteBackreference:
      absolute?.type === 'backref'
        ? { construct: `\\${String(absolute.group)}`, detail: 'numbered back-reference' }
        : null,
    names: parsed.names,
    duplicatesAllowedAtEnd: parsed.duplicatesAllowedAtEnd,
    minLength: Math.min(...parsed.alternatives.map((branch) => sequenceLength(branch).min)),
    searchDependent: nodes.some(
      (node) =>
        node.type === 'keep' || (node.type === 'assert' && node.assertion === 'search-start')
    ),
    breaksJoin: parsed.unterminatedQuote
  };
}

/**
 * The analysis of a row not checked (past a {@link PCRE_LIMITS} bound):
 * unknown in every respect.
 *
 * @param row The row.
 * @param bytes What it costs (its length, at least).
 * @param detail Which bound, for the reason.
 */
export function uncheckedRow(row: string, bytes: number, detail: string): RowAnalysis {
  const unchecked = { construct: `${row.slice(0, 16)}…`, detail };
  return {
    unchecked: true,
    bytes,
    save: { outcome: 'unknown', ...unchecked },
    dropRepairs: [],
    parens: null,
    pcreOnly: unchecked,
    matchesAll: false,
    source: null,
    risk: null,
    topLevelOption: null,
    absoluteBackreference: null,
    names: [],
    duplicatesAllowedAtEnd: null,
    minLength: NaN,
    searchDependent: false,
    breaksJoin: false
  };
}
