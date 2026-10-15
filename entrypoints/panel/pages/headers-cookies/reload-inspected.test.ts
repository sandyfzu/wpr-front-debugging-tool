/**
 * The inspected-page reload seam: feature detection (a DevTools window has
 * the API; a standalone page does not) and the three outcomes.
 */
import { describe, expect, it, vi } from 'vitest';
import { canReloadInspected, reloadInspected } from './reload-inspected';

describe('reloadInspected', () => {
  it('detects the API', () => {
    expect(canReloadInspected({})).toBe(false);
    expect(canReloadInspected({ devtools: {} })).toBe(false);
    expect(canReloadInspected({ devtools: { inspectedWindow: { reload: vi.fn() } } })).toBe(true);
  });

  it('hands the reload over with an options object, bound to the API', () => {
    const inspectedWindow = {
      reload: vi.fn(function (this: unknown) {
        expect(this).toBe(inspectedWindow);
      })
    };
    expect(reloadInspected({ devtools: { inspectedWindow } })).toBe('reloaded');
    expect(inspectedWindow.reload).toHaveBeenCalledWith({});
  });

  it('answers unavailable outside DevTools and failed when the API throws', () => {
    expect(reloadInspected({})).toBe('unavailable');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      reloadInspected({
        devtools: {
          inspectedWindow: {
            reload: () => {
              throw new Error('Extension context invalidated.');
            }
          }
        }
      })
    ).toBe('failed');
    warn.mockRestore();
  });
});
