/**
 * The Detections presentation rules: the link table's rows (and only
 * those), the verdict → vocabulary mapping and the cache-age line.
 */
import { describe, expect, it } from 'vitest';
import { navRoute } from '../../routes';
import { CARD_PAGE_LINKS, cacheAgeText, STATUS_TONES } from './card-presentation';

describe('CARD_PAGE_LINKS', () => {
  it('links exactly the features that own a page, each to a real route', () => {
    expect([...CARD_PAGE_LINKS]).toEqual([
      ['delay_js', 'javascript'],
      ['defer_all_js', 'javascript'],
      ['lazyload', 'lazyload']
    ]);
    for (const route of CARD_PAGE_LINKS.values()) {
      expect(navRoute(route)).toBeDefined();
    }
  });
});

describe('STATUS_TONES', () => {
  it('maps active to ok and not-active to neutral (never error)', () => {
    expect(STATUS_TONES).toEqual({ active: 'ok', 'not-active': 'neutral' });
  });
});

describe('cacheAgeText', () => {
  const stamp = 1_700_000_000;
  it.each([
    [0, 'Generated just now'],
    [90_000, 'Generated 1 min ago'],
    [3 * 3_600_000, 'Generated 3 h ago'],
    [-60_000, 'Generated just now']
  ])('ages a stamp by %d ms → %s', (elapsed, expected) => {
    expect(cacheAgeText(stamp, stamp * 1000 + elapsed)).toBe(expected);
  });
});
