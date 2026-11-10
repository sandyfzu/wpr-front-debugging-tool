import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from './fixtures/corpus';
import { parsePage } from './parse-page';
import {
  carriesAsyncCssAttribute,
  hasAsyncCssLink,
  insideNoscript,
  isStylesheetLink
} from './stylesheet-links';

/** The parsed page's links around the given body markup. */
function links(body: string): HTMLLinkElement[] {
  return parsePage(`<!doctype html><html><head></head><body>${body}</body></html>`).links;
}

describe('insideNoscript', () => {
  it('finds a <noscript> at any ancestor depth, nothing elsewhere', () => {
    const [outside, direct, nested] = links(
      '<link rel="stylesheet" href="/a.css"><noscript><link rel="stylesheet" href="/b.css">' +
        '<span><link rel="stylesheet" href="/c.css"></span></noscript>'
    );
    expect([outside, direct, nested].map((link) => link && insideNoscript(link))).toEqual([
      false,
      true,
      true
    ]);
  });
});

describe('carriesAsyncCssAttribute', () => {
  it('reads data-rocket-async="style" exactly', () => {
    const marked = links(
      '<link data-rocket-async="style"><link data-rocket-async="STYLE"><link data-rocket-async>' +
        '<link data-rocket-async="script"><link>'
    );
    expect(marked.map(carriesAsyncCssAttribute)).toEqual([true, false, false, false, false]);
  });
});

describe('isStylesheetLink', () => {
  const cases: [markup: string, expected: boolean][] = [
    ['<link rel="stylesheet" href="/a.css">', true],
    // Exact rel, as the stylesheet reading always was.
    ['<link rel="STYLESHEET" href="/a.css">', false],
    ['<link rel="alternate stylesheet" href="/a.css">', false],
    // The async swap, still preloading.
    ['<link rel="preload" as="style" data-rocket-async="style" href="/a.css">', true],
    ['<link rel="preload" as="style" href="/a.css">', false],
    ['<link rel="preload" as="font" data-rocket-async="style" href="/a.css">', false],
    ['<link rel="preload" data-rocket-async="style" href="/a.css">', false],
    ['<link rel="prefetch" as="style" data-rocket-async="style" href="/a.css">', false],
    ['<noscript><link rel="stylesheet" href="/a.css"></noscript>', false],
    [
      '<noscript><link rel="preload" as="style" data-rocket-async="style" href="/a.css"></noscript>',
      false
    ]
  ];
  for (const [markup, expected] of cases) {
    it(`${markup} ⇒ ${String(expected)}`, () => {
      const [link] = links(markup);
      expect(link && isStylesheetLink(link)).toBe(expected);
    });
  }
});

describe('hasAsyncCssLink', () => {
  it('is true for one stamped link outside <noscript>, any rel', () => {
    expect(hasAsyncCssLink(links('<link rel="stylesheet" data-rocket-async="style">'))).toBe(true);
    expect(hasAsyncCssLink(links('<link rel="preload" data-rocket-async="style">'))).toBe(true);
    expect(hasAsyncCssLink(links('<link rel="preload" as="style">'))).toBe(false);
    expect(
      hasAsyncCssLink(
        links('<noscript><link rel="stylesheet" data-rocket-async="style"></noscript>')
      )
    ).toBe(false);
    expect(hasAsyncCssLink([])).toBe(false);
  });
});

describe('the async CSS fixture (WP Rocket 3.24 markup)', () => {
  const page = parsePage(readFileSync(join(FIXTURE_DIR, 'async-css-link.html'), 'utf8'));

  it('parses the <noscript> fallback links as elements (raw HTML, scripting off)', () => {
    expect(page.links.filter(insideNoscript)).toHaveLength(2);
  });

  it('counts only the head links as stylesheets: two swapped + the print one', () => {
    // Fails without the <noscript> guard (five candidates).
    expect(page.links.filter(isStylesheetLink).map((link) => link.getAttribute('rel'))).toEqual([
      'preload',
      'preload',
      'stylesheet'
    ]);
    expect(page.links.filter((link) => carriesAsyncCssAttribute(link))).toHaveLength(2);
  });
});
