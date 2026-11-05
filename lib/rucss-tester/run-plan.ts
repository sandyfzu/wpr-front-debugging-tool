/**
 * One RUCSS test run, prepared and applied as pure steps: the configuration
 * is turned into a run plan (every pattern compiled once, before anything
 * is fetched or touched), each page style is judged against it, and the
 * service's CSS is turned into the CSS that replaces the removed styles.
 *
 * Style rules: every inline `style` and `link[rel="stylesheet"]` goes,
 * except an inline style whose markup contains a preserve marker (default
 * markers plus the user's) and a stylesheet whose URL matches an exclusion
 * pattern. WP Rocket's own used-CSS style is never preserved: the test
 * replaces it by definition.
 */
import { parseLineList } from '../../utils/line-list';
import { LAZY_RENDER_INLINE_CSS_ID, RUCSS_USED_CSS_ID } from '../wp-rocket/constants';
import type { RucssTesterConfig } from './config';

/** Id of the `style` element carrying the test's resulting CSS. */
export const RUCSS_RESULT_STYLE_ID = 'rucss_test_result_style';

/** The page styles a run judges (exact `rel` match: alternate sheets stay untouched). */
export const RUCSS_STRIP_SELECTOR = 'style,link[rel="stylesheet"]';

/**
 * Inline-style markers always preserved, so a test never strips styles that
 * are not the page's own design:
 * - `#wpcb-quick-actions-menu` — a code-snippet plugin's logged-in quick-actions menu;
 * - `wpr_rucss_style` — an opt-in keep marker any inline style can carry (e.g. as its id);
 * - `admin-bar.min.css` / `dashicons.min.css` — the WordPress admin bar and its
 *   icon font, named in an inlined copy of those files;
 * - WP Rocket's lazy-render inline style, which keeps not-yet-rendered sections
 *   hidden (stripping it would show them all at once).
 */
// `__PURE__`: a bundle importing only this module's limits drops the list.
export const DEFAULT_INLINE_PRESERVES: readonly string[] = /*#__PURE__*/ Object.freeze([
  '#wpcb-quick-actions-menu',
  'wpr_rucss_style',
  'admin-bar.min.css',
  'dashicons.min.css',
  LAZY_RENDER_INLINE_CSS_ID
]);

/** Most characters the built CSS may reach (4 × the largest accepted service answer). */
export const RUCSS_RESULT_CSS_MAX_CHARS = 8 * 1024 * 1024;

/** A compiled replacement pair. */
export interface CompiledReplacement {
  /** Index of the pair in the configuration (skipped rows keep their slot). */
  readonly index: number;
  /** The global pattern. */
  readonly pattern: RegExp;
  /** The replacement template (`$` substitutions apply; empty deletes). */
  readonly replacement: string;
}

/** A compiled exclusion line. */
export interface CompiledExclusion {
  /** The line as typed (trimmed): named when its pattern fails on a URL. */
  readonly line: string;
  /** The flagless pattern. */
  readonly pattern: RegExp;
}

/** Everything a run needs, validated and compiled. */
export interface RucssRunPlan {
  /** Safelist entries sent to the service. */
  readonly safelist: readonly string[];
  /** Preserve markers: the defaults, then the user's (deduplicated). */
  readonly inlinePreserves: readonly string[];
  /** Exclusion lines: a stylesheet whose URL matches one stays on the page. */
  readonly excludeFilePatterns: readonly CompiledExclusion[];
  /** CSS placed before the built CSS (never touched by the pairs). */
  readonly prepend: string;
  /** CSS placed after the built CSS (never touched by the pairs). */
  readonly append: string;
  /** Pairs with a search pattern, in order. */
  readonly replacements: readonly CompiledReplacement[];
  /** Ask the service for the mobile variant. */
  readonly mobile: boolean;
  /** Ask the service to treat the page as the home page. */
  readonly home: boolean;
}

/** A pattern the run cannot use (the whole run is refused). */
export type RucssPlanProblem =
  | {
      readonly kind: 'exclude-pattern';
      /** The offending line (trimmed). */
      readonly line: string;
      /** The engine's syntax error. */
      readonly message: string;
    }
  | {
      readonly kind: 'replacement-pattern';
      /** Index of the pair in the configuration. */
      readonly index: number;
      /** The pair's search pattern, as typed. */
      readonly search: string;
      /** The engine's syntax error. */
      readonly message: string;
    };

/** Preparation result: the plan, or every problem found. */
export type RucssPlanResult =
  | { readonly ok: true; readonly plan: RucssRunPlan }
  | { readonly ok: false; readonly problems: readonly RucssPlanProblem[] };

/** A page style as the run sees it. */
export type RucssStyleNode =
  | {
      readonly kind: 'inline';
      /** The element's id (empty when none). */
      readonly id: string;
      /** The element's serialized markup (`outerHTML`). */
      readonly markup: string;
    }
  | {
      readonly kind: 'link';
      /** The resolved stylesheet URL (`link.href`; empty when none). */
      readonly href: string;
    };

/** What a run does with one page style. */
export type RucssStyleDecision = 'remove' | 'preserved' | 'excluded';

/** An exclusion pattern the engine gave up on for a URL (e.g. its backtracking stack overflowed). */
export interface RucssExclusionFailure {
  readonly ok: false;
  readonly problem: 'exclusion-failed';
  /** The exclusion line whose pattern failed. */
  readonly line: string;
  /** The engine's message. */
  readonly message: string;
}

/** One pair's effect on the CSS. */
export interface ReplacementCount {
  readonly index: number;
  /** Matches replaced. */
  readonly count: number;
}

/** Why the CSS could not be built (the page must stay untouched). */
export type RucssCssFailure =
  | {
      readonly ok: false;
      readonly problem: 'oversize';
      /** The pair whose output would pass the cap; absent when prepend/append did. */
      readonly index?: number;
    }
  | {
      readonly ok: false;
      /** The pattern engine gave up on this CSS (e.g. its backtracking stack overflowed). */
      readonly problem: 'pattern-failed';
      /** The pair whose pattern failed. */
      readonly index: number;
      /** The engine's message. */
      readonly message: string;
    };

/** CSS build result. */
export type RucssCssBuild =
  | {
      readonly ok: true;
      /** The CSS to inject. */
      readonly css: string;
      /** One entry per applied pair, in plan order. */
      readonly applied: readonly ReplacementCount[];
    }
  | RucssCssFailure;

/**
 * The engine's message for a thrown value.
 *
 * @param error What was thrown.
 * @returns Its message (an `Error`'s), else its string form.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Compile a pattern the way the run will.
 *
 * @param source The pattern source.
 * @param flags The flags (`''` for exclusions, `'g'` for replacements).
 * @returns The compiled pattern, or the engine's syntax-error message.
 */
export function compilePattern(
  source: string,
  flags: '' | 'g'
):
  | { readonly ok: true; readonly pattern: RegExp }
  | { readonly ok: false; readonly message: string } {
  try {
    return { ok: true, pattern: new RegExp(source, flags) };
  } catch (error) {
    // `RegExp` throws only a SyntaxError on a bad source; the message names it.
    return { ok: false, message: errorMessage(error) };
  }
}

/**
 * Turn a configuration into a run plan, compiling every pattern once.
 * Exclusion lines are raw patterns (no flags, so case-sensitive); pairs
 * with an empty search are unfinished rows and skipped.
 *
 * @param config A valid configuration.
 * @returns The plan, or every invalid pattern (exclusions first, then pairs).
 */
export function prepareRucssRun(config: RucssTesterConfig): RucssPlanResult {
  const problems: RucssPlanProblem[] = [];
  const excludeFilePatterns: CompiledExclusion[] = [];
  for (const line of parseLineList(config.excludeFiles)) {
    const compiled = compilePattern(line, '');
    if (compiled.ok) excludeFilePatterns.push({ line, pattern: compiled.pattern });
    else problems.push({ kind: 'exclude-pattern', line, message: compiled.message });
  }
  const replacements: CompiledReplacement[] = [];
  config.replacements.forEach((pair, index) => {
    if (pair.search === '') return;
    const compiled = compilePattern(pair.search, 'g');
    if (compiled.ok) {
      replacements.push({ index, pattern: compiled.pattern, replacement: pair.replacement });
    } else {
      problems.push({
        kind: 'replacement-pattern',
        index,
        search: pair.search,
        message: compiled.message
      });
    }
  });
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    plan: {
      safelist: parseLineList(config.safelist),
      // Defaults first, then the user's lines; a user repeat of a default collapses.
      inlinePreserves: parseLineList(
        [...DEFAULT_INLINE_PRESERVES, config.inlinePreserve].join('\n')
      ),
      excludeFilePatterns,
      prepend: config.prepend,
      append: config.append,
      replacements,
      mobile: config.mobile,
      home: config.home
    }
  };
}

/**
 * Judge an inline style: kept when its markup contains a preserve marker,
 * unless it is WP Rocket's used-CSS style. Substring checks only (linear in
 * the markup), so it is safe to run on a page's own thread.
 *
 * @param id The element's id (empty when none).
 * @param markup The element's serialized markup (`outerHTML`).
 * @param preserves The preserve markers.
 * @returns `preserved` or `remove`.
 */
export function decideInlineStyle(
  id: string,
  markup: string,
  preserves: readonly string[]
): Extract<RucssStyleDecision, 'preserved' | 'remove'> {
  if (id === RUCSS_USED_CSS_ID) return 'remove';
  return preserves.some((marker) => markup.includes(marker)) ? 'preserved' : 'remove';
}

/**
 * Judge a stylesheet link: kept when its URL matches an exclusion pattern
 * (a link without a URL never matches). Runs the user's patterns, whose
 * cost is unbounded (catastrophic backtracking) — keep it off a host
 * page's thread.
 *
 * @param href The resolved stylesheet URL (`link.href`; empty when none).
 * @param exclusions The exclusion lines.
 * @returns `excluded` or `remove`; the failure naming the line whose
 *   pattern the engine gave up on (the patterns after it are not tried).
 */
export function decideLinkStyle(
  href: string,
  exclusions: readonly CompiledExclusion[]
): Extract<RucssStyleDecision, 'excluded' | 'remove'> | RucssExclusionFailure {
  if (href === '') return 'remove';
  for (const { line, pattern } of exclusions) {
    try {
      if (pattern.test(href)) return 'excluded';
    } catch (error) {
      return { ok: false, problem: 'exclusion-failed', line, message: errorMessage(error) };
    }
  }
  return 'remove';
}

/**
 * Judge one page style (see {@link decideLinkStyle} and {@link decideInlineStyle}).
 *
 * @param node The style as the run sees it.
 * @param plan The run plan.
 * @returns `excluded` (kept link), `preserved` (kept inline style), `remove`,
 *   or a link's exclusion failure.
 */
export function decideRucssStyle(
  node: RucssStyleNode,
  plan: RucssRunPlan
): RucssStyleDecision | RucssExclusionFailure {
  return node.kind === 'link'
    ? decideLinkStyle(node.href, plan.excludeFilePatterns)
    : decideInlineStyle(node.id, node.markup, plan.inlinePreserves);
}

/** A replacement template's fixed text and `$` tokens, counted by what each inserts. */
interface TemplateTokens {
  /** Characters every substitution writes as-is (capture tokens counted as literal too). */
  readonly fixed: number;
  /** `$&`: the match. */
  readonly match: number;
  /** `` $` ``: the text before the match. */
  readonly before: number;
  /** `$'`: the text after the match. */
  readonly after: number;
  /** `$1`…`$99` and `$<name>`: a capture. */
  readonly capture: number;
}

/**
 * Read a template's substitution tokens. `$$` writes one `$`; `$&`, `` $` ``
 * and `$'` always substitute. A capture token may turn out literal (`$9` with
 * fewer groups, `$<x>` without named groups), so its own characters stay
 * counted as fixed text: the bound then covers either outcome.
 *
 * @param template The replacement template.
 * @returns The fixed width and token counts (exact for a template without capture tokens).
 */
function scanTemplate(template: string): TemplateTokens {
  let fixed = template.length;
  let match = 0;
  let before = 0;
  let after = 0;
  let capture = 0;
  for (let at = template.indexOf('$'); at !== -1; at = template.indexOf('$', at + 1)) {
    const next = template.charAt(at + 1);
    if (next === '$') {
      fixed--;
      at++;
    } else if (next === '&' || next === '`' || next === "'") {
      fixed -= 2;
      if (next === '&') match++;
      else if (next === '`') before++;
      else after++;
      at++;
    } else if (next === '<' || (next >= '0' && next <= '9')) {
      capture++;
    }
  }
  return { fixed, match, before, after, capture };
}

/**
 * Longest capture of a match.
 *
 * @param match A match with its captures.
 * @returns The longest capture's length (0 when none exists or participated).
 */
function longestCapture(match: RegExpExecArray): number {
  let longest = 0;
  for (let group = 1; group < match.length; group++) {
    longest = Math.max(longest, match[group]?.length ?? 0);
  }
  return longest;
}

/** A pair's matches, measured before its output exists. */
interface ReplacementMeasure {
  /** Matches (empty ones included — the same ones `replace` substitutes). */
  readonly count: number;
  /** The output length, exact for a `$`-free template, else an upper bound. */
  readonly maxLength: number;
}

/**
 * Count a global pattern's matches and bound the replaced text's length
 * without building it. Each substitution is the template's fixed text plus,
 * per token, the text it inserts (the match, the text before or after it);
 * a capture token adds the match's longest capture on top of its own
 * characters, so the bound never undercounts and is exact without one.
 *
 * @param text The text to replace in.
 * @param pattern A global pattern (`matchAll` clones it: `lastIndex` stays untouched).
 * @param template The replacement template.
 * @returns The match count and the output length bound.
 * @throws What the pattern engine throws (e.g. a backtracking stack overflow).
 */
function measureReplacement(text: string, pattern: RegExp, template: string): ReplacementMeasure {
  const tokens = scanTemplate(template);
  let count = 0;
  let maxLength = text.length;
  for (const match of text.matchAll(pattern)) {
    count++;
    const matched = match[0].length;
    const before = match.index;
    let inserted = tokens.fixed + tokens.match * matched;
    inserted += tokens.before * before + tokens.after * (text.length - before - matched);
    if (tokens.capture > 0) inserted += tokens.capture * longestCapture(match);
    maxLength += inserted - matched;
  }
  return { count, maxLength };
}

/**
 * Apply one pair, refusing before the output is built when it could pass
 * the cap. Two passes — count/measure, then the native `replace` — keep the
 * native `$` substitution semantics exact and the refusal allocation-free.
 *
 * @param css The current CSS.
 * @param pair The compiled pair.
 * @param maxChars The output cap.
 * @returns The replaced CSS with its match count, or why it was refused.
 */
function applyReplacement(
  css: string,
  pair: CompiledReplacement,
  maxChars: number
): { readonly ok: true; readonly css: string; readonly count: number } | RucssCssFailure {
  const { index, pattern, replacement } = pair;
  try {
    const measure = measureReplacement(css, pattern, replacement);
    if (measure.maxLength > maxChars) return { ok: false, problem: 'oversize', index };
    const next = css.replace(pattern, replacement);
    // Backstop: the bound never undercounts, so this only guards a bound defect.
    if (next.length > maxChars) return { ok: false, problem: 'oversize', index };
    return { ok: true, css: next, count: measure.count };
  } catch (error) {
    // The engine gave up on the user's pattern over this CSS: a failure, never a crash.
    return { ok: false, problem: 'pattern-failed', index, message: errorMessage(error) };
  }
}

/**
 * Build the CSS that replaces the removed styles: the pairs applied in order
 * to the service's CSS (each sees the previous one's output; `$&`/`$1`
 * substitutions apply), then the prepend and append text around it.
 *
 * @param shakenCss The service's CSS.
 * @param plan The run plan.
 * @param maxChars The output cap (defaults to {@link RUCSS_RESULT_CSS_MAX_CHARS}).
 * @returns The CSS with per-pair match counts; `oversize` when any step could
 *   pass the cap (refused before that step's output is built); `pattern-failed`
 *   when the pattern engine throws on a pair.
 */
export function buildRucssCss(
  shakenCss: string,
  plan: RucssRunPlan,
  maxChars: number = RUCSS_RESULT_CSS_MAX_CHARS
): RucssCssBuild {
  let css = shakenCss;
  const applied: ReplacementCount[] = [];
  for (const pair of plan.replacements) {
    const step = applyReplacement(css, pair, maxChars);
    if (!step.ok) return step;
    css = step.css;
    applied.push({ index: pair.index, count: step.count });
  }
  if (plan.prepend.length + css.length + plan.append.length > maxChars) {
    return { ok: false, problem: 'oversize' };
  }
  return { ok: true, css: plan.prepend + css + plan.append, applied };
}
