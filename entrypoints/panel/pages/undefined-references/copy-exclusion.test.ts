/**
 * The Copy-as-exclusion action: the pattern reaches the clipboard and the
 * toast names the WP Rocket setting it goes into; every failure shape ends
 * in the error toast naming the pattern, never a throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, toastItems } from '../../../../components/ui/toast-store';
import { copyAsExclusion } from './copy-exclusion';

const PATTERN = '/wp-content/plugins/p/a.js';

beforeEach(() => {
  toast.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  toast.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('copyAsExclusion', () => {
  it('copies the pattern verbatim and toasts the setting to paste it into', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    await expect(copyAsExclusion(PATTERN, () => ({ writeText }))).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(PATTERN);
    expect(toastItems()).toHaveLength(1);
    expect(toastItems()[0]).toMatchObject({
      tone: 'success',
      title: 'Exclusion copied',
      description:
        "Paste it into WP Rocket's Delay JavaScript execution → Excluded JavaScript Files."
    });
  });

  it('toasts the pattern to add by hand when the clipboard rejects the write', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('Document is not focused.')));
    await expect(copyAsExclusion(PATTERN, () => ({ writeText }))).resolves.toBe('failed');
    expect(toastItems()).toHaveLength(1);
    expect(toastItems()[0]).toMatchObject({
      tone: 'error',
      title: 'Copy failed',
      description: 'Add it by hand: /wp-content/plugins/p/a.js'
    });
    // The platform's error text never reaches the UI copy.
    expect(JSON.stringify(toastItems())).not.toContain('Document is not focused');
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('toasts the remedy when no clipboard exists in this context', async () => {
    const result = await copyAsExclusion(PATTERN, () => {
      throw new Error('The secure-context clipboard is unavailable in this context.');
    });
    expect(result).toBe('failed');
    expect(toastItems()[0]).toMatchObject({ tone: 'error', title: 'Copy failed' });
  });

  it('defaults to the platform clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyAsExclusion(PATTERN)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(PATTERN);
  });
});
