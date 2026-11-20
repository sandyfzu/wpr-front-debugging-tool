/** The state-chip split: order kept, at most three visible, "+N" naming the rest. */
import { describe, expect, it } from 'vitest';
import {
  CALM_VISIBLE_STATE_CHIPS,
  MAX_VISIBLE_STATE_CHIPS,
  NO_STATE_CHIPS,
  UNVERIFIED_SIMULATION_SUFFIX,
  chipPhrase,
  simulatableSource,
  splitStateChips,
  type StateChip
} from './state-chips';
import type { StateSource } from './state-sources';

/** Chips named `a`, `b`, … in order. */
function chips(count: number): StateChip[] {
  return Array.from({ length: count }, (_, index) => {
    const name = String.fromCharCode(97 + index);
    return { id: name, label: name.toUpperCase(), source: 'page' };
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
    expect(split.overflow).toEqual({ label: '+1', title: 'Also: D (page)', hidesWpRocket: false });
  });

  it('6 chips ⇒ 3 + "+3", the title listing the hidden ones in order with their sources', () => {
    const sources: StateSource[] = ['page', 'page', 'page', 'simulated', 'wp-rocket', 'excluded'];
    const row = chips(6).map((chip, index) => ({ ...chip, source: sources[index] ?? 'page' }));
    const split = splitStateChips(row);
    expect(split.visible.map((chip) => chip.id)).toEqual(['a', 'b', 'c']);
    expect(split.overflow).toEqual({
      label: '+3',
      title: 'Also: D (FDT simulation), E (WP Rocket), F (FDT exclusion)',
      hidesWpRocket: true
    });
  });

  it('the "+N" chip carries the rocket only when it hides a WP Rocket chip', () => {
    const withSources = (sources: readonly StateSource[]): StateChip[] =>
      chips(sources.length).map((chip, index) => ({ ...chip, source: sources[index] ?? 'page' }));
    // WP Rocket chips all visible: nothing of WP Rocket's hides.
    expect(
      splitStateChips(withSources(['wp-rocket', 'wp-rocket', 'wp-rocket', 'simulated'])).overflow
        ?.hidesWpRocket
    ).toBe(false);
    expect(
      splitStateChips(withSources(['excluded', 'page', 'simulated', 'page', 'wp-rocket'])).overflow
        ?.hidesWpRocket
    ).toBe(true);
  });

  it('honors a custom cap', () => {
    const split = splitStateChips(chips(3), 1);
    expect(split.visible.map((chip) => chip.id)).toEqual(['a']);
    expect(split.overflow?.label).toBe('+2');
  });

  it('caps calm rows at two (+N past it), the default staying at three', () => {
    expect(CALM_VISIBLE_STATE_CHIPS).toBe(2);
    expect(MAX_VISIBLE_STATE_CHIPS).toBe(3);
    const calm = splitStateChips(chips(3), CALM_VISIBLE_STATE_CHIPS);
    expect(calm.visible.map((chip) => chip.id)).toEqual(['a', 'b']);
    expect(calm.overflow?.label).toBe('+1');
    expect(splitStateChips(chips(2), CALM_VISIBLE_STATE_CHIPS).overflow).toBeNull();
    expect(splitStateChips(chips(3)).overflow).toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects the cap %s (a wiring bug, named)', (max) => {
    expect(() => splitStateChips(chips(2), max)).toThrow(/positive integer, got/);
  });
});

describe('chipPhrase', () => {
  it.each([
    ['wp-rocket', 'Deferred (WP Rocket)'],
    ['simulated', 'Deferred (FDT simulation)'],
    ['excluded', 'Deferred (FDT exclusion)'],
    ['page', 'Deferred (page)']
  ] as const)('is the label, then the %s source in parentheses', (source, phrase) => {
    expect(chipPhrase({ id: 'd', label: 'Deferred', source })).toBe(phrase);
  });
});

describe('simulatableSource', () => {
  it('a verified simulation is the source, named with the feature', () => {
    expect(simulatableSource('simulated', 'Lazyloaded', 'Feature X')).toEqual({
      source: 'simulated',
      title: "Lazyloaded by the FDT's Feature X simulation"
    });
  });

  it('no marker: WP Rocket, unflagged', () => {
    expect(simulatableSource(null, 'Delayed', 'Feature X')).toEqual({
      source: 'wp-rocket',
      title: 'Delayed by WP Rocket (Feature X)'
    });
  });

  it('an unverified marker keeps WP Rocket and flags the title', () => {
    expect(simulatableSource('unverified', 'Delayed', 'Feature X')).toEqual({
      source: 'wp-rocket',
      title: `Delayed by WP Rocket (Feature X)${UNVERIFIED_SIMULATION_SUFFIX}`
    });
    expect(UNVERIFIED_SIMULATION_SUFFIX).toBe(' (simulation not verified)');
  });
});
