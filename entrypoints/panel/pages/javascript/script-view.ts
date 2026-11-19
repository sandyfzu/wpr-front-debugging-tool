/**
 * The JavaScript page's pure view layer: everything the page derives from the
 * classified script rows before rendering — the calm row's name, one-line
 * preview, size and state chips, the detail's facts and code language, and
 * the facets over row views. No DOM, no Solid: the page wraps these in one
 * memo chain and the rows only read the results.
 */
import type { CodeLanguage } from '../../../../components/ui/code-block-langs';
import {
  JS_PAGE_FACETS,
  JS_PAGE_RESOURCES,
  type JsFacetId,
  type JsScriptResource
} from '../../../../lib/panel/resources-view-model';
import { liftFacets, type FacetSet } from '../../../../lib/panel/resource-facets';
import type { DetailFact } from '../resource-list/detail-section';
import { urlPreview } from '../resource-list/resource-list-view';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import {
  JS_SCRIPT_STATES,
  NO_SCRIPT_SIMULATION,
  fdtExclusions,
  type JsStateId,
  type ScriptSimulation
} from '../../../../lib/panel/script-states';
import {
  FDT_EXCLUDED_RESOURCE,
  MINIFY_ATTRIBUTE,
  MINIFY_ATTRIBUTE_VALUE,
  WPR_DEFER_ATTRIBUTE
} from '../../../../lib/wp-rocket/constants';
import type { SimulationFact } from '../../../../lib/wp-rocket/types';
import {
  countLabel,
  formatCompactCount,
  formatCompactFloor,
  formatCount,
  type CountNoun
} from '../../../../utils/format-count';
import {
  isBlankScriptType,
  isClassicScriptType,
  isJsonScriptType
} from '../../../../utils/script-type';
import { resourceName } from '../resource-list/resource-list-view';
import {
  CALM_VISIBLE_STATE_CHIPS,
  simulatableSource,
  splitStateChips,
  type StateChip,
  type StateChipSplit
} from '../resource-list/state-chips';
import { STATE_SOURCES, type StateSource } from '../resource-list/state-sources';

/**
 * How much of an inline script's text the capture delivered (the payload's
 * size caps clip one long script, and a list-wide budget leaves later
 * scripts empty once spent). An external row's URL can be `clipped` too.
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
  /** The classified script (its `id` is the position at build time only). */
  readonly row: JsScriptResource;
  /** How much text (or URL) was captured. */
  readonly capture: ContentCapture;
  /** Every state chip, most important first (the detail shows them all). */
  readonly chips: readonly StateChip[];
  /** The row's chips, split for the calm row (two, then "+N"). */
  readonly rowChips: StateChipSplit;
  /** The one-line preview: type prefix, then the collapsed code or the URL. */
  readonly preview: string;
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
 * facets keep them.
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
 * The script's own type when it is worth reading: a delayed script's
 * original `type` (what Delay JS restores — `module`, `importmap`…). None,
 * a blank one, or a classic JavaScript MIME type runs as an ordinary classic
 * script, so naming it is noise. Only delayed rows carry it: the inventory
 * records no `type` for the others (their detail reads it from the served tag).
 *
 * @param row The classified script.
 * @returns The type, or `null`.
 */
export function notableScriptType(row: JsScriptResource): string | null {
  const type = row.originalType;
  if (type === null || isBlankScriptType(type) || isClassicScriptType(type)) return null;
  return type;
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

/** The preview line's length cap (a row shows one truncating line; the rest is the detail's). */
export const PREVIEW_CHARS = 200;

/** One whitespace character (the set `\s` matches). */
const WHITESPACE = /\s/;

/**
 * Collapse a text's whitespace runs to single spaces and keep its first
 * {@link PREVIEW_CHARS} chars, scanning only as far as it keeps (a 512 KB
 * bundle costs a preview, not a pass). Never ends on half a surrogate pair.
 *
 * @param text The source text.
 * @returns The collapsed, trimmed preview.
 */
export function collapsedPreview(text: string): string {
  let out = '';
  let pendingSpace = false;
  for (let at = 0; at < text.length && out.length < PREVIEW_CHARS; at += 1) {
    const char = text.charAt(at);
    if (WHITESPACE.test(char)) {
      pendingSpace = out !== '';
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      pendingSpace = false;
    }
    out += char;
  }
  const end = Math.min(out.length, PREVIEW_CHARS);
  const last = out.charCodeAt(end - 1);
  return out.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

/** The preview's words for an inline row with no code to show. */
export const NO_CODE_PREVIEW: Readonly<Record<'blank' | 'not-captured', string>> = {
  blank: 'Empty inline script',
  'not-captured': 'Content not captured (size budget)'
};

/**
 * A row's one-line preview: the notable type first (`module · …`), then the
 * collapsed inline code or the external URL; an inline row with no text says
 * why (blank script vs. text the size budget left out).
 *
 * @param row The classified script.
 * @param capture How much text was captured.
 */
export function scriptPreview(row: JsScriptResource, capture: ContentCapture): string {
  const type = notableScriptType(row);
  const body =
    row.type === 'external'
      ? urlPreview(row.content)
      : capture === 'not-captured'
        ? NO_CODE_PREVIEW['not-captured']
        : row.content.trim() === ''
          ? NO_CODE_PREVIEW.blank
          : collapsedPreview(row.content);
  return type === null ? body : `${type} · ${body}`;
}

/**
 * Build one row's view.
 *
 * @param row The classified script.
 * @param key The row's key.
 * @param capture How much text was captured.
 * @param simulation The features a verified simulation ran on the page.
 */
export function scriptRowView(
  row: JsScriptResource,
  key: string,
  capture: ContentCapture = 'complete',
  simulation: ScriptSimulation = NO_SCRIPT_SIMULATION
): ScriptRowView {
  const chips = scriptStateChips(row, simulation);
  return {
    key,
    row,
    capture,
    chips,
    rowChips: splitStateChips(chips, CALM_VISIBLE_STATE_CHIPS),
    preview: scriptPreview(row, capture)
  };
}

/** The row's name when an external script's `src` is empty. */
export const EMPTY_SRC_NAME = 'Empty src attribute';

/**
 * A row's name: an external script's file name (the Network panel's
 * "Name"), or "Inline script #n" by its position among inline scripts.
 *
 * @param view The row view.
 * @param inlineOrdinal The row's 1-based position among inline scripts.
 */
export function scriptName(view: ScriptRowView, inlineOrdinal: number): string {
  if (view.row.type === 'inline') return `Inline script #${String(inlineOrdinal)}`;
  return resourceName(view.row.content) || EMPTY_SRC_NAME;
}

/**
 * The detail's caps kind label.
 *
 * @param view The row view.
 */
export function scriptKind(view: ScriptRowView): string {
  return view.row.type === 'inline' ? 'Inline script' : 'External script';
}

/**
 * The size cell: an inline script's character count, compact ("18.6K"),
 * a rounded-down floor ("≥ 524.2K") when the capture clipped it; nothing for an external
 * script (never fetched) or text the budget left out.
 *
 * @param view The row view.
 * @returns The cell text, or `undefined` for an empty cell.
 */
export function scriptSize(view: ScriptRowView): string | undefined {
  if (view.row.type === 'external' || view.capture === 'not-captured') return undefined;
  const chars = view.row.content.length;
  return view.capture === 'clipped' ? `≥ ${formatCompactFloor(chars)}` : formatCompactCount(chars);
}

/** Characters, in their two count forms. */
const CHARACTER_NOUN: CountNoun = { one: 'character', other: 'characters' };

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
 * The detail's facts — only the ones that hold: the delay and defer markers,
 * the original type, the minify stamp, the local exclusion marker, and an
 * inline script's size (floored when clipped).
 *
 * @param view The row view.
 * @returns The facts, in reading order.
 */
export function scriptFacts(view: ScriptRowView): DetailFact[] {
  const { row } = view;
  const facts: DetailFact[] = [];
  if (row.delayed) facts.push({ label: 'Delayed', value: 'Delay JS type', mono: false });
  if (row.originalType !== null)
    facts.push({ label: 'Original type', value: row.originalType, mono: true });
  if (row.deferred) facts.push({ label: 'Defer', value: 'defer', mono: true });
  if (row.deferredByWPR)
    facts.push({ label: 'WP Rocket defer', value: WPR_DEFER_ATTRIBUTE, mono: true });
  if (row.minifyAttribute)
    facts.push({
      label: 'Minify stamp',
      value: `${MINIFY_ATTRIBUTE}="${MINIFY_ATTRIBUTE_VALUE}"`,
      mono: true
    });
  if (row.fdtExcluded !== null)
    facts.push({
      label: 'FDT exclusion',
      value: `${FDT_EXCLUDED_RESOURCE}="${row.fdtExcluded}"`,
      mono: true
    });
  if (row.type === 'inline' && view.capture !== 'not-captured') {
    const size = countLabel(row.content.length, CHARACTER_NOUN);
    facts.push({
      label: 'Size',
      value: view.capture === 'clipped' ? `≥ ${size} (clipped)` : size,
      mono: false
    });
  }
  return facts;
}

/**
 * The language an inline script's code highlights as: JSON when its
 * effective type declares JSON (a delayed script's original type, else the
 * served `type`), else JavaScript. `undefined` while the type is still
 * unknown (an undelayed script before its served tag answers).
 *
 * @param row The classified script.
 * @param served The served tag's `type`: a string, `null` (none), or
 *   `undefined` (not known — still asking, or the read failed).
 * @param settled Whether the served-tag read is over (a failed read falls
 *   back to JavaScript instead of waiting forever).
 */
export function scriptCodeLanguage(
  row: JsScriptResource,
  served: string | null | undefined,
  settled: boolean
): CodeLanguage | undefined {
  if (row.delayed)
    return row.originalType !== null && isJsonScriptType(row.originalType) ? 'json' : 'javascript';
  if (served === undefined) return settled ? 'javascript' : undefined;
  return served !== null && isJsonScriptType(served) ? 'json' : 'javascript';
}

/**
 * The text a detail's code block renders: the whole source, or — past what
 * the code block highlights (`HIGHLIGHT_MAX_CHARS`) — its first that many
 * chars, so a 500 KB bundle mounts a bounded block (highlighted, too)
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
 * The note under a block that shows only the start of its script.
 *
 * @param max The render limit.
 */
export function expandedCutNote(max: number): string {
  return `Showing the first ${formatCount(max)} characters — copy gets the full script.`;
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
    a.minifyAttribute === b.minifyAttribute &&
    a.originalType === b.originalType
  );
}

/** The page's facets over row views (labels and predicates stay declared once, in the shared table). */
export const JS_VIEW_FACETS: FacetSet<ScriptRowView, JsFacetId> = liftFacets(
  JS_PAGE_FACETS,
  (view: ScriptRowView) => view.row
);

/**
 * The searched field of a row view: an external script's URL, an inline
 * script's code (the shared definition's field).
 *
 * @param view The row view.
 */
export function scriptSearchField(view: ScriptRowView): string {
  return JS_PAGE_RESOURCES.searchField(view.row);
}
