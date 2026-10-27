/**
 * The registry-to-platform context translation: identity on Manifest V3,
 * the toolbar button's Manifest V2 name below it, and a loud refusal of
 * manifest versions no platform reports.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  PAGE_CONTENT_CONTEXTS,
  platformMenuContext,
  platformMenuContexts,
  type PlatformMenuContext
} from './menu-contexts';

describe('PlatformMenuContext', () => {
  it('keeps every name the registry uses, all declared by the browser API', () => {
    // The union grew with the in-page names: an undeclared one would drop out.
    expectTypeOf<PlatformMenuContext>().toEqualTypeOf<
      | 'all'
      | 'action'
      | 'browser_action'
      | 'page'
      | 'frame'
      | 'selection'
      | 'link'
      | 'editable'
      | 'image'
      | 'video'
      | 'audio'
    >();
  });
});

describe('PAGE_CONTENT_CONTEXTS', () => {
  it('names the in-page contexts only: never the toolbar button menu nor a catch-all', () => {
    expect([...PAGE_CONTENT_CONTEXTS]).toEqual([
      'page',
      'frame',
      'selection',
      'link',
      'editable',
      'image',
      'video',
      'audio'
    ]);
    for (const outside of ['all', 'action', 'browser_action', 'page_action', 'launcher', 'tab']) {
      expect(PAGE_CONTENT_CONTEXTS as readonly string[]).not.toContain(outside);
    }
  });
});

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

  it('keeps every in-page name on both manifest versions', () => {
    for (const context of PAGE_CONTENT_CONTEXTS) {
      expect(platformMenuContext(context, 2)).toBe(context);
      expect(platformMenuContext(context, 3)).toBe(context);
    }
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
