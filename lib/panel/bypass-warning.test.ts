/**
 * The "applied despite ?nowprocket" warning on the Detections cards and the
 * support report, over real plugin renders: footprint-decided applied rows
 * of a bypass URL warn; the same page off a bypass URL, a meta-decided page
 * on one and any simulated row never do. The card verdict never changes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BYPASS_APPLIED_COPY } from '../detection/bypass-applied';
import { FIXTURE_DIR } from '../detection/fixtures/corpus';
import { LABEL_MINIFY_JAVASCRIPT } from '../detection/labels';
import { parsePage } from '../detection/parse-page';
import { applyPresencePropagation, runChecks } from '../detection/run-detection';
import { withSimulationMarker } from '../detection/simulated-pages.fixtures';
import type { WprDetections } from '../wp-rocket/types';
import { buildStatusItems, type StatusItem } from './detections-view-model';
import { buildSupportReport } from './support-report';
import { emptyDetections, makeReportData } from './support-report.fixtures';

/** A fixture page's text. */
function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

/** A page's rows, with the simulated features the background vouched for. */
function detect(html: string, verified: readonly 'delay_js'[] = []): WprDetections {
  const detections = runChecks(parsePage(html), verified);
  applyPresencePropagation(detections);
  return detections;
}

/** The cards of a page, with or without the bypass URL. */
function cards(detections: WprDetections, bypass: boolean): StatusItem[] {
  return buildStatusItems(
    makeReportData({ wprDetections: detections, ...(bypass ? { bypassAttested: true } : {}) })
  );
}

/** The ids of the cards carrying the warning. */
function warned(items: readonly StatusItem[]): string[] {
  return items.filter((item) => item.bypassWarning !== undefined).map((item) => item.id);
}

const BYPASS_RENDER = detect(fixture('bypass-render.html'));

describe('the Detections cards', () => {
  it('a bypass render warns exactly its footprint-decided applied rows', () => {
    const items = cards(BYPASS_RENDER, true);
    expect(warned(items)).toEqual(['defer_all_js', 'minify_js', 'lazyload']);
    for (const id of ['defer_all_js', 'minify_js', 'lazyload']) {
      expect(items.find((item) => item.id === id)).toMatchObject({
        status: 'active',
        source: 'footprint',
        bypassWarning: BYPASS_APPLIED_COPY
      });
    }
    // Delay JS is bypass-guarded: absent, never warned.
    expect(items.find((item) => item.id === 'delay_js')).toMatchObject({ status: 'not-active' });
  });

  it('the same page off a bypass URL carries no warning, and the verdicts are unchanged', () => {
    const plain = cards(BYPASS_RENDER, false);
    expect(warned(plain)).toEqual([]);
    // Dropping the warning leaves exactly the plain cards: a pure modifier
    // (`toEqual` reads an own `undefined` as the field's absence).
    const stripped = cards(BYPASS_RENDER, true).map((item) => ({
      ...item,
      bypassWarning: undefined
    }));
    expect(stripped).toEqual(plain);
  });

  it('a feature comment with no footprint counts nothing and warns nothing', () => {
    // WP Rocket's comments for features with no footprint on this render.
    const tokens = [
      'wpr_minify_css',
      'wpr_lazyload_iframes',
      'wpr_lazyload_css_bg_img',
      'wpr_async_css',
      'wpr_remove_unused_css',
      'wpr_cdn',
      'wpr_minify_concatenate_js',
      'wpr_delay_js'
    ];
    // Appended at the file's end, where WP Rocket writes its comments (after
    // `</html>`); the fixture's own header comment also contains `</html>`.
    const html =
      fixture('bypass-render.html') + tokens.map((token) => `<!-- ${token} -->`).join('');
    expect(parsePage(html).comments).toEqual(expect.arrayContaining(tokens));
    const commented = detect(html);
    /** Each row's verdict: presence + deciding source. */
    const verdicts = (detections: WprDetections): Record<string, unknown> =>
      Object.fromEntries(
        (Object.keys(detections) as (keyof WprDetections)[]).map((key) => {
          const row = detections[key];
          return [key, { present: row.present, source: 'source' in row ? row.source : undefined }];
        })
      );
    expect(verdicts(commented)).toEqual(verdicts(BYPASS_RENDER));
    expect(warned(cards(commented, true))).toEqual(['defer_all_js', 'minify_js', 'lazyload']);
  });

  it('a meta-decided page served on a bypass URL never warns (a normal copy)', () => {
    expect(warned(cards(detect(fixture('me-home-cached.html')), true))).toEqual([]);
  });

  it('a degraded generator meta on a bypass URL never warns (WP Rocket rendered normally)', () => {
    // Over the token cap: the meta decides no row, so the footprints still do.
    const html = fixture('bypass-render.html').replace(
      '<head>',
      `<head><meta name="generator" content="WP Rocket" data-wpr-features="${'x'.repeat(200)}">`
    );
    const page = parsePage(html);
    expect(page.featureMeta).toMatchObject({ attributePresent: true, degraded: true });
    const detections = detect(html);
    expect(detections.minify_js).toMatchObject({ present: true, source: 'footprint' });
    const items = buildStatusItems(
      makeReportData({ wprDetections: detections, bypassAttested: true, wprGeneratorMeta: true })
    );
    expect(warned(items)).toEqual([]);
    // The same rows without the meta mark do warn: the mark alone decides.
    expect(warned(cards(detections, true))).toEqual(['defer_all_js', 'minify_js', 'lazyload']);
  });

  it('a simulated row never warns, verified or not; its served siblings still do', () => {
    const marked = withSimulationMarker(fixture('delay-on-no-meta.html'));
    for (const verified of [['delay_js'] as const, [] as const]) {
      const items = cards(detect(marked, verified), true);
      expect(items.find((item) => item.id === 'delay_js')).toHaveProperty('simulation');
      expect(warned(items)).toEqual(['minify_css', 'minify_js', 'lazyload']);
    }
  });

  it('the merged CSS-delivery card warns when async CSS stands in by footprint', () => {
    const detections = emptyDetections();
    detections.wpr.present = true;
    detections.async_css = { present: true, criticalStyle: false, source: 'footprint' };
    const card = cards(detections, true).find((item) => item.id === 'remove_unused_css');
    expect(card).toMatchObject({ status: 'active', bypassWarning: BYPASS_APPLIED_COPY });
  });

  it('the merged card stays unwarned when both rows are absent', () => {
    const detections = emptyDetections();
    detections.wpr.present = true;
    const card = cards(detections, true).find((item) => item.id === 'remove_unused_css');
    expect(card).not.toHaveProperty('bypassWarning');
  });
});

describe('the support report', () => {
  const CONTEXT = { generatedAt: Date.UTC(2026, 10, 9), extensionVersion: '1.0.0', pageUrl: null };

  it('adds the warning sentence to each warned row’s Details', () => {
    const text = buildSupportReport(
      makeReportData({ wprDetections: BYPASS_RENDER, bypassAttested: true }),
      CONTEXT
    );
    const sentence = BYPASS_APPLIED_COPY.sentence.replace(/[.?]/g, '\\$&');
    const rows = text.split('\n').filter((line) => line.includes(BYPASS_APPLIED_COPY.sentence));
    expect(rows).toHaveLength(3);
    expect(text).toMatch(
      new RegExp(
        `^\\| ${LABEL_MINIFY_JAVASCRIPT} \\| Active \\| Page footprint \\| .*${sentence} \\|$`,
        'm'
      )
    );
  });

  it('says nothing of it off a bypass URL', () => {
    const text = buildSupportReport(makeReportData({ wprDetections: BYPASS_RENDER }), CONTEXT);
    expect(text).not.toContain(BYPASS_APPLIED_COPY.sentence);
  });
});
