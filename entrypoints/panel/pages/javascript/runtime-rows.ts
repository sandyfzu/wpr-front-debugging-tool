/**
 * A live script read as list rows for the Runtime states section: one row
 * per script in document order (its position is its id), named the way the
 * reader tells scripts apart — a URL's file name, an inline script's ordinal
 * — plus the two filter dimensions: the state chips (the shared list's
 * definition) and the source groups (narrowed before the list) — also
 * declared as the two facets of the combinable filter.
 *
 * State chips: executed / failed / pending / not delayed. `skipped` (a
 * nomodule fallback WP Rocket's runtime deliberately did not run) and
 * `unknown` (a status value this version does not know) are neither ran nor
 * failed nor waiting, so no chip claims them: they are listed under all
 * states only, and the section names them in a note.
 */
import {
  choiceFacet,
  defineFacets,
  type FacetSet,
  type FacetValue
} from '../../../../lib/panel/resource-facets';
import type {
  ResourceFilterRow,
  ResourcePageDefinition
} from '../../../../lib/panel/resources-view-model';
import type { ScriptGroup, ScriptRuntimeState } from '../../../../lib/script-runtime/classify';
import type { LiveScriptRecord } from '../../../../lib/script-runtime/read-live';
import {
  RUNTIME_GROUP_LABELS,
  type OutsideFilterCounts
} from '../../../../lib/script-runtime/outcome-view';
import { resourceName } from '../resource-list/resource-list-view';

/** One script's row. */
export interface RuntimeRow {
  /** Position in the read (document order) — the list key. */
  readonly id: number;
  readonly script: LiveScriptRecord;
  /** The display name: a URL's file name, or "Inline script N". */
  readonly name: string;
}

/** The state chips' ids, in render order. */
export type RuntimeStateFilterId = 'all' | 'executed' | 'failed' | 'pending' | 'not-delayed';

/**
 * A chip over one runtime state (its id is the state's own).
 *
 * @param state The state (also the chip id).
 * @param label The chip label.
 * @returns The chip row (also the State facet's value).
 */
function stateChip(
  state: Extract<ScriptRuntimeState, RuntimeStateFilterId>,
  label: string
): ResourceFilterRow<RuntimeRow, RuntimeStateFilterId> {
  return { id: state, label, predicate: (row) => row.script.state === state };
}

/** The state chips past "All states", in render order — declared once (chip bar + facet). */
const STATE_CHIPS: readonly ResourceFilterRow<RuntimeRow, RuntimeStateFilterId>[] = [
  stateChip('executed', 'Executed'),
  stateChip('failed', 'Failed'),
  stateChip('pending', 'Pending'),
  stateChip('not-delayed', 'Not delayed')
];

/** The state chips + the searched text (URL, id, classes, code). */
export const RUNTIME_STATE_LIST: ResourcePageDefinition<RuntimeRow, RuntimeStateFilterId> = {
  filters: [{ id: 'all', label: 'All states', predicate: () => true }, ...STATE_CHIPS],
  searchField: (row) =>
    [row.script.source, row.script.id, row.script.classes.join(' '), row.script.fullText].join('\n')
};

/** The source filter: every group, or one. */
export type RuntimeSourceFilter = 'all' | ScriptGroup;

/** The groups, in chip order. */
export const RUNTIME_GROUPS: readonly ScriptGroup[] = ['theme', 'plugin', 'inline', 'other'];

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
 * The section's facets (value ids = the chip ids): a script has one source
 * group and one state, so each is a choice. `skipped` and `unknown` match no
 * State value — reachable under Any only, as under "All states" today.
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
  choiceFacet('state', 'State', STATE_CHIPS)
]);

/**
 * The rows of a read.
 *
 * @param scripts The read's scripts, in document order.
 * @returns One row per script; inline scripts numbered from 1 in document order.
 */
export function runtimeRows(scripts: readonly LiveScriptRecord[]): RuntimeRow[] {
  let inline = 0;
  return scripts.map((script, id) => {
    if (script.sourceKind === 'url') return { id, script, name: resourceName(script.source) };
    inline += 1;
    return { id, script, name: `Inline script ${String(inline)}` };
  });
}

/**
 * Whether two rows with the same id show the same thing (a re-read keeps an
 * unchanged row's object, and so its rendered row and expanded state).
 *
 * @param a A row.
 * @param b A row.
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
 * The rows of one source group.
 *
 * @param rows Every row.
 * @param source The source filter.
 */
export function rowsOfSource(
  rows: readonly RuntimeRow[],
  source: RuntimeSourceFilter
): readonly RuntimeRow[] {
  return source === 'all' ? rows : rows.filter(inGroup(source));
}

/**
 * The rows per group (the source chips' counts).
 *
 * @param rows Every row.
 */
export function groupCounts(rows: readonly RuntimeRow[]): Readonly<Record<ScriptGroup, number>> {
  const counts: Record<ScriptGroup, number> = { theme: 0, plugin: 0, inline: 0, other: 0 };
  for (const row of rows) counts[row.script.group] += 1;
  return counts;
}

/**
 * The rows no state chip covers, by state.
 *
 * @param rows The rows in view (after the source filter).
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
 * A row's seed height in px (the list measures the real one).
 *
 * @param row The row.
 * @param expanded Whether its details are open.
 */
export function estimateRuntimeRow(row: RuntimeRow, expanded: boolean): number {
  const facts = row.script.id !== '' || row.script.classes.length > 0 ? 16 : 0;
  return 56 + facts + (expanded ? 260 : 0);
}
