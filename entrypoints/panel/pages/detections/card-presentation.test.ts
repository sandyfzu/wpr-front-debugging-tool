/**
 * The Detections presentation rules: the link table's rows (and only
 * those), the verdict → vocabulary mapping (tone + row word) and the cache-age line.
 */
import { describe, expect, it } from 'vitest';
import { navRoute } from '../../routes';
import { STATUS_LABELS } from '../../../../lib/panel/detections-summary';
import {
  CARD_PAGE_LINKS,
  cacheAgeText,
  ENTRY_STATE_LABELS,
  STATUS_TONES
} from './card-presentation';

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

describe('ENTRY_STATE_LABELS', () => {
  it('words a row like the summary, except not active reads the Off filter word', () => {
    expect(ENTRY_STATE_LABELS).toEqual({
      active: 'Active',
      collecting: 'Collecting',
      unknown: 'Unknown',
      'not-active': 'Off'
    });
    // The report keeps its own word.
    expect(STATUS_LABELS['not-active']).toBe('Not active');
  });
});

describe('STATUS_TONES', () => {
  it('maps active to ok, the unsure verdicts to amber and not-active to neutral (never error)', () => {
    expect(STATUS_TONES).toEqual({
      active: 'ok',
      collecting: 'warn',
      unknown: 'warn',
      'not-active': 'neutral'
    });
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
