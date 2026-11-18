import { describe, expect, it } from 'vitest';
import { nextSheetPresence, SHEET_CLOSED, type SheetPresence } from './sheet-presence';

const open1: SheetPresence = { phase: 'open', mount: 1 };
const closing1: SheetPresence = { phase: 'closing', mount: 1 };

describe('nextSheetPresence', () => {
  it('runs the full cycle: closed → open → closing → closed', () => {
    const opened = nextSheetPresence(SHEET_CLOSED, 'show');
    expect(opened).toEqual(open1);
    const closing = nextSheetPresence(opened, 'hide');
    expect(closing).toEqual(closing1);
    expect(nextSheetPresence(closing, 'exited')).toEqual({ phase: 'closed', mount: 1 });
  });

  it('starts a fresh mount on every open, including a show while closing', () => {
    expect(nextSheetPresence({ phase: 'closed', mount: 4 }, 'show')).toEqual({
      phase: 'open',
      mount: 5
    });
    expect(nextSheetPresence(closing1, 'show')).toEqual({ phase: 'open', mount: 2 });
  });

  it('returns the same state for events that do not apply', () => {
    expect(nextSheetPresence(SHEET_CLOSED, 'hide')).toBe(SHEET_CLOSED);
    expect(nextSheetPresence(SHEET_CLOSED, 'exited')).toBe(SHEET_CLOSED);
    expect(nextSheetPresence(open1, 'show')).toBe(open1);
    // A stale exit timer never closes an open sheet.
    expect(nextSheetPresence(open1, 'exited')).toBe(open1);
    expect(nextSheetPresence(closing1, 'hide')).toBe(closing1);
  });
});
