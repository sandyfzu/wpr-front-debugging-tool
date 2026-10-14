/**
 * The Copy-report mechanism: the report reaches the clipboard and confirms;
 * a rejected write, a missing clipboard and a throwing seam all end as the
 * failure outcome with the remedy toast — never a rejection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, toastItems } from '../../../../components/ui/toast-store';
import { buildSupportReport } from '../../../../lib/panel/support-report';
import { makeFdtData } from '../../state/fixtures';
import {
  copySupportReport,
  REPORT_COPIED,
  REPORT_COPY_FAILED,
  REPORT_COPY_REMEDY
} from './copy-report';

afterEach(() => {
  toast.clear();
});

/** The newest toast in the queue. */
function lastToast(): ReturnType<typeof toastItems>[number] | undefined {
  return toastItems().at(-1);
}

describe('copySupportReport', () => {
  it('writes the support report and confirms with "Report copied"', async () => {
    const data = makeFdtData({ undefinedReferencesOnPage: ['jQuery'] });
    let written: string | null = null;
    const outcome = await copySupportReport(data, () => ({
      writeText: (text) => {
        written = text;
        return Promise.resolve();
      }
    }));
    expect(outcome).toBe('copied');
    expect(written).toBe(buildSupportReport(data));
    expect(lastToast()).toMatchObject({ tone: 'success', title: REPORT_COPIED });
  });

  it('answers a rejected write with the remedy toast', async () => {
    const outcome = await copySupportReport(makeFdtData(), () => ({
      writeText: () => Promise.reject(new Error('Document is not focused.'))
    }));
    expect(outcome).toBe('failed');
    expect(lastToast()).toMatchObject({
      tone: 'error',
      title: REPORT_COPY_FAILED,
      description: REPORT_COPY_REMEDY
    });
  });

  it('answers a missing clipboard (seam throws) the same way', async () => {
    const outcome = await copySupportReport(makeFdtData(), () => {
      throw new Error('no clipboard');
    });
    expect(outcome).toBe('failed');
    expect(lastToast()?.title).toBe(REPORT_COPY_FAILED);
  });

  it('defaults to the secure-context clipboard', async () => {
    const writeText = vi.fn((): Promise<void> => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      expect(await copySupportReport(makeFdtData())).toBe('copied');
      expect(writeText).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
