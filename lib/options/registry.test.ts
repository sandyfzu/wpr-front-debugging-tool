/**
 * Option-registry integrity pins: stable unique ids, every row in a real
 * section, deep immutability (the registry is data, never mutable state),
 * defaults read through the storage contract (never re-typed), the
 * grouping/row-value guards the page renders from, the drafted/instant row
 * split, and the data-driven on-page UI cascade.
 */
import { describe, expect, it } from 'vitest';
import { FALLBACK, storedOptionsOrFallback, type StoredOptions } from '../storage/options';
import {
  DRAFTED_OPTION_ROWS,
  isDraftedOptionRow,
  isValidOptionValue,
  ON_PAGE_UI_OFF_NOTE,
  onPageDisabledNote,
  optionRowsIn,
  OPTION_ROWS,
  OPTION_SECTIONS,
  readOption,
  type DraftedOptionRow,
  type OptionRow
} from './registry';

/** Look a drafted row up by id, failing the test loudly when the registry lacks it. */
function rowOf(id: string): DraftedOptionRow {
  const row = DRAFTED_OPTION_ROWS.find((candidate) => candidate.id === id);
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
    for (const row of DRAFTED_OPTION_ROWS) {
      // Every drafted registry row resolves to a documented value on the defaults —
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
    // The gate leads its card; the rows it governs follow it; the badge
    // (unaffected by the gate) closes the card.
    expect(optionRowsIn('features').map((row) => row.id)).toEqual([
      'page-ui-gate',
      'palette-chord',
      'toolbarBadge'
    ]);
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

describe('drafted and instant rows', () => {
  it('splits the registry: drafted rows are the sync:options ones, in display order', () => {
    expect(DRAFTED_OPTION_ROWS.map((row) => row.id)).toEqual([
      'wp-dashboard-dbugger-entry',
      'appearance',
      'toolbarBadge'
    ]);
    expect(Object.isFrozen(DRAFTED_OPTION_ROWS)).toBe(true);
    const instant = OPTION_ROWS.filter((row) => !isDraftedOptionRow(row));
    expect(instant.map((row) => [row.kind, row.id])).toEqual([
      ['page-ui-gate', 'page-ui-gate'],
      ['chord', 'palette-chord']
    ]);
  });
});

describe('the on-page UI cascade', () => {
  /** Any row by id (instant ones included). */
  function anyRow(id: string): OptionRow {
    const row = OPTION_ROWS.find((candidate) => candidate.id === id);
    if (row === undefined) throw new Error(`registry test: no row '${id}'`);
    return row;
  }

  it('marks exactly the rows that configure injected page UI', () => {
    // Today: the palette shortcut. The gate itself is the master (never
    // marked); the D-bugger entry (wp-admin menu), the appearance choice and
    // the toolbar badge are not on-page UI.
    expect(OPTION_ROWS.filter((row) => row.onPage === true).map((row) => row.id)).toEqual([
      'palette-chord'
    ]);
  });

  it('disables marked rows only while the gate is known off, naming the way back', () => {
    const chord = anyRow('palette-chord');
    expect(onPageDisabledNote(chord, false)).toBe(ON_PAGE_UI_OFF_NOTE);
    expect(onPageDisabledNote(chord, true)).toBeNull();
    // An unknown gate (loading, unreadable) disables nothing.
    expect(onPageDisabledNote(chord, null)).toBeNull();
    expect(ON_PAGE_UI_OFF_NOTE).toContain(anyRow('page-ui-gate').label);
    for (const id of ['page-ui-gate', 'wp-dashboard-dbugger-entry', 'appearance', 'toolbarBadge']) {
      expect(onPageDisabledNote(anyRow(id), false)).toBeNull();
    }
  });

  it('the shortcut row warns that browser-owned shortcuts never reach the field', () => {
    // The browser acts on them before the page sees a keydown: no refusal can explain it.
    expect(anyRow('palette-chord').description).toContain('Browser-owned shortcuts');
    expect(anyRow('palette-chord').description).toContain("can't be recorded");
  });

  it('is data-driven: any row kind carrying the marker inherits it', () => {
    // A future marked boolean row (the chip default's shape) needs no code.
    const marked: OptionRow = {
      kind: 'boolean',
      id: 'futureOnPageRow',
      section: 'features',
      label: 'Future',
      description: 'Future',
      onPage: true
    };
    expect(onPageDisabledNote(marked, false)).toBe(ON_PAGE_UI_OFF_NOTE);
    expect(onPageDisabledNote(marked, true)).toBeNull();
  });
});
