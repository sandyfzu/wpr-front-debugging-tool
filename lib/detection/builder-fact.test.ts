/**
 * The builder marker's read rule (present / absent / hostile / duplicate /
 * misplaced / degraded) and the facts it adds to the detection rows —
 * additive only: every verdict and every other row stay as served.
 */
import { describe, expect, it } from 'vitest';
import { BUILDER_MARKER_META_NAME } from '../wp-rocket/constants';
import type { WprDetections } from '../wp-rocket/types';
import { applyPipeline } from '../exclusion-builder/pipeline';
import { EMPTY_EXCLUSION_SET } from '../exclusion-builder/set';
import { applyBuilderFacts, parseBuilderMarker } from './builder-fact';
import { parsePage } from './parse-page';
import { runDetection } from './run-detection';

/** A marker meta with the given content. */
function marker(content: string, extra = ''): string {
  return `<meta name="${BUILDER_MARKER_META_NAME}" content="${content}"${extra}>`;
}

/** A page with `head` and `body` markup. */
function page(head: string, body = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
}

/** The note as the detection pass reads it off a page's HTML. */
function read(html: string): ReturnType<typeof parseBuilderMarker> {
  return parsePage(html).builderNote;
}

/** A WP Rocket page declaring Delay JS + Defer JS, its delayed script restored. */
const SERVED_HEAD =
  '<meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_delay_js wpr_defer_js wpr_lazyload_images wpr_automatic_lazy_rendering">';

/** The detection rows with every `builder` field removed. */
function withoutBuilder(detections: WprDetections): WprDetections {
  const copy = structuredClone(detections);
  delete copy.delay_js.builder;
  delete copy.defer_all_js.builder;
  delete copy.lazyload.builder;
  delete copy.automatic_lazy_rendering.builder;
  return copy;
}

describe('parseBuilderMarker', () => {
  it('reads exactly one well-formed marker in <head>', () => {
    expect(read(page(marker('v1 delay_js=off defer_all_js=page-off lazyload=excluded:3')))).toEqual(
      { delay_js: { off: 'feature' }, defer_all_js: { off: 'page' }, lazyload: { excluded: 3 } }
    );
  });

  it('accepts either attribute order', () => {
    const html = page(`<meta content="v1 delay_js=off" name="${BUILDER_MARKER_META_NAME}">`);
    expect(read(html)).toEqual({ delay_js: { off: 'feature' } });
  });

  it('states nothing without a marker', () => {
    expect(read(page('<title>t</title>'))).toBeNull();
    expect(read('')).toBeNull();
  });

  it('states nothing when several markers exist, even identical ones', () => {
    expect(read(page(`${marker('v1 delay_js=off')}${marker('v1 delay_js=off')}`))).toBeNull();
    // A second copy anywhere counts — here in the body.
    expect(read(page(marker('v1 delay_js=off'), marker('v1 lazyload=excluded:1')))).toBeNull();
  });

  it('reads the one marker wherever the page markup moved it', () => {
    const fact = { delay_js: { off: 'feature' } };
    // In <body>: the head closed early (a stray element, or the serialized
    // live <noscript> text re-parsed with scripting off).
    expect(read(page('', marker('v1 delay_js=off')))).toEqual(fact);
    expect(read(page(`<div></div>${marker('v1 delay_js=off')}`))).toEqual(fact);
    // Nested in head content rather than a direct child.
    expect(read(page(`<noscript>${marker('v1 delay_js=off')}</noscript>`))).toEqual(fact);
  });

  it('reads the marker on a WP Rocket head carrying its noscript lazyload style', () => {
    // WP Rocket's LazyLoad head: once the live document is serialized, the
    // noscript content is escaped text, which closes <head> in a
    // scripting-off parse and moves the marker (written just before
    // </head>) into <body>.
    const head = `${SERVED_HEAD}<noscript><style id="rocket-lazyload-nojs-css">.rll-youtube-player, [data-lazy-src]{display:none !important;}</style></noscript>`;
    const live = new DOMParser().parseFromString(
      page(`${head}${marker('v1 delay_js=off')}`),
      'text/html'
    );
    const noscript = live.querySelector('noscript');
    // The live (scripting-on) document holds that content as text.
    noscript?.replaceChildren(live.createTextNode(noscript.innerHTML));
    const serialized = new XMLSerializer().serializeToString(live);
    expect(read(serialized)).toEqual({ delay_js: { off: 'feature' } });
  });

  it('states nothing for a marker with extra or missing attributes', () => {
    expect(read(page(marker('v1 delay_js=off', ' charset="utf-8"')))).toBeNull();
    expect(read(page(marker('v1 delay_js=off', ' http-equiv="refresh"')))).toBeNull();
    expect(read(page(`<meta name="${BUILDER_MARKER_META_NAME}">`))).toBeNull();
  });

  it('states nothing for malformed or hostile content (all or nothing)', () => {
    for (const content of [
      '',
      'v1',
      'v2 delay_js=off',
      'v1 delay_js=off delay_js=off',
      'v1 lazyload=off',
      'v1 delay_js=excluded:0',
      `v1 ${'delay_js=off '.repeat(10_000)}`
    ]) {
      expect(read(page(marker(content))), content.slice(0, 40)).toBeNull();
    }
  });

  it('ignores a meta whose name differs in case or spacing', () => {
    expect(
      read(
        page(`<meta name="${BUILDER_MARKER_META_NAME.toUpperCase()}" content="v1 delay_js=off">`)
      )
    ).toBeNull();
    expect(
      read(page(`<meta name=" ${BUILDER_MARKER_META_NAME}" content="v1 delay_js=off">`))
    ).toBeNull();
  });

  it('reads the marker after the live-document serialization the data hub performs', () => {
    const parsed = new DOMParser().parseFromString(page(marker('v1 delay_js=off')), 'text/html');
    // The parsed document itself, as parsePage hands it over…
    expect(parseBuilderMarker(parsed)).toEqual({ delay_js: { off: 'feature' } });
    // …and the XMLSerializer round trip the data hub snapshots the live page with.
    const serialized = new XMLSerializer().serializeToString(parsed);
    expect(read(serialized)).toEqual({ delay_js: { off: 'feature' } });
  });
});

describe('applyBuilderFacts', () => {
  it('adds the fact to each named row and nothing else', () => {
    const { detections } = runDetection(page(SERVED_HEAD));
    const before = structuredClone(detections);
    applyBuilderFacts(detections, {
      delay_js: { off: 'feature' },
      automatic_lazy_rendering: { excluded: 2 }
    });
    expect(detections.delay_js.builder).toEqual({ off: 'feature' });
    expect(detections.automatic_lazy_rendering.builder).toEqual({ excluded: 2 });
    expect(detections.defer_all_js).not.toHaveProperty('builder');
    expect(detections.lazyload).not.toHaveProperty('builder');
    expect(withoutBuilder(detections)).toEqual(before);
  });

  it('is a no-op without a note', () => {
    const { detections } = runDetection(page(SERVED_HEAD));
    const before = structuredClone(detections);
    applyBuilderFacts(detections, null);
    expect(detections).toEqual(before);
  });
});

describe('the detection pass with a builder marker', () => {
  it('keeps the served verdict and adds the in-tab fact', () => {
    const html = page(`${SERVED_HEAD}${marker('v1 delay_js=off defer_all_js=page-off')}`);
    const { detections } = runDetection(html);
    expect(detections.delay_js).toMatchObject({
      present: true,
      source: 'meta',
      builder: { off: 'feature' }
    });
    expect(detections.defer_all_js).toMatchObject({
      present: true,
      source: 'meta',
      builder: { off: 'page' }
    });
  });

  it('changes no other field of any row: the marker is no footprint, no declaration', () => {
    const plain = runDetection(page(SERVED_HEAD));
    const marked = runDetection(
      page(
        `${SERVED_HEAD}${marker('v1 delay_js=off defer_all_js=off automatic_lazy_rendering=excluded:1 lazyload=excluded:2')}`
      )
    );
    expect(withoutBuilder(marked.detections)).toEqual(plain.detections);
    expect(marked.preloadedResources).toEqual(plain.preloadedResources);
    // Not WP Rocket evidence either: a marker alone proves no plugin presence.
    const alone = runDetection(page(marker('v1 delay_js=off')));
    expect(alone.detections.wpr.present).toBe(false);
    expect(alone.detections.delay_js).toMatchObject({
      present: false,
      builder: { off: 'feature' }
    });
  });

  it('reads back what the rewrite wrote, end to end', () => {
    const served = page(
      SERVED_HEAD,
      '<script type="rocketlazyloadscript" data-rocket-src="https://s.tld/a.js" id="a"></script>'
    );
    const rewritten = applyPipeline(served, {
      ...EMPTY_EXCLUSION_SET,
      disable: { ...EMPTY_EXCLUSION_SET.disable, delayJs: true }
    }).html;
    expect(runDetection(rewritten).detections.delay_js.builder).toEqual({ off: 'feature' });
    expect(runDetection(served).detections.delay_js).not.toHaveProperty('builder');
  });
});
