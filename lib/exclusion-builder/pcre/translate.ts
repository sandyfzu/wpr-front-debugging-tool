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
import { intersects, byteRanges, setSource, unionOf, type ByteSet } from './byte-set';
import {
  parsePcre,
  type Assertion,
  type GroupKind,
  type ParseIssue,
  type ParsedPattern,
  type PatternNode
} from './parse';

/** The features whose rows are PCRE patterns. */
export type RegexFeatureId = 'delay_js' | 'defer_all_js';

/** One PCRE construct the translator reports, named for the row note. */
export interface PcreConstruct {
  /** The construct as WP Rocket's runtime sees it (after its escapes). */
  readonly construct: string;
  /** What is wrong with it. */
  readonly detail: string;
}

/** Everything learned about one row on its own (no set context). */
export interface RowAnalysis {
  /** WP Rocket's save drops the row: PCRE rejects it (its `#…#` check, no `i`). */
  readonly invalidAtSave: PcreConstruct | null;
  /** A construct with no proven JS equivalent at runtime (or one PCRE rejects only there). */
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
  /** Group names the row declares. */
  readonly names: readonly string[];
  /** The row may repeat a group name (`(?J)` / branch reset), so joining it cannot clash. */
  readonly allowsDuplicateNames: boolean;
  /** Defer joining: a `\Q` left open quotes the wrapper's `)`, so the joined pattern cannot compile. */
  readonly breaksJoin: boolean;
}

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

/** The first issue of a kind, as a construct named in text. */
function firstIssue(issues: readonly ParseIssue[], kind: ParseIssue['kind']): PcreConstruct | null {
  const issue = issues.find((candidate) => candidate.kind === kind);
  return issue === undefined
    ? null
    : { construct: fromByteString(issue.construct), detail: issue.detail };
}

/**
 * Whether WP Rocket's save drops the row: its validation compiles
 * `#row#` (`#` escaped, no `i`) and removes rows PCRE rejects. Only
 * rejections proven on PCRE2 are claimed; anything unknown is kept.
 *
 * @param row A stored-form row (text).
 * @returns The rejected construct, or `null` when the row is kept.
 */
export function saveRejection(row: string): PcreConstruct | null {
  const pattern = applyEscapes(toByteString(row), SAVE_ESCAPES);
  const delimiter = delimiterProblem(pattern);
  if (delimiter !== null) return delimiter.construct === '\\0' ? null : delimiter;
  return firstIssue(parsePcre(pattern, false).issues, 'invalid');
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
    nodes.some((node) => node.type === 'option' && !node.caselessOnly)
  );
}

/** Visit every node of a tree, depth first. */
function* walk(nodes: readonly PatternNode[]): Generator<PatternNode> {
  for (const node of nodes) {
    yield node;
    if (node.type === 'group') for (const branch of node.alternatives) yield* walk(branch);
    if (node.type === 'repeat') yield* walk([node.node]);
  }
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
   * @param parsed The runtime-form parse (complete, no issues).
   * @param caseless Whether back-references compare caselessly.
   * @param options Replace-mode settings.
   */
  constructor(
    private readonly parsed: ParsedPattern,
    private readonly caseless: boolean,
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
          if (bytes === null || (this.caseless && intersects(bytes, JS_ONLY_FOLDED))) {
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
          const holdsState = [...walk(inner.alternatives.flat())].some(
            (child) =>
              child.type === 'backref' ||
              child.type === 'keep' ||
              (child.type === 'group' && child.kind === 'capture')
          );
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
        // Wrapped so a following digit never extends the reference number.
        return this.caseless ? `(?i:\\${String(target)})` : `(?:\\${String(target)})`;
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
  return applyEscapes(toByteString(row), RUNTIME_ESCAPES[feature]);
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
  return new Emitter(parsed, true, options).run();
}

/** Whether an emit result is a translation. */
export function isEmitted(result: Emitted | PcreConstruct): result is Emitted {
  return 'source' in result;
}

/**
 * Analyze one stored row of a regex feature on its own: whether WP Rocket's
 * save keeps it, how its runtime pattern translates, and the facts the
 * Defer joined checks need.
 *
 * @param feature The row's feature.
 * @param row The stored row.
 */
export function analyzeRow(feature: RegexFeatureId, row: string): RowAnalysis {
  const pattern = runtimePattern(feature, row);
  const parsed = parsePcre(pattern, true);
  const emitted = delimiterProblem(pattern) ?? emitParsed(parsed, {});
  const source = isEmitted(emitted) ? emitted.source : null;
  const option = parsed.issues.find((issue) => issue.detail === 'option setting');
  const absolute = [...walk(parsed.alternatives.flat())].find(
    (node) => node.type === 'backref' && node.absolute
  );
  return {
    invalidAtSave: saveRejection(row),
    pcreOnly: isEmitted(emitted) ? null : emitted,
    matchesAll: parsed.complete && parsed.alternatives.some((nodes) => nodes.every(alwaysNullable)),
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
    allowsDuplicateNames: parsed.allowsDuplicateNames,
    breaksJoin: parsed.unterminatedQuote
  };
}
