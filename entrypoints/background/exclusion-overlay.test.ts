import { describe, expect, it, vi } from 'vitest';
import {
  EXCLUSION_OVERLAY_SCRIPT,
  classifyInjectionFailure,
  openExclusionOverlay,
  type ScriptInjector
} from './exclusion-overlay';

/** An injector resolving or rejecting once, with its spy. */
function injector(result: Promise<unknown>): {
  api: ScriptInjector;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(() => result);
  return { api: { executeScript: spy }, spy };
}

describe('openExclusionOverlay', () => {
  it('injects the overlay script into the top frame only', async () => {
    const { api, spy } = injector(Promise.resolve([]));
    expect(await openExclusionOverlay(7, api)).toBe('injected');
    expect(spy).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [0] },
      files: [EXCLUSION_OVERLAY_SCRIPT]
    });
  });

  it('never rejects: a refusal is an outcome', async () => {
    const { api } = injector(Promise.reject(new Error('Cannot access a chrome:// URL')));
    expect(await openExclusionOverlay(7, api)).toBe('unsupported-page');
  });
});

describe('classifyInjectionFailure', () => {
  it('tells a closed tab, an unscriptable page and a real failure apart', () => {
    expect(classifyInjectionFailure(new Error('No tab with id: 5.'))).toBe('tab-gone');
    expect(classifyInjectionFailure(new Error('Invalid tab ID: 5'))).toBe('tab-gone');
    expect(
      classifyInjectionFailure(
        new Error(
          'Cannot access contents of the page. Extension manifest must request permission to access the respective host.'
        )
      )
    ).toBe('unsupported-page');
    expect(classifyInjectionFailure(new Error('Missing host permission for the tab'))).toBe(
      'unsupported-page'
    );
    expect(classifyInjectionFailure(new Error('The extensions gallery cannot be scripted.'))).toBe(
      'unsupported-page'
    );
    // Case-insensitive (engines word these differently).
    expect(classifyInjectionFailure(new Error('MISSING HOST PERMISSION for the tab'))).toBe(
      'unsupported-page'
    );
    expect(classifyInjectionFailure(new Error('no tab with id: 9'))).toBe('tab-gone');
    expect(classifyInjectionFailure('boom')).toBe('failed');
  });
});
