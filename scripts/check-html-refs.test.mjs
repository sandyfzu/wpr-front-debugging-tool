import { describe, expect, it } from 'vitest';
import {
  buildPath,
  entryModule,
  importsCss,
  isLocalReference,
  pageProblems,
  pageReferences,
  pairPages
} from './check-html-refs.mjs';

/* Pure pieces of the built-HTML reference gate; the CLI `main()` (directory walk + printing) is thin glue. */

/** The panel's source page as it is shaped today. */
const SOURCE = `<!doctype html><html><head>
<link rel="stylesheet" href="../../assets/css/theme.css" />
<link rel="icon" type="image/png" sizes="16x16" href="/icon/16.png" />
<script type="module" src="./main.tsx"></script></head></html>`;

/** A sound built page for {@link SOURCE}. */
const BUILT = `<!doctype html><html><head>
<link rel="icon" type="image/png" sizes="16x16" href="/icon/16.png">
<script type="module" crossorigin src="/chunks/panel-a1.js"></script>
<link rel="modulepreload" crossorigin href="/chunks/types-b2.js">
<link rel="stylesheet" crossorigin href="/assets/theme-c3.css"></head></html>`;

/** Every path of {@link BUILT}, each 10 bytes. */
const sizes = (overrides = {}) => {
  const table = {
    'icon/16.png': 10,
    'chunks/panel-a1.js': 10,
    'chunks/types-b2.js': 10,
    'assets/theme-c3.css': 10,
    ...overrides
  };
  return (path) => (path in table ? table[path] : null);
};

describe('pageReferences', () => {
  it('reads link/script URLs with rel and type, either quote style, any case', () => {
    expect(
      pageReferences(
        `<LINK REL="Stylesheet" HREF='/a.css'><script src="/b.js" type=module></script>`
      )
    ).toEqual([
      { tag: 'link', rel: 'stylesheet', type: '', url: '/a.css' },
      // An unquoted attribute value is not read (the bundler always quotes).
      { tag: 'script', rel: '', type: '', url: '/b.js' }
    ]);
  });

  it('skips tags without a URL (inline scripts) and never reads data-href look-alikes', () => {
    expect(pageReferences('<script>1</script><link data-href="/x.css" rel="icon">')).toEqual([]);
  });
});

describe('isLocalReference / buildPath', () => {
  it.each([
    'https://x.test/a.js',
    'data:text/css,',
    '//cdn.test/a.js',
    '#top',
    'chrome-extension://id/a',
    ' '
  ])('treats %j as not naming a build file', (url) => {
    expect(isLocalReference(url)).toBe(false);
  });

  it('maps root-absolute and relative URLs to build paths, dropping query and fragment', () => {
    expect(isLocalReference('/chunks/a.js')).toBe(true);
    expect(buildPath('/chunks/a.js?v=1#x')).toBe('chunks/a.js');
    expect(buildPath('./assets/a.css')).toBe('assets/a.css');
    expect(buildPath('assets/a.css')).toBe('assets/a.css');
  });
});

describe('pageProblems', () => {
  it('passes a sound page', () => {
    expect(pageProblems('panel.html', SOURCE, BUILT, sizes())).toEqual([]);
  });

  it('names a reference to a missing or empty file', () => {
    expect(
      pageProblems('panel.html', SOURCE, BUILT, sizes({ 'chunks/types-b2.js': 0 })).concat(
        pageProblems('panel.html', SOURCE, BUILT.replace('theme-c3', 'theme-zz'), sizes())
      )
    ).toEqual([
      'panel.html: "/chunks/types-b2.js" is an empty file',
      'panel.html: "/assets/theme-zz.css" names no emitted file'
    ]);
  });

  it('fails a dropped stylesheet (the page would render unstyled)', () => {
    const built = BUILT.replace(/<link rel="stylesheet"[^>]*>/, '');
    expect(pageProblems('panel.html', SOURCE, built, sizes())).toEqual([
      'panel.html: 0 emitted .css link(s) for 1 CSS input(s) (a stylesheet was dropped; the page renders unstyled)'
    ]);
  });

  it('fails a stylesheet link that is not CSS', () => {
    const built = BUILT.replace('/assets/theme-c3.css', '/chunks/panel-a1.js');
    expect(pageProblems('panel.html', SOURCE, built, sizes())).toEqual([
      'panel.html: 0 emitted .css link(s) for 1 CSS input(s) (a stylesheet was dropped; the page renders unstyled)'
    ]);
  });

  it("counts the entry module's own CSS: losing either emitted sheet fails", () => {
    // The shared token sheet + the page's own CSS, as the bundler emits them.
    const both = BUILT.replace(
      '</head>',
      '<link rel="stylesheet" crossorigin href="/assets/panel-d4.css"></head>'
    );
    const table = sizes({ 'assets/panel-d4.css': 10 });
    expect(pageProblems('panel.html', SOURCE, both, table, true)).toEqual([]);
    // Either sheet lost leaves one .css link — a pass under an "any .css link" rule.
    for (const lost of [/<link rel="stylesheet"[^>]*theme-c3[^>]*>/, /<link[^>]*panel-d4[^>]*>/]) {
      expect(pageProblems('panel.html', SOURCE, both.replace(lost, ''), table, true)).toEqual([
        'panel.html: 1 emitted .css link(s) for 2 CSS input(s) (a stylesheet was dropped; the page renders unstyled)'
      ]);
    }
  });

  it('fails an unprocessed source reference and a dropped module script', () => {
    const built = BUILT.replace(
      '<script type="module" crossorigin src="/chunks/panel-a1.js"></script>',
      '<script src="./main.tsx"></script><link rel="preload" href="../../assets/x.png">'
    );
    expect(pageProblems('panel.html', SOURCE, built, sizes())).toEqual([
      'panel.html: <script> still points at source "./main.tsx" (unprocessed)',
      'panel.html: <link> still points at source "../../assets/x.png" (unprocessed)',
      'panel.html: its source module script emitted no <script type="module">'
    ]);
  });

  it('fails a dropped absolute source reference (a public/ asset)', () => {
    const built = BUILT.replace(/<link rel="icon"[^>]*>/, '');
    expect(pageProblems('panel.html', SOURCE, built, sizes())).toEqual([
      'panel.html: source reference "/icon/16.png" was dropped from the built page'
    ]);
  });

  it('ignores external references on either side', () => {
    const source = `${SOURCE}<link rel="preconnect" href="https://x.test">`;
    const built = `${BUILT}<script src="https://x.test/a.js"></script>`;
    expect(pageProblems('panel.html', source, built, sizes())).toEqual([]);
  });
});

describe('importsCss / entryModule', () => {
  it.each([
    ["import './style.css';", true],
    ['import "../x/a.css?inline"', true],
    ["  import './style.css'", true],
    ["import { x } from './style.css.ts';", false],
    ["// see './style.css'", false],
    ["const s = import('./lazy.css');", false],
    ["import './style.scss';", false]
  ])('reads %j as a CSS side-effect import: %s', (source, expected) => {
    expect(importsCss(source)).toBe(expected);
  });

  it('finds the first local module script, relative to the page folder', () => {
    expect(entryModule(SOURCE)).toBe('main.tsx');
    expect(entryModule('<script type="module" src="https://x.test/a.js"></script>')).toBeNull();
    expect(entryModule('<script src="./classic.js"></script>')).toBeNull();
  });
});

describe('pairPages', () => {
  it('pairs built pages with their entrypoint and names a built page without one', () => {
    expect(pairPages(['panel.html', 'stray.html'], ['panel', 'options'], 'chrome-mv3')).toEqual({
      pairs: ['panel'],
      problems: ['chrome-mv3/stray.html: no source page']
    });
  });
});
