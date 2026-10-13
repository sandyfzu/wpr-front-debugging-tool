/**
 * The palette matcher's pinned behavior: empty queries hand the registry
 * order back untouched, tokens must all match somewhere (label or keyword),
 * boundary hits outrank mid-word ones, a boundary label hit outranks a
 * boundary keyword hit, multi-token queries require the AND over one row,
 * and equal scores keep the registry order — deterministic, no
 * engine-dependent sorting noise.
 */
import { describe, expect, it } from 'vitest';
import { rankCommands, type MatchableCommand } from './matcher';

/** The sample registry rows (labels + keywords, nothing else). */
const ROWS: readonly MatchableCommand[] = [
  { label: 'Detections' },
  { label: 'JavaScript' },
  { label: 'Preloaded Resources', keywords: ['links'] },
  { label: 'Export JSON', keywords: ['save', 'download'] }
];

describe('rankCommands', () => {
  it('hands the registry order back for an empty or blank query', () => {
    expect(rankCommands(ROWS, '')).toEqual(ROWS);
    expect(rankCommands(ROWS, '   ')).toEqual(ROWS);
    // Identity-safe: the passed array is never re-sorted in place.
    expect(rankCommands(ROWS, 'export')).not.toBe(ROWS);
  });

  it('requires every token to match in one row (the AND rule)', () => {
    expect(rankCommands(ROWS, 'json export').map((row) => row.label)).toEqual(['Export JSON']);
    expect(rankCommands(ROWS, 'json nosuch')).toEqual([]);
  });

  it('puts boundary hits above mid-word hits', () => {
    // 'Gunmetal' carries the token mid-word (after a word character); 'Metal'
    // boundary-hits at its own start.
    const rows: readonly MatchableCommand[] = [{ label: 'Gunmetal' }, { label: 'Metal' }];
    expect(rankCommands(rows, 'metal').map((row) => row.label)).toEqual(['Metal', 'Gunmetal']);
  });

  it('reaches keywords, and a boundary label hit outranks an equal boundary keyword hit', () => {
    // The keyword can be the only carrier.
    expect(rankCommands(ROWS, 'links').map((row) => row.label)).toEqual(['Preloaded Resources']);
    // Same token, both boundary hits: the label row wins out (+2).
    const rows: readonly MatchableCommand[] = [
      { label: 'Jumpstart', keywords: [] },
      { label: 'Onward', keywords: ['jump'] }
    ];
    expect(rankCommands(rows, 'jump').map((row) => row.label)).toEqual(['Jumpstart', 'Onward']);
  });

  it('ranks case-insensitively', () => {
    expect(rankCommands(ROWS, 'EXPORT').map((row) => row.label)).toEqual(['Export JSON']);
  });

  it('keeps the registry order between equal scores', () => {
    // Both rows boundary-hit the token at their own start (score 20 plus the
    // label bonus each) — the tie falls back to the registry order.
    const rows: readonly MatchableCommand[] = [{ label: 'Abad' }, { label: 'Acac' }];
    expect(rankCommands(rows, 'a').map((row) => row.label)).toEqual(['Abad', 'Acac']);
  });
});
