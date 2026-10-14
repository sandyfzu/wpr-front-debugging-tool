/**
 * The Copy-as-exclusion action: the URL reaches the clipboard and the toast
 * points at the Exclusion Builder; every failure shape ends in the error
 * toast with its remedy, never a throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, toastItems } from '../../../../components/ui/toast-store';
import {
  COPIED_DESCRIPTION,
  COPIED_TITLE,
  COPY_FAILED_REMEDY,
  COPY_FAILED_TITLE,
  copyAsExclusion
} from './copy-exclusion';

const URL_A = 'https://x.test/wp-content/plugins/p/a.js?ver=1';

beforeEach(() => {
  toast.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  toast.clear();
  vi.restoreAllMocks();
});

describe('copyAsExclusion', () => {
  it('copies the script URL verbatim and toasts where to paste it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    await expect(copyAsExclusion(URL_A, () => ({ writeText }))).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(URL_A);
    expect(toastItems()).toHaveLength(1);
    expect(toastItems()[0]).toMatchObject({
      tone: 'success',
      title: COPIED_TITLE,
      description: COPIED_DESCRIPTION
    });
    expect(COPIED_TITLE).toBe('Script URL copied');
    expect(COPIED_DESCRIPTION).toContain('Exclusion Builder');
    expect(COPIED_DESCRIPTION).toContain('Delay JavaScript execution');
  });

  it('toasts the remedy when the clipboard rejects the write', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('Document is not focused.')));
    await expect(copyAsExclusion(URL_A, () => ({ writeText }))).resolves.toBe('failed');
    expect(toastItems()).toHaveLength(1);
    expect(toastItems()[0]).toMatchObject({
      tone: 'error',
      title: COPY_FAILED_TITLE,
      description: COPY_FAILED_REMEDY
    });
    // The platform's error text never reaches the UI copy.
    expect(JSON.stringify(toastItems())).not.toContain('Document is not focused');
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('toasts the remedy when no clipboard exists in this context', async () => {
    const result = await copyAsExclusion(URL_A, () => {
      throw new Error('The secure-context clipboard is unavailable in this context.');
    });
    expect(result).toBe('failed');
    expect(toastItems()[0]).toMatchObject({ tone: 'error', title: COPY_FAILED_TITLE });
  });

  it('defaults to the platform clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      await expect(copyAsExclusion(URL_A)).resolves.toBe('copied');
      expect(writeText).toHaveBeenCalledWith(URL_A);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
