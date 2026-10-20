/**
 * The document step: the budgeted pipeline (rewritten / over-budget per
 * step / engine-failed), overrun row attribution, and the byte-level
 * rewrite (size guard, charset round trip, unchanged runs, runner faults).
 */
import { describe, expect, it, vi } from 'vitest';
import { applyPipeline, EXCLUSION_PIPELINE_IDS } from '../exclusion-builder/pipeline';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../exclusion-builder/set';
import {
  createInProcessTransformRunner,
  DOCUMENT_BODY_BYTE_LIMIT,
  DOCUMENT_TRANSFORM_BUDGET_MS,
  overBudgetOutcome,
  overrunRow,
  rewriteDocument,
  runDocumentPipeline,
  type DocumentTransformRequest,
  type DocumentTransformRunner
} from './document-transform';

/** A set with selected rows/toggles replaced. */
function setWith(
  rows: Partial<ExclusionSet['rows']>,
  disable?: Partial<ExclusionSet['disable']>
): ExclusionSet {
  return {
    rows: { ...EMPTY_EXCLUSION_SET.rows, ...rows },
    disable: { ...EMPTY_EXCLUSION_SET.disable, ...disable }
  };
}

/** A clock answering the given readings in order (the last one repeats). */
function clock(...readings: number[]): () => number {
  let index = 0;
  return () => readings[Math.min(index++, readings.length - 1)] ?? 0;
}

const DELAYED = '<script type="rocketlazyloadscript" data-rocket-src="a.js"></script>';
const DELAY_SET = setWith({ delayJs: ['a\\.js'] });

/** A request over `html` with the default budget. */
function request(html: string, set: ExclusionSet = DELAY_SET): DocumentTransformRequest {
  return { html, set, documentUrl: null, budgetMs: 100 };
}

describe('runDocumentPipeline', () => {
  it('rewrites within budget with exactly the engine output', () => {
    const result = runDocumentPipeline(request(DELAYED), clock(0));
    const expected = applyPipeline(DELAYED, DELAY_SET);
    expect(result).toEqual({
      ok: true,
      html: expected.html,
      outcome: { outcome: 'rewritten', reports: expected.reports }
    });
  });

  it('announces every step in pipeline order', () => {
    const started: string[] = [];
    runDocumentPipeline(request(DELAYED), clock(0), (feature) => started.push(feature));
    expect(started).toEqual(EXCLUSION_PIPELINE_IDS);
  });

  it.each(EXCLUSION_PIPELINE_IDS.map((feature, index) => [feature, index] as const))(
    'names %s when its step crosses the budget',
    (feature, index) => {
      // Readings: start, then one per finished step; the crossing step reads 101.
      const readings = [0, ...EXCLUSION_PIPELINE_IDS.map((_, step) => (step < index ? 1 : 101))];
      const result = runDocumentPipeline(request(DELAYED), clock(...readings));
      expect(result).toEqual({
        ok: false,
        outcome: {
          outcome: 'over-budget',
          feature,
          row: overrunRow(DELAY_SET, feature),
          budgetMs: 100
        }
      });
    }
  );

  it('treats exactly-at-budget as within budget', () => {
    expect(runDocumentPipeline(request(DELAYED), clock(0, 100)).ok).toBe(true);
  });

  it('reports an invalid set as engine-failed with the validation error', () => {
    const result = runDocumentPipeline(request(DELAYED, setWith({ delayJs: ['('] })), clock(0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome).toEqual({ outcome: 'failed', reason: 'engine-failed' });
    expect(result.cause).toMatchObject({ name: 'ExclusionValidationError' });
  });

  it('reports an engine throw as engine-failed with its cause', () => {
    const boom = new Error('boom');
    const result = runDocumentPipeline(request(DELAYED), () => {
      throw boom;
    });
    expect(result).toEqual({
      ok: false,
      outcome: { outcome: 'failed', reason: 'engine-failed' },
      cause: boom
    });
  });

  it('threads the document URL to URL-resolving rows', () => {
    const html = '<script src="js/a.js" data-rocket-defer defer></script>';
    const set = setWith({ deferJs: ['^https://s\\.tld/js/a\\.js$'] });
    const resolved = runDocumentPipeline(
      { ...request(html, set), documentUrl: 'https://s.tld/page' },
      clock(0)
    );
    expect(resolved.ok && resolved.html).not.toBe(html);
    const raw = runDocumentPipeline(request(html, set), clock(0));
    expect(raw.ok && raw.html).toBe(html);
  });
});

describe('overrunRow / overBudgetOutcome', () => {
  it('names the single row of a row-driven pattern feature', () => {
    expect(overrunRow(setWith({ delayJs: ['(a+)+$'] }), 'delay_js')).toBe('(a+)+$');
    expect(overrunRow(setWith({ deferJs: ['x'] }), 'defer_all_js')).toBe('x');
  });

  it('names no row when ambiguous, feature-wide, or literal', () => {
    expect(overrunRow(setWith({ delayJs: ['a', 'b'] }), 'delay_js')).toBeNull();
    expect(overrunRow(setWith({ delayJs: [] }), 'delay_js')).toBeNull();
    expect(overrunRow(setWith({ delayJs: ['a'] }, { delayJs: true }), 'delay_js')).toBeNull();
    expect(overrunRow(setWith({ lazyload: ['a'] }), 'lazyload')).toBeNull();
    expect(overrunRow(setWith({ lazyRender: ['a'] }), 'automatic_lazy_rendering')).toBeNull();
  });

  it('builds the over-budget outcome', () => {
    expect(overBudgetOutcome(setWith({ deferJs: ['x'] }), 'defer_all_js', 5)).toEqual({
      outcome: 'over-budget',
      feature: 'defer_all_js',
      row: 'x',
      budgetMs: 5
    });
  });
});

describe('createInProcessTransformRunner', () => {
  it('resolves the pipeline result', async () => {
    const runner = createInProcessTransformRunner(clock(0));
    await expect(runner(request(DELAYED))).resolves.toMatchObject({ ok: true });
  });

  it('defaults to the platform clock', async () => {
    await expect(createInProcessTransformRunner()(request(DELAYED))).resolves.toMatchObject({
      ok: true
    });
  });
});

describe('rewriteDocument', () => {
  const encoder = new TextEncoder();
  const runner = createInProcessTransformRunner(clock(0));
  const doc = (body: Uint8Array, contentType: string | null = 'text/html; charset=utf-8') => ({
    body,
    contentType,
    documentUrl: null
  });

  it('serves the re-encoded rewrite with its reports', async () => {
    const rewrite = await rewriteDocument(
      doc(encoder.encode(`<p>é</p>${DELAYED}`)),
      DELAY_SET,
      runner
    );
    const expected = applyPipeline(`<p>é</p>${DELAYED}`, DELAY_SET);
    expect(rewrite.outcome).toEqual({ outcome: 'rewritten', reports: expected.reports });
    expect(rewrite.body).toEqual(encoder.encode(expected.html));
  });

  it('serves the original bytes when the run changed nothing', async () => {
    const rewrite = await rewriteDocument(doc(encoder.encode('<p>x</p>')), DELAY_SET, runner);
    expect(rewrite.outcome.outcome).toBe('rewritten');
    expect(rewrite.body).toBeNull();
  });

  it('re-encodes in the original single-byte charset', async () => {
    const latin = Uint8Array.from(`<p>\xe9</p>${DELAYED}`, (char) => char.charCodeAt(0));
    const rewrite = await rewriteDocument(
      doc(latin, 'text/html; charset=windows-1252'),
      DELAY_SET,
      runner
    );
    const expected = applyPipeline(`<p>é</p>${DELAYED}`, DELAY_SET).html;
    expect(rewrite.body).toEqual(Uint8Array.from(expected, (char) => char.charCodeAt(0)));
  });

  it('serves unmodified as decode-failed when the charset cannot round-trip', async () => {
    const runnerSpy = vi.fn(runner);
    const sjis = await rewriteDocument(
      doc(encoder.encode(DELAYED), 'text/html; charset=shift_jis'),
      DELAY_SET,
      runnerSpy
    );
    expect(sjis).toEqual({ outcome: { outcome: 'failed', reason: 'decode-failed' }, body: null });
    const malformed = await rewriteDocument(doc(Uint8Array.of(0xff, 0x3c)), DELAY_SET, runnerSpy);
    expect(malformed.outcome).toEqual({ outcome: 'failed', reason: 'decode-failed' });
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it('serves unmodified as decode-failed when the rewrite cannot be re-encoded', async () => {
    const injecting: DocumentTransformRunner = (req) =>
      Promise.resolve({
        ok: true,
        html: `${req.html}日本`,
        outcome: { outcome: 'rewritten', reports: [] }
      });
    const latin = Uint8Array.from('<p>x</p>', (char) => char.charCodeAt(0));
    const rewrite = await rewriteDocument(
      doc(latin, 'text/html; charset=windows-1252'),
      DELAY_SET,
      injecting
    );
    expect(rewrite).toEqual({
      outcome: { outcome: 'failed', reason: 'decode-failed' },
      body: null
    });
  });

  it('refuses an oversized body as body-unavailable without decoding', async () => {
    const runnerSpy = vi.fn(runner);
    const rewrite = await rewriteDocument(
      doc(new Uint8Array(DOCUMENT_BODY_BYTE_LIMIT + 1)),
      DELAY_SET,
      runnerSpy
    );
    expect(rewrite).toEqual({
      outcome: { outcome: 'failed', reason: 'body-unavailable' },
      body: null
    });
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it('passes the over-budget outcome through unmodified', async () => {
    const overrun = createInProcessTransformRunner(clock(0, 10_000));
    const rewrite = await rewriteDocument(doc(encoder.encode(DELAYED)), DELAY_SET, overrun, 50);
    expect(rewrite).toEqual({
      outcome: { outcome: 'over-budget', feature: 'delay_js', row: 'a\\.js', budgetMs: 50 },
      body: null
    });
  });

  it('carries an engine failure cause for the log', async () => {
    const boom = new Error('boom');
    const failing: DocumentTransformRunner = () =>
      Promise.resolve({
        ok: false,
        outcome: { outcome: 'failed', reason: 'engine-failed' },
        cause: boom
      });
    const rewrite = await rewriteDocument(doc(encoder.encode(DELAYED)), DELAY_SET, failing);
    expect(rewrite).toEqual({
      outcome: { outcome: 'failed', reason: 'engine-failed' },
      body: null,
      cause: boom
    });
  });

  it('maps a rejecting runner to engine-failed', async () => {
    const boom = new Error('runner broke');
    const rejecting: DocumentTransformRunner = () => Promise.reject(boom);
    const rewrite = await rewriteDocument(doc(encoder.encode(DELAYED)), DELAY_SET, rejecting);
    expect(rewrite).toEqual({
      outcome: { outcome: 'failed', reason: 'engine-failed' },
      body: null,
      cause: boom
    });
  });

  it('hands the runner the decoded text, set, URL and default budget', async () => {
    const seen: DocumentTransformRequest[] = [];
    const recording: DocumentTransformRunner = (req) => {
      seen.push(req);
      return runner(req);
    };
    await rewriteDocument(
      { body: encoder.encode('<p>é</p>'), contentType: null, documentUrl: 'https://s.tld/' },
      DELAY_SET,
      recording
    );
    expect(seen).toEqual([
      {
        html: '<p>é</p>',
        set: DELAY_SET,
        documentUrl: 'https://s.tld/',
        budgetMs: DOCUMENT_TRANSFORM_BUDGET_MS
      }
    ]);
  });
});
