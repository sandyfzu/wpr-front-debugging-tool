import { describe, expect, it } from 'vitest';
import { LINEAR_SCALING_TIMEOUT_MS, linearScaling } from '../../vitest.shared';
import { LAZYLOAD_IFRAME_SELECTOR, LAZYLOAD_IMG_SELECTOR } from './constants';
import { hasLazyloadOptions } from './lazyload-options';

const IMG = [LAZYLOAD_IMG_SELECTOR];
const IFRAME = [LAZYLOAD_IFRAME_SELECTOR];
const EITHER = [LAZYLOAD_IMG_SELECTOR, LAZYLOAD_IFRAME_SELECTOR];

/** WP Rocket 3.24's minified options script head (no `SCRIPT_DEBUG`), as served. */
const MINIFIED =
  'window.lazyLoadOptions=[{elements_selector:"img[data-lazy-src],.rocket-lazyload,iframe[data-lazy-src]",data_src:"lazy-src",threshold:300}];';

/** The same script under `SCRIPT_DEBUG` (its head, byte for byte from `Assets.php`). */
const READABLE =
  'window.lazyLoadOptions = [{\n' +
  '                elements_selector: "img[data-lazy-src],.rocket-lazyload,iframe[data-lazy-src]",\n' +
  '                data_src: "lazy-src",\n';

/** …and its iframes-only variant (no CSS background arm: `{`, no `[`). */
const READABLE_IFRAMES =
  'window.lazyLoadOptions = {\n' +
  '                elements_selector: "iframe[data-lazy-src]",\n' +
  '                data_src: "lazy-src",\n';

describe('hasLazyloadOptions', () => {
  it.each([
    ['minified', MINIFIED, EITHER, true],
    ['minified, image selector', MINIFIED, IMG, true],
    ['minified, iframe selector', MINIFIED, IFRAME, true],
    ['readable (SCRIPT_DEBUG)', READABLE, IMG, true],
    ['readable, iframe selector', READABLE, IFRAME, true],
    ['readable iframes-only', READABLE_IFRAMES, IFRAME, true],
    ['readable iframes-only, image selector', READABLE_IFRAMES, IMG, false],
    ['CRLF line breaks', READABLE.replaceAll('\n', '\r\n'), IMG, true]
  ])('reads WP Rocket’s %s options script', (_name, text, selectors, expected) => {
    expect(hasLazyloadOptions(text, selectors)).toBe(expected);
  });

  it.each([
    ['tabs around `=`', 'window.lazyLoadOptions\t=\t{elements_selector:"img[data-lazy-src]"}'],
    ['newlines around `=`', 'window.lazyLoadOptions\n=\n{elements_selector:"img[data-lazy-src]"}'],
    [
      'a line break between openers',
      'window.lazyLoadOptions = [\n  {\n    s: "img[data-lazy-src]"'
    ],
    ['the selector right after `=`', 'window.lazyLoadOptions=img[data-lazy-src]'],
    ['any text before the selector on its line', 'window.lazyLoadOptions=x img[data-lazy-src] q'],
    ['a prefix before `window`', 'mywindow.lazyLoadOptions=img[data-lazy-src]'],
    ['a mention inside a comment', '/* window.lazyLoadOptions = {img[data-lazy-src]} */'],
    [
      'a comparison (`==`, the old rule’s reading)',
      'if (window.lazyLoadOptions == "img[data-lazy-src]")'
    ],
    [
      'a later assignment on an already-searched line',
      'window.lazyLoadOptions=1; window.lazyLoadOptions = {\n  s: "img[data-lazy-src]"'
    ],
    [
      'an assignment after an unassigned mention',
      'window.lazyLoadOptions;window.lazyLoadOptions=img[data-lazy-src]'
    ]
  ])('matches %s', (_name, text) => {
    expect(hasLazyloadOptions(text, IMG)).toBe(true);
  });

  it.each([
    ['a longer identifier', 'window.lazyLoadOptionsX={elements_selector:"img[data-lazy-src]"}'],
    [
      'a property of the global',
      "window.lazyLoadOptions.img = [{ elements_selector: 'img[data-lazy-src]' }];"
    ],
    [
      'the bare global (no `window.`)',
      'var lazyLoadOptions = {elements_selector:"img[data-lazy-src]"};'
    ],
    ['a mention without assignment', 'var docs = "see window.lazyLoadOptions"; img[data-lazy-src]'],
    ['the selector a line below a value', 'window.lazyLoadOptions={}\nvar s="img[data-lazy-src]";'],
    [
      'the selector below a non-opener line',
      'window.lazyLoadOptions = {\n  a: 1,\n  s: "img[data-lazy-src]"'
    ],
    ['the selector after a U+2028 break', 'window.lazyLoadOptions=1\u2028img[data-lazy-src]'],
    ['the selector before the assignment', 'img[data-lazy-src];window.lazyLoadOptions={}'],
    [
      'a theme’s vanilla-lazyload setup',
      'window.lazyLoadOptions = { elements_selector: ".lazy" };'
    ],
    ['an empty text', ''],
    ['a dangling assignment', 'window.lazyLoadOptions =   ']
  ])('does not match %s', (_name, text) => {
    expect(hasLazyloadOptions(text, IMG)).toBe(false);
  });

  it('needs one of the given selectors', () => {
    expect(hasLazyloadOptions(MINIFIED, [])).toBe(false);
    expect(hasLazyloadOptions(READABLE, ['video[data-lazy-src]'])).toBe(false);
  });

  it.each([
    ['assignments sharing a selector-less line', 'window.lazyLoadOptions=1;'],
    ['unassigned lookalikes', 'window.lazyLoadOptionsX '],
    ['assignments each opening a long opener run', 'window.lazyLoadOptions = [{ \n'],
    ['gaps never reaching `=`', 'window.lazyLoadOptions      \t\n']
  ])(
    'reads %s in linear time',
    (_name, unit) => {
      const text = (bytes: number): string => unit.repeat(Math.ceil(bytes / unit.length));
      const scaling = linearScaling(text, (input) => hasLazyloadOptions(input, EITHER));
      expect(scaling.violation).toBeUndefined();
      expect(scaling.output).toBe(false);
    },
    LINEAR_SCALING_TIMEOUT_MS
  );
});
