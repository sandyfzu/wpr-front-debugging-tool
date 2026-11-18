/**
 * The JSON export's mechanism: the happy path downloads a file, every
 * download-seam failure degrades to a clipboard copy (each outcome toasts
 * its own honest framing), a double failure is the final answer, and the
 * filename is pure date arithmetic. The platform error never renders.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipboardLike } from '../../../components/ui/copy-button';
import { toast, toastItems, type ToastItem } from '../../../components/ui/toast-store';
import { makeFdtData } from '../state/fixtures';
import { exportFilename, exportPageDataJson, type JsonExportDeps } from './export-json';
import { EXPORT_REDACTION_NOTICE, redactPageDataForExport } from '../../../lib/redaction/page-data';
import {
  PLANTED,
  PLANTED_INLINE_BODIES,
  PLANTED_RAW_HEADERS
} from '../../../lib/redaction/planted-secrets.fixtures';

/** The fixed stamp the filename test builds (2026-10-13 04:25 UTC-local). */
const STAMP = new Date(2026, 9, 13, 4, 25);

beforeEach(() => {
  toast.clear();
});

/** The last toast in the queue (the freshest framing). */
function latestToast(): ToastItem | undefined {
  const items = toastItems();
  return items[items.length - 1];
}

/**
 * Deps whose download behaves per test: the payload/filename are recorded,
 * the failure controlled by the thrown error slot.
 */
function makeDeps(options?: {
  download?: (payload: string, filename: string) => void;
  clipboard?: ClipboardLike;
  clipboardAt?: () => ClipboardLike;
}): JsonExportDeps {
  return {
    download:
      options?.download ??
      ((payload, filename) => {
        // The default seam guards an exportable pair (real seams ignore it).
        if (payload.length === 0 || !filename.endsWith('.json')) {
          throw new Error('an empty or misnamed export is not exportable');
        }
      }),
    // The lazy seam contract: the accessor resolves inside the fallback arm.
    // (Integration amendment: the clipboard dep grew from a value to an
    // accessor so a clipboard-less context degrades as an outcome — the
    // helper follows the grown contract, no assertion semantics changed.)
    clipboard:
      options?.clipboardAt ??
      (() =>
        options?.clipboard ?? {
          writeText: vi.fn(() => Promise.resolve(undefined))
        }),
    now: () => STAMP
  };
}

describe('exportFilename', () => {
  it('builds a sorted-day, minute-stamped name', () => {
    expect(exportFilename(STAMP)).toBe('wpr-fdt-export-20261013-0425.json');
    // The pad keeps the sort stable across single-digit months/hours.
    expect(exportFilename(new Date(2026, 0, 2, 3, 4))).toBe('wpr-fdt-export-20260102-0304.json');
  });
});

describe('exportPageDataJson', () => {
  it('downloads a pretty-printed JSON file and confirms with a success toast', async () => {
    const download = vi.fn((payload: string, filename: string) => {
      expect(filename).toBe('wpr-fdt-export-20261013-0425.json');
      // The whole contract shape serializes (real FdtData through the fixture),
      // through the export redaction and headed by its notice.
      expect(JSON.parse(payload)).toEqual(redactPageDataForExport(makeFdtData()));
    });
    const result = await exportPageDataJson(makeFdtData(), makeDeps({ download }));
    expect(result).toBe('downloaded');
    expect(latestToast()?.tone).toBe('success');
    expect(latestToast()?.description).toContain('.json');
  });

  it('exports no planted secret and states that values are redacted', async () => {
    let payload = '';
    const base = makeFdtData();
    const planted = makeFdtData({
      pageHeaders: PLANTED_RAW_HEADERS,
      wprDetections: {
        ...base.wprDetections,
        delay_js: {
          present: true,
          version: null,
          delayedScripts: PLANTED_INLINE_BODIES.length,
          scripts: PLANTED_INLINE_BODIES.map((content) => ({
            inline: true,
            content,
            delayed: true,
            deferred: false,
            deferredByWPR: false,
            fdtExcluded: null,
            minifyAttribute: false
          }))
        }
      }
    });
    const result = await exportPageDataJson(
      planted,
      makeDeps({
        download: (text) => {
          payload = text;
        }
      })
    );
    expect(result).toBe('downloaded');
    expect(payload).not.toContain(PLANTED);
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(Object.keys(parsed)[0]).toBe('redaction');
    expect(parsed['redaction']).toEqual(EXPORT_REDACTION_NOTICE);
  });

  it('exports nothing when the redaction itself fails (never the raw data)', async () => {
    const download = vi.fn();
    const writeText = vi.fn((): Promise<void> => Promise.resolve(undefined));
    const data = makeFdtData();
    Object.defineProperty(data, 'wprDetections', {
      enumerable: true,
      get: () => {
        throw new Error('unreadable');
      }
    });
    const result = await exportPageDataJson(
      data,
      makeDeps({ download, clipboard: { writeText } as unknown as ClipboardLike })
    );
    expect(result).toBe('failed');
    expect(download).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(latestToast()?.tone).toBe('error');
  });

  it('degrades a download failure to the clipboard copy with its info toast', async () => {
    const writeText = vi.fn((): Promise<void> => Promise.resolve(undefined));
    const result = await exportPageDataJson(
      makeFdtData(),
      makeDeps({
        download: () => {
          throw new Error('no anchor click here');
        },
        clipboard: { writeText } as unknown as ClipboardLike
      })
    );
    expect(result).toBe('copied');
    // The clipboard carried the exact payload...
    expect(writeText).toHaveBeenCalledWith(
      JSON.stringify(redactPageDataForExport(makeFdtData()), null, 2)
    );
    // ...the framing names the degrade (no platform error renders).
    const item = latestToast();
    expect(item?.tone).toBe('info');
    expect(item?.description).toContain('unavailable');
  });

  it('answers a double failure with the error framing (never a silent end)', async () => {
    const writeText = vi.fn((): Promise<never> => Promise.reject(new Error('clipboard rejected')));
    const result = await exportPageDataJson(
      makeFdtData(),
      makeDeps({
        download: () => {
          throw new Error('no downloads api');
        },
        clipboard: { writeText } as unknown as ClipboardLike
      })
    );
    expect(result).toBe('failed');
    const item = latestToast();
    expect(item?.tone).toBe('error');
    expect(item?.description).toContain('Neither');
  });

  it('lands a clipboard construction failure in the final outcome, not the caller', async () => {
    // A clipboard-less context: the lazy seam's build throws before a copy
    // could run — an outcome of the fallback arm (never an escape out of
    // the export; the run-command guard is the last line, not this path's
    // plan).
    const result = await exportPageDataJson(
      makeFdtData(),
      makeDeps({
        download: () => {
          throw new Error('no downloads api');
        },
        clipboardAt: () => {
          throw new Error('The secure-context clipboard is unavailable in this context.');
        }
      })
    );
    expect(result).toBe('failed');
    const item = latestToast();
    expect(item?.tone).toBe('error');
    expect(item?.description).toContain('Neither');
  });
});
