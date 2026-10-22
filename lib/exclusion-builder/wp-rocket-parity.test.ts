/**
 * WP Rocket parity: replays every row of `wp-rocket-parity.fixtures.json`
 * (expected outputs derived from the real plugin by `pnpm parity:wp-rocket`)
 * against this engine — no PHP here.
 *
 * - save rows: typed lines → the stored rows + dropped lines the engine's
 *   field normalization yields;
 * - match rows: the page WP Rocket serves without user rows, run through
 *   the feature's transform with the stored rows → the subject ids the
 *   engine restores (its exclusion marker) and its candidate count.
 *
 * A row marked `pending` is behavior the engine does not mirror yet: it runs
 * as `it.fails`, so it stays green only while it still fails — the sub-phase
 * named by `pending` removes the mark when its change turns the row green.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FDT_EXCLUDED_RESOURCE } from '../wp-rocket/constants';
import { exclusionFieldLines, trimExclusionRow } from './field-text';
import { parseTagAt, scanTags } from './html-scan';
import { exclusionPipelineSteps } from './pipeline';
import { EMPTY_EXCLUSION_SET, EXCLUSION_FEATURES, type ExclusionSet } from './set';
import { findAttribute } from './tag-edit';
import {
  parseParityTable,
  typedLineBytes,
  type DroppedLine,
  type MatchRow,
  type ParityRow,
  type SaveRow,
  type TypedLine
} from './wp-rocket-parity-table';

/** The table, validated at load: a malformed row fails the file, naming the row. */
const table = parseParityTable(
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'wp-rocket-parity.fixtures.json'),
      'utf8'
    )
  )
);

/** A typed line as editor text (bytes that are not UTF-8 decode to U+FFFD). */
function editorText(line: TypedLine): string {
  return typeof line === 'string' ? line : new TextDecoder().decode(typedLineBytes(line));
}

/**
 * What the engine stores for a save row today: `exclusionFieldLines`
 * (trim + drop whitespace-only lines), whose only drop is an empty line.
 */
function engineSave(row: SaveRow): Pick<SaveRow, 'stored' | 'dropped'> {
  const lines = row.typed.map(editorText);
  const dropped: DroppedLine[] = [];
  lines.forEach((line, index) => {
    const typed = row.typed[index];
    if (trimExclusionRow(line) === '' && typed !== undefined) {
      dropped.push({ index, row: typed, reason: 'empty' });
    }
  });
  return { stored: exclusionFieldLines(lines), dropped };
}

/** The set carrying a match row's stored rows on its feature. */
function setFor(row: MatchRow): ExclusionSet {
  const spec = EXCLUSION_FEATURES.find((candidate) => candidate.id === row.feature);
  if (spec === undefined) throw new Error(`no feature ${row.feature}`);
  return {
    ...EMPTY_EXCLUSION_SET,
    rows: { ...EMPTY_EXCLUSION_SET.rows, [spec.rowsKey]: row.rows }
  };
}

/** Ids of the elements carrying the engine's exclusion marker, in document order. */
function markedIds(html: string): string[] {
  const ids: string[] = [];
  for (const tag of scanTags(html)) {
    const parsed = parseTagAt(html.slice(tag.start, tag.openingEnd), 0);
    const id = findAttribute(parsed, 'id')?.value;
    if (id != null && findAttribute(parsed, FDT_EXCLUDED_RESOURCE) !== null) ids.push(id);
  }
  return ids;
}

/** The comparable outcome of a match row: candidate count, excluded ids, Defer page state. */
interface MatchOutcome {
  readonly candidates: number;
  readonly excluded: readonly string[];
  readonly featureOff?: boolean;
}

/** The expected outcome, from the table. */
function expectedMatch(row: MatchRow): MatchOutcome {
  return {
    candidates: row.candidates.length,
    excluded: [...row.excluded].sort(),
    ...(row.featureOff === undefined ? {} : { featureOff: row.featureOff })
  };
}

/**
 * The engine's outcome: the feature's pipeline step over the served page.
 * The engine has no page-wide Defer failure yet, so `featureOff` is false.
 */
function engineMatch(row: MatchRow): MatchOutcome {
  const step = exclusionPipelineSteps(setFor(row)).find(
    (candidate) => candidate.id === row.feature
  );
  if (step === undefined) throw new Error(`no pipeline step for ${row.feature}`);
  const result = step.apply(row.served);
  return {
    candidates: result.report.candidates,
    excluded: [...new Set(markedIds(result.html))].sort(),
    ...(row.feature === 'defer_all_js' ? { featureOff: false } : {})
  };
}

/** The test title: id, the note, and the pending mark. */
function title(row: ParityRow): string {
  const pending = row.pending === undefined ? '' : `[pending ${row.pending}] `;
  return `${pending}${row.id}${row.note === undefined ? '' : ` — ${row.note}`}`;
}

/** `it`, or `it.fails` for a pending row. */
function testFor(row: ParityRow): typeof it | typeof it.fails {
  return row.pending === undefined ? it : it.fails;
}

describe('WP Rocket parity table', () => {
  // The harness finds subjects with its own tag scan; this one must see the
  // same ids, or a replay would compare different elements.
  it('identifies every candidate subject in the served page by its id', () => {
    for (const row of table.rows) {
      if (row.kind !== 'match') continue;
      const ids = scanTags(row.served).flatMap((tag) => {
        const id = findAttribute(parseTagAt(row.served.slice(tag.start, tag.openingEnd), 0), 'id');
        return id?.value == null ? [] : [id.value];
      });
      expect({ row: row.id, missing: row.candidates.filter((id) => !ids.includes(id)) }).toEqual({
        row: row.id,
        missing: []
      });
    }
  });

  describe('save rows (typed → stored)', () => {
    for (const row of table.rows) {
      if (row.kind !== 'save') continue;
      testFor(row)(title(row), () => {
        expect(engineSave(row)).toEqual({ stored: row.stored, dropped: row.dropped });
      });
    }
  });

  describe('match rows (stored rows + served page → excluded subjects)', () => {
    for (const row of table.rows) {
      if (row.kind !== 'match') continue;
      testFor(row)(title(row), () => {
        expect(engineMatch(row)).toEqual(expectedMatch(row));
      });
    }
  });
});
