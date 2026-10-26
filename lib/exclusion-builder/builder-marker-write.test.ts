/**
 * The builder marker step: facts from the step reports, the write rule
 * (every existing copy removed, one appended at the end of `<head>` only
 * when a feature changed the document), idempotence, and its cost.
 */
import { describe, expect, it } from 'vitest';
import { BUILDER_MARKER_META_NAME } from '../wp-rocket/constants';
import {
  builderFactOf,
  builderNoteOf,
  markBuilderEffects,
  namesBuilderMarker,
  writeBuilderMarker
} from './builder-marker-write';
import { applyPipeline } from './pipeline';
import type { TransformReport } from './report';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from './set';

/** A report with the given fields over a zeroed row-driven one. */
function report(fields: Partial<TransformReport>): TransformReport {
  return {
    feature: 'delay_js',
    featureWide: false,
    candidates: 0,
    rewritten: 0,
    regionRemovals: 0,
    matchedRows: [],
    unmatchedRows: [],
    ...fields
  };
}

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

/** The marker element for a content, as the step writes it. */
function marker(content: string): string {
  return `<meta name="${BUILDER_MARKER_META_NAME}" content="${content}">`;
}

/** How many marker metas a text spells (raw, any attribute form the step writes). */
function markerCount(html: string): number {
  return html.split(`name="${BUILDER_MARKER_META_NAME}"`).length - 1;
}

/** A page whose head holds `head` and whose body holds `body`. */
function page(head: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
}

const DELAYED =
  '<script type="rocketlazyloadscript" data-rocket-src="https://s.tld/a.js" id="a"></script>';
const DEFERRED =
  '<script src="https://s.tld/jquery.js" id="jquery-core-js" data-rocket-defer defer></script>';
const LAZY_IMAGE = '<img src="ph.gif" data-lazy-src="real.jpg" class="hero" alt="x">';
const LAZY_RENDER =
  '<style id="rocket-lazyrender-inline-css">[data-wpr-lazyrender] {content-visibility: auto;}</style>';
const RENDERED = '<div data-wpr-lazyrender="1" class="below">x</div>';

describe('builderFactOf', () => {
  it('reads a feature-wide run that changed the document as off', () => {
    expect(builderFactOf(report({ featureWide: true, rewritten: 2 }))).toEqual({ off: 'feature' });
    // Region removals alone (the controller scripts, the inline CSS) change the document too.
    expect(builderFactOf(report({ featureWide: true, regionRemovals: 1 }))).toEqual({
      off: 'feature'
    });
  });

  it('states nothing for a feature-wide run that changed nothing', () => {
    expect(builderFactOf(report({ featureWide: true }))).toBeNull();
  });

  it('reads a page-off run that restored elements as off for the page', () => {
    const fact = builderFactOf(
      report({ feature: 'defer_all_js', rewritten: 2, pageState: 'off', pageOffRows: ['.*'] })
    );
    expect(fact).toEqual({ off: 'page' });
  });

  it('states nothing for a page-off run with nothing to restore', () => {
    expect(builderFactOf(report({ feature: 'defer_all_js', pageState: 'off' }))).toBeNull();
  });

  it('reads a row run by the elements it restored (unclamped here)', () => {
    expect(builderFactOf(report({ rewritten: 3 }))).toEqual({ excluded: 3 });
    expect(builderFactOf(report({ rewritten: 12_345 }))).toEqual({ excluded: 12_345 });
    expect(builderFactOf(report({ rewritten: 1, pageState: 'unknown' }))).toEqual({ excluded: 1 });
  });

  it('states nothing for a row run that restored nothing', () => {
    expect(builderFactOf(report({ candidates: 4, unmatchedRows: ['zzz'] }))).toBeNull();
  });
});

describe('builderNoteOf', () => {
  it('keeps one fact per feature that changed the document', () => {
    expect(
      builderNoteOf([
        report({ feature: 'delay_js', featureWide: true, regionRemovals: 1 }),
        report({ feature: 'defer_all_js' }),
        report({ feature: 'automatic_lazy_rendering', featureWide: true }),
        report({ feature: 'lazyload', rewritten: 2 })
      ])
    ).toEqual({ delay_js: { off: 'feature' }, lazyload: { excluded: 2 } });
  });

  it('is empty when nothing changed', () => {
    expect(builderNoteOf([])).toEqual({});
    expect(builderNoteOf([report({ feature: 'lazyload' })])).toEqual({});
  });
});

describe('writeBuilderMarker', () => {
  const note = { delay_js: { off: 'feature' } } as const;

  it('appends one marker at the end of <head>, after the charset', () => {
    const html = page('<title>t</title>', '<p>x</p>');
    const out = writeBuilderMarker(html, note);
    expect(out).toBe(page(`<title>t</title>${marker('v1 delay_js=off')}`, '<p>x</p>'));
    expect(out.indexOf('<meta charset="utf-8">')).toBe(html.indexOf('<meta charset="utf-8">'));
  });

  it('appends before <body> when the head is never closed', () => {
    const html = '<html><head><meta charset="utf-8"><title>t</title><BODY class="b"><p>x</p>';
    expect(writeBuilderMarker(html, note)).toBe(
      `<html><head><meta charset="utf-8"><title>t</title>${marker('v1 delay_js=off')}<BODY class="b"><p>x</p>`
    );
  });

  it('uses the first real </head>, never one in a comment or raw text', () => {
    const html =
      '<html><head><!-- </head> --><script>"</head>"</script><title></head></title></HEAD ><body></body></html>';
    const out = writeBuilderMarker(html, note);
    expect(out).toBe(
      `<html><head><!-- </head> --><script>"</head>"</script><title></head></title>${marker('v1 delay_js=off')}</HEAD ><body></body></html>`
    );
  });

  it('writes nothing on a document that spells neither </head> nor <body>', () => {
    const html = '<meta charset="utf-8"><title>t</title><p>x</p>';
    expect(writeBuilderMarker(html, note)).toBe(html);
  });

  it('writes nothing for an empty note and returns the input itself', () => {
    const html = page('', '<p>x</p>');
    expect(writeBuilderMarker(html, {})).toBe(html);
  });

  it('removes a served copy and writes its own', () => {
    const html = page(marker('v1 lazyload=excluded:9'), '');
    expect(writeBuilderMarker(html, note)).toBe(page(marker('v1 delay_js=off'), ''));
  });

  it('removes every served copy, wherever and however spelled', () => {
    const served = [
      marker('v1 delay_js=off'),
      `<META NAME="${BUILDER_MARKER_META_NAME}" content="v1 defer_all_js=off" charset="x">`,
      `<meta content='spoof' name=${BUILDER_MARKER_META_NAME} />`,
      `<meta name="${BUILDER_MARKER_META_NAME}">`
    ];
    const html = page(
      `${served[0] ?? ''}<title>t</title>${served[1] ?? ''}`,
      `${served[2] ?? ''}<p>x</p>${served[3] ?? ''}`
    );
    const cleared = page('<title>t</title>', '<p>x</p>');
    // An empty note: copies go, nothing comes back.
    expect(writeBuilderMarker(html, {})).toBe(cleared);
    expect(writeBuilderMarker(html, note)).toBe(
      page(`<title>t</title>${marker('v1 delay_js=off')}`, '<p>x</p>')
    );
  });

  it('leaves metas of other names, other casings of the name, comments and script text', () => {
    const kept = [
      '<meta name="generator" content="WP Rocket 3.20" data-wpr-features="wpr_delay_js">',
      `<meta name="${BUILDER_MARKER_META_NAME.toUpperCase()}" content="v1 delay_js=off">`,
      `<!-- ${marker('v1 delay_js=off')} -->`,
      `<script>document.write('${marker('v1 delay_js=off')}')</script>`,
      `<meta property="${BUILDER_MARKER_META_NAME}" content="v1 delay_js=off">`
    ].join('');
    const html = page(kept, '');
    expect(writeBuilderMarker(html, {})).toBe(html);
  });

  it('is idempotent for a given note', () => {
    const html = page(marker('v1 lazyload=excluded:9'), '<p>x</p>');
    const once = writeBuilderMarker(html, note);
    expect(writeBuilderMarker(once, note)).toBe(once);
    expect(markerCount(once)).toBe(1);
  });

  it('stays linear in the document size (ratio-bounded, no wall-clock ceiling)', () => {
    const chunk = `<div class="c"><img src="a.jpg" alt="a"><p>${'text '.repeat(20)}</p></div>`;
    /** A page of about `mib` MiB. */
    const sized = (mib: number): string =>
      page('<title>t</title>', chunk.repeat(Math.ceil((mib * 1024 * 1024) / chunk.length)));
    /** Best of three runs (ms), so one scheduler hiccup cannot decide. */
    const best = (html: string): number => {
      let fastest = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        expect(markerCount(writeBuilderMarker(html, note))).toBe(1);
        fastest = Math.min(fastest, performance.now() - started);
      }
      return fastest;
    };
    const small = best(sized(1));
    const large = best(sized(4));
    // 4× the input: linear is ~4×; quadratic would be ~16×. A generous
    // ceiling (plus a 5 ms floor for timer noise) still catches the latter.
    expect(large).toBeLessThan(10 * Math.max(small, 5));
  });

  it('removes a served copy whose name is spelled with character references', () => {
    const spelled = [
      'wpr-fdt-exclusion&#45;builder',
      'wpr-fdt-exclusion&#x2D;builder',
      'wpr-fdt-exclusion&#X2d;builder',
      'wpr-fdt-exclusion&#0045builder',
      '&#119;pr-fdt-exclusion-builder',
      // A named reference may stand for anything: treated as a possible match.
      'wpr-fdt-exclusion&hyphen;builder'
    ];
    for (const name of spelled) {
      const html = page(`<meta name="${name}" content="v1 lazyload=excluded:9">`, '');
      expect(writeBuilderMarker(html, {}), name).toBe(page('', ''));
      expect(namesBuilderMarker(name), name).toBe(true);
    }
  });

  it('keeps metas whose decoded name cannot be the marker', () => {
    for (const name of [
      'wpr-fdt-exclusion&#46;builder',
      'wpr-fdt-exclusion&#x2D;builders',
      'x&amp;wpr-fdt-exclusion-builder',
      'wpr-fdt-exclusion-builder&#0;',
      'wpr&#xE9;-fdt-exclusion-builder',
      '&'
    ]) {
      expect(namesBuilderMarker(name), name).toBe(false);
      const html = page(`<meta name="${name}" content="v1">`, '');
      expect(writeBuilderMarker(html, {}), name).toBe(html);
    }
  });

  it('matches a value spelling thousands of references in linear time', () => {
    expect(namesBuilderMarker(`${'&a;'.repeat(50_000)}x`)).toBe(false);
    expect(namesBuilderMarker(`wpr${'&a;'.repeat(50_000)}builder`)).toBe(true);
  });

  it('never inserts inside raw text the browser will not parse as markup', () => {
    const rawText = [
      '<noframes></head></noframes>',
      '<noembed></head></noembed>',
      '<xmp></head></xmp>',
      '<iframe></head></iframe>',
      '<noscript></head></noscript>',
      '<textarea></head></textarea>',
      '<title></head></title>'
    ];
    for (const region of rawText) {
      const html = `<html><head>${region}</head><body></body></html>`;
      expect(writeBuilderMarker(html, note), region).toBe(
        `<html><head>${region}${marker('v1 delay_js=off')}</head><body></body></html>`
      );
    }
    // <plaintext> never ends: no real </head> follows it, so nothing is written.
    const plaintext = '<html><head><plaintext></head><body>';
    expect(writeBuilderMarker(plaintext, note)).toBe(plaintext);
  });

  it('leaves a marker spelled inside raw text alone (it is text, not an element)', () => {
    const html = page(`<noscript>${marker('v1 delay_js=off')}</noscript>`, '');
    expect(writeBuilderMarker(html, {})).toBe(html);
  });
});

describe('markBuilderEffects through the pipeline', () => {
  it('states Delay JS off on a page whose delayed scripts it restored', () => {
    const out = applyPipeline(page('', DELAYED), setWith({}, { delayJs: true })).html;
    expect(out).toContain(`${marker('v1 delay_js=off')}</head>`);
    expect(markerCount(out)).toBe(1);
  });

  it('states Defer JS off feature-wide', () => {
    const out = applyPipeline(page(DEFERRED, ''), setWith({}, { deferJs: true })).html;
    expect(out).toContain(`${marker('v1 defer_all_js=off')}</head>`);
  });

  it('states Defer JS off for the page when its rows turn WP Rocket off', () => {
    // `.*` consumes the pre-check's subject: WP Rocket defers nothing on the page.
    const out = applyPipeline(page(DEFERRED, ''), setWith({ deferJs: ['.*'] })).html;
    expect(out).toContain(`${marker('v1 defer_all_js=page-off')}</head>`);
  });

  it('states Automatic Lazy Rendering off feature-wide', () => {
    const out = applyPipeline(page(LAZY_RENDER, RENDERED), setWith({}, { lazyRender: true })).html;
    expect(out).toContain(`${marker('v1 automatic_lazy_rendering=off')}</head>`);
  });

  it('states the elements each feature’s rows restored, in registry order', () => {
    const out = applyPipeline(
      page(LAZY_RENDER, `${LAZY_IMAGE}${RENDERED}${DELAYED}`),
      setWith({ lazyload: ['hero'], lazyRender: ['below'], delayJs: ['a\\.js'] })
    ).html;
    expect(out).toContain(
      `${marker('v1 delay_js=excluded:1 automatic_lazy_rendering=excluded:1 lazyload=excluded:1')}</head>`
    );
  });

  it('writes no marker when no feature changed the document', () => {
    const html = page(DEFERRED, `${LAZY_IMAGE}${DELAYED}`);
    expect(applyPipeline(html, EMPTY_EXCLUSION_SET).html).toBe(html);
    // Rows that match nothing change nothing either.
    expect(applyPipeline(html, setWith({ lazyload: ['zzz'], delayJs: ['zzz'] })).html).toBe(html);
  });

  it('replaces a served copy with its own, and drops it when nothing changed', () => {
    const html = page(marker('v1 lazyload=excluded:9'), DELAYED);
    const applied = applyPipeline(html, setWith({}, { delayJs: true })).html;
    expect(markerCount(applied)).toBe(1);
    expect(applied).toContain(marker('v1 delay_js=off'));
    expect(markerCount(applyPipeline(html, EMPTY_EXCLUSION_SET).html)).toBe(0);
  });

  it('matches markBuilderEffects over the feature steps’ output', () => {
    const html = page('', DELAYED);
    const set = setWith({}, { delayJs: true });
    const result = applyPipeline(html, set);
    expect(markBuilderEffects(result.html, result.reports)).toBe(result.html);
  });
});
