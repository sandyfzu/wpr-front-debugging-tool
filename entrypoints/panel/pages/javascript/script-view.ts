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
 * Per-line cap of the collapsed preview (a cut line ends in `…`). The
 * collapsed block shows three visual lines at most: at the widest panel a
 * wrapped mono line holds ≈ 200 chars, so three of them ≈ 600 — the cap
 * never shortens what is visible, while a minified one-line bundle stays out
 * of the highlighter until expanded.
 */
export const PREVIEW_LINE_CHARS = 750;

/** The mark a preview line cut at {@link PREVIEW_LINE_CHARS} ends with. */
export const PREVIEW_CUT_MARK = '…';

/** The shape of an inline script's code, derived once per row. */
export interface InlineCode {
  /** Visual line count (a single trailing line break adds no line). */
  readonly lines: number;
  /**
   * Whether the text alone makes the toggle useful: more lines than the
   * collapsed block shows, or a preview line cut at its cap. (The row also
   * offers it when the block reports its clamp clipping — a wrapped line.)
   */
  readonly expandable: boolean;
  /** The text the collapsed block renders and highlights. */
  readonly preview: string;
  /** Blank source (empty or whitespace only): nothing to show or copy. */
  readonly blank: boolean;
}

/**
 * How much of an inline script's text the capture delivered (the payload's
 * size caps clip one long script, and a list-wide budget leaves later
 * scripts empty once spent).
 */
export type ContentCapture = 'complete' | 'clipped' | 'not-captured';

/** One rendered row: the classified script plus everything derived from it. */
export interface ScriptRowView {
  /**
   * The row's identity across refreshes: the script itself (type, URL or a
   * text signature) plus its occurrence among identical scripts — never its
   * document position, so a script added above shifts nothing.
   */
  readonly key: string;
  /** A DOM-id-safe form of {@link ScriptRowView.key}. */
  readonly domId: string;
  /** The classified script (its `id` is the position at build time only). */
  readonly row: JsScriptResource;
  /** How much inline text was captured (`complete` for external rows). */
  readonly capture: ContentCapture;
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
 * Visual line count of a source text in one pass (no split array — inline
 * scripts reach 512 KB). Lines break on `\n` (a `\r\n` pair counts once); a
 * single trailing break adds no visual line, matching how a `<pre>` renders.
 *
 * @param text The source text.
 * @returns The line count (`0` for `''`).
 */
export function countLines(text: string): number {
  if (text === '') return 0;
  let lines = 1;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    if (at === text.length - 1) break;
    lines += 1;
  }
  return lines;
}

/**
 * The text the collapsed block renders: the first {@link COLLAPSED_CODE_LINES}
 * lines, each cut at {@link PREVIEW_LINE_CHARS} and marked with
 * {@link PREVIEW_CUT_MARK}. Highlighting tokenizes left to right, so the
 * visible lines color as in the full text, while the highlighter never sees
 * the hidden bulk of a large script.
 *
 * @param text The full source text.
 * @returns The preview and whether a line was cut at the cap (the text
 *   itself when nothing is cut).
 */
export function collapsedPreview(text: string): { preview: string; lineCut: boolean } {
  const kept: string[] = [];
  let start = 0;
  let lineCut = false;
  let moreLines = false;
  while (kept.length < COLLAPSED_CODE_LINES) {
    const end = text.indexOf('\n', start);
    const line = end === -1 ? text.slice(start) : text.slice(start, end);
    if (line.length > PREVIEW_LINE_CHARS) {
      lineCut = true;
      kept.push(`${line.slice(0, PREVIEW_LINE_CHARS)}${PREVIEW_CUT_MARK}`);
    } else {
      kept.push(line);
    }
    if (end === -1) break;
    start = end + 1;
    if (kept.length === COLLAPSED_CODE_LINES && start < text.length) moreLines = true;
  }
  return { preview: lineCut || moreLines ? kept.join('\n') : text, lineCut };
}

/**
 * Derive an inline script's code shape.
 *
 * @param text The inline source.
 * @returns Its line count, expandability, collapsed preview and blankness.
 */
export function inlineCode(text: string): InlineCode {
  const lines = countLines(text);
  const { preview, lineCut } = collapsedPreview(text);
  const blank = text.trim() === '';
  return {
    lines,
    expandable: !blank && (lines > COLLAPSED_CODE_LINES || lineCut),
    preview,
    blank
  };
}

/**
 * The collapse toggle's words: how much a click reveals ("Show all 40
 * lines"), or "Expand" when the collapsed block hides the rest of its lines.
 *
 * @param code The script's code shape.
 * @param expanded Whether the code is expanded.
 */
export function codeToggleLabel(code: InlineCode, expanded: boolean): string {
  if (expanded) return 'Collapse';
  return code.lines > COLLAPSED_CODE_LINES ? `Show all ${lineCount(code.lines)}` : 'Expand';
}

/** Whether two classified scripts carry the same data (position ignored). */
export function sameScript(a: JsScriptResource, b: JsScriptResource): boolean {
  return (
    a.type === b.type &&
    a.content === b.content &&
    a.delayed === b.delayed &&
    a.deferred === b.deferred &&
    a.deferredByWPR === b.deferredByWPR &&
    a.fdtExcluded === b.fdtExcluded
  );
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
 * Keep only the expanded keys whose script is still there **unchanged**: a
 * refresh that removed a script, or changed it under the same key, forgets
 * its expanded flag (a different script must not open expanded).
 *
 * @param expanded The expanded keys.
 * @param previous The row views the flags were set on.
 * @param next The refreshed row views.
 * @returns `expanded` itself when nothing was dropped, else the kept keys.
 */
export function pruneExpanded(
  expanded: ReadonlySet<string>,
  previous: readonly ScriptRowView[],
  next: readonly ScriptRowView[]
): ReadonlySet<string> {
  if (expanded.size === 0) return expanded;
  const before = new Map(previous.map((view) => [view.key, view]));
  const after = new Map(next.map((view) => [view.key, view]));
  const kept = [...expanded].filter((key) => {
    const view = after.get(key);
    return view !== undefined && view === before.get(key);
  });
  return kept.length === expanded.size ? expanded : new Set(kept);
}

/**
 * Flip one key's membership.
 *
 * @param expanded The expanded keys.
 * @param key The row to flip.
 * @returns A new set (sets in signals must change identity to notify).
 */
export function toggleExpanded(expanded: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(expanded);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** Thousands-grouped count ("5,000"), the panel's number format. */
export function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

/**
 * Count phrase for scripts ("1 script", "1,204 scripts", or "5,000+
 * scripts" for a list the capture cut — the count is then a floor).
 *
 * @param count The number of scripts.
 * @param partial The list was cut at its cap.
 */
export function scriptCount(count: number, partial = false): string {
  return `${formatCount(count)}${partial ? '+' : ''} ${count === 1 && !partial ? 'script' : 'scripts'}`;
}

/**
 * Count phrase for code lines ("1 line", "1,040 lines").
 *
 * @param count The number of lines.
 */
export function lineCount(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'line' : 'lines'}`;
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
  return `${formatCount(shown)} of ${scriptCount(total)} shown`;
}
