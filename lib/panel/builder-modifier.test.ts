/**
 * The Exclusion Builder modifier on the Detections cards and in the
 * support report: the served verdict stays in Status, the modifier joins
 * the Details (explaining a fact the rewrite emptied), and nothing is said
 * on a page with no builder fact.
 */
import { describe, expect, it } from 'vitest';
import { runDetection } from '../detection/run-detection';
import { BUILDER_MARKER_META_NAME } from '../wp-rocket/constants';
import { buildStatusItems, type StatusItem } from './detections-view-model';
import { buildSupportReport, type SupportReportContext } from './support-report';
import { emptyDetections, makeReportData } from './support-report.fixtures';

const CONTEXT: SupportReportContext = {
  generatedAt: Date.UTC(2026, 9, 26, 12, 0, 0),
  extensionVersion: '1.4.0',
  pageUrl: 'https://example.com/'
};

/** The generator meta declaring the builder's features. */
const DECLARED =
  '<meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_delay_js wpr_defer_js wpr_lazyload_images">';

/** A page with an optional generator declaration, marker content and body. */
function page(head: string, marker: string | null, body = ''): string {
  const note =
    marker === null ? '' : `<meta name="${BUILDER_MARKER_META_NAME}" content="${marker}">`;
  return `<!doctype html><html><head>${head}${note}</head><body>${body}</body></html>`;
}

/** The cards of a page. */
function cards(html: string): StatusItem[] {
  return buildStatusItems(makeReportData({ wprDetections: runDetection(html).detections }));
}

/** One card by id. */
function card(items: readonly StatusItem[], id: string): StatusItem {
  const found = items.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no card ${id}`);
  return found;
}

/** The report's table row of one feature name. */
function reportRow(html: string, name: string): string {
  const report = buildSupportReport(
    makeReportData({ wprDetections: runDetection(html).detections }),
    CONTEXT
  );
  const row = report.split('\n').find((line) => line.startsWith(`| ${name} |`));
  if (row === undefined) throw new Error(`no report row ${name}`);
  return row;
}

describe('the Detections cards', () => {
  it('keep the served verdict and carry the fact and its sentence', () => {
    const items = cards(page(DECLARED, 'v1 delay_js=off lazyload=excluded:2'));
    expect(card(items, 'delay_js')).toMatchObject({
      status: 'active',
      source: 'meta',
      builder: { off: 'feature' },
      modifier: 'Disabled in this tab by the Exclusion Builder.'
    });
    expect(card(items, 'lazyload')).toMatchObject({
      status: 'active',
      builder: { excluded: 2 },
      modifier: '2 images excluded by the Exclusion Builder.'
    });
    expect(card(items, 'defer_all_js')).not.toHaveProperty('builder');
    expect(card(items, 'defer_all_js')).not.toHaveProperty('modifier');
  });

  it('carry no modifier on a page with no builder fact', () => {
    for (const item of cards(page(DECLARED, null))) {
      expect(item, item.id).not.toHaveProperty('builder');
      expect(item, item.id).not.toHaveProperty('modifier');
    }
  });
});

describe('the support report row', () => {
  it('states the served verdict and the modifier, the modifier standing for the emptied version', () => {
    // Delay JS disabled: the controller (and so the library version) is gone.
    expect(reportRow(page(DECLARED, 'v1 delay_js=off'), 'Delay JavaScript execution')).toBe(
      '| Delay JavaScript execution | Active | Generator meta | Disabled in this tab by the Exclusion Builder. |'
    );
  });

  it('adds the modifier after the row’s own facts', () => {
    const delayed = '<script>class RocketLazyLoadScripts{constructor(){this.v="2.0.5"}}</script>';
    expect(
      reportRow(page(DECLARED, 'v1 delay_js=excluded:1', delayed), 'Delay JavaScript execution')
    ).toBe(
      '| Delay JavaScript execution | Active | Generator meta | Version `2.0.5`; 1 script excluded by the Exclusion Builder. |'
    );
    expect(reportRow(page(DECLARED, 'v1 defer_all_js=page-off'), 'Load JavaScript deferred')).toBe(
      '| Load JavaScript deferred | Active | Generator meta | Off in this tab: an Exclusion Builder row stops WP Rocket deferring. |'
    );
  });

  it('never claims WP Rocket served a feature it did not', () => {
    // No declaration: the disabled feature reads not active; only the modifier explains it.
    expect(reportRow(page('', 'v1 delay_js=off'), 'Delay JavaScript execution')).toBe(
      '| Delay JavaScript execution | Not active | — | Disabled in this tab by the Exclusion Builder. |'
    );
  });

  it('orders the Details cell as facts; why; modifier', () => {
    // Automatic Lazy Rendering still collecting (render hashes on the page,
    // nothing converted) while its rows excluded one element: the card has
    // both the unsure why and the modifier.
    const detections = emptyDetections();
    detections.wpr = { ...detections.wpr, present: true };
    detections.automatic_lazy_rendering = {
      present: false,
      lazyRenderElements: 0,
      inlineCssPresent: false,
      locationHashes: 2,
      builder: { excluded: 1 }
    };
    const report = buildSupportReport(makeReportData({ wprDetections: detections }), CONTEXT);
    const row = report.split('\n').find((line) => line.startsWith('| Automatic Lazy Rendering |'));
    expect(row).toBe(
      '| Automatic Lazy Rendering | Collecting | — | Enabled, not yet applied on this page.; 1 element excluded by the Exclusion Builder. |'
    );
  });

  it('says nothing of the builder on a page with no fact', () => {
    const report = buildSupportReport(
      makeReportData({ wprDetections: runDetection(page(DECLARED, null)).detections }),
      CONTEXT
    );
    expect(report).not.toContain('Exclusion Builder');
  });
});
