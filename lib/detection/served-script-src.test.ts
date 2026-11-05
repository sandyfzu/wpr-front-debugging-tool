/**
 * The served-URL rule every URL-recognizing check reads: a delayed tag's
 * non-empty `data-rocket-src` before `src`, resolved like the `src` property.
 */
import { describe, expect, it } from 'vitest';
import { servedSrcOf } from '../wp-rocket/delayed-script';
import { servedScriptSrc, servedScriptSrcAttribute } from './served-script-src';

/** The first script of a parsed document (the test runner's base: `http://localhost:3000/`). */
function script(html: string): HTMLScriptElement {
  const found = new DOMParser().parseFromString(html, 'text/html').querySelector('script');
  if (found === null) throw new Error(`no script in fixture: ${html}`);
  return found;
}

const DELAYED_URL = 'https://s.example/wp-content/cache/min/1/a.js';

describe('servedScriptSrcAttribute', () => {
  it.each([
    [
      'delayed',
      `<script type="rocketlazyloadscript" data-rocket-src="${DELAYED_URL}"></script>`,
      DELAYED_URL
    ],
    ['plain', '<script src="/a.js"></script>', '/a.js'],
    [
      'both: the delayed URL wins',
      '<script type="text/rocketlazyloadscript" src="/x.js" data-rocket-src="/a.js"></script>',
      '/a.js'
    ],
    [
      'empty data-rocket-src falls back',
      '<script type="rocketlazyloadscript" data-rocket-src="" src="/a.js"></script>',
      '/a.js'
    ],
    [
      'valueless data-rocket-src falls back',
      '<script type="rocketlazyloadscript" data-rocket-src src="/a.js"></script>',
      '/a.js'
    ],
    ['valueless src stays empty', '<script src></script>', ''],
    [
      'undelayed tag: data-rocket-src is ignored',
      '<script data-rocket-src="/a.js" src="/x.js"></script>',
      '/x.js'
    ],
    ['undelayed tag without src', '<script data-rocket-src="/a.js"></script>', null],
    [
      'delay type matches case-insensitively',
      '<script type="TEXT/RocketLazyLoadScript" data-rocket-src="/a.js"></script>',
      '/a.js'
    ],
    [
      'the marker must end the type',
      '<script type="rocketlazyloadscript-x" data-rocket-src="/a.js" src="/x.js"></script>',
      '/x.js'
    ],
    [
      'whitespace-only data-rocket-src is a value',
      '<script type="rocketlazyloadscript" data-rocket-src=" " src="/x.js"></script>',
      ' '
    ],
    [
      'empty data-rocket-src alone',
      '<script type="rocketlazyloadscript" data-rocket-src=""></script>',
      null
    ],
    ['inline', '<script>x()</script>', null]
  ])('%s', (_case, html, expected) => {
    expect(servedScriptSrcAttribute(script(html))).toBe(expected);
  });
});

describe('servedScriptSrc', () => {
  it.each([
    [
      'delayed absolute',
      `<script type="rocketlazyloadscript" data-rocket-src="${DELAYED_URL}"></script>`,
      DELAYED_URL
    ],
    [
      'delayed relative resolves against the document',
      '<script type="rocketlazyloadscript" data-rocket-src="/wp-content/cache/min/1/a.js"></script>',
      'http://localhost:3000/wp-content/cache/min/1/a.js'
    ],
    ['plain resolves like `src`', '<script src="/a.js"></script>', 'http://localhost:3000/a.js'],
    [
      'both: the delayed URL wins',
      '<script type="text/rocketlazyloadscript" src="/x.js" data-rocket-src="/a.js"></script>',
      'http://localhost:3000/a.js'
    ],
    [
      'empty data-rocket-src falls back to `src`',
      '<script type="rocketlazyloadscript" data-rocket-src="" src="/a.js"></script>',
      'http://localhost:3000/a.js'
    ],
    [
      'undelayed tag reads `src`',
      '<script data-rocket-src="/a.js" src="/x.js"></script>',
      'http://localhost:3000/x.js'
    ],
    [
      'protocol-relative delayed URL takes the document scheme',
      '<script type="rocketlazyloadscript" data-rocket-src="//cdn.example/a.js"></script>',
      'http://cdn.example/a.js'
    ],
    [
      'whitespace-only delayed URL resolves like `src` (the document URL)',
      '<script type="rocketlazyloadscript" data-rocket-src="  "></script>',
      'http://localhost:3000/'
    ],
    ['no URL at all', '<script>x()</script>', ''],
    [
      'unparseable delayed URL stays raw',
      '<script type="rocketlazyloadscript" data-rocket-src="http://[x"></script>',
      'http://[x'
    ]
  ])('%s', (_case, html, expected) => {
    expect(servedScriptSrc(script(html))).toBe(expected);
  });

  it('honors the document base for a delayed URL', () => {
    const delayed = script(
      '<head><base href="https://cdn.example/sub/"></head><script type="rocketlazyloadscript" data-rocket-src="a.js"></script>'
    );
    expect(servedScriptSrc(delayed)).toBe('https://cdn.example/sub/a.js');
  });
});

describe('servedSrcOf (the shared rule) on live elements', () => {
  it('agrees with the element reader on the same attributes', () => {
    const element = script(
      `<script type="rocketlazyloadscript" data-rocket-src="" src="https://s.example/x.js"></script>`
    );
    expect(
      servedSrcOf({
        type: element.getAttribute('type'),
        delayedSrc: element.getAttribute('data-rocket-src'),
        src: element.getAttribute('src')
      })
    ).toBe(servedScriptSrcAttribute(element));
  });
});
