/** The panel's shared appearance-write guard: success is quiet, every failure toasts its remedy. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, toastItems } from '../../components/ui/toast-store';
import {
  APPEARANCE_FAILURE_TITLE,
  APPEARANCE_SAVE_NOTE,
  guardAppearanceWrite
} from './appearance-write';

afterEach(() => {
  toast.clear();
  vi.restoreAllMocks();
});

describe('guardAppearanceWrite', () => {
  it('runs the write once and stays quiet when it lands', async () => {
    const write = vi.fn(() => Promise.resolve());
    await guardAppearanceWrite(write);
    expect(write).toHaveBeenCalledTimes(1);
    expect(toastItems()).toEqual([]);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('Extension context invalidated'))],
    [
      'throws before returning a promise',
      () => {
        throw new Error('storage unavailable');
      }
    ],
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the platform may reject with anything
    ['rejects with a non-error', () => Promise.reject('quota')]
  ])('toasts the remedy (never rejects) when the write %s', async (_case, write) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(guardAppearanceWrite(write)).resolves.toBeUndefined();
    const items = toastItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      tone: 'error',
      title: APPEARANCE_FAILURE_TITLE,
      description: APPEARANCE_SAVE_NOTE
    });
    expect(warn).toHaveBeenCalled();
  });

  it('names the outcome and the remedy in words', () => {
    expect(APPEARANCE_FAILURE_TITLE).toBe('The appearance could not be changed');
    expect(APPEARANCE_SAVE_NOTE).toBe(
      'The choice did not save; the panel keeps its current palette.'
    );
  });
});
