/**
 * The registry-to-platform context translation: identity on Manifest V3,
 * the toolbar button's Manifest V2 name below it, and a loud refusal of
 * manifest versions no platform reports.
 */
import { describe, expect, it } from 'vitest';
import { platformMenuContext, platformMenuContexts } from './menu-contexts';

describe('platformMenuContext', () => {
  it('keeps every registry name on Manifest V3 (and later)', () => {
    expect(platformMenuContext('all', 3)).toBe('all');
    expect(platformMenuContext('action', 3)).toBe('action');
    expect(platformMenuContext('action', 4)).toBe('action');
  });

  it("names the toolbar button's menu 'browser_action' on Manifest V2", () => {
    expect(platformMenuContext('action', 2)).toBe('browser_action');
    // 'all' already covers the toolbar menu on both versions.
    expect(platformMenuContext('all', 2)).toBe('all');
  });

  it('refuses manifest versions no platform reports, naming the input', () => {
    for (const version of [1, 0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => platformMenuContext('action', version), String(version)).toThrow(
        new RangeError(`Unsupported manifest version: ${String(version)}`)
      );
    }
  });
});

describe('platformMenuContexts', () => {
  it('translates every context in order into a fresh list', () => {
    const contexts = ['action', 'all'] as const;
    const translated = platformMenuContexts(contexts, 2);
    expect(translated).toEqual(['browser_action', 'all']);
    expect(platformMenuContexts(contexts, 3)).toEqual(['action', 'all']);
    expect(platformMenuContexts(contexts, 3)).not.toBe(contexts);
  });

  it('propagates the manifest-version refusal', () => {
    expect(() => platformMenuContexts(['all'], 1)).toThrow(RangeError);
  });
});
