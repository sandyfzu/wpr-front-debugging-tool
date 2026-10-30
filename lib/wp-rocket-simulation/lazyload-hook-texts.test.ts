import { describe, expect, it } from 'vitest';
import { LINEAR_SCALING_TIMEOUT_MS, linearScaling } from '../../vitest.shared';
import {
  beaconBlockBefore,
  elementEnds,
  generatorMetaBefore,
  lazyloadHookTexts,
  pageBeaconBlock,
  placeLazyloadHookTexts
} from './lazyload-hook-texts';
import type { SimulationData, SimulationVersionData } from './simulation-data';

/** A data file holding one version's LazyLoad texts (keys are arbitrary here: no hash check). */
const DATA: SimulationData = {
  format: 1,
  versions: {
    '3.24': {
      lazyload: {
        runtime: { sha256: 'r', bytes: 1, jsPath: 'lazyload/17.8.3/lazyload.min.js' },
        noJsStyle: { sha256: 'h' },
        optionsScript: { sha256: 'o' },
        runtimeTag: { beforeUrl: { sha256: 'b' }, afterUrl: { sha256: 'a' } },
        excludedAttributes: { sha256: 'x', count: 0 },
        excludedSrc: { sha256: 'y', count: 0 }
      }
    } as unknown as SimulationVersionData
  },
  texts: {
    h: '<noscript>H</noscript>',
    o: '<script>O</script>',
    b: '<script src="',
    a: '"></script>'
  },
  rowLists: {}
};

const ASSETS = 'https://example.org/wp-content/plugins/wp-rocket/assets/';

describe('lazyloadHookTexts', () => {
  it('builds the head text and the footer around the runtime URL from the data file', () => {
    expect(lazyloadHookTexts(DATA, '3.24', ASSETS)).toEqual({
      head: '<noscript>H</noscript>',
      footer: `<script>O</script><script src="${ASSETS}js/lazyload/17.8.3/lazyload.min.js"></script>`,
      runtimeUrl: `${ASSETS}js/lazyload/17.8.3/lazyload.min.js`
    });
  });

  it('throws naming an unknown version or a missing text', () => {
    expect(() => lazyloadHookTexts(DATA, '9.9', ASSETS)).toThrow('no version 9.9');
    expect(() => lazyloadHookTexts({ ...DATA, texts: {} }, '3.24', ASSETS)).toThrow('no text h');
  });
});

/** Texts easy to spot in placed pages. */
const TEXTS = { head: '[H]', footer: '[F]' };

const META = '<meta name="generator" content="WP Rocket 3.24" data-wpr-features="wpr_a wpr_b" />';
const DATA_SCRIPT = '<script>var rocket_beacon_data = {"a":1}</script>';
const BEACON_TAG = `<script data-name="wpr-wpr-beacon" src='https://e.org/js/wpr-beacon.min.js' async></script>`;

/**
 * The placed page, or the refusal.
 *
 * @param html The page.
 */
function place(html: string): string {
  const placed = placeLazyloadHookTexts(html, TEXTS);
  return placed.ok ? placed.html : `refused: ${placed.refused}`;
}

describe('placeLazyloadHookTexts', () => {
  it.each([
    ['one end tag of each', '<head></head><body></body>', '<head>[H]</head><body>[F]</body>'],
    ['caseless end tags', '<HEAD></HEAD><BODY></Body>', '<HEAD>[H]</HEAD><BODY>[F]</Body>'],
    [
      'the generator meta ending the head',
      `<head>${META}</head></body>`,
      `<head>[H]${META}</head>[F]</body>`
    ],
    [
      'the beacon block ending the body',
      `</head>${DATA_SCRIPT}${BEACON_TAG}</body>`,
      `[H]</head>[F]${DATA_SCRIPT}${BEACON_TAG}</body>`
    ],
    [
      'blocks apart from the end tags',
      `${META} </head>${DATA_SCRIPT}${BEACON_TAG}\n</body>`,
      `${META} [H]</head>${DATA_SCRIPT}${BEACON_TAG}\n[F]</body>`
    ]
  ])('%s', (_name, html, expected) => {
    expect(place(html)).toBe(expected);
  });

  it('reports where each text went', () => {
    expect(
      placeLazyloadHookTexts(`${META}</head>${DATA_SCRIPT}${BEACON_TAG}</body>`, TEXTS)
    ).toMatchObject({
      ok: true,
      placement: { head: 'before-generator-meta', footer: 'before-beacon-block', fallbacks: [] }
    });
    expect(placeLazyloadHookTexts('</head></body>', TEXTS)).toMatchObject({
      ok: true,
      placement: { head: 'before-end-tag', footer: 'before-end-tag', fallbacks: [] }
    });
  });

  it('takes the first of several head ends and the last of several body ends, named', () => {
    const placed = placeLazyloadHookTexts('a</head>b</HEAD>c</body>d</BODY>e', TEXTS);
    expect(placed).toEqual({
      ok: true,
      html: 'a[H]</head>b</HEAD>c</body>d[F]</BODY>e',
      placement: {
        head: 'before-end-tag',
        footer: 'before-end-tag',
        fallbacks: ['first-of-several-head-ends', 'last-of-several-body-ends']
      }
    });
  });

  it('places before an uppercase </BODY>: the buffer appends the beacon after it (case-sensitive strrpos)', () => {
    const page = `<head></head><body>x</BODY>${DATA_SCRIPT}${BEACON_TAG}`;
    expect(placeLazyloadHookTexts(page, TEXTS)).toEqual({
      ok: true,
      html: `<head>[H]</head><body>x[F]</BODY>${DATA_SCRIPT}${BEACON_TAG}`,
      placement: { head: 'before-end-tag', footer: 'before-end-tag', fallbacks: [] }
    });
  });

  it('names the several-</head> fallback alone, with the generator meta before the first', () => {
    const placed = placeLazyloadHookTexts(`${META}</head><svg></head></svg></body>`, TEXTS);
    expect(placed).toEqual({
      ok: true,
      html: `[H]${META}</head><svg></head></svg>[F]</body>`,
      placement: {
        head: 'before-generator-meta',
        footer: 'before-end-tag',
        fallbacks: ['first-of-several-head-ends']
      }
    });
  });

  it.each([
    ['no-head-end', '<body></body>'],
    ['no-body-end', '<head></head><body>'],
    ['no-head-end', ''],
    ['body-end-before-head-end', '</body></head>'],
    ['body-end-before-head-end', '</body></body></head></head>']
  ])('refuses %s: %j', (refused, html) => {
    expect(placeLazyloadHookTexts(html, TEXTS)).toEqual({ ok: false, refused });
  });

  it('keeps the footer after the head text when a beacon block would start before it', () => {
    const html = `<script>var rocket_beacon_data = </head></script>${BEACON_TAG}</body>`;
    expect(place(html)).toBe(
      `<script>var rocket_beacon_data = [H]</head></script>${BEACON_TAG}[F]</body>`
    );
  });
});

describe('elementEnds', () => {
  it('finds ASCII-caseless end tags only (no Unicode folding)', () => {
    expect(elementEnds('</HEAD></BODY>')).toEqual({ head: 0, body: 7, fallbacks: [] });
    // `K` (Kelvin sign) lowercases to `k` in Unicode, never in PCRE without `u`: no match shifts.
    expect(elementEnds('K</head></body>')).toEqual({ head: 1, body: 8, fallbacks: [] });
    expect(elementEnds('</hEAd ></body>')).toEqual({ refused: 'no-head-end' });
  });
});

describe('generatorMetaBefore', () => {
  it.each<[string, string, number | null]>([
    ['the meta', `x${META}`, 1],
    ['empty values', '<meta name="generator" content="WP Rocket" data-wpr-features="" />', 0],
    [
      'content only starting with WP Rocket',
      '<meta name="generator" content="WP Rocketish" data-wpr-features="a" />',
      0
    ],
    [
      'another generator',
      '<meta name="generator" content="WordPress 6.8" data-wpr-features="a" />',
      null
    ],
    ['content too short', '<meta name="generator" content="WP" data-wpr-features="a" />', null],
    ['case differs (the buffer writes it exactly)', META.toUpperCase(), null],
    [
      'no space before the slash',
      '<meta name="generator" content="WP Rocket" data-wpr-features="a"/>',
      null
    ],
    [
      'an extra attribute',
      '<meta name="generator" content="WP Rocket" data-x="1" data-wpr-features="a" />',
      null
    ],
    ['only the end', '" />', null],
    ['only the features', '" data-wpr-features="a" />', null],
    ['nothing', '', null],
    [
      'a quote inside a value',
      '<meta name="generator" content="WP Rocket"" data-wpr-features="a" />',
      null
    ]
  ])('%s', (_name, html, expected) => {
    expect(generatorMetaBefore(`${html}</head>`, html.length)).toBe(expected);
  });
});

describe('beaconBlockBefore', () => {
  it.each<[string, string, number | null]>([
    ['the block', `x${DATA_SCRIPT}${BEACON_TAG}`, 1],
    [
      'an empty data script and URL',
      `<script>var rocket_beacon_data = </script><script data-name="wpr-wpr-beacon" src='' async></script>`,
      0
    ],
    [
      'the leftmost data start after the last </script>',
      `<script>var rocket_beacon_data = <script>var rocket_beacon_data = 1</script>${BEACON_TAG}`,
      0
    ],
    [
      'a </script> inside the data',
      `<script>var rocket_beacon_data = a</script>b</script>${BEACON_TAG}`,
      null
    ],
    [
      'a data start after that </script>',
      `a</script><script>var rocket_beacon_data = 2</script>${BEACON_TAG}`,
      10
    ],
    ['the tag alone', BEACON_TAG, null],
    [
      'a double-quoted URL',
      `${DATA_SCRIPT}<script data-name="wpr-wpr-beacon" src="u" async></script>`,
      null
    ],
    ['no async', `${DATA_SCRIPT}<script data-name="wpr-wpr-beacon" src='u'></script>`, null],
    ['only the end', `' async></script>`, null],
    ['nothing', '', null]
  ])('%s', (_name, html, expected) => {
    expect(beaconBlockBefore(`${html}</body>`, html.length)?.start ?? null).toBe(expected);
  });

  it("reads the tag's raw URL", () => {
    expect(
      beaconBlockBefore(`x${DATA_SCRIPT}${BEACON_TAG}`, 1 + DATA_SCRIPT.length + BEACON_TAG.length)
    ).toEqual({
      start: 1,
      src: 'https://e.org/js/wpr-beacon.min.js'
    });
  });

  it('never takes a data start after the tag', () => {
    const html = `</script>${BEACON_TAG}</body><script>var rocket_beacon_data = `;
    expect(beaconBlockBefore(html, html.indexOf('</body>'))).toBeNull();
  });
});

describe('pageBeaconBlock', () => {
  const BLOCK = `${DATA_SCRIPT}${BEACON_TAG}`;

  it.each<[string, string, number | null]>([
    ['the block abutting the last </body>', `a</body>${BLOCK}</BODY>`, 8],
    ['a lookalike in a comment after the real block', `${BLOCK}</body><!--${BLOCK}-->`, 0],
    ['a block not abutting the last </body>', `${BLOCK}</body>x</body>`, null],
    ['no </body>', BLOCK, null]
  ])('%s', (_name, html, expected) => {
    expect(pageBeaconBlock(html)?.start ?? null).toBe(expected);
  });
});

/**
 * `unit` repeated to `bytes`.
 *
 * @param unit The repeated text.
 * @param bytes The target length.
 */
const fill = (unit: string, bytes: number): string => unit.repeat(Math.ceil(bytes / unit.length));

describe('placement on hostile pages', () => {
  it.each<[string, (bytes: number) => string]>([
    [
      'quotes before the head end',
      (bytes) => `${fill('" data-wpr-features="', bytes)}" /></head></body>`
    ],
    ['end tags everywhere', (bytes) => fill('</head></body></HEAD></BODY>', bytes)],
    [
      'data starts and </script>s before the beacon tag',
      (bytes) =>
        `</head>${fill('<script>var rocket_beacon_data = </script>', bytes)}${BEACON_TAG}</body>`
    ],
    [
      'a long data script',
      (bytes) =>
        `</head><script>var rocket_beacon_data = ${fill('<scrip', bytes)}</script>${BEACON_TAG}</body>`
    ],
    ['quotes before the body end', (bytes) => `</head>${fill(`' async></script>`, bytes)}</body>`]
  ])(
    '%s',
    (_name, build) => {
      expect(
        linearScaling(build, (html) => placeLazyloadHookTexts(html, TEXTS)).violation
      ).toBeUndefined();
    },
    LINEAR_SCALING_TIMEOUT_MS
  );
});
