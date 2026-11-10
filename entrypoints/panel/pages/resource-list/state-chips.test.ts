/** The state-chip split: order kept, at most three visible, "+N" naming the rest. */
import { describe, expect, it } from 'vitest';
import {
  MAX_VISIBLE_STATE_CHIPS,
  NO_STATE_CHIPS,
  chipPhrase,
  splitStateChips,
  type StateChip
} from './state-chips';

/** Chips named `a`, `b`, … in order. */
function chips(count: number): StateChip[] {
  return Array.from({ length: count }, (_, index) => {
    const name = String.fromCharCode(97 + index);
    return { id: name, label: name.toUpperCase(), kind: 'info' };
  });
}

describe('splitStateChips', () => {
  it('a row without states shares the empty split', () => {
    expect(splitStateChips([])).toBe(NO_STATE_CHIPS);
    expect(NO_STATE_CHIPS).toEqual({ visible: [], overflow: null });
  });

  it.each([1, 2, 3])('%i chips all show, in order, no "+N"', (count) => {
    const row = chips(count);
    const split = splitStateChips(row);
    expect(split.visible).toBe(row);
    expect(split.overflow).toBeNull();
  });

  it('caps at three by default', () => {
    expect(MAX_VISIBLE_STATE_CHIPS).toBe(3);
  });

  it('4 chips ⇒ 3 + "+1"', () => {
    const split = splitStateChips(chips(4));
    expect(split.visible.map((chip) => chip.id)).toEqual(['a', 'b', 'c']);
    expect(split.overflow).toEqual({ label: '+1', title: 'Also: D' });
  });

  it('6 chips ⇒ 3 + "+3", the title listing the hidden ones in order with their marks', () => {
    const row = chips(6).map((chip) => (chip.id === 'e' ? { ...chip, mark: 'WP Rocket' } : chip));
    const split = splitStateChips(row);
    expect(split.visible.map((chip) => chip.id)).toEqual(['a', 'b', 'c']);
    expect(split.overflow).toEqual({ label: '+3', title: 'Also: D, E (WP Rocket), F' });
  });

  it('honors a custom cap', () => {
    const split = splitStateChips(chips(3), 1);
    expect(split.visible.map((chip) => chip.id)).toEqual(['a']);
    expect(split.overflow?.label).toBe('+2');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects the cap %s (a wiring bug, named)', (max) => {
    expect(() => splitStateChips(chips(2), max)).toThrow(/positive integer, got/);
  });
});

describe('chipPhrase', () => {
  it('is the label, then the mark in parentheses', () => {
    expect(chipPhrase({ id: 'd', label: 'Deferred', kind: 'info' })).toBe('Deferred');
    expect(chipPhrase({ id: 'd', label: 'Deferred', kind: 'info', mark: 'Simulated' })).toBe(
      'Deferred (Simulated)'
    );
  });
});
