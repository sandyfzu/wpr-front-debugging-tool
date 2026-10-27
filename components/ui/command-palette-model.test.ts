/**
 * The palette combobox model's rules: highlight moves (wrap, disabled rows
 * skipped, enabled ends), the re-rank placement, the live-region sentence,
 * the field's key → move map, the Apple-platform check and the list scroll delta.
 */
import { describe, expect, it } from 'vitest';
import {
  fieldHighlightMove,
  firstEnabledId,
  highlightAfterRank,
  isApplePlatform,
  moveHighlight,
  noMatchText,
  paletteAnnouncement,
  scrollDeltaToReveal,
  type HighlightRow
} from './command-palette-model';

/** a, (b disabled), c, (d disabled): disabled rows inside and at the end. */
const ROWS: readonly HighlightRow[] = [
  { id: 'a' },
  { id: 'b', disabled: true },
  { id: 'c' },
  { id: 'd', disabled: true }
];

/** Every row disabled: nothing can be highlighted. */
const ALL_DISABLED: readonly HighlightRow[] = [
  { id: 'x', disabled: true },
  { id: 'y', disabled: true }
];

describe('firstEnabledId', () => {
  it('skips leading disabled rows', () => {
    expect(firstEnabledId([{ id: 'z', disabled: true }, ...ROWS])).toBe('a');
  });

  it('is null for an empty or all-disabled list', () => {
    expect(firstEnabledId([])).toBeNull();
    expect(firstEnabledId(ALL_DISABLED)).toBeNull();
  });
});

describe('moveHighlight', () => {
  it('steps over disabled rows both ways', () => {
    expect(moveHighlight(ROWS, 'a', 'next')).toBe('c');
    expect(moveHighlight(ROWS, 'c', 'previous')).toBe('a');
  });

  it('wraps at both ends (skipping a disabled tail)', () => {
    expect(moveHighlight(ROWS, 'c', 'next')).toBe('a');
    expect(moveHighlight(ROWS, 'a', 'previous')).toBe('c');
  });

  it('jumps to the enabled ends on first/last', () => {
    expect(moveHighlight(ROWS, 'c', 'first')).toBe('a');
    expect(moveHighlight(ROWS, 'a', 'last')).toBe('c');
  });

  it('steps from the matching end when the highlight is unset or stale', () => {
    expect(moveHighlight(ROWS, null, 'next')).toBe('a');
    expect(moveHighlight(ROWS, null, 'previous')).toBe('c');
    expect(moveHighlight(ROWS, 'gone', 'next')).toBe('a');
  });

  it('stays on the only enabled row', () => {
    expect(moveHighlight([{ id: 'solo' }, { id: 'off', disabled: true }], 'solo', 'next')).toBe(
      'solo'
    );
  });

  it('is null when nothing is enabled or listed', () => {
    expect(moveHighlight(ALL_DISABLED, 'x', 'next')).toBeNull();
    expect(moveHighlight(ALL_DISABLED, null, 'last')).toBeNull();
    expect(moveHighlight([], null, 'previous')).toBeNull();
  });
});

describe('highlightAfterRank', () => {
  it('re-arms the top enabled row on a new query, even when the old row is still listed', () => {
    expect(highlightAfterRank(ROWS, 'c', true)).toBe('a');
  });

  it('keeps a still-listed enabled row across a same-query re-rank', () => {
    expect(highlightAfterRank(ROWS, 'c', false)).toBe('c');
  });

  it('re-arms the top when the kept row vanished or became disabled', () => {
    expect(highlightAfterRank(ROWS, 'gone', false)).toBe('a');
    expect(highlightAfterRank(ROWS, 'b', false)).toBe('a');
  });

  it('arms the top at first rank and is null for an empty result', () => {
    expect(highlightAfterRank(ROWS, null, false)).toBe('a');
    expect(highlightAfterRank([], 'a', true)).toBeNull();
  });
});

describe('paletteAnnouncement', () => {
  const facts = { query: 'ex', count: 3, activeLabel: 'Export JSON', speakActiveRow: false };

  it('speaks the count after a query (singular and plural)', () => {
    expect(paletteAnnouncement('query', facts)).toBe('3 commands available');
    expect(paletteAnnouncement('query', { ...facts, count: 1 })).toBe('1 command available');
  });

  it('speaks the no-match line for an empty result, row or not', () => {
    expect(paletteAnnouncement('query', { ...facts, count: 0, activeLabel: null })).toBe(
      noMatchText('ex')
    );
    expect(
      paletteAnnouncement('query', { ...facts, count: 0, activeLabel: null, speakActiveRow: true })
    ).toBe('No commands match “ex”');
  });

  it('leaves the region alone on moves unless the row is spoken', () => {
    expect(paletteAnnouncement('move', facts)).toBeNull();
    expect(paletteAnnouncement('move', { ...facts, speakActiveRow: true })).toBe('Export JSON');
    expect(
      paletteAnnouncement('move', { ...facts, speakActiveRow: true, activeLabel: null })
    ).toBeNull();
  });

  it('appends the highlighted row to the count when the row is spoken', () => {
    expect(paletteAnnouncement('query', { ...facts, speakActiveRow: true })).toBe(
      '3 commands available, Export JSON'
    );
    expect(
      paletteAnnouncement('query', { ...facts, speakActiveRow: true, activeLabel: null })
    ).toBe('3 commands available');
  });
});

describe('isApplePlatform', () => {
  it('recognizes macOS, iPhone and iPad platform strings (either source)', () => {
    expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isApplePlatform({ platform: 'iPhone' })).toBe(true);
    expect(isApplePlatform({ platform: 'iPad' })).toBe(true);
    expect(isApplePlatform({ platform: 'Win32', userAgentData: { platform: 'macOS' } })).toBe(true);
  });

  it('prefers the client-hints platform over the deprecated one', () => {
    expect(isApplePlatform({ platform: 'MacIntel', userAgentData: { platform: 'Windows' } })).toBe(
      false
    );
  });

  it('is false for other platforms and for missing facts', () => {
    expect(isApplePlatform({ platform: 'Win32' })).toBe(false);
    expect(isApplePlatform({ platform: 'Linux x86_64' })).toBe(false);
    expect(isApplePlatform({})).toBe(false);
  });
});

describe('scrollDeltaToReveal', () => {
  const list = { top: 100, bottom: 200 };

  it('is zero for a row fully in view', () => {
    expect(scrollDeltaToReveal({ top: 100, bottom: 130 }, list)).toBe(0);
    expect(scrollDeltaToReveal({ top: 170, bottom: 200 }, list)).toBe(0);
  });

  it('scrolls up by the overhang above, down by the overhang below', () => {
    expect(scrollDeltaToReveal({ top: 80, bottom: 110 }, list)).toBe(-20);
    expect(scrollDeltaToReveal({ top: 190, bottom: 220 }, list)).toBe(20);
  });

  it('aligns a row taller than the list to its top', () => {
    expect(scrollDeltaToReveal({ top: 150, bottom: 300 }, list)).toBe(50);
  });
});

describe('fieldHighlightMove', () => {
  const bare = { shiftKey: false, altKey: false, metaKey: false };

  it('maps the bare arrow / Home / End keys to their moves', () => {
    expect(fieldHighlightMove({ ...bare, key: 'ArrowDown' })).toBe('next');
    expect(fieldHighlightMove({ ...bare, key: 'ArrowUp' })).toBe('previous');
    expect(fieldHighlightMove({ ...bare, key: 'Home' })).toBe('first');
    expect(fieldHighlightMove({ ...bare, key: 'End' })).toBe('last');
  });

  it.each(['shiftKey', 'altKey', 'metaKey'] as const)(
    'leaves the keys to the field while %s is held (text selection / caret)',
    (modifier) => {
      for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
        expect(fieldHighlightMove({ ...bare, key, [modifier]: true })).toBeNull();
      }
    }
  );

  it('is null for every other key', () => {
    for (const key of ['Enter', 'ArrowLeft', 'PageDown', 'a', 'Tab']) {
      expect(fieldHighlightMove({ ...bare, key })).toBeNull();
    }
  });
});
