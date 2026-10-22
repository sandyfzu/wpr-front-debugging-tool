/**
 * The translator against the WP Rocket parity table: every Delay/Defer match
 * row, fed its stored rows only (no subject), yields exactly the row's
 * `engine.problem` when it has one and no problem otherwise; and no stored
 * row of a save fixture is one WP Rocket's save rejects.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseParityTable } from '../wp-rocket-parity-table';
import { regexRowProblems } from './rows';
import { saveOutcome, type RegexFeatureId } from './translate';

/** The table, validated at load. */
const table = parseParityTable(
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'wp-rocket-parity.fixtures.json'),
      'utf8'
    )
  )
);

/** Whether a feature's rows are PCRE patterns. */
function isRegexFeature(feature: string): feature is RegexFeatureId {
  return feature === 'delay_js' || feature === 'defer_all_js';
}

describe('PCRE translator vs the WP Rocket parity table', () => {
  describe('match rows: problems from the stored rows alone', () => {
    for (const row of table.rows) {
      if (row.kind !== 'match' || !isRegexFeature(row.feature)) continue;
      const feature = row.feature;
      const expected =
        row.engine !== undefined && 'problem' in row.engine ? [row.engine.problem] : [];
      it(`${row.id} → ${expected.join(', ') || 'no problem'}`, () => {
        const ids = [...new Set(regexRowProblems(feature, row.rows).map((entry) => entry.problem))];
        expect(ids).toEqual(expected);
      });
    }
  });

  // Stored rows whose save the parser does not model (subroutine calls can
  // recurse forever): reported unknown, never dropped.
  const UNMODELED_STORED = ['(?+1)(x)'];

  it('keeps every row the settings save stores (or leaves its fate unknown)', () => {
    for (const row of table.rows) {
      if (row.kind !== 'save' || !isRegexFeature(row.feature)) continue;
      for (const stored of row.stored) {
        const expected = UNMODELED_STORED.includes(stored) ? 'unknown' : 'kept';
        expect({ row: row.id, stored, outcome: saveOutcome(stored).outcome }).toEqual({
          row: row.id,
          stored,
          outcome: expected
        });
      }
    }
  });
});
