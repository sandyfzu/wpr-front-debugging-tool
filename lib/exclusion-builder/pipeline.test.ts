/**
 * The pipeline: ordered composition (order declared once), a combined
 * per-transform report for UI/status consumption, and the composition
 * mechanics proven with a fixture transform that imports nothing outside
 * this module.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPipeline,
  composeSteps,
  type Composition,
  type CompositionOutput,
  EXCLUSION_PIPELINE_IDS,
  EXCLUSION_PIPELINE_STEP_IDS,
  exclusionPipelineSteps,
  featureReports,
  runExclusionPipeline,
  type PipelineStep
} from './pipeline';
import { delayJsTransform } from './delay-js';
import { deferJsTransform } from './defer-js';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from './set';
import type { TransformReport } from './report';
import { ExclusionValidationError } from './errors';
import { ROW_REASONS } from './row-reasons';

/** A set with selected rows/toggles replaced (spread keeps the rest empty). */
function setWith(
  rows: Partial<ExclusionSet['rows']>,
  disable?: Partial<ExclusionSet['disable']>
): ExclusionSet {
  return {
    rows: { ...EMPTY_EXCLUSION_SET.rows, ...rows },
    disable: { ...EMPTY_EXCLUSION_SET.disable, ...disable }
  };
}

/**
 * The completed composition's output (an unhooked composition always
 * completes — anything else fails the test).
 */
function completed<R>(run: Composition<R>): CompositionOutput<R> {
  if (!run.completed) throw new Error(`composition stopped at ${run.stoppedAt}`);
  return { html: run.html, reports: run.reports };
}

describe('composeSteps', () => {
  /** A fixture transform: strips one `<!--FIDX-->` comment per apply. */
  const fixtureStep = (report: { stripped: number }): PipelineStep<{ stripped: number }> => ({
    id: 'fixture-strip',
    apply: (html: string) => {
      const marker = '<!--FIDX-->';
      const stripped = html.split(marker).length - 1;
      report.stripped += stripped;
      return { html: html.split(marker).join(''), report };
    }
  });

  it('chains the html through the steps in order and collects their reports', () => {
    const report = { stripped: 0 };
    // Heterogeneous report shapes — composition is generic over the report type.
    const steps: PipelineStep<unknown>[] = [
      { id: 'upper', apply: (html) => ({ html: html.replace('b', 'B'), report: { uppered: 1 } }) },
      fixtureStep(report)
    ];
    const result = completed(composeSteps('a<!--FIDX-->b<!--FIDX-->c', steps));
    // The renamed `B` proves the rename ran first; both markers stripped proves the
    // fixture step consumed its predecessor's output.
    expect(result.html).toBe('aBc');
    expect(result.reports).toEqual([{ uppered: 1 }, { stripped: 2 }]);
    expect(report.stripped).toBe(2);
  });

  it("feeds each step the previous step's output — a later step sees an earlier step's rewrite", () => {
    const steps: PipelineStep<unknown>[] = [
      { id: 'rename', apply: (html) => ({ html: html.replace('one', 'two'), report: null }) },
      {
        id: 'observe',
        apply: (html) => ({ html, report: html.includes('two') ? 'saw-two' : 'missed' })
      }
    ];
    const result = completed(composeSteps('<p>one</p>', steps));
    expect(result.reports).toEqual([null, 'saw-two']);
  });

  it('is the identity for an empty step list', () => {
    const html = '<p>x</p>';
    expect(composeSteps(html, [])).toEqual({ completed: true, html, reports: [] });
  });
});

describe('EXCLUSION_PIPELINE_IDS', () => {
  it('declares the execution order once — delay, defer, lazy render, lazyload', () => {
    expect(EXCLUSION_PIPELINE_IDS).toEqual([
      'delay_js',
      'defer_all_js',
      'automatic_lazy_rendering',
      'lazyload'
    ]);
  });
});

describe('applyPipeline', () => {
  it("refuses a set outside WP Rocket's stored form, naming every such row", () => {
    // WP Rocket dedupes before joining Defer rows: undeduped, two identical
    // named-group rows read as a page-wide failure it never has.
    const html = '<script src="a.js" data-rocket-defer defer></script>';
    const set = setWith({ deferJs: ["(?'n'a)", "(?'n'a)"], delayJs: [' a\\.js'] });
    let thrown: unknown;
    try {
      applyPipeline(html, set);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ExclusionValidationError);
    expect((thrown as ExclusionValidationError).invalid).toEqual([
      { feature: 'delay_js', index: 0, row: ' a\\.js', reason: ROW_REASONS.notStored },
      { feature: 'defer_all_js', index: 1, row: "(?'n'a)", reason: ROW_REASONS.notStored }
    ]);
  });

  it('reads the stored form of that set as WP Rocket does: one row, judged alone', () => {
    const html = '<script src="a.js" data-rocket-defer defer></script>';
    expect(() => applyPipeline(html, setWith({ deferJs: ["(?'n'a)"] }))).toThrow(
      /PCRE-only syntax/
    );
    expect(applyPipeline(html, setWith({ deferJs: ['a\\.js'] })).reports).toHaveLength(4);
  });

  it('is the identity for an empty set on any document, with a zeroed report per transform', () => {
    const html = `<script type="rocketlazyloadscript" data-rocket-src="a.js" data-rocket-defer defer></script>`;
    const result = applyPipeline(html, EMPTY_EXCLUSION_SET);
    expect(result.html).toBe(html);
    expect(
      result.reports.map((report) => [report.feature, report.candidates, report.rewritten])
    ).toEqual([
      ['delay_js', 1, 0],
      ['defer_all_js', 1, 0],
      ['automatic_lazy_rendering', 0, 0],
      ['lazyload', 0, 0]
    ]);
  });

  it('applies every feature in one pass and stamps the marker as CSV across transforms', () => {
    const html = [
      '<!DOCTYPE html><html><head><style id="rocket-lazyrender-inline-css">[data-wpr-lazyrender] {content-visibility: auto;}</style></head><body>',
      '<script type="rocketlazyloadscript" data-rocket-src="combo.js" data-rocket-defer defer></script>',
      '<img src="ph.gif" data-lazy-src="photo.jpg">',
      '<div data-wpr-lazyrender="1" class="pagination"><ul>1</ul></div>',
      '</body></html>'
    ].join('');
    const result = applyPipeline(
      html,
      setWith({
        delayJs: ['combo\\.js'],
        deferJs: ['combo\\.js'],
        lazyload: ['photo.jpg'],
        lazyRender: ['pagination']
      })
    );
    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).not.toContain('rocketlazyloadscript');
    expect(result.html).not.toContain('data-rocket-src');
    expect(result.html).not.toContain('data-rocket-defer');
    expect(result.html).toContain(
      '<script src="combo.js" data-wpr-fdt-excluded="delay_js, defer_all_js"></script>'
    );
    expect(result.html).toContain('src="photo.jpg" data-wpr-fdt-excluded="lazyload"');
    expect(result.html).toContain('<ul>1</ul>');
    // A row-matched element loses its stamp; the inline CSS is a feature-wide
    // removal — it legitimately remains on a row-matched run.
    expect(result.html).toContain(
      '<div class="pagination" data-wpr-fdt-excluded="automatic_lazy_rendering">'
    );
    expect(result.html).toContain('rocket-lazyrender-inline-css');
    expect(result.reports.map((report) => [report.feature, report.rewritten])).toEqual([
      ['delay_js', 1],
      ['defer_all_js', 1],
      ['automatic_lazy_rendering', 1],
      ['lazyload', 1]
    ]);
  });

  it('lets a feature-wide disable override its rows and reports the mode honestly', () => {
    const html = '<script type="rocketlazyloadscript" data-rocket-src="a.js"></script>';
    const result = applyPipeline(html, setWith({ delayJs: ['never-matches'] }, { delayJs: true }));
    expect(result.html).toContain('src="a.js"');
    expect(result.reports[0]).toMatchObject({
      feature: 'delay_js',
      featureWide: true,
      rewritten: 1
    });
  });

  it('throws the typed error naming every invalid row across features before any transform runs', () => {
    const throws = (): unknown =>
      applyPipeline('<p>x</p>', setWith({ delayJs: ['(bad['], deferJs: ['(also-bad['] }));
    expect(throws).toThrow(/delay_js\[0\]|defer_all_js\[0\]/);
    try {
      throws();
    } catch (error) {
      const validationError = error as { invalid?: Array<{ feature: string }> };
      expect(validationError.invalid?.map((problem) => problem.feature)).toEqual([
        'delay_js',
        'defer_all_js'
      ]);
    }
  });

  it("keeps the document's bytes untouched outside the rewrites (decode/encode is the backends' job)", () => {
    const html = `<!doctype html><p>\uD800\u{1F600}&#038;</p><script type="rocketlazyloadscript" data-rocket-src="a.js"></script>`;
    const result = applyPipeline(html, setWith({ delayJs: ['a\\.js'] }));
    expect(result.html.startsWith('<!doctype html><p>\uD800\u{1F600}&#038;</p>')).toBe(true);
    expect(result.html).toContain('&#038;');
  });

  it('composes the real transforms with a fixture step through the same generic seam', () => {
    // The seam a session backend (or a later tester mode) plugs into: a
    // trivially different operation rides the same composition mechanics.
    const delayStep: PipelineStep<TransformReport> = {
      id: 'delay_js',
      apply: (html: string) => {
        const result = delayJsTransform(html, setWith({ delayJs: ['combo\\.js'] }));
        return { html: result.html, report: result.report };
      }
    };
    const fixtureStep: PipelineStep<{ stripped: number }> = {
      id: 'fixture-strip-style',
      apply: (html: string) => ({
        html: html.replace('<style>gone</style>', ''),
        report: { stripped: 1 }
      })
    };
    // Heterogeneous reports — the seam is generic over the report type.
    const steps: PipelineStep<unknown>[] = [fixtureStep, delayStep];
    const result = completed(
      composeSteps(
        '<style>gone</style><script type="rocketlazyloadscript" data-rocket-src="combo.js"></script>',
        steps
      )
    );
    expect(result.html).toBe('<script src="combo.js" data-wpr-fdt-excluded="delay_js"></script>');
    expect(result.reports[0]).toEqual({ stripped: 1 });
    expect(result.reports[1]).toMatchObject({ feature: 'delay_js', rewritten: 1 });
  });

  it('report order is the declared pipeline order regardless of set construction', () => {
    const reports = applyPipeline('<p>x</p>', setWith({ lazyload: ['a.jpg'] })).reports;
    expect(reports.map((report) => report.feature)).toEqual([
      'delay_js',
      'defer_all_js',
      'automatic_lazy_rendering',
      'lazyload'
    ]);
  });

  // The per-transform semantics are pinned in their own suites; the pipeline
  // only guarantees composition, so defer/lazyload arms here stay light.
  it("threads the transforms' independence — an unmatched feature rewrites nothing", () => {
    const html = '<script src="a.js" data-rocket-defer="defer" defer></script>';
    const result = applyPipeline(html, setWith({ deferJs: ['other\\.js'], lazyload: ['a.jpg'] }));
    expect(result.html).toBe(html);
  });
});

describe('direct single-feature use', () => {
  it('exposes the transforms for direct use outside the pipeline', () => {
    const html = '<script type="rocketlazyloadscript" data-rocket-src="a.js"></script>';
    const delayResult = delayJsTransform(html, setWith({ delayJs: ['a\\.js'] }));
    expect(delayResult.report.feature).toBe('delay_js');
    expect(delayResult.html).toContain('src="a.js"');
    const deferResult = deferJsTransform(html, setWith({ deferJs: ['a\\.js'] }));
    // The delayed script carries no defer marker — the defer transform is a no-op on it.
    expect(deferResult.report.candidates).toBe(0);
  });
});

describe('exclusionPipelineSteps', () => {
  const RELATIVE = '<script src="js/a.js" data-rocket-defer defer></script>';

  it('yields the inline-pass replay as Defer JS, then one step per feature in the declared order', () => {
    const ids = exclusionPipelineSteps(EMPTY_EXCLUSION_SET).map((step) => step.id);
    expect(ids).toEqual(['defer_all_js', ...EXCLUSION_PIPELINE_IDS]);
    expect(ids).toEqual(EXCLUSION_PIPELINE_STEP_IDS);
  });

  it('gives the replay step no report of its own (Defer JS reports the pass)', () => {
    const [replay] = exclusionPipelineSteps(EMPTY_EXCLUSION_SET);
    expect(replay?.apply('<p>x</p>')).toEqual({ html: '<p>x</p>', report: null });
  });

  it('composes to exactly what applyPipeline returns', () => {
    const html = '<script type="rocketlazyloadscript" data-rocket-src="a.js"></script>';
    const set = setWith({ delayJs: ['a\\.js'] });
    const composed = completed(composeSteps(html, exclusionPipelineSteps(set)));
    expect({ html: composed.html, reports: featureReports(composed.reports) }).toEqual(
      applyPipeline(html, set)
    );
  });

  it('matches Defer JS rows against the raw src, never a resolved URL (as WP Rocket does)', () => {
    const resolvedRow = setWith({ deferJs: ['^https://s\\.tld/js/a\\.js$'] });
    const steps = exclusionPipelineSteps(resolvedRow);
    expect(completed(composeSteps(RELATIVE, steps)).reports[1]?.rewritten).toBe(0);
    expect(applyPipeline(RELATIVE, resolvedRow).reports[1]?.rewritten).toBe(0);
    const rawRow = setWith({ deferJs: ['^js/a\\.js$'] });
    expect(applyPipeline(RELATIVE, rawRow).reports[1]?.rewritten).toBe(1);
  });
});

describe('the Defer JS inline pass across Delay JS (WP Rocket 3.23.5.1, run)', () => {
  // Served with no rows: Defer JS wrapped both copies (its tag match ends at
  // the first `>`, so the wrapper starts in the attribute), Delay JS delayed both.
  const open = "window.addEventListener('DOMContentLoaded', function() {";
  const delayed = `<script type="text/rocketlazyloadscript" data-x=">${open}jQuery">>jQuery(1)});</script>`;
  const SERVED = `${delayed}<!-- ${delayed} -->`;

  it('undoes the wrapping before Delay JS restores, so every copy comes back', () => {
    const set = setWith({ deferJs: ['JQUERY.JS'], delayJs: ['data-x'] });
    const { html, reports } = applyPipeline(SERVED, set);
    // WP Rocket serves `<script data-x=">jQuery">>jQuery(1)</script>` for both
    // copies; Delay JS restores never reach inside a comment (that copy stays delayed).
    expect(html).toBe(
      '<script data-x=">jQuery" data-wpr-fdt-excluded="delay_js">>jQuery(1)</script>' +
        '<!-- <script type="text/rocketlazyloadscript" data-x=">jQuery">>jQuery(1)</script> -->'
    );
    expect(reports[1]).toMatchObject({ feature: 'defer_all_js', inlineUnwrapped: 1 });
  });

  it('leaves the wrapping and reports it undetermined when the live rows decide', () => {
    const { html, reports } = applyPipeline(SERVED, setWith({ deferJs: ['foo.js'] }));
    expect(html).toBe(SERVED);
    expect(reports[1]).toMatchObject({ feature: 'defer_all_js', undetermined: 1 });
  });

  it('flags a wrapper spanning scripts instead of guessing its bodies', () => {
    // `<script id="i1">jQuery(1)</script >` + an empty `f.js` script: WP Rocket
    // wraps across both, Delay JS rewrites the end tags. Under `jquery.min.js`
    // it serves i1 = `jQuery(1)` and f empty — not readable from this page.
    const delayedTag = '<script type="text/rocketlazyloadscript"';
    const spanned =
      `${delayedTag} id="i1">${open}jQuery(1)</script>\n` +
      `${delayedTag} data-rocket-src="/f.js" id="f" data-rocket-defer defer>});</script>`;
    const set = setWith({ deferJs: ['jquery.min.js'], delayJs: ['\\{jQuery'] });
    const { html, reports } = applyPipeline(spanned, set);
    expect(html).toBe(spanned);
    expect(reports[0]).toMatchObject({ feature: 'delay_js', rewritten: 0, undetermined: 1 });
    expect(reports[1]).toMatchObject({
      feature: 'defer_all_js',
      candidates: 2,
      rewritten: 0,
      // Both left as served: i1, and f holding the closing.
      undetermined: 2
    });
    // Not the live-rows caveat: the rows decide nothing here.
    expect(reports[1]?.inlineUndetermined).toBeUndefined();
  });

  it('pins the named residual r2b: a whole wrapper spanning to a script with a body of its own', () => {
    // Source `<script id="i1">jQuery(function(){});</script >` + `<script
    // id="g">var a=1;</script>`, served by WP Rocket 3.23.5.1 (run) through
    // Defer JS and Delay JS: the wrapper opens in i1 and closes in g, yet i1
    // reads exactly like one whole wrapper. Under `jquery.min.js` + Delay row
    // `a=1;\}\);` WP Rocket keeps both delayed: i1 as `jQuery(function(){});`,
    // g as `var a=1;`. The engine cannot tell this page from a
    // whole wrapper followed by a script ending in `});` (common), so it
    // answers as for that page — this test pins that known wrong answer.
    const delayedTag = '<script type="text/rocketlazyloadscript"';
    const served =
      `${delayedTag} id="i1">${open}jQuery(function(){});</script>\n` +
      `${delayedTag} id="g">var a=1;});</script>`;
    const set = setWith({ deferJs: ['jquery.min.js'], delayJs: ['a=1;\\}\\);'] });
    const { html, reports } = applyPipeline(served, set);
    expect(html).toBe(
      `${delayedTag} id="i1">jQuery(function(){</script>\n` +
        '<script id="g" data-wpr-fdt-excluded="delay_js">var a=1;});</script>'
    );
    // No lane flags it: a confident answer.
    expect(reports.every((report) => (report.undetermined ?? 0) === 0)).toBe(true);
  });
});

describe('runExclusionPipeline (the one path applyPipeline and the session run)', () => {
  const html = '<script type="rocketlazyloadscript" data-rocket-src="a.js"></script>';
  const set = setWith({ delayJs: ['a\\.js'] });

  it('completes unhooked with exactly what applyPipeline returns', () => {
    expect(runExclusionPipeline(html, set)).toEqual({
      completed: true,
      ...applyPipeline(html, set)
    });
  });

  it('calls onStepStart then stopAfter once per step, in step order', () => {
    const calls: string[] = [];
    runExclusionPipeline(html, set, {
      onStepStart: (id) => calls.push(`start:${id}`),
      stopAfter: (id) => {
        calls.push(`after:${id}`);
        return false;
      }
    });
    expect(calls).toEqual(
      EXCLUSION_PIPELINE_STEP_IDS.flatMap((id) => [`start:${id}`, `after:${id}`])
    );
  });

  it('stops at the step stopAfter first answers true for, running no later step', () => {
    const started: string[] = [];
    let after = 0;
    const run = runExclusionPipeline(html, set, {
      onStepStart: (id) => started.push(id),
      stopAfter: () => ++after === 3
    });
    expect(run).toEqual({ completed: false, stoppedAt: EXCLUSION_PIPELINE_STEP_IDS[2] });
    expect(started).toEqual(EXCLUSION_PIPELINE_STEP_IDS.slice(0, 3));
  });

  it('throws every invalid row before any step starts', () => {
    const started: string[] = [];
    expect(() =>
      runExclusionPipeline('<p>x</p>', setWith({ delayJs: ['(bad['] }), {
        onStepStart: (id) => started.push(id)
      })
    ).toThrow(ExclusionValidationError);
    expect(started).toEqual([]);
  });
});

describe('composeSteps under a host budget (a clock that advances inside each step)', () => {
  const BUDGET_MS = 100;

  /**
   * Steps that each advance a fake clock by their cost while they run,
   * composed with the budget check a session host passes as `stopAfter`.
   */
  function budgetedRun(costs: readonly number[]): Composition<null> {
    let clockMs = 0;
    const steps: PipelineStep<null>[] = costs.map((cost, index) => ({
      id: `step-${String(index)}`,
      apply: (html) => {
        clockMs += cost;
        return { html: `${html}${String(index)}`, report: null };
      }
    }));
    return composeSteps('', steps, { stopAfter: () => clockMs > BUDGET_MS });
  }

  it('names the step whose own work crosses the budget, never the next one', () => {
    // Cumulative 10, 40, 110: step 2 crosses it (a check before the step would name step 3).
    expect(budgetedRun([10, 30, 70, 5])).toEqual({ completed: false, stoppedAt: 'step-2' });
  });

  it('reports an overrun in the last step (no later check exists to catch it)', () => {
    expect(budgetedRun([10, 10, 10, 90])).toEqual({ completed: false, stoppedAt: 'step-3' });
  });

  it('completes a run that ends exactly at the budget', () => {
    expect(budgetedRun([25, 25, 25, 25])).toEqual({
      completed: true,
      html: '0123',
      reports: [null, null, null, null]
    });
  });
});

describe('runExclusionPipeline — decoding facts', () => {
  // A non-stamped parent is matched as libxml re-serializes it: UTF-8 bytes
  // without a BOM (no charset meta) read as Latin-1 (`été` → `Ã©tÃ©`, no
  // match); after a UTF-8 BOM libxml reads UTF-8 and the row matches.
  const html =
    '<html><body><div class="été"><div data-wpr-lazyrender="1">x</div></div></body></html>';
  const set = setWith({ lazyRender: ['été'] });
  const lazyRenderRewritten = (reports: readonly TransformReport[]): number | undefined =>
    reports.find((report) => report.feature === 'automatic_lazy_rendering')?.rewritten;

  it('reads the page through `bytes`: a BOM changes what the rows match', () => {
    const plain = completed(runExclusionPipeline(html, set));
    const bom = completed(
      runExclusionPipeline(html, set, { bytes: { encoding: 'utf-8', bom: true } })
    );
    expect(lazyRenderRewritten(plain.reports)).toBe(0);
    expect(plain.html).toBe(html);
    expect(lazyRenderRewritten(bom.reports)).toBe(1);
    expect(bom.html).not.toContain('data-wpr-lazyrender');
  });
});
