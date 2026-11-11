/**
 * The JavaScript page's pure view layer: everything the page derives from the
 * classified script rows before rendering — state chips, the inline-code
 * shape (line count, expandability, collapsed preview), row-height seeds,
 * chip states and the expanded-row bookkeeping. No DOM, no Solid: the page
 * wraps these in one memo chain and the rows only read the results.
 */
import { pruneKeyedFlags } from '../../../../lib/panel/list-behavior';
import type { FilterChip } from '../../../../components/ui/filter-bar';
import type { StatusKind } from '../../../../components/ui/status-badge';
import type {
  JsFilterId,
  JsScriptResource,
  ResourceFilterRow,
  ResourcePageDefinition
} from '../../../../lib/panel/resources-view-model';
import { JS_PAGE_RESOURCES } from '../../../../lib/panel/resources-view-model';
import { buildFilterChips } from '../../../../lib/panel/list-behavior';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import {
  JS_SCRIPT_STATES,
  NO_SCRIPT_SIMULATION,
  fdtExclusions,
  type JsStateId,
  type ScriptSimulation
} from '../../../../lib/panel/script-states';
import { countLabel, formatCount, type CountNoun } from '../../../../utils/format-count';
import { isBlankScriptType, isClassicScriptType } from '../../../../utils/script-type';
import {
  simulatableSource,
  splitStateChips,
  type StateChip,
  type StateChipSplit
} from '../resource-list/state-chips';
import { STATE_SOURCES, type StateSource } from '../resource-list/state-sources';
import type { SimulationFact } from '../../../../lib/wp-rocket/types';

/** A summary-strip state: its words and its vocabulary kind. */
export interface ScriptBadge {
  readonly label: string;
  readonly kind: StatusKind;
}

/** The collapsed code area shows exactly this many code lines. */
export const COLLAPSED_CODE_LINES = 3;

/**
 * Per-line cap of the collapsed preview. The collapsed block shows three
 * visual lines at most: at the widest panel a wrapped mono line holds ≈ 200
 * chars, so three of them ≈ 600 — the cap never shortens what is visible,
 * while a minified one-line bundle is not shipped to the highlighter until
 * expanded. A cut line shows a muted `…` drawn after it by the code block
 * (outside the text: never highlighted, selected or copied), and the toggle
 * reads "Show full lines".
 */
export const PREVIEW_LINE_CHARS = 750;

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
  /** A preview line was cut at {@link PREVIEW_LINE_CHARS}. */
  readonly lineCut: boolean;
  /** The preview lines (0-based) cut at {@link PREVIEW_LINE_CHARS}, for their `…` mark. */
  readonly cutLines: readonly number[];
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
  /** The row's state chips, split for rendering. */
  readonly chips: StateChipSplit;
  /** A delayed row's original-type detail ("type: module"), else `null`. */
  readonly typeDetail: string | null;
  /** Inline scripts only; `null` for external ones. */
  readonly code: InlineCode | null;
}

/** The sources a JavaScript row's chips can show — all four (the page's legend). */
export const JS_CHIP_SOURCES: readonly StateSource[] = STATE_SOURCES;

/** What a chip shows beyond its state's label: its source and hover text. */
type ChipDisplay = (
  row: JsScriptResource,
  simulation: ScriptSimulation
) => Pick<StateChip, 'source' | 'title'>;

/**
 * A Delayed or stamped Deferred chip's source and hover text (the shared
 * rule, {@link simulatableSource}), naming the feature by its plugin-settings name.
 *
 * @param fact The feature's simulation fact (`null`: no marker).
 * @param verb The state's verb ("Delayed").
 * @param feature The feature's option id.
 */
function simulatableChip(
  fact: SimulationFact | null,
  verb: string,
  feature: 'delay_js' | 'defer_all_js'
): Pick<StateChip, 'source' | 'title'> {
  return simulatableSource(fact, verb, getRealOptionName(feature));
}

/**
 * Per state: who produced it and what its hover text says (the source and
 * the feature, by its plugin-settings name). The local exclusion is the
 * FDT's; Delayed and WP Rocket's defer stamp go through
 * {@link simulatableChip}; a plain `defer` is the page's own; Combined and
 * Minified are WP Rocket's (their states already require WP Rocket's evidence).
 */
const JS_CHIP_DISPLAY: Readonly<Record<JsStateId, ChipDisplay>> = {
  excluded: (row) => ({
    source: 'excluded',
    title: `Excluded by FDT from ${fdtExclusions(row).map(getRealOptionName).join(' and ')}`
  }),
  delayed: (_row, simulation) => simulatableChip(simulation.delay, 'Delayed', 'delay_js'),
  deferred: (row, simulation) =>
    row.deferredByWPR
      ? simulatableChip(simulation.defer, 'Deferred', 'defer_all_js')
      : { source: 'page', title: "The page's own defer attribute" },
  combined: () => ({
    source: 'wp-rocket',
    title: `Bundle built by WP Rocket (${getRealOptionName('minify_concatenate_js')})`
  }),
  minified: () => ({
    source: 'wp-rocket',
    title: `Minified by WP Rocket (${getRealOptionName('minify_js')})`
  })
};

/**
 * The state chips of one script row, most important first (the shared
 * state table's order); negative states ("not delayed") are no chips — the
 * filters keep them.
 *
 * @param row The classified script.
 * @param simulation The features a verified simulation, not WP Rocket, ran
 *   on the page (default: none).
 * @returns The chips, unsplit.
 */
export function scriptStateChips(
  row: JsScriptResource,
  simulation: ScriptSimulation = NO_SCRIPT_SIMULATION
): StateChip[] {
  const chips: StateChip[] = [];
  for (const state of JS_SCRIPT_STATES) {
    if (!state.holds(row)) continue;
    chips.push({
      id: state.id,
      label: state.label,
      ...JS_CHIP_DISPLAY[state.id](row, simulation)
    });
  }
  return chips;
}

/**
 * The row's chips, split for rendering (at most three, then "+N").
 *
 * @param row The classified script.
 * @param simulation See {@link scriptStateChips}.
 */
export function scriptChipSplit(
  row: JsScriptResource,
  simulation: ScriptSimulation = NO_SCRIPT_SIMULATION
): StateChipSplit {
  return splitStateChips(scriptStateChips(row, simulation));
}

/** Hover text of the original-type detail. */
export const ORIGINAL_TYPE_TITLE = `The script's own type, restored when ${getRealOptionName('delay_js')} runs it`;

/**
 * The detail a delayed row shows for its original `type` ("type: module").
 * Only a type worth reading shows: none, a blank one, or a classic
 * JavaScript MIME type (`text/javascript`, most delayed rows) runs the script
 * as an ordinary classic script, so naming it is noise.
 *
 * @param row The classified script.
 * @returns The detail text, or `null` when the type says nothing new.
 */
export function originalTypeDetail(row: JsScriptResource): string | null {
  const type = row.originalType;
  if (type === null || isBlankScriptType(type) || isClassicScriptType(type)) return null;
  return `type: ${type}`;
}

/**
 * The summary strip's Delay JS state: served by WP Rocket, run by a verified
 * simulation (never "Not detected" while a runtime holds scripts back), or
 * absent.
 *
 * @param present WP Rocket served Delay JS on the page.
 * @param simulated A verified simulation runs Delay JS here instead.
 * @returns The badge's word and tone.
 */
export function delaySummaryBadge(present: boolean, simulated: boolean): ScriptBadge {
  if (present) return { label: 'Detected', kind: 'ok' };
  // Info, as every other "Simulated" badge: its glyph sets it apart from
  // "Not detected" (never the word alone).
  if (simulated) return { label: 'Simulated', kind: 'info' };
  return { label: 'Not detected', kind: 'neutral' };
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
 * lines, each cut at {@link PREVIEW_LINE_CHARS}. Highlighting tokenizes left
 * to right, so the visible lines color as in the full text, while the
 * highlighter never sees the hidden bulk of a large script.
 *
 * @param text The full source text.
 * @returns The preview and whether a line was cut at the cap (the text
 *   itself when nothing is cut).
 */
export function collapsedPreview(text: string): {
  preview: string;
  lineCut: boolean;
  cutLines: number[];
} {
  const kept: string[] = [];
  const cutLines: number[] = [];
  let start = 0;
  let lineCut = false;
  let moreLines = false;
  while (kept.length < COLLAPSED_CODE_LINES) {
    const end = text.indexOf('\n', start);
    const line = end === -1 ? text.slice(start) : text.slice(start, end);
    if (line.length > PREVIEW_LINE_CHARS) {
      lineCut = true;
      cutLines.push(kept.length);
      kept.push(line.slice(0, PREVIEW_LINE_CHARS));
    } else {
      kept.push(line);
    }
    if (end === -1) break;
    start = end + 1;
    if (kept.length === COLLAPSED_CODE_LINES && start < text.length) moreLines = true;
  }
  return { preview: lineCut || moreLines ? kept.join('\n') : text, lineCut, cutLines };
}

/**
 * Derive an inline script's code shape.
 *
 * @param text The inline source.
 * @returns Its line count, expandability, collapsed preview and blankness.
 */
export function inlineCode(text: string): InlineCode {
  const lines = countLines(text);
  const { preview, lineCut, cutLines } = collapsedPreview(text);
  const blank = text.trim() === '';
  return {
    lines,
    expandable: !blank && (lines > COLLAPSED_CODE_LINES || lineCut),
    preview,
    lineCut,
    cutLines,
    blank
  };
}

/**
 * The text an expanded block renders: the whole source, or — past what the
 * code block highlights (`HIGHLIGHT_MAX_CHARS`) — its first that many chars,
 * so expanding a 500 KB bundle mounts a bounded block (highlighted, too)
 * instead of the whole text. Never cuts a surrogate pair; copy keeps using
 * the full source.
 *
 * @param source The full inline source.
 * @param max The render limit (`HIGHLIGHT_MAX_CHARS`).
 * @returns The text to render and whether it was cut.
 */
export function expandedText(source: string, max: number): { text: string; cut: boolean } {
  if (source.length <= max) return { text: source, cut: false };
  const last = source.charCodeAt(max - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return { text: source.slice(0, end), cut: true };
}

/**
 * The note under an expanded block that shows only the start of its script.
 *
 * @param max The render limit.
 */
export function expandedCutNote(max: number): string {
  return `Showing the first ${formatCount(max)} characters — copy gets the full script.`;
}

/**
 * The collapse toggle's words: how much a click reveals — "Show all 40
 * lines", "Show full lines" when the preview cut long lines (each marked
 * by a `…` outside the code), or "Expand" when the clamp hides a wrapped
 * line.
 *
 * @param code The script's code shape.
 * @param expanded Whether the code is expanded.
 */
export function codeToggleLabel(code: InlineCode, expanded: boolean): string {
  if (expanded) return 'Collapse';
  if (code.lines > COLLAPSED_CODE_LINES) return `Show all ${lineCount(code.lines)}`;
  return code.lineCut ? 'Show full lines' : 'Expand';
}

/** Whether two classified scripts carry the same data (position ignored). */
export function sameScript(a: JsScriptResource, b: JsScriptResource): boolean {
  return (
    a.type === b.type &&
    a.content === b.content &&
    a.delayed === b.delayed &&
    a.deferred === b.deferred &&
    a.deferredByWPR === b.deferredByWPR &&
    a.fdtExcluded === b.fdtExcluded &&
    a.minified === b.minified &&
    a.combined === b.combined &&
    a.originalType === b.originalType
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
  return buildFilterChips({ filters }, counts, selected);
}

/** Seed heights (px) for rows not measured yet — measurement corrects them. */
export const ROW_ESTIMATES = {
  /** External row: one line at regular width (two when compact). */
  external: 37,
  /** Inline row without code to show (blank source). */
  inlineBlank: 57,
  /** Inline row, collapsed: caption/chips line, three code lines, toggle. */
  inlineCollapsed: 145,
  /** Inline row with three lines or fewer and no toggle. */
  inlineShort: 115
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
 * {@link pruneKeyedFlags} over this page's script rows (keyed by script identity).
 *
 * @param states The flags to prune.
 * @param previous The row views the flags were set on.
 * @param next The refreshed row views.
 * @returns `states` itself when nothing was dropped, else the kept keys.
 */
export function pruneRowFlags(
  states: ReadonlySet<string>,
  previous: readonly ScriptRowView[],
  next: readonly ScriptRowView[]
): ReadonlySet<string> {
  return pruneKeyedFlags(states, previous, next, (view) => view.key);
}

/** Code lines, in their two count forms. */
const LINE_NOUN: CountNoun = { one: 'line', other: 'lines' };

/**
 * Count phrase for code lines ("1 line", "1,040 lines").
 *
 * @param count The number of lines.
 */
export function lineCount(count: number): string {
  return countLabel(count, LINE_NOUN);
}

/**
 * The inline-code row's caption: the code's language, then the line count
 * (`javascript · 3 lines`). The block's toolbar is gone in the compact rows,
 * so the row carries this one muted caption instead — one fact, no chrome.
 *
 * @param lang The code's language (the block's `lang`).
 * @param lines The line count.
 */
export function codeCaption(lang: string, lines: number): string {
  return `${lang} · ${lineCount(lines)}`;
}
