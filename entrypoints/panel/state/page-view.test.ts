import { describe, expect, it } from 'vitest';
import { pageViewOf } from './page-view';

describe('pageViewOf', () => {
  it.each([
    ['idle', 'loading'],
    ['fetching', 'loading'],
    ['error', 'error'],
    ['unavailable', 'unavailable'],
    ['ready', 'page'],
    ['refreshing', 'page']
  ] as const)('maps %s to the %s view', (status, view) => {
    expect(pageViewOf(status)).toBe(view);
  });

  it('keeps a soft refresh on the same view (scroll survives it)', () => {
    expect(pageViewOf('refreshing')).toBe(pageViewOf('ready'));
  });
});
