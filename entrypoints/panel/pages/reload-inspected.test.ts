/**
 * The inspected-page reload seam: feature detection (a DevTools window has
 * the API; a standalone page does not) and the three outcomes.
 */
import { describe, expect, it, vi } from 'vitest';
import { canReloadInspected, inspectedReloadAction, reloadInspected } from './reload-inspected';

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

describe('inspectedReloadAction', () => {
  it('is absent outside a DevTools window', () => {
    expect(inspectedReloadAction({})).toBeUndefined();
    expect(inspectedReloadAction({ devtools: { inspectedWindow: {} } })).toBeUndefined();
  });

  it('reloads and confirms, or tells the user the remedy on a failure', async () => {
    const { toastItems: toasts } = await import('../../../components/ui/toast-store');
    const reload = vi.fn();
    inspectedReloadAction({ devtools: { inspectedWindow: { reload } } })?.();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toasts().at(-1)?.title).toBe(
      'Reloading the page — the panel refreshes when it reports back'
    );
    inspectedReloadAction({
      devtools: {
        inspectedWindow: {
          reload: () => {
            throw new Error('Extension context invalidated.');
          }
        }
      }
    })?.();
    expect(toasts().at(-1)).toMatchObject({
      title: 'Reload failed',
      description: 'Reload the inspected page from its own tab.'
    });
  });
});
