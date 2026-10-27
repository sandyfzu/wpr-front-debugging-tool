/**
 * Gate × per-site precedence for the detection widget: the gate wins in
 * both directions of the opt-in, an unknown opt-in hides.
 */
import { describe, expect, it } from 'vitest';
import { widgetVisible } from './visibility';

describe('widgetVisible', () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [true, null, false],
    [false, true, false],
    [false, false, false],
    [false, null, false]
  ] as const)('gate running %s × site opt-in %s → %s', (gate, site, shown) => {
    expect(widgetVisible(gate, site)).toBe(shown);
  });
});
