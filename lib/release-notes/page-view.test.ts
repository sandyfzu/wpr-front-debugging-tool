/**
 * The page's view: after an update every announced release above the floor
 * in full; else the running release first (or the newest earlier one);
 * older rows as history, newer or invalid rows dropped, notices filtered to
 * the build; and the placeholders' values per platform.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE_CHORD } from '../storage/palette-chord';
import type { ReleaseNote } from './notes';
import { DEVTOOLS_SHORTCUTS, whatsNewTokens, whatsNewView } from './page-view';

/** A row with one notice per build scope. */
function note(version: string, announce = true): ReleaseNote {
  return {
    version,
    announce,
    headline: version,
    highlights: [],
    improvements: [],
    notices: [
      { id: 'all', title: 'All', body: 'b' },
      { id: 'chromium', title: 'C', body: 'b', browsers: ['chromium'] },
      { id: 'firefox', title: 'F', body: 'b', browsers: ['firefox'] }
    ]
  };
}

const NOTES = [note('3.0.0'), note('3.2.0'), note('bad'), note('2.5.0'), note('3.1.0')];

describe('whatsNewView', () => {
  it('shows the running version first and older rows as history, newest first', () => {
    const view = whatsNewView(NOTES, '3.1.0', 'chromium');
    expect(view.featured.map((row) => row.version)).toEqual(['3.1.0']);
    expect(view.history.map((row) => row.version)).toEqual(['3.0.0', '2.5.0']);
  });

  it('falls back to the newest earlier row for a version without one', () => {
    expect(whatsNewView(NOTES, '3.1.7', 'chromium').featured.map((row) => row.version)).toEqual([
      '3.1.0'
    ]);
  });

  it('shows nothing when no row is at or below the running version', () => {
    expect(whatsNewView(NOTES, '1.0', 'chromium')).toEqual({ featured: [], history: [] });
    expect(whatsNewView([], '3.0.0', 'chromium')).toEqual({ featured: [], history: [] });
  });

  it('keeps every valid row for an unparsable running version', () => {
    expect(whatsNewView(NOTES, 'dev', 'chromium').featured.map((row) => row.version)).toEqual([
      '3.2.0'
    ]);
  });

  it('features every announced release above the floor, newest first', () => {
    const notes = [note('3.0.0'), note('3.0.1', false), note('3.1.0'), note('2.0.0')];
    const view = whatsNewView(notes, '3.1.0', 'chromium', '2.2.5');
    expect(view.featured.map((row) => row.version)).toEqual(['3.1.0', '3.0.0']);
    expect(view.history.map((row) => row.version)).toEqual(['3.0.1', '2.0.0']);
    // A routine patch as the running version: the announced release leads.
    const patch = whatsNewView(notes, '3.0.1', 'chromium', '2.2.5');
    expect(patch.featured.map((row) => row.version)).toEqual(['3.0.0']);
    expect(patch.history.map((row) => row.version)).toEqual(['3.0.1', '2.0.0']);
  });

  it('excludes the floor itself and keeps rows above the running version out', () => {
    const view = whatsNewView(NOTES, '3.1.0', 'chromium', '3.0.0');
    expect(view.featured.map((row) => row.version)).toEqual(['3.1.0']);
    expect(view.history.map((row) => row.version)).toEqual(['3.0.0', '2.5.0']);
  });

  it('falls back to the running release when nothing announced is above the floor', () => {
    const notes = [note('3.0.1', false), note('3.0.0')];
    expect(
      whatsNewView(notes, '3.0.1', 'chromium', '3.0.0').featured.map((row) => row.version)
    ).toEqual(['3.0.1']);
  });

  it('ignores a malformed floor (the address is untrusted)', () => {
    expect(
      whatsNewView(NOTES, '3.1.0', 'chromium', 'nope').featured.map((row) => row.version)
    ).toEqual(['3.1.0']);
  });

  it('filters notices to the running build', () => {
    expect(whatsNewView(NOTES, '3.0.0', 'chromium').featured[0]?.notices.map((n) => n.id)).toEqual([
      'all',
      'chromium'
    ]);
    expect(whatsNewView(NOTES, '3.0.0', 'firefox').featured[0]?.notices.map((n) => n.id)).toEqual([
      'all',
      'firefox'
    ]);
  });
});

describe('whatsNewTokens', () => {
  it('writes the shortcuts in the platform’s notation', () => {
    expect(whatsNewTokens(DEFAULT_PALETTE_CHORD, 'mac')).toEqual({
      paletteShortcut: '⌥K',
      devtoolsShortcut: DEVTOOLS_SHORTCUTS.mac
    });
    expect(whatsNewTokens(DEFAULT_PALETTE_CHORD, 'other')).toEqual({
      paletteShortcut: 'Alt+K',
      devtoolsShortcut: DEVTOOLS_SHORTCUTS.other
    });
  });
});
