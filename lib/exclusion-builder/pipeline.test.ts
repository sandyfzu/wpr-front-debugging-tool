/**
 * The pipeline: ordered composition (order declared once), a combined
 * per-transform report for UI/status consumption, and the composition
 * mechanics proven with a fixture transform that imports nothing outside
 * this module.
 */
import { describe, expect, it } from 'vitest';
import { applyPipeline, composeSteps, EXCLUSION_PIPELINE_IDS, type PipelineStep } from './pipeline';
import { delayJsTransform } from './delay-js';
import { deferJsTransform } from './defer-js';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from './set';
import type { TransformReport } from './report';

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
    const result = composeSteps('a<!--FIDX-->b<!--FIDX-->c', steps);
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
    const result = composeSteps('<p>one</p>', steps);
    expect(result.reports).toEqual([null, 'saw-two']);
  });

  it('is the identity for an empty step list', () => {
    const html = '<p>x</p>';
    expect(composeSteps(html, [])).toEqual({ html, reports: [] });
  });
});

describe('EXCLUSION_PIPELINE_IDS', () => {
  it('declares the execution order once — delay, defer, lazyload, lazy render', () => {
    expect(EXCLUSION_PIPELINE_IDS).toEqual([
      'delay_js',
      'defer_all_js',
      'lazyload',
      'automatic_lazy_rendering'
    ]);
  });
});

describe('applyPipeline', () => {
  it('is the identity for an empty set on any document, with a zeroed report per transform', () => {
    const html = `<script type="rocketlazyloadscript" data-rocket-src="a.js" data-rocket-defer defer></script>`;
    const result = applyPipeline(html, EMPTY_EXCLUSION_SET);
    expect(result.html).toBe(html);
    expect(
      result.reports.map((report) => [report.feature, report.candidates, report.rewritten])
    ).toEqual([
      ['delay_js', 1, 0],
      ['defer_all_js', 1, 0],
      ['lazyload', 0, 0],
      ['automatic_lazy_rendering', 0, 0]
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
      '<script src="combo.js" data-wpr-fdt-excluded="delay_js,defer_all_js"></script>'
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
      ['lazyload', 1],
      ['automatic_lazy_rendering', 1]
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
      applyPipeline('<p>x</p>', setWith({ delayJs: ['(bad['], lazyRender: ['(also-bad['] }));
    expect(throws).toThrow(/delay_js\[0\]|automatic_lazy_rendering\[0\]/);
    try {
      throws();
    } catch (error) {
      const validationError = error as { invalid?: Array<{ feature: string }> };
      expect(validationError.invalid?.map((problem) => problem.feature)).toEqual([
        'delay_js',
        'automatic_lazy_rendering'
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
    const result = composeSteps(
      '<style>gone</style><script type="rocketlazyloadscript" data-rocket-src="combo.js"></script>',
      steps
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
      'lazyload',
      'automatic_lazy_rendering'
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
