/** The overlay footer's status line: which fact it says, and its tone. */
import { describe, expect, it } from 'vitest';
import { DRAFT_TOO_LARGE_WORDS } from './copy';
import type { SaveState } from './controller';
import { draftTooLarge, footerLine, type FooterFacts } from './footer-line';

const TOO_LARGE: SaveState = { kind: 'not-saved', reason: 'too-large' };
const CALM: FooterFacts = { invalid: 0, stuck: false, dirty: false, save: { kind: 'idle' } };

describe('footerLine', () => {
  it('puts a draft over the set cap first, whatever else holds', () => {
    for (const facts of [
      { ...CALM, save: TOO_LARGE },
      { ...CALM, save: TOO_LARGE, dirty: true },
      { ...CALM, save: TOO_LARGE, invalid: 3 },
      { ...CALM, save: TOO_LARGE, invalid: 1, stuck: true, dirty: true }
    ]) {
      expect(footerLine(facts)).toEqual({ text: DRAFT_TOO_LARGE_WORDS, tone: 'error' });
    }
  });

  it('then rows to fix, an unavailability Apply cannot fix, unapplied edits', () => {
    expect(footerLine({ ...CALM, invalid: 1, stuck: true, dirty: true })).toEqual({
      text: '1 row needs fixing',
      tone: 'error'
    });
    expect(footerLine({ ...CALM, invalid: 2 })?.text).toBe('2 rows need fixing');
    expect(footerLine({ ...CALM, stuck: true, dirty: true })).toEqual({
      text: 'Applying again won’t help until the cause above is fixed',
      tone: 'muted'
    });
    expect(footerLine({ ...CALM, dirty: true, save: { kind: 'saved' } })).toEqual({
      text: 'Edits not applied yet',
      tone: 'muted'
    });
  });

  it('else the save state: errors in the error tone, nothing when idle', () => {
    expect(footerLine({ ...CALM, save: { kind: 'saved' } })).toEqual({
      text: 'Draft saved',
      tone: 'muted'
    });
    expect(footerLine({ ...CALM, save: { kind: 'not-saved', reason: 'timeout' } })?.tone).toBe(
      'error'
    );
    expect(footerLine(CALM)).toBeNull();
  });
});

describe('draftTooLarge', () => {
  it('holds for the over-cap reason only', () => {
    expect(draftTooLarge(TOO_LARGE)).toBe(true);
    expect(draftTooLarge({ kind: 'not-saved', reason: 'timeout' })).toBe(false);
    expect(draftTooLarge({ kind: 'saved' })).toBe(false);
  });
});
