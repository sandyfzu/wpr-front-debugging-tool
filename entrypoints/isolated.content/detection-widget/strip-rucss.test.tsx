/**
 * A RUCSS test on the on-page strip: the tab-level card line and the
 * closed pill's glyph appear exactly while a test's CSS is on the page (any
 * pass phase), sit beside the Exclusion Builder's when both apply, and are
 * spoken once — in the model and in the rendered widget.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILDER_PILL_HINT_SPOKEN } from '../../../lib/detection/hud';
import { cacheStateForPage } from '../../../lib/detection/cache-context';
import { runDetection } from '../../../lib/detection/run-detection';
import {
  RUCSS_TEST_MODE_LINE,
  RUCSS_TEST_MODE_PILL_SPOKEN
} from '../../../lib/rucss-tester/test-mode';
import { BUILDER_MARKER_META_NAME } from '../../../lib/wp-rocket/constants';
import {
  buildStripCardModel,
  WIDGET_BUILDER_LINE_ID,
  WIDGET_RUCSS_LINE_ID,
  type StripCardModel,
  type StripDataSnapshot
} from './strip-state';
import { cardDescriptionIds, DetectionWidgetView, pillSpokenIdentity } from './ui';

afterEach(cleanup);

/**
 * A ready snapshot of a WP Rocket page, optionally rewritten by the builder.
 *
 * @param builderMarker The builder marker's content, or null.
 */
function ready(builderMarker: string | null = null): StripDataSnapshot {
  const marker =
    builderMarker === null
      ? ''
      : `<meta name="${BUILDER_MARKER_META_NAME}" content="${builderMarker}">`;
  const html = `<!doctype html><html><head><meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_delay_js">${marker}</head><body></body></html>`;
  const detections = runDetection(html).detections;
  return {
    phase: 'ready',
    detections,
    cacheState: cacheStateForPage({ wpr: detections.wpr, headers: null, bypassAttested: false })
  };
}

/** The card model for a snapshot and a test count. */
function model(snapshot: StripDataSnapshot, rucssTestRuns?: number): StripCardModel {
  return buildStripCardModel({
    snapshot,
    wordpressVersion: null,
    fdtVersion: '0.0.0',
    rucssTestRuns
  });
}

/** Render the open card; returns its root. */
function renderCard(card: StripCardModel): HTMLElement {
  const noop = (): void => undefined;
  const { container } = render(() => (
    <DetectionWidgetView
      model={() => card}
      mood={() => 'green'}
      cardOpen={() => true}
      actions={{
        registerCard: noop,
        registerPill: noop,
        registerChrome: noop,
        openCard: noop,
        closeCard: noop
      }}
    />
  ));
  return container;
}

describe('the strip model — RUCSS test line', () => {
  it('is absent without a test (or with the input left out)', () => {
    expect(model(ready()).rucssTestLine).toBeNull();
    expect(model(ready(), 0).rucssTestLine).toBeNull();
  });

  it('is the shared line once a test applied, in every pass phase', () => {
    for (const snapshot of [
      ready(),
      { phase: 'running', detections: null, cacheState: null },
      { phase: 'failed', detections: null, cacheState: null }
    ] satisfies StripDataSnapshot[]) {
      expect(model(snapshot, 2).rucssTestLine, snapshot.phase).toBe(RUCSS_TEST_MODE_LINE);
    }
  });
});

describe('the rendered widget — RUCSS test', () => {
  it('shows the card line with its glyph and adds it to the dialog description', () => {
    const root = renderCard(model(ready(), 1));
    const line = root.querySelector<HTMLElement>('[data-fdt-strip-rucss]');
    expect(line?.textContent).toBe(RUCSS_TEST_MODE_LINE);
    expect(line?.querySelector('.dw-rucss-glyph')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector(`#${WIDGET_RUCSS_LINE_ID}`)?.textContent).toBe(RUCSS_TEST_MODE_LINE);
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-describedby')).toBe(
      WIDGET_RUCSS_LINE_ID
    );
  });

  it('draws the pill glyph and speaks the hint once, after the identity', () => {
    const pill = renderCard(model(ready(), 1)).querySelector<HTMLElement>('.dw-pill');
    const glyph = pill?.querySelector<HTMLElement>('[data-fdt-strip-pill-rucss]');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(glyph?.querySelectorAll('svg')).toHaveLength(1);
    expect(pill?.querySelector('[data-fdt-strip-pill-builder-spoken]')?.textContent).toBe(
      `WPR 3.23.5.1${RUCSS_TEST_MODE_PILL_SPOKEN}`
    );
  });

  it('sits beside the builder’s glyph and line when both apply', () => {
    const card = model(ready('v1 delay_js=off'), 1);
    const root = renderCard(card);
    const pill = root.querySelector<HTMLElement>('.dw-pill');
    const builderGlyph = pill?.querySelector('[data-fdt-strip-pill-builder]');
    const rucssGlyph = pill?.querySelector('[data-fdt-strip-pill-rucss]');
    expect(builderGlyph).not.toBeNull();
    expect(builderGlyph?.nextElementSibling).toBe(rucssGlyph);
    expect(pill?.querySelector('[data-fdt-strip-pill-builder-spoken]')?.textContent).toBe(
      `WPR 3.23.5.1${BUILDER_PILL_HINT_SPOKEN}${RUCSS_TEST_MODE_PILL_SPOKEN}`
    );
    expect(root.querySelector('[data-fdt-strip-builder]')).not.toBeNull();
    expect(root.querySelector('[data-fdt-strip-rucss]')).not.toBeNull();
    expect(cardDescriptionIds(card)).toBe(`${WIDGET_BUILDER_LINE_ID} ${WIDGET_RUCSS_LINE_ID}`);
  });

  it('an untested page: no glyph, no line, no hint', () => {
    const card = model(ready());
    const root = renderCard(card);
    expect(root.querySelector('[data-fdt-strip-pill-rucss]')).toBeNull();
    expect(root.querySelector('[data-fdt-strip-rucss]')).toBeNull();
    expect(pillSpokenIdentity(card)).toBeNull();
    expect(cardDescriptionIds(card)).toBeUndefined();
  });
});
