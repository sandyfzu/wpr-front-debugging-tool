/**
 * The forward LazyLoad (images) transform runs synchronously on the
 * document's critical path, so it must stay linear on any page: pages
 * shaped against each scan (where PCRE backtracks or rescans), against the
 * `str_replace` rewrites, plus a realistic page — each timed at 1 and 4 MiB.
 */
import { describe, expect, it } from 'vitest';
import { LINEAR_SCALING_TIMEOUT_MS, linearScaling } from '../../vitest.shared';
import {
  lazyloadExclusions,
  simulateLazyloadImages,
  type LazyloadForwardResult
} from './lazyload-forward';

/**
 * `unit` repeated to `bytes`.
 *
 * @param unit The repeated text.
 * @param bytes The target length.
 */
const fill = (unit: string, bytes: number): string => unit.repeat(Math.ceil(bytes / unit.length));

/**
 * Units numbered until `bytes`.
 *
 * @param unit Builds the unit from its index.
 * @param bytes The target length.
 */
const numbered = (unit: (index: number) => string, bytes: number): string => {
  const parts: string[] = [];
  let length = 0;
  for (let index = 0; length < bytes; index++) {
    const part = unit(index);
    parts.push(part);
    length += part.length;
  }
  return parts.join('');
};

/** A line of text. */
const PARAGRAPH = '<p class="text">lorem ipsum dolor sit amet lorem ipsum dolor sit amet</p>\n';

/** A logo excluded by a WP Rocket literal yet carrying native lazy loading. */
const EXCLUDED_LOGO = '<img src="/logo.png" class="custom-logo skip-lazy" loading="lazy">\n';

/**
 * `count` image-optimizer pictures (a WebP source, then the image), one per line.
 *
 * @param count How many.
 */
const webpPictures = (count: number): string =>
  Array.from(
    { length: count },
    (_, i) =>
      `<picture><source type="image/webp" srcset="/p${String(i)}.jpg.webp"><img src="/p${String(i)}.jpg" width="300" height="200" alt=""></picture>\n`
  ).join('');

/**
 * `count` distinct images with native lazy loading, one per line.
 *
 * @param count How many.
 */
const lazyImages = (count: number): string =>
  Array.from(
    { length: count },
    (_, i) =>
      `<img src="/i${String(i)}.jpg" width="300" height="200" loading="lazy" decoding="async">\n`
  ).join('');

const LITERALS = lazyloadExclusions(
  { excludedAttributes: ['data-no-lazy=', 'skip-lazy'], excludedSrc: ['/wpcf7_captcha/'] },
  ['keep']
);

/**
 * Simulate a page with a few rows.
 *
 * @param html The page.
 */
const simulate = (html: string): LazyloadForwardResult =>
  simulateLazyloadImages({
    html,
    literals: { excludedAttributes: LITERALS.attributes, excludedSrc: LITERALS.src },
    rows: []
  });

describe('simulateLazyloadImages — linear on hostile pages', () => {
  it.each<[string, (bytes: number) => string]>([
    ['an unclosed `<script>`', (bytes) => `<script>${'a'.repeat(bytes)}`],
    ['`<script>` openings with no close', (bytes) => fill('<script>a', bytes)],
    ['an unclosed `<noscript>` with tags', (bytes) => `<noscript>${fill('<p>a', bytes)}`],
    ['an unclosed `<picture>` before many `>`', (bytes) => `<picture>${fill('>a', bytes)}`],
    [
      'an unclosed `<picture-x>` near the end',
      (bytes) => `${fill('<p>t</p>', bytes)}<picture-x>a>`
    ],
    ['`<picture` openings with no `>`', (bytes) => fill('<picture', bytes)],
    ['`<img ` before one far `>`', (bytes) => `<img ${'a'.repeat(bytes)}>`],
    ['`<img ` openings with no `>`', (bytes) => fill('<img a', bytes)],
    [
      'long attribute runs on one image',
      (bytes) => `<img src="/a.jpg"${fill(' data-x="y"', bytes)}>`
    ],
    [
      'many distinct lazy images (one pass)',
      (bytes) => numbered((i) => `<img src="/${String(i)}.jpg">`, bytes)
    ],
    [
      'many distinct excluded images with loading=lazy (replayed, bounded)',
      (bytes) => numbered((i) => `<img src="/${String(i)}.jpg" loading="lazy" class="keep">`, bytes)
    ],
    [
      'nested images (replayed, bounded)',
      (bytes) =>
        numbered(
          (i) =>
            `<img alt="<img src='/${String(i)}.jpg'" src="/o${String(i)}.jpg"><img src='/${String(i)}.jpg'>`,
          bytes
        )
    ],
    [
      'many pictures (replayed, bounded)',
      (bytes) =>
        numbered(
          (i) =>
            `<picture><source srcset="/${String(i)}.webp"><img src="/${String(i)}.jpg"></picture>`,
          bytes
        )
    ],
    [
      'one picture image repeated in noscript stretches',
      (bytes) =>
        `<picture><img src="/a.jpg"></picture>${fill('<noscript><img src="/a.jpg"></noscript>', bytes)}`
    ],
    [
      '`<noscript>` openings on one line before a picture image',
      (bytes) => `${fill('<noscript>', bytes)}<picture><img src="/a.jpg"></picture>`
    ],
    ['background candidates with no `>`', (bytes) => fill('<div a=', bytes)],
    ['background candidates with unclosed quotes', (bytes) => `<div ${fill('="a', bytes)}>`],
    [
      'many background images (replayed, bounded)',
      (bytes) =>
        numbered((i) => `<div style="background-image:url(/${String(i)}.png)">x</div>`, bytes)
    ],
    ['`style=` candidates inside one tag', (bytes) => `<div ${fill(' style="x', bytes)}>`],
    [
      '150 WebP pictures before text (replayed per picture)',
      (bytes) => `${webpPictures(150)}${fill(PARAGRAPH, bytes)}`
    ],
    [
      'an excluded `loading=lazy` logo and 300 images before text (replayed)',
      (bytes) => `${EXCLUDED_LOGO}${lazyImages(300)}${fill(PARAGRAPH, bytes)}`
    ],
    ['pictures before dense tags', (bytes) => `${webpPictures(62)}${fill('<b>x</b>\n', bytes)}`],
    [
      'pictures before noscript blocks',
      (bytes) => `${webpPictures(62)}${fill('<noscript>a</noscript>', bytes)}`
    ],
    [
      'noscript blocks on one line before pictures',
      (bytes) => `${fill('<noscript>a</noscript>', bytes)}${webpPictures(200).replaceAll('\n', '')}`
    ],
    ['an unclosed `<img ` tail', (bytes) => `<img src="/a.jpg"><img ${'a'.repeat(bytes)}`],
    ['unclosed `<picture` openings', (bytes) => `<picture>a</picture>${fill('<picture a', bytes)}`],
    [
      'multibyte attributes',
      (bytes) => numbered((i) => `<img src="/é${String(i)}.jpg" alt="ééé">`, bytes)
    ]
  ])(
    '%s',
    (_name, build) => {
      expect(linearScaling(build, simulate).violation).toBeUndefined();
    },
    LINEAR_SCALING_TIMEOUT_MS
  );

  it.each<[string, string, Partial<LazyloadForwardResult['report']>]>([
    ['150 WebP pictures', webpPictures(150), { state: 'simulated', pictures: 150 }],
    [
      'an excluded `loading=lazy` logo and 300 images',
      EXCLUDED_LOGO + lazyImages(300),
      { state: 'simulated', images: 300 }
    ]
  ])('a realistic 1 MB page with %s: simulated', (_name, head, report) => {
    const html = `<!DOCTYPE html><html><head></head><body>${head}${fill(PARAGRAPH, 1_000_000)}</body></html>`;
    expect(simulate(html).report).toMatchObject(report);
  });

  it(
    'a realistic page: distinct images, a picture, a few backgrounds, scripts — simulated at 4 MiB',
    () => {
      const block = (index: number): string =>
        `<p>${'text '.repeat(40)}</p><img src="/wp-content/uploads/a${String(index)}.jpg" width="300" height="200" loading="lazy" srcset="/a${String(index)}-300.jpg 300w, /a${String(index)}-600.jpg 600w" sizes="(max-width: 300px) 100vw, 300px"><script>var x=${String(index)};</script>\n`;
      const backgrounds = Array.from(
        { length: 20 },
        (_, index) =>
          `<div class="wp-block-cover" style="background-image:url(/bg${String(index)}.jpg)">c</div>`
      ).join('');
      const page = (bytes: number): string =>
        `<!DOCTYPE html><html><head><title>t</title></head><body><picture><source srcset="/h.webp" type="image/webp"><img src="/h.jpg"></picture>${backgrounds}${numbered(block, bytes)}</body></html>`;
      const scaling = linearScaling(page, simulate);
      expect(scaling.violation).toBeUndefined();
      expect(scaling.output?.report).toMatchObject({
        state: 'simulated',
        pictures: 1,
        backgrounds: 20
      });
    },
    LINEAR_SCALING_TIMEOUT_MS
  );
});
