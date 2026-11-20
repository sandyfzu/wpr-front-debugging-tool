/**
 * The page-style inventories over happy-dom: document order, both kinds,
 * every field clipped to its cap, the CSS preview, the count bound with an
 * honest total, and a page left untouched — the RUCSS test's list and the
 * Stylesheets page's wider one with its tag facts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PAGE_STYLE_LIMITS, parsePageStylesReply } from '../../../lib/messaging/page-styles';
import { parsePageStylesheetsReply } from '../../../lib/messaging/page-stylesheets';
import { buildStylesheetRows } from '../../../lib/panel/stylesheet-rows';
import { CSS_STYLE_STATES, stylesheetPageFacts } from '../../../lib/panel/style-states';
import type { WprDetections } from '../../../lib/wp-rocket/types';
import {
  collectPageStyles,
  collectPageStylesheets,
  cssPreview,
  describeStyle
} from './style-inventory';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

/** A well-formed snapshot id (the page stamps a random one on every list). */
const SNAPSHOT_ID = '0123456789abcdef0123456789abcdef';
describe('collectPageStyles', () => {
  it('lists the stripped selector’s elements in document order, untouched', () => {
    document.head.innerHTML = [
      '<link rel="stylesheet" id="theme-css" class="a  b" media="print" href="/theme.css">',
      '<link rel="preload" href="/font.woff2">',
      '<style id="inline">\n  .a {\n color: red; }\n</style>'
    ].join('');
    document.body.innerHTML =
      '<link rel="stylesheet" href="https://cdn.test/x.css"><style></style>';
    const before = document.documentElement.outerHTML;
    const reply = collectPageStyles(document);
    expect(document.documentElement.outerHTML).toBe(before);
    expect(reply.total).toBe(4);
    expect(reply.styles).toEqual([
      {
        kind: 'link',
        id: 'theme-css',
        className: 'a  b',
        href: new URL('/theme.css', location.href).href,
        media: 'print',
        preview: '',
        chars: 0
      },
      {
        kind: 'inline',
        id: 'inline',
        className: '',
        href: '',
        media: '',
        preview: '.a { color: red; }',
        chars: '\n  .a {\n color: red; }\n'.length
      },
      {
        kind: 'link',
        id: '',
        className: '',
        href: 'https://cdn.test/x.css',
        media: '',
        preview: '',
        chars: 0
      },
      { kind: 'inline', id: '', className: '', href: '', media: '', preview: '', chars: 0 }
    ]);
    // Exactly what the panel's guard accepts.
    expect(parsePageStylesReply(reply)).toEqual(reply);
  });

  it('lists at most the cap and still counts every style', () => {
    document.head.innerHTML = '<style></style>'.repeat(PAGE_STYLE_LIMITS.count + 2);
    const reply = collectPageStyles(document);
    expect(reply.styles).toHaveLength(PAGE_STYLE_LIMITS.count);
    expect(reply.total).toBe(PAGE_STYLE_LIMITS.count + 2);
    expect(parsePageStylesReply(reply)).not.toBeNull();
  });
});

describe('describeStyle', () => {
  it('clips every string to its cap so a hostile page cannot break the reply', () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.id = 'i'.repeat(PAGE_STYLE_LIMITS.idChars + 50);
    link.setAttribute('class', 'c'.repeat(PAGE_STYLE_LIMITS.classChars + 50));
    link.setAttribute('media', 'm'.repeat(PAGE_STYLE_LIMITS.mediaChars + 50));
    link.href = `https://a.test/${'p'.repeat(PAGE_STYLE_LIMITS.hrefChars)}`;
    const entry = describeStyle(link);
    expect(entry.id).toHaveLength(PAGE_STYLE_LIMITS.idChars);
    expect(entry.id.endsWith('…')).toBe(true);
    expect(entry.className).toHaveLength(PAGE_STYLE_LIMITS.classChars);
    expect(entry.media).toHaveLength(PAGE_STYLE_LIMITS.mediaChars);
    expect(entry.href).toHaveLength(PAGE_STYLE_LIMITS.hrefChars);
    expect(parsePageStylesReply({ styles: [entry], total: 1 })).not.toBeNull();
  });

  it('counts a large inline style whole but previews only its start', () => {
    const style = document.createElement('style');
    style.textContent = `.x{}${' '.repeat(10)}${'a'.repeat(5_000_000)}`;
    const entry = describeStyle(style);
    expect(entry.chars).toBe(5_000_014);
    expect(entry.preview).toHaveLength(PAGE_STYLE_LIMITS.previewChars);
    expect(entry.preview.startsWith('.x{} aaa')).toBe(true);
  });
});

describe('cssPreview', () => {
  it('collapses whitespace and trims', () => {
    expect(cssPreview('\n\t a {\n  b: c }  ')).toBe('a { b: c }');
    expect(cssPreview('')).toBe('');
  });
});

describe('collectPageStylesheets', () => {
  it('lists every style and the links the detection reads as stylesheets, in document order', () => {
    document.head.innerHTML = [
      '<link rel="stylesheet" href="/theme.css">',
      '<link rel="preload" as="style" data-rocket-async="style" href="/async.css">',
      '<link rel="preload" as="style" href="/unstamped.css">',
      '<link rel="preload" as="font" href="/font.woff2">',
      '<link rel="icon" href="/favicon.ico">',
      '<link rel="alternate stylesheet" href="/alt.css">',
      '<style id="rocket-critical-css">.c{}</style>'
    ].join('');
    document.body.innerHTML = '<style id="wpr-usedcss">.u{}</style>';
    const before = document.documentElement.outerHTML;
    const { reply, elements } = collectPageStylesheets(document);
    expect(document.documentElement.outerHTML).toBe(before);
    expect(reply.total).toBe(4);
    // The snapshot keeps exactly the described elements, in the same order.
    expect(elements.map((element) => element.getAttribute('href') ?? `#${element.id}`)).toEqual([
      '/theme.css',
      '/async.css',
      '#rocket-critical-css',
      '#wpr-usedcss'
    ]);
    expect(reply.styles.map((style) => style.href || `#${style.id}`)).toEqual([
      new URL('/theme.css', location.href).href,
      new URL('/async.css', location.href).href,
      '#rocket-critical-css',
      '#wpr-usedcss'
    ]);
    const stamped = { ...reply, snapshotId: SNAPSHOT_ID };
    expect(parsePageStylesheetsReply(stamped)).toEqual(stamped);
  });

  it('keeps an async link once its onload flipped it to a stylesheet', () => {
    document.head.innerHTML =
      '<link rel="stylesheet" as="style" data-rocket-async="style" href="/async.css">';
    expect(collectPageStylesheets(document).reply.styles[0]?.rocketAsync).toBe(true);
  });

  it('reads each link’s WP Rocket stamps, exact values only', () => {
    document.head.innerHTML = [
      '<link rel="stylesheet" data-minify="1" href="/a.css">',
      '<link rel="stylesheet" data-minify="true" data-rocket-async="other" href="/b.css">',
      '<link rel="stylesheet" data-minify="1" href="">',
      '<link rel="stylesheet" data-minify="1">',
      '<link rel="stylesheet" data-wpr-hosted-gf-parameters="" href="/fonts.css">'
    ].join('');
    expect(
      collectPageStylesheets(document).reply.styles.map((style) => [
        style.minifyAttribute,
        style.rocketAsync,
        style.hostedFont
      ])
    ).toEqual([
      [true, false, false],
      [false, false, false],
      // The stamp counts only beside a non-empty href, as the detection reads it.
      [false, false, false],
      [false, false, false],
      [false, false, true]
    ]);
  });

  it('never gives an inline style a link fact', () => {
    document.head.innerHTML =
      '<style data-minify="1" data-rocket-async="style" data-wpr-hosted-gf-parameters="x">.a{}</style>';
    expect(collectPageStylesheets(document).reply.styles).toEqual([
      {
        kind: 'inline',
        id: '',
        className: '',
        href: '',
        media: '',
        preview: '.a{}',
        chars: 4,
        minifyAttribute: false,
        rocketAsync: false,
        hostedFont: false
      }
    ]);
  });

  it('lists at most the cap and still counts every stylesheet', () => {
    document.head.innerHTML =
      '<link rel="icon" href="/i.ico">'.repeat(5) +
      '<style></style>'.repeat(PAGE_STYLE_LIMITS.count + 2);
    const { reply, elements } = collectPageStylesheets(document);
    expect(reply.styles).toHaveLength(PAGE_STYLE_LIMITS.count);
    expect(elements).toHaveLength(PAGE_STYLE_LIMITS.count);
    expect(reply.total).toBe(PAGE_STYLE_LIMITS.count + 2);
    expect(parsePageStylesheetsReply({ ...reply, snapshotId: SNAPSHOT_ID })).not.toBeNull();
  });
});

describe('the Stylesheets page over committed corpus pages, end to end', () => {
  /**
   * The page's rows as the panel builds them: the fixture's live list, read
   * by the collector, classified with the page facts of its detection snapshot.
   */
  function corpusStates(fixture: string): { id: string; href: string; states: string[] }[] {
    const dir = join(__dirname, '../../../lib/detection/fixtures');
    const html = readFileSync(join(dir, fixture), 'utf8');
    const detections = (
      JSON.parse(readFileSync(join(dir, `${fixture}.expected.json`), 'utf8')) as {
        wprDetections: WprDetections;
      }
    ).wprDetections;
    const page = new DOMParser().parseFromString(html, 'text/html');
    const reply = parsePageStylesheetsReply({
      ...collectPageStylesheets(page).reply,
      snapshotId: SNAPSHOT_ID
    });
    if (reply === null) throw new Error(`${fixture}: the collector's reply failed its guard`);
    return buildStylesheetRows(reply, stylesheetPageFacts(detections)).map((row) => ({
      id: row.elementId,
      href: row.href.replace(/^https:\/\/[^/]+/, '').replace(/\?.*$/, ''),
      states: CSS_STYLE_STATES.filter((state) => state.holds(row)).map((state) => state.id)
    }));
  }

  it('async CSS page: the live critical style, async links, the minified one; never the noscript fallbacks', () => {
    const states = corpusStates('async-css-link.html');
    expect(states.filter((row) => row.states.length > 0)).toEqual([
      { id: 'rocket-critical-css', href: '', states: ['critical'] },
      {
        id: '',
        href: '/wp-includes/css/dist/block-library/style.min.css',
        states: ['async']
      },
      {
        id: '',
        href: '/wp-content/cache/min/1/wp-content/themes/twentytwentyfive/style.css',
        states: ['async', 'minified']
      }
    ]);
    // The fallback copies inside <noscript> are not the page's stylesheets.
    expect(states.some((row) => row.id === 'theme-css')).toBe(false);
  });

  it('RUCSS page: the used-CSS style carries the RUCSS chip, nothing else is claimed', () => {
    const states = corpusStates('me-blog-alr.html');
    expect(states.filter((row) => row.states.length > 0)).toEqual([
      { id: 'wpr-usedcss', href: '', states: ['rucss'] }
    ]);
  });

  it('minify stamp without proof: the moved-cache-root link reads nothing', () => {
    expect(corpusStates('minify-attribute-only.html').flatMap((row) => row.states)).toEqual([]);
    expect(corpusStates('minify-moved-cache-root.html').flatMap((row) => row.states)).toEqual([
      'minified'
    ]);
  });
});
