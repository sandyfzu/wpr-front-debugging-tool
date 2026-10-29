/**
 * The document step: the budgeted pipeline (rewritten / over-budget per
 * step / engine-failed), overrun row attribution, and the byte-level
 * rewrite (size guard, charset round trip, unchanged runs, runner faults).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  applyPipeline,
  EXCLUSION_PIPELINE_STEP_IDS,
  runExclusionPipeline
} from '../exclusion-builder/pipeline';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../exclusion-builder/set';
import { BUILDER_MARKER_META_NAME } from '../wp-rocket/constants';
import {
  createInProcessTransformRunner,
  DOCUMENT_BODY_BYTE_LIMIT,
  isRewritableResponse,
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
  return { html, set, budgetMs: 100 };
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

  it('announces every step in pipeline order (the inline-pass replay as Defer JS)', () => {
    const started: string[] = [];
    runDocumentPipeline(request(DELAYED), clock(0), (feature) => started.push(feature));
    expect(started).toEqual(EXCLUSION_PIPELINE_STEP_IDS);
  });

  it.each(EXCLUSION_PIPELINE_STEP_IDS.map((feature, index) => [feature, index] as const))(
    'names %s when step %i crosses the budget',
    (feature, index) => {
      // Readings: start, then one per finished step; the crossing step reads 101.
      const readings = [
        0,
        ...EXCLUSION_PIPELINE_STEP_IDS.map((_, step) => (step < index ? 1 : 101))
      ];
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

  it("hands the engine the request's decoding facts (a BOM changes what the rows match)", () => {
    // Without a BOM libxml reads the parent's UTF-8 `été` as Latin-1 and the row misses it.
    const html =
      '<html><body><div class="été"><div data-wpr-lazyrender="1">x</div></div></body></html>';
    const set = setWith({ lazyRender: ['été'] });
    const bytes = { encoding: 'utf-8', bom: true };
    const withBom = runDocumentPipeline({ ...request(html, set), bytes }, clock(0));
    const plain = runDocumentPipeline(request(html, set), clock(0));
    const engine = runExclusionPipeline(html, set, { bytes });
    expect(engine.completed && engine.html).not.toBe(html);
    expect(withBom).toMatchObject({ ok: true, html: engine.completed && engine.html });
    expect(plain).toMatchObject({ ok: true, html });
  });

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

  it("refuses a set outside WP Rocket's stored form as engine-failed, never running it", () => {
    const set = setWith({ delayJs: ['a\\.js', 'a\\.js'] });
    const result = runDocumentPipeline(request(DELAYED, set), clock(0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome).toEqual({ outcome: 'failed', reason: 'engine-failed' });
    expect(result.cause).toMatchObject({
      name: 'ExclusionValidationError',
      invalid: [{ feature: 'delay_js', index: 1, row: 'a\\.js' }]
    });
  });

  it('rewrites a set whose rows only warn, as WP Rocket applies them', () => {
    const html = `${DELAYED}<script src="b.js" data-rocket-defer defer></script>`;
    // `(?a)` matches every script; `.*` makes Defer JS defer nothing on the page.
    const set = setWith({ delayJs: ['(?a)'], deferJs: ['.*'] });
    const result = runDocumentPipeline(request(html, set), clock(0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toContain('rocketlazyloadscript');
    expect(result.html).not.toContain('data-rocket-defer');
    const [delay, defer] = result.outcome.reports;
    expect(delay).toMatchObject({ rewritten: 1, matchAllRows: ['(?a)'] });
    expect(defer).toMatchObject({ rewritten: 1, pageState: 'off', pageOffRows: ['.*'] });
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

  it('matches Defer JS rows against the raw src, never the URL resolved against the document', () => {
    const html = '<script src="js/a.js" data-rocket-defer defer></script>';
    const resolvedRow = setWith({ deferJs: ['^https://s\\.tld/js/a\\.js$'] });
    const resolved = runDocumentPipeline(request(html, resolvedRow), clock(0));
    expect(resolved.ok && resolved.html).toBe(html);
    const rawRow = setWith({ deferJs: ['^js/a\\.js$'] });
    const raw = runDocumentPipeline(request(html, rawRow), clock(0));
    expect(raw.ok && raw.html).not.toBe(html);
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

describe('runDocumentPipeline: the builder marker step', () => {
  const served = `<meta name="${BUILDER_MARKER_META_NAME}" content="v1 lazyload=excluded:9">`;
  const page = `<html><head>${served}</head><body>${DELAYED}</body></html>`;
  const ours = `<meta name="${BUILDER_MARKER_META_NAME}" content="v1 delay_js=excluded:1">`;

  it('ends a run within budget with the marker for what the features changed', () => {
    const result = runDocumentPipeline(request(page), clock(0));
    expect(result.ok && result.html).toBe(
      `<html><head>${ours}</head><body>${applyPipeline(DELAYED, DELAY_SET).html}</body></html>`
    );
  });

  it('never runs on an over-budget document: its original bytes, served copy included, are served', async () => {
    const encoder = new TextEncoder();
    const overrun = createInProcessTransformRunner(clock(0, 10_000));
    const rewrite = await rewriteDocument(
      { body: encoder.encode(page), contentType: 'text/html' },
      DELAY_SET,
      overrun,
      50
    );
    expect(rewrite.outcome.outcome).toBe('over-budget');
    expect(rewrite.body).toBeNull();
  });

  it('serves the rewrite when only a served copy was removed (the document changed)', async () => {
    const encoder = new TextEncoder();
    const html = `<html><head>${served}</head><body><p>x</p></body></html>`;
    const rewrite = await rewriteDocument(
      { body: encoder.encode(html), contentType: 'text/html' },
      DELAY_SET,
      createInProcessTransformRunner(clock(0))
    );
    expect(rewrite.body).toEqual(encoder.encode('<html><head></head><body><p>x</p></body></html>'));
    expect(rewrite).not.toHaveProperty('rulesOnly');
  });
});

describe('rewriteDocument', () => {
  const encoder = new TextEncoder();
  const runner = createInProcessTransformRunner(clock(0));
  const doc = (body: Uint8Array, contentType: string | null = 'text/html; charset=utf-8') => ({
    body,
    contentType
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

  it('serves unmodified as encode-failed when the rewrite cannot be re-encoded', async () => {
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
      outcome: { outcome: 'failed', reason: 'encode-failed' },
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
    // The first step (the Defer JS inline-pass replay) crosses: Defer JS, no row of its own.
    const overrun = createInProcessTransformRunner(clock(0, 10_000));
    const rewrite = await rewriteDocument(doc(encoder.encode(DELAYED)), DELAY_SET, overrun, 50);
    expect(rewrite).toEqual({
      outcome: { outcome: 'over-budget', feature: 'defer_all_js', row: null, budgetMs: 50 },
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

  describe('speculation rules (a session effect, whatever the engine did)', () => {
    const RULES = '<script type="speculationrules">{"prefetch":[]}</script>';
    const latin1 = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

    it('removes them even when the exclusions changed nothing', async () => {
      const rewrite = await rewriteDocument(
        doc(encoder.encode(`<p>é</p>${RULES}`)),
        DELAY_SET,
        runner
      );
      expect(rewrite.outcome.outcome).toBe('rewritten');
      expect(rewrite.body).toEqual(encoder.encode('<p>é</p>'));
      expect(rewrite.speculationRulesRemoved).toBe(1);
      // Only the rules changed: a copy-serving backend serves the original instead.
      expect(rewrite.rulesOnly).toBe(true);
    });

    it('removes them alongside the exclusions, in a single-byte charset', async () => {
      const rewrite = await rewriteDocument(
        doc(latin1(`<p>\xe9</p>${RULES}${DELAYED}`), 'text/html; charset=windows-1252'),
        DELAY_SET,
        runner
      );
      const expected = applyPipeline(`<p>é</p>${DELAYED}`, DELAY_SET).html;
      expect(rewrite.body).toEqual(latin1(expected));
      expect(rewrite.speculationRulesRemoved).toBe(1);
      expect(rewrite).not.toHaveProperty('rulesOnly');
    });

    it('removes them from the original when the engine overran or failed', async () => {
      const overrun = createInProcessTransformRunner(clock(0, 10_000));
      const over = await rewriteDocument(
        doc(encoder.encode(`${RULES}${DELAYED}`)),
        DELAY_SET,
        overrun,
        50
      );
      expect(over.outcome.outcome).toBe('over-budget');
      expect(over.body).toEqual(encoder.encode(DELAYED));
      const boom = new Error('boom');
      const failing: DocumentTransformRunner = () =>
        Promise.resolve({
          ok: false,
          outcome: { outcome: 'failed', reason: 'engine-failed' },
          cause: boom
        });
      const failed = await rewriteDocument(
        doc(encoder.encode(`${RULES}${DELAYED}`)),
        DELAY_SET,
        failing
      );
      expect(failed).toEqual({
        outcome: { outcome: 'failed', reason: 'engine-failed' },
        body: encoder.encode(DELAYED),
        speculationRulesRemoved: 1,
        rulesOnly: true,
        cause: boom
      });
    });

    it('serves the original without its rules when the rewrite cannot be re-encoded', async () => {
      const injecting: DocumentTransformRunner = (req) =>
        Promise.resolve({
          ok: true,
          html: `${req.html}日本`,
          outcome: { outcome: 'rewritten', reports: [] }
        });
      const rewrite = await rewriteDocument(
        doc(latin1(`<p>x</p>${RULES}`), 'text/html; charset=windows-1252'),
        DELAY_SET,
        injecting
      );
      expect(rewrite).toEqual({
        outcome: { outcome: 'failed', reason: 'encode-failed' },
        body: latin1('<p>x</p>'),
        speculationRulesRemoved: 1,
        rulesOnly: true
      });
    });

    it('never touches a body it cannot decode', async () => {
      const rewrite = await rewriteDocument(
        doc(encoder.encode(RULES), 'text/html; charset=shift_jis'),
        DELAY_SET,
        runner
      );
      expect(rewrite).toEqual({
        outcome: { outcome: 'failed', reason: 'decode-failed' },
        body: null
      });
    });
  });

  it('hands the runner the decoded text, set, default budget and decoding facts', async () => {
    const seen: DocumentTransformRequest[] = [];
    const recording: DocumentTransformRunner = (req) => {
      seen.push(req);
      return runner(req);
    };
    await rewriteDocument(
      { body: encoder.encode('<p>é</p>'), contentType: null },
      DELAY_SET,
      recording
    );
    expect(seen).toEqual([
      {
        html: '<p>é</p>',
        set: DELAY_SET,
        budgetMs: DOCUMENT_TRANSFORM_BUDGET_MS,
        bytes: { encoding: 'utf-8', bom: false }
      }
    ]);
  });

  it('tells the runner when a BOM led the bytes, and the encoding the text was decoded with', async () => {
    const seen: DocumentTransformRequest[] = [];
    const recording: DocumentTransformRunner = (req) => {
      seen.push(req);
      return runner(req);
    };
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('<p>x</p>')]);
    await rewriteDocument({ body: bom, contentType: null }, DELAY_SET, recording);
    await rewriteDocument(
      {
        body: new Uint8Array([0x3c, 0x70, 0x3e, 0xe9]),
        contentType: 'text/html; charset=windows-1252'
      },
      DELAY_SET,
      recording
    );
    expect(seen.map((req) => req.bytes)).toEqual([
      { encoding: 'utf-8', bom: true },
      { encoding: 'windows-1252', bom: false }
    ]);
  });
});

describe('isRewritableResponse', () => {
  const html = { status: 200, method: 'GET', contentType: 'text/html; charset=utf-8' };

  it.each([
    ['a 200 GET HTML page', html],
    ['a case-insensitive essence', { ...html, contentType: 'Text/HTML' }],
    ['the last valid type of a combined header', { ...html, contentType: 'text/plain, text/html' }],
    ['a POST result page', { ...html, method: 'POST' }],
    ['a themed 404', { ...html, status: 404 }],
    ['a 500 error page', { ...html, status: 500 }],
    ['the lowest final status', { ...html, status: 200 }],
    ['the highest status', { ...html, status: 599 }]
  ])('rewrites %s', (_case, response) => {
    expect(isRewritableResponse(response)).toBe(true);
  });

  it.each([
    ['plain text', { ...html, contentType: 'text/plain' }],
    ['JSON (REST API)', { ...html, contentType: 'application/json; charset=UTF-8' }],
    ['an RSS feed', { ...html, contentType: 'application/rss+xml; charset=UTF-8' }],
    ['SVG', { ...html, contentType: 'image/svg+xml' }],
    ['XHTML (draconian XML parsing)', { ...html, contentType: 'application/xhtml+xml' }],
    ['a missing type (the browser sniffs)', { ...html, contentType: null }],
    ['an unparsable type', { ...html, contentType: 'html' }],
    ['HTML followed by another type', { ...html, contentType: 'text/html, text/plain' }],
    ['a redirect', { ...html, status: 302 }],
    ['the first 3xx', { ...html, status: 300 }],
    ['the last 3xx', { ...html, status: 399 }],
    ['204 No Content', { ...html, status: 204 }],
    ['205 Reset Content', { ...html, status: 205 }],
    ['206 Partial Content (a fragment)', { ...html, status: 206 }],
    ['304 Not Modified', { ...html, status: 304 }],
    ['an informational status', { ...html, status: 199 }],
    ['an out-of-range status', { ...html, status: 600 }],
    ['a non-integer status', { ...html, status: 200.5 }],
    ['a HEAD request', { ...html, method: 'HEAD' }],
    ['a lowercase head request', { ...html, method: 'head' }]
  ])('passes %s through', (_case, response) => {
    expect(isRewritableResponse(response)).toBe(false);
  });
});

describe('overBudgetOutcome: the simulate stage', () => {
  it('names the stage and no row, even when the feature holds one row', () => {
    expect(overBudgetOutcome(setWith({ delayJs: ['x'] }), 'delay_js', 5, 'simulate')).toEqual({
      outcome: 'over-budget',
      feature: 'delay_js',
      row: null,
      budgetMs: 5,
      stage: 'simulate'
    });
  });
});
