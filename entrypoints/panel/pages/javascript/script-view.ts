/**
 * The JavaScript page's pure view layer: everything the page derives from the
 * classified script rows before rendering — state badges, the inline-code
 * shape (line count, expandability, collapsed preview), row-height seeds,
 * chip states and the expanded-row bookkeeping. No DOM, no Solid: the page
 * wraps these in one memo chain and the rows only read the results.
 */
import type { FilterChip } from '../../../../components/ui/filter-bar';
import type { StatusKind } from '../../../../components/ui/status-badge';
import type {
  JsFilterId,
  JsScriptResource,
  ResourceFilterRow,
  ResourcePageDefinition
} from '../../../../lib/panel/resources-view-model';
import { JS_PAGE_RESOURCES } from '../../../../lib/panel/resources-view-model';
import type { WprDetections } from '../../../../lib/wp-rocket/types';

/** One state chip on a script row: its words and its vocabulary kind. */
export interface ScriptBadge {
  readonly label: string;
  readonly kind: StatusKind;
}

/** The collapsed code area shows exactly this many code lines. */
export const COLLAPSED_CODE_LINES = 3;

/**
 * A line longer than this may fold into several visual lines once wrapping is
 * on, so it makes a script expandable even within {@link COLLAPSED_CODE_LINES}.
 */
export const WRAP_RISK_LINE_CHARS = 80;

/**
 * Per-line cap of the collapsed preview. The collapsed block shows three
 * visual lines at most; at the widest panels a wrapped line holds a few
 * hundred mono characters, so this cap never shortens what is visible while
 * keeping a minified 500 KB one-liner out of the highlighter until expanded.
 */
export const PREVIEW_LINE_CHARS = 2_000;

/** The shape of an inline script's code, derived once per row. */
export interface InlineCode {
  /** Visual line count (a single trailing line break adds no line). */
  readonly lines: number;
  /** Whether the collapse toggle is offered (see {@link isExpandable}). */
  readonly expandable: boolean;
  /** The text the collapsed block renders and highlights. */
  readonly preview: string;
  /** Blank source (empty or whitespace only): nothing to show or copy. */
  readonly blank: boolean;
}

/** One rendered row: the classified script plus everything derived from it. */
export interface ScriptRowView {
  readonly row: JsScriptResource;
  readonly badges: readonly ScriptBadge[];
  /** Inline scripts only; `null` for external ones. */
  readonly code: InlineCode | null;
}

/** The two features a local exclusion marker can name (detection-record ids). */
type ExcludableFeature = Extract<keyof WprDetections, 'delay_js' | 'defer_all_js'>;

/**
 * Whether the row's local exclusion marker names a feature. The marker is a
 * free-form attribute value, so it matches by substring (several feature ids
 * may share one value).
 */
function excludedFrom(row: JsScriptResource, feature: ExcludableFeature): boolean {
  return row.fdtExcluded?.includes(feature) ?? false;
}

/**
 * The state badges of one script row, in reading order: the Delay JS state,
 * then (external scripts only — an inline script cannot be deferred) the
 * defer state. A delayed or deferred script is `info`; a script the local
 * exclusion marker kept out of the feature is `warn` (a deliberate exclusion
 * worth noticing); plain "not" states are `neutral`.
 *
 * @param row The classified script.
 * @returns One or two badges.
 */
export function scriptStateBadges(row: JsScriptResource): ScriptBadge[] {
  const badges: ScriptBadge[] = [delayBadge(row)];
  if (row.type === 'external') badges.push(deferBadge(row));
  return badges;
}

/** The Delay JS badge (see {@link scriptStateBadges}). */
function delayBadge(row: JsScriptResource): ScriptBadge {
  if (row.delayed) return { label: 'Delayed', kind: 'info' };
  if (excludedFrom(row, 'delay_js'))
    return { label: 'Not delayed (Excluded by FDT)', kind: 'warn' };
  return { label: 'Not delayed', kind: 'neutral' };
}

/** The defer badge — WP Rocket's own defer wins over a native `defer`. */
function deferBadge(row: JsScriptResource): ScriptBadge {
  if (row.deferredByWPR) return { label: 'Deferred (By WP Rocket)', kind: 'info' };
  if (row.deferred) return { label: 'Deferred', kind: 'info' };
  if (excludedFrom(row, 'defer_all_js')) {
    return { label: 'Not deferred (Excluded by FDT)', kind: 'warn' };
  }
  return { label: 'Not deferred', kind: 'neutral' };
}

/**
 * Line count and longest line of a source text in one pass (no split array —
 * inline scripts reach 512 KB). Lines break on `\n` (a `\r\n` pair counts
 * once, its `\r` as one char of the line); a single trailing break adds no
 * visual line, matching how a `<pre>` renders it.
 *
 * @param text The source text.
 * @returns The visual line count (`0` for `''`) and the longest line length.
 */
export function measureCode(text: string): { lines: number; longestLine: number } {
  if (text === '') return { lines: 0, longestLine: 0 };
  let lines = 0;
  let longestLine = 0;
  let start = 0;
  while (start <= text.length) {
    const end = text.indexOf('\n', start);
    const stop = end === -1 ? text.length : end;
    // The empty remainder after a final break is not a rendered line.
    if (end === -1 && start === text.length && lines > 0) break;
    lines += 1;
    longestLine = Math.max(longestLine, stop - start);
    if (end === -1) break;
    start = end + 1;
  }
  return { lines, longestLine };
}

/**
 * Whether an inline script gets the collapse toggle — a pure function of the
 * text, never a post-render measurement: more lines than the collapsed area
 * shows, or a line long enough that turning wrapping on may fold it past the
 * clamp. A toggle that turns out to change nothing is harmless; a missing one
 * hides code.
 *
 * @param lines The visual line count.
 * @param longestLine The longest line's length in chars.
 */
export function isExpandable(lines: number, longestLine: number): boolean {
  return lines > COLLAPSED_CODE_LINES || longestLine > WRAP_RISK_LINE_CHARS;
}

/**
 * The text the collapsed block renders: the first {@link COLLAPSED_CODE_LINES}
 * lines, each cut at {@link PREVIEW_LINE_CHARS}. Highlighting tokenizes left
 * to right, so the visible lines color exactly as in the full text, while the
 * highlighter never sees the hidden bulk of a large script.
 *
 * @param text The full source text.
 * @returns The preview (the text itself when nothing is cut).
 */
export function collapsedPreview(text: string): string {
  const kept: string[] = [];
  let start = 0;
  let cut = false;
  while (kept.length < COLLAPSED_CODE_LINES) {
    const end = text.indexOf('\n', start);
    const line = end === -1 ? text.slice(start) : text.slice(start, end);
    if (line.length > PREVIEW_LINE_CHARS) cut = true;
    kept.push(line.slice(0, PREVIEW_LINE_CHARS));
    if (end === -1) break;
    start = end + 1;
    if (kept.length === COLLAPSED_CODE_LINES && start < text.length) cut = true;
  }
  return cut ? kept.join('\n') : text;
}

/**
 * Derive an inline script's code shape.
 *
 * @param text The inline source.
 * @returns Its line count, expandability, collapsed preview and blankness.
 */
export function inlineCode(text: string): InlineCode {
  const { lines, longestLine } = measureCode(text);
  const blank = text.trim() === '';
  return {
    lines,
    expandable: !blank && isExpandable(lines, longestLine),
    preview: collapsedPreview(text),
    blank
  };
}

/**
 * The collapse toggle's words: how much a click reveals ("Show all 40
 * lines"), or "Expand" when the clamp hides only the tail of long lines.
 *
 * @param code The script's code shape.
 * @param expanded Whether the code is expanded.
 */
export function codeToggleLabel(code: InlineCode, expanded: boolean): string {
  if (expanded) return 'Collapse';
  return code.lines > COLLAPSED_CODE_LINES ? `Show all ${lineCount(code.lines)}` : 'Expand';
}

/**
 * Build one row view.
 *
 * @param row The classified script.
 */
export function buildRowView(row: JsScriptResource): ScriptRowView {
  return {
    row,
    badges: scriptStateBadges(row),
    code: row.type === 'inline' ? inlineCode(row.content) : null
  };
}

/** Whether two classified scripts carry the same data (every field). */
export function sameScript(a: JsScriptResource, b: JsScriptResource): boolean {
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.content === b.content &&
    a.delayed === b.delayed &&
    a.deferred === b.deferred &&
    a.deferredByWPR === b.deferredByWPR &&
    a.fdtExcluded === b.fdtExcluded
  );
}

/**
 * Build the row views for a fresh row list, reusing every previous view whose
 * script is unchanged. A soft refresh of an unchanged page therefore hands
 * the list the very same objects: rendered rows keep their DOM (no re-mount,
 * no re-highlight, no flash) and only changed rows are re-derived.
 *
 * @param previous The views of the previous pass (`[]` on the first).
 * @param rows The fresh classified rows.
 * @returns The new views (`previous` itself when every row is unchanged).
 */
export function reconcileRowViews(
  previous: readonly ScriptRowView[],
  rows: readonly JsScriptResource[]
): readonly ScriptRowView[] {
  const byId = new Map(previous.map((view) => [view.row.id, view]));
  let changed = previous.length !== rows.length;
  const next = rows.map((row, index) => {
    const prior = byId.get(row.id);
    if (prior !== undefined && sameScript(prior.row, row)) {
      if (previous[index] !== prior) changed = true;
      return prior;
    }
    changed = true;
    return buildRowView(row);
  });
  return changed ? next : previous;
}

/**
 * The JavaScript page's filter/search pattern over row views — the shared
 * definition's chips and searched field, lifted through `view.row` (labels
 * and predicates stay declared once, in the shared table).
 */
export const JS_VIEW_RESOURCES: ResourcePageDefinition<ScriptRowView, JsFilterId> = {
  filters: JS_PAGE_RESOURCES.filters.map(
    (filter): ResourceFilterRow<ScriptRowView, JsFilterId> => ({
      id: filter.id,
      label: filter.label,
      predicate: (view) => filter.predicate(view.row)
    })
  ),
  searchField: (view) => JS_PAGE_RESOURCES.searchField(view.row)
};

/**
 * The chip bar's data. A chip with nothing to select is disabled (no
 * dead-end click) — except the "all" chip and the selected chip: a refresh
 * that empties the selected filter keeps it selected (and reachable) so the
 * list can say so and offer the way back.
 *
 * @param filters The page's chip rows, in render order.
 * @param counts Rows per chip id.
 * @param selected The selected chip id.
 * @returns The chips for `FilterBar`.
 */
export function buildChips(
  filters: readonly Pick<ResourceFilterRow<never, JsFilterId>, 'id' | 'label'>[],
  counts: Readonly<Record<JsFilterId, number>>,
  selected: JsFilterId
): FilterChip[] {
  return filters.map((filter) => {
    const count = counts[filter.id];
    return {
      value: filter.id,
      label: filter.label,
      count,
      disabled: count === 0 && filter.id !== 'all' && filter.id !== selected
    };
  });
}

/** Seed heights (px) for rows not measured yet — measurement corrects them. */
export const ROW_ESTIMATES = {
  /** External row: one line at regular width (two when compact). */
  external: 37,
  /** Inline row without code to show (blank source). */
  inlineBlank: 49,
  /** Inline row, collapsed: badge line, toolbar + three code lines, toggle. */
  inlineCollapsed: 165,
  /** Inline row with three lines or fewer and no toggle. */
  inlineShort: 137
} as const;

/**
 * Estimate a row's height before it is measured.
 *
 * @param view The row view.
 * @returns The seed height in px.
 */
export function estimateRowSize(view: ScriptRowView): number {
  if (view.code === null) return ROW_ESTIMATES.external;
  if (view.code.blank) return ROW_ESTIMATES.inlineBlank;
  return view.code.expandable ? ROW_ESTIMATES.inlineCollapsed : ROW_ESTIMATES.inlineShort;
}

/**
 * Drop expanded-row ids that no longer name a row (a refresh removed them).
 *
 * @param expanded The expanded ids.
 * @param present The ids of the current rows.
 * @returns `expanded` itself when nothing was dropped, else the pruned set.
 */
export function pruneExpanded(
  expanded: ReadonlySet<number>,
  present: ReadonlySet<number>
): ReadonlySet<number> {
  let stale = false;
  for (const id of expanded) {
    if (!present.has(id)) {
      stale = true;
      break;
    }
  }
  if (!stale) return expanded;
  return new Set([...expanded].filter((id) => present.has(id)));
}

/**
 * Flip one id's membership.
 *
 * @param expanded The expanded ids.
 * @param id The row to flip.
 * @returns A new set (sets in signals must change identity to notify).
 */
export function toggleExpanded(expanded: ReadonlySet<number>, id: number): ReadonlySet<number> {
  const next = new Set(expanded);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * Count phrase for scripts ("1 script", "12 scripts").
 *
 * @param count The number of scripts.
 */
export function scriptCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'script' : 'scripts'}`;
}

/**
 * Count phrase for code lines ("1 line", "40 lines").
 *
 * @param count The number of lines.
 */
export function lineCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'line' : 'lines'}`;
}

/**
 * The polite result-count announcement: said only while a chip or a
 * committed query narrows the list (an unfiltered list has nothing to
 * report), never per keystroke — the query it reads is the committed one.
 *
 * @param shown Rows rendered.
 * @param total Rows on the page.
 * @param narrowed Whether a chip or query is active.
 */
export function resultAnnouncement(shown: number, total: number, narrowed: boolean): string {
  if (!narrowed) return '';
  return `${String(shown)} of ${scriptCount(total)} shown`;
}
