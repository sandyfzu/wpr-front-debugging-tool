/**
 * Option-registry integrity pins: stable unique ids, every row in a real
 * section, deep immutability (the registry is data, never mutable state),
 * defaults read through the storage contract (never re-typed), and the
 * grouping/row-value guards the page renders from.
 */
import { describe, expect, it } from 'vitest';
import { FALLBACK, storedOptionsOrFallback, type StoredOptions } from '../storage/options';
import {
  isValidOptionValue,
  optionRowsIn,
  OPTION_ROWS,
  OPTION_SECTIONS,
  readOption,
  type OptionRow
} from './registry';

/** Look a row up by id, failing the test loudly when the registry lacks it. */
function rowOf(id: string): OptionRow {
  const row = OPTION_ROWS.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`registry test: no row '${id}'`);
  return row;
}

describe('option registry integrity', () => {
  it('rows have stable, unique ids — including the canonical dbugger-entry key', () => {
    const ids = OPTION_ROWS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The canonical storage key, verbatim — a renamed spelling would strand
    // the stored value.
    expect(ids).toContain('wp-dashboard-dbugger-entry');
    expect(ids).toContain('toolbarBadge');
    expect(ids).toContain('appearance');
  });

  it('every row declares a section that exists, and section ids are unique', () => {
    const sectionIds = OPTION_SECTIONS.map((section) => section.id);
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
    for (const row of OPTION_ROWS) {
      expect(sectionIds).toContain(row.section);
    }
  });

  it('is immutable data — the tables, their rows and their sections are frozen', () => {
    expect(Object.isFrozen(OPTION_SECTIONS)).toBe(true);
    expect(Object.isFrozen(OPTION_ROWS)).toBe(true);
    for (const row of OPTION_ROWS) expect(Object.isFrozen(row)).toBe(true);
    for (const section of OPTION_SECTIONS) expect(Object.isFrozen(section)).toBe(true);
  });

  it('projects the storage contracts — defaults come from the storage shape, not the table', () => {
    // The rows read the storage contract's own defaults; the table carries
    // no default of its own that could drift.
    const defaults = storedOptionsOrFallback(undefined);
    for (const row of OPTION_ROWS) {
      // Every registry row resolves to a documented value on the defaults —
      // no row depends on a slot the storage shape does not define.
      expect(readOption(row, defaults)).not.toBeUndefined();
    }
    // The P9A rows pinned against the documented fallback values.
    expect(readOption(rowOf('wp-dashboard-dbugger-entry'), FALLBACK)).toBe(true);
    expect(readOption(rowOf('toolbarBadge'), FALLBACK)).toBe(true);
    expect(readOption(rowOf('appearance'), FALLBACK)).toBe('system');
  });

  it('groups rows per section, covering every row exactly once', () => {
    expect(optionRowsIn('improvements').map((row) => row.id)).toEqual([
      'wp-dashboard-dbugger-entry'
    ]);
    expect(optionRowsIn('appearance').map((row) => row.id)).toEqual(['appearance']);
    expect(optionRowsIn('features').map((row) => row.id)).toEqual(['toolbarBadge']);
    const grouped = OPTION_SECTIONS.flatMap((section) => optionRowsIn(section.id));
    expect(grouped).toHaveLength(OPTION_ROWS.length);
  });

  it('guards row values by kind — boolean rows demand booleans, the appearance row the three choices', () => {
    const badge = rowOf('toolbarBadge');
    const theme = rowOf('appearance');
    expect(isValidOptionValue(badge, true)).toBe(true);
    expect(isValidOptionValue(badge, false)).toBe(true);
    expect(isValidOptionValue(badge, 'dark')).toBe(false);
    expect(isValidOptionValue(theme, 'system')).toBe(true);
    expect(isValidOptionValue(theme, 'dark')).toBe(true);
    expect(isValidOptionValue(theme, 'light')).toBe(true);
    expect(isValidOptionValue(theme, 'neon' as never)).toBe(false);
    expect(isValidOptionValue(theme, true)).toBe(false);
  });

  it('readOption falls back to the storage contract defaults when a known slot is somehow absent', () => {
    // Known keys are always defined post-validator; the belt guards a
    // hand-built shape where one went missing (both groups' known keys absent).
    const holey = JSON.parse(
      '{"improvements":{},"appearance":"system","features":{}}'
    ) as StoredOptions;
    expect(readOption(rowOf('wp-dashboard-dbugger-entry'), holey)).toBe(true);
    expect(readOption(rowOf('toolbarBadge'), holey)).toBe(true);
  });
});
