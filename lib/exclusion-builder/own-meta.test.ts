import { describe, expect, it } from 'vitest';
import { BUILDER_MARKER_META_NAME, SIMULATION_MARKER_META_NAME } from '../wp-rocket/constants';
import { scanTokens } from './html-scan';
import { headEnd, isOwnMetaTag, OWN_META_NAME_PATTERN, readsAsOwnMetaName } from './own-meta';

describe('own meta markers', () => {
  it('both marker names are ones the reference rule can decide', () => {
    expect(OWN_META_NAME_PATTERN.test(BUILDER_MARKER_META_NAME)).toBe(true);
    expect(OWN_META_NAME_PATTERN.test(SIMULATION_MARKER_META_NAME)).toBe(true);
  });

  it('refuses a name the rule cannot decide (a caller bug)', () => {
    for (const name of ['Upper', 'with space', 'fjord-name', 'x1', '']) {
      expect(() => readsAsOwnMetaName('x', name), name).toThrow(RangeError);
    }
  });

  it('reads numeric references as the DOM does, named ones never', () => {
    expect(readsAsOwnMetaName('wpr-fdt&#45;simulation', SIMULATION_MARKER_META_NAME)).toBe(true);
    expect(readsAsOwnMetaName('&#x77;pr-fdt-simulation', SIMULATION_MARKER_META_NAME)).toBe(true);
    expect(readsAsOwnMetaName('wpr-fdt&hyphen;simulation', SIMULATION_MARKER_META_NAME)).toBe(
      false
    );
    expect(readsAsOwnMetaName('wpr-fdt&#38;#45;simulation', SIMULATION_MARKER_META_NAME)).toBe(
      false
    );
  });

  it('names only meta start tags by their first name attribute', () => {
    const tokens = scanTokens(
      '<meta name="a-b" name="x"><meta name="x" name="a-b"><link name="a-b"></meta>',
      'browser'
    );
    expect(tokens.map((token) => isOwnMetaTag(token, 'a-b'))).toEqual([true, false, false, false]);
  });

  it('finds the end of the head: </head>, else <body>, else none', () => {
    const at = (html: string) => headEnd(scanTokens(html, 'browser'));
    expect(at('<head></head><body>')).toBe(6);
    expect(at('<head><body>')).toBe(6);
    expect(at('<p>x</p>')).toBeNull();
  });
});
