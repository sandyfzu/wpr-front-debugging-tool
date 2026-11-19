/**
 * A live script read as calm list rows for the Runtime states section: one
 * row per script in document order, keyed by the script itself (its URL, or
 * the start of its code, plus its occurrence — never its state or position,
 * so Read again keeps the open detail on a script whose state changed),
 * named the way the reader tells scripts apart (a URL's file name, an inline
 * script's ordinal), plus the section's two facets (Source × State), the
 * searched text and the detail's pure view (kind, facts, copy, code note).
 *
 * State values: executed / failed / pending / not delayed. `skipped` (a
 * nomodule fallback WP Rocket's runtime deliberately did not run) and
 * `unknown` (a status value this version does not know) are neither ran nor
 * failed nor waiting, so no value claims them: they show under State "Any"
 * only, and the section names them in a note.
 */
import type { CodeLanguage } from '../../../../components/ui/code-block-langs';
import {
  choiceFacet,
  defineFacets,
  type FacetSet,
  type FacetValue
} from '../../../../lib/panel/resource-facets';
import { FIELD_MAX, type ScriptGroup } from '../../../../lib/script-runtime/classify';
import {
  codeNote,
  fullTextCapped,
  RUNTIME_GROUP_LABELS,
  textCapped,
  type OutsideFilterCounts
} from '../../../../lib/script-runtime/outcome-view';
import type { LiveScriptRecord } from '../../../../lib/script-runtime/read-live';
import type { DetailFact } from '../resource-list/detail-section';
import type { DetailCopy } from '../resource-list/master-detail';
import { resourceName, urlPreview } from '../resource-list/resource-list-view';
import { SCRIPT_KIND_LABELS, SCRIPT_URL_COPY_LABEL } from '../resource-list/script-words';

/** One script's row. */
export interface RuntimeRow {
  /** The script's identity across reads (signature + occurrence). */
  readonly key: string;
  readonly script: LiveScriptRecord;
  /** The display name: a URL's file name, or "Inline script N". */
  readonly name: string;
  /** The muted line: `#id · ` then the URL without its scheme, or the start of the code. */
  readonly preview: string;
}

/** The facts' word for a status attribute the script does not carry. */
export const NONE_VALUE = 'None';

/** The Source fact's words for a script without a URL. */
export const INLINE_SOURCE_COPY = {
  inline: 'Inline code',
  'converted-inline': 'Inline code, run by Delay JS from a data: URL'
} as const;

/** The preview's (and the code section's) words for an inline script without code. */
export const EMPTY_CODE_COPY = 'No code in the tag.';

/** The copy's name (control + toast) when the read kept only the start of the code. */
export const PARTIAL_CODE_COPY_LABEL = 'Start of the code';

/** Appended to the code's cut note: what the partial copy takes. */
export const PARTIAL_COPY_NOTE = 'Copy takes only this start.';

/**
 * The note on a script's code: the read's own cut note, plus what copy
 * takes when the code is not whole; null for whole code.
 *
 * @param script The record.
 * @returns The note.
 */
export function runtimeCodeNote(script: LiveScriptRecord): string | null {
  const note = codeNote(script);
  return note === null ? null : `${note} ${PARTIAL_COPY_NOTE}`;
}

/** The groups, in facet order. */
export const RUNTIME_GROUPS: readonly ScriptGroup[] = ['theme', 'plugin', 'inline', 'other'];

/**
 * A State value over one runtime state (its id is the state's own).
 *
 * @param state The state (also the value id).
 * @param label The value's label.
 * @returns The facet value.
 */
function stateValue(
  state: 'executed' | 'failed' | 'pending' | 'not-delayed',
  label: string
): FacetValue<RuntimeRow> {
  return { id: state, label, predicate: (row) => row.script.state === state };
}

/**
 * Whether a row's script comes from one source group.
 *
 * @param group The group.
 * @returns The row predicate.
 */
function inGroup(group: ScriptGroup): (row: RuntimeRow) => boolean {
  return (row) => row.script.group === group;
}

/** The section's facet ids, in render order. */
export type RuntimeFacetId = 'source' | 'state';

/**
 * The section's facets: a script has one source group and one state, so
 * each is a choice. `skipped` and `unknown` match no State value — reachable
 * under Any only.
 */
export const RUNTIME_FACETS: FacetSet<RuntimeRow, RuntimeFacetId> = defineFacets<
  RuntimeRow,
  RuntimeFacetId
>([
  choiceFacet(
    'source',
    'Source',
    RUNTIME_GROUPS.map((group): FacetValue<RuntimeRow> => ({
      id: group,
      label: RUNTIME_GROUP_LABELS[group],
      predicate: inGroup(group)
    }))
  ),
  choiceFacet('state', 'State', [
    stateValue('executed', 'Executed'),
    stateValue('failed', 'Failed'),
    stateValue('pending', 'Pending'),
    stateValue('not-delayed', 'Not delayed')
  ])
]);

/**
 * The searched text of a row: URL, id, classes and code.
 *
 * @param row The row.
 * @returns The text the query matches against.
 */
export function runtimeSearchField(row: RuntimeRow): string {
  const script = row.script;
  return [script.source, script.id, script.classes.join(' '), script.fullText].join('\n');
}

/**
 * A script's signature, without its occurrence: a URL by itself; code by its
 * preview (the read's first code points — stable whatever the shared text
 * budget left of the full text). Neither the state nor the status is in it.
 *
 * @param script The record.
 * @returns The signature.
 */
export function runtimeSignature(script: LiveScriptRecord): string {
  return script.sourceKind === 'url' ? `u|${script.source}` : `i|${script.preview}`;
}

/**
 * The preview line: the script's `#id` first (when it has one), then the URL
 * without its scheme, else the start of its code, else the empty-code words.
 *
 * @param script The record.
 * @returns The line.
 */
export function runtimePreview(script: LiveScriptRecord): string {
  const lead =
    script.sourceKind === 'url'
      ? urlPreview(script.source)
      : script.preview === ''
        ? EMPTY_CODE_COPY
        : script.preview;
  return script.id === '' ? lead : `#${script.id} · ${lead}`;
}

/**
 * The rows of a read.
 *
 * @param scripts The read's scripts, in document order.
 * @returns One row per script; inline scripts numbered from 1 in document
 *   order; keys unique (an occurrence suffix tells duplicates apart).
 */
export function runtimeRows(scripts: readonly LiveScriptRecord[]): RuntimeRow[] {
  let inline = 0;
  const seen = new Map<string, number>();
  return scripts.map((script) => {
    const signature = runtimeSignature(script);
    const occurrence = seen.get(signature) ?? 0;
    seen.set(signature, occurrence + 1);
    const key = `${signature}#${String(occurrence)}`;
    const preview = runtimePreview(script);
    if (script.sourceKind === 'url') {
      return { key, script, name: resourceName(script.source), preview };
    }
    inline += 1;
    return { key, script, name: `Inline script ${String(inline)}`, preview };
  });
}

/**
 * Whether two same-key rows show the same thing (a re-read keeps an
 * unchanged row's object, and so its rendered row).
 *
 * @param a A row.
 * @param b A row.
 * @returns `true` when every shown field matches.
 */
export function sameRuntimeRow(a: RuntimeRow, b: RuntimeRow): boolean {
  const x = a.script;
  const y = b.script;
  return (
    a.name === b.name &&
    x.state === y.state &&
    x.rawStatus === y.rawStatus &&
    x.group === y.group &&
    x.structuredData === y.structuredData &&
    x.sourceKind === y.sourceKind &&
    x.source === y.source &&
    x.id === y.id &&
    x.fullTextCut === y.fullTextCut &&
    x.fullText === y.fullText &&
    x.classes.length === y.classes.length &&
    x.classes.every((name, index) => name === y.classes[index])
  );
}

/**
 * The rows no State value covers, by state.
 *
 * @param rows The read's rows.
 * @returns The skipped and unknown counts.
 */
export function outsideFilterCounts(rows: readonly RuntimeRow[]): OutsideFilterCounts {
  let skipped = 0;
  let unknown = 0;
  for (const row of rows) {
    if (row.script.state === 'skipped') skipped += 1;
    else if (row.script.state === 'unknown') unknown += 1;
  }
  return { skipped, unknown };
}

/**
 * The detail's caps label.
 *
 * @param row The row.
 * @returns "Structured data", "External script" or "Inline script".
 */
export function runtimeKind(row: RuntimeRow): string {
  if (row.script.structuredData) return 'Structured data';
  return SCRIPT_KIND_LABELS[row.script.sourceKind === 'url' ? 'external' : 'inline'];
}

/**
 * Whether the read cut the script's URL at its field cap (the tile then
 * offers no open action and the header no copy).
 *
 * @param script The record.
 * @returns `true` for a clipped URL.
 */
export function urlClipped(script: LiveScriptRecord): boolean {
  return script.sourceKind === 'url' && textCapped(script.source, FIELD_MAX);
}

/**
 * Whether the record holds the script's whole code (neither the read's
 * shared budget nor the per-script cap cut it).
 *
 * @param script The record.
 * @returns `true` when the full text is the whole code.
 */
export function wholeCode(script: LiveScriptRecord): boolean {
  return !script.fullTextCut && !fullTextCapped(script.fullText);
}

/**
 * The code the read kept, as the page holds it: a cut text (budget or cap)
 * loses the `…` the cut appended, so a paste carries no character the page
 * does not have. (A script whose own text ends in `…` exactly at the cap
 * reads as cut — the safe side — and so copies one character short.)
 *
 * @param script The record.
 * @returns The kept code.
 */
export function keptCode(script: LiveScriptRecord): string {
  const text = script.fullText;
  return !wholeCode(script) && text.endsWith('…') ? text.slice(0, -1) : text;
}

/**
 * The detail header's copy: the URL (unless the read clipped it — a clipped
 * URL opens nothing), the whole code, or — when the read kept only its
 * start — that start under a name that never claims the whole script.
 *
 * @param row The row.
 * @returns The copy, or `undefined` when there is nothing to copy.
 */
export function runtimeCopy(row: RuntimeRow): DetailCopy | undefined {
  const script = row.script;
  if (script.sourceKind === 'url') {
    return urlClipped(script) ? undefined : { text: script.source, label: SCRIPT_URL_COPY_LABEL };
  }
  if (script.fullText === '') return undefined;
  return wholeCode(script)
    ? { text: script.fullText, label: SCRIPT_KIND_LABELS.inline }
    : { text: keptCode(script), label: PARTIAL_CODE_COPY_LABEL };
}

/**
 * The detail's facts — the status attribute always (its absence is a fact),
 * where inline code comes from, the id and the classes when present.
 *
 * @param script The record.
 * @returns The facts, in reading order.
 */
export function runtimeFacts(script: LiveScriptRecord): DetailFact[] {
  const facts: DetailFact[] = [
    { label: 'Status attribute', value: script.rawStatus ?? NONE_VALUE, mono: true }
  ];
  if (script.sourceKind !== 'url') {
    facts.push({ label: 'Source', value: INLINE_SOURCE_COPY[script.sourceKind], mono: false });
  }
  if (script.id !== '') facts.push({ label: 'ID', value: script.id, mono: true });
  if (script.classes.length > 0) {
    facts.push({ label: 'Classes', value: script.classes.join(' '), mono: true });
  }
  return facts;
}

/**
 * The code block's language: structured data is JSON, the rest JavaScript.
 *
 * @param script The record.
 * @returns The language.
 */
export function runtimeCodeLanguage(script: LiveScriptRecord): CodeLanguage {
  return script.structuredData ? 'json' : 'javascript';
}
