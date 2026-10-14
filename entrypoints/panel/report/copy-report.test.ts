/**
 * The Copy-report binding: the report (with its provenance) reaches the
 * clipboard and confirms; a rejected write, a missing clipboard and a
 * throwing context read all end as the failure outcome with the remedy
 * toast — never a rejection; a missing version/URL only thins the report.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, toastItems } from '../../../components/ui/toast-store';
import { buildSupportReport } from '../../../lib/panel/support-report';
import { makeFdtData } from '../state/fixtures';
import {
  copySupportReport,
  manifestVersion,
  realCopyReportDeps,
  REPORT_COPIED,
  REPORT_COPY_FAILED,
  REPORT_COPY_REMEDY,
  type CopyReportDeps
} from './copy-report';

afterEach(() => {
  toast.clear();
  vi.restoreAllMocks();
});

/** The newest toast in the queue. */
function lastToast(): ReturnType<typeof toastItems>[number] | undefined {
  return toastItems().at(-1);
}

/** Seams with a recording clipboard; overrides replace single seams. */
function deps(overrides?: Partial<CopyReportDeps>): {
  deps: CopyReportDeps;
  written: () => string;
} {
  let written = '';
  return {
    deps: {
      clipboard: () => ({
        writeText: (text) => {
          written = text;
          return Promise.resolve();
        }
      }),
      now: () => Date.UTC(2026, 9, 14, 12, 0, 0),
      extensionVersion: () => '1.4.0',
      pageUrl: () => Promise.resolve('https://example.com/'),
      ...overrides
    },
    written: () => written
  };
}

describe('copySupportReport', () => {
  it('writes the report with its provenance and confirms with "Report copied"', async () => {
    const data = makeFdtData({ undefinedReferencesOnPage: ['jQuery'] });
    const run = deps();
    expect(await copySupportReport(data, run.deps)).toBe('copied');
    expect(run.written()).toBe(
      buildSupportReport(data, {
        generatedAt: Date.UTC(2026, 9, 14, 12, 0, 0),
        extensionVersion: '1.4.0',
        pageUrl: 'https://example.com/'
      })
    );
    expect(run.written()).toContain('- **Page:** `https://example.com/`');
    expect(lastToast()).toMatchObject({ tone: 'success', title: REPORT_COPIED });
  });

  it('still copies when the version and the URL are unknown', async () => {
    const run = deps({ extensionVersion: () => null, pageUrl: () => Promise.resolve(null) });
    expect(await copySupportReport(makeFdtData(), run.deps)).toBe('copied');
    expect(run.written()).not.toContain('**Page:**');
    expect(run.written()).toContain('- **Extension version:** Not available');
  });

  it('answers a rejected write with the remedy toast', async () => {
    const run = deps({
      clipboard: () => ({ writeText: () => Promise.reject(new Error('Document is not focused.')) })
    });
    expect(await copySupportReport(makeFdtData(), run.deps)).toBe('failed');
    expect(lastToast()).toMatchObject({
      tone: 'error',
      title: REPORT_COPY_FAILED,
      description: REPORT_COPY_REMEDY
    });
  });

  it('answers a missing clipboard (seam throws) the same way', async () => {
    const run = deps({
      clipboard: () => {
        throw new Error('no clipboard');
      }
    });
    expect(await copySupportReport(makeFdtData(), run.deps)).toBe('failed');
    expect(lastToast()?.title).toBe(REPORT_COPY_FAILED);
  });

  it('answers a context read that rejects the same way (never an escape)', async () => {
    const run = deps({ pageUrl: () => Promise.reject(new Error('boom')) });
    expect(await copySupportReport(makeFdtData(), run.deps)).toBe('failed');
    expect(lastToast()?.title).toBe(REPORT_COPY_FAILED);
  });
});

describe('the production seams', () => {
  it('reads the manifest version, and degrades to null when the runtime throws', () => {
    vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({
      manifest_version: 3,
      name: 'x',
      version: '9.9.9'
    });
    expect(manifestVersion()).toBe('9.9.9');
    vi.spyOn(browser.runtime, 'getManifest').mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(manifestVersion()).toBeNull();
  });

  it('wires the secure-context clipboard, the clock and a URL read that answers null outside DevTools', async () => {
    const writeText = vi.fn((): Promise<void> => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      const real = realCopyReportDeps();
      expect(await real.pageUrl()).toBeNull();
      expect(Math.abs(real.now() - Date.now())).toBeLessThan(1000);
      await real.clipboard().writeText('x');
      expect(writeText).toHaveBeenCalledWith('x');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
