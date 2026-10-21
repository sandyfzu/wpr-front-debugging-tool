/**
 * The declaration-only boundary additions: the two new rows, the cache
 * marker invariant, the bypass mark and the defer count. The shared fixtures
 * keep the base payload genuine.
 */
import { describe, expect, it } from 'vitest';
import { parseFdtData, parseWprDetections } from './validate';
import { minimalDetections, validFdt, validDetections } from './validate.fixtures';

describe('the new declaration-only rows', () => {
  it('accepts presence with an optional source and rejects unknown keys', () => {
    for (const row of ['self_hosted_fonts', 'image_dimensions']) {
      const base = minimalDetections();
      expect(
        parseWprDetections({ ...base, [row]: { present: true, source: 'meta' } }),
        row
      ).not.toBeNull();
      expect(parseWprDetections({ ...base, [row]: { present: false } }), row).not.toBeNull();
      expect(parseWprDetections({ ...base, [row]: { present: true, extra: 1 } }), row).toBeNull();
      expect(
        parseWprDetections({ ...base, [row]: { present: true, source: 'heuristic' } }),
        row
      ).toBeNull();
    }
  });

  it('an own source: undefined is not engine output', () => {
    const base = minimalDetections();
    expect(
      parseWprDetections({
        ...base,
        self_hosted_fonts: { present: false, source: undefined }
      })
    ).toBeNull();
  });
});

describe('the cache marker invariant', () => {
  const baseWpr = {
    present: true,
    cacheMarkerFound: false,
    cached: false,
    version: null,
    timeStamp: null
  };
  const cases: Array<[string, Record<string, unknown>, boolean]> = [
    ['absent row', baseWpr, true],
    ['signature only', { ...baseWpr, cacheMarkerFound: true }, true],
    ['cached', { ...baseWpr, cacheMarkerFound: true, cached: true, timeStamp: 1 }, true],
    ['marker without presence', { ...baseWpr, present: false, cacheMarkerFound: true }, false],
    [
      'cached without presence',
      { ...baseWpr, present: false, cacheMarkerFound: true, cached: true },
      false
    ],
    ['cached without marker', { ...baseWpr, cached: true }, false],
    ['stamp without cached', { ...baseWpr, timeStamp: 123 }, false],
    ['negative stamp', { ...baseWpr, cacheMarkerFound: true, cached: true, timeStamp: -1 }, false],
    [
      'fractional stamp',
      { ...baseWpr, cacheMarkerFound: true, cached: true, timeStamp: 1.5 },
      false
    ],
    [
      'stamp past the display ceiling',
      { ...baseWpr, cacheMarkerFound: true, cached: true, timeStamp: 253_402_300_800 },
      false
    ],
    [
      'display ceiling exactly',
      { ...baseWpr, cacheMarkerFound: true, cached: true, timeStamp: 253_402_300_799 },
      true
    ]
  ];
  for (const [name, wpr, accepted] of cases) {
    it(`${accepted ? 'accepts' : 'rejects'} ${name}`, () => {
      const payload = { ...minimalDetections(), wpr };
      expect(parseWprDetections(payload)).toEqual(accepted ? payload : null);
    });
  }
});

describe('the declaration-only row invariants', () => {
  it('replaceImage cannot be applied evidence on a refuted iframes row', () => {
    const base = minimalDetections();
    expect(
      parseWprDetections({
        ...base,
        lazyload_iframes: { present: false, replaceImage: true }
      })
    ).toBeNull();
    expect(
      parseWprDetections({ ...base, lazyload_iframes: { present: true, replaceImage: true } })
    ).not.toBeNull();
  });

  it('image_dimensions is declaration-only', () => {
    const base = minimalDetections();
    for (const row of [
      { present: false, source: 'footprint' },
      { present: true },
      { present: true, source: 'footprint' }
    ]) {
      expect(
        parseWprDetections({ ...base, image_dimensions: row }),
        JSON.stringify(row)
      ).toBeNull();
    }
    for (const row of [
      { present: false },
      { present: false, source: 'meta' },
      { present: true, source: 'meta' }
    ]) {
      expect(
        parseWprDetections({ ...base, image_dimensions: row }),
        JSON.stringify(row)
      ).not.toBeNull();
    }
  });
});

describe('the count invariants', () => {
  const base = validDetections();

  it('delayedScripts is a capped non-negative integer bounded by an uncut list', () => {
    const row = base.delay_js as Record<string, unknown>;
    const script = {
      inline: false,
      src: '/a.js',
      delayed: true,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: null
    };
    for (const [delayedScripts, accepted] of [
      [0, true],
      [1, true],
      [1.5, false],
      [-1, false],
      [2, false],
      [1_000_001, false]
    ] as const) {
      expect(
        parseWprDetections({
          ...base,
          delay_js: { ...row, scripts: [script], delayedScripts }
        }),
        String(delayedScripts)
      ).toEqual(accepted ? expect.anything() : null);
    }
    // A truncated list is the one reason the count may exceed the list.
    expect(
      parseWprDetections({
        ...base,
        delay_js: { ...row, scripts: [], delayedScripts: 2, truncated: true }
      })
    ).not.toBeNull();
  });

  it('deferredScripts stays a capped safe integer at least the URL count', () => {
    const row = base.defer_all_js as Record<string, unknown>;
    for (const [deferredScripts, accepted] of [
      [0, true],
      [2, true],
      [Number.MAX_SAFE_INTEGER, false],
      [1e15, false],
      [1_000_001, false]
    ] as const) {
      expect(
        parseWprDetections({ ...base, defer_all_js: { ...row, scripts: [], deferredScripts } }),
        String(deferredScripts)
      ).toEqual(accepted ? expect.anything() : null);
    }
  });

  it('element counts are capped safe integers', () => {
    for (const count of [0, 1_000_000, 1_000_001, 1.5, Number.MAX_SAFE_INTEGER]) {
      const accepted = count === 0 || count === 1_000_000;
      const payload = {
        ...base,
        automatic_lazy_rendering: {
          present: false,
          lazyRenderElements: count,
          inlineCssPresent: false,
          locationHashes: 0
        }
      };
      expect(parseWprDetections(payload), String(count)).toEqual(
        accepted ? expect.anything() : null
      );
    }
  });
});

describe('the bypass mark', () => {
  it('is additive and only ever true', () => {
    expect(parseFdtData({ ...validFdt(), bypassAttested: true })).toMatchObject({
      bypassAttested: true
    });
    expect(parseFdtData({ ...validFdt(), bypassAttested: false })).toBeNull();
    expect(parseFdtData({ ...validFdt(), bypassAttested: 'yes' })).toBeNull();
    expect(parseFdtData(validFdt())?.bypassAttested).toBeUndefined();
  });

  it('tolerates an own undefined like an absent additive flag', () => {
    expect(parseFdtData({ ...validFdt(), bypassAttested: undefined })).toEqual(
      parseFdtData(validFdt())
    );
  });
});

describe('the WordPress version envelope field', () => {
  it('is additive: absent, or a non-empty string within the version cap', () => {
    expect(parseFdtData({ ...validFdt(), wordpressVersion: '6.8.1' })).toMatchObject({
      wordpressVersion: '6.8.1'
    });
    expect(parseFdtData(validFdt())?.wordpressVersion).toBeUndefined();
    expect(parseFdtData({ ...validFdt(), wordpressVersion: 'x'.repeat(64) })).not.toBeNull();
  });

  it.each([
    ['empty', ''],
    ['over cap', 'x'.repeat(65)],
    ['number', 6.8],
    ['null', null]
  ])('rejects a %s value', (_name, value) => {
    expect(parseFdtData({ ...validFdt(), wordpressVersion: value })).toBeNull();
  });

  it('keeps the field beside cookies and the bypass mark', () => {
    const parsed = parseFdtData({
      ...validFdt(),
      cookies: { names: ['wprocket'], capturedAt: 1 },
      bypassAttested: true,
      wordpressVersion: '6.9'
    });
    expect(parsed).toMatchObject({ wordpressVersion: '6.9', bypassAttested: true });
  });
});

describe('the defer count', () => {
  it('bounds the URL list and counts every attributed script', () => {
    const detections = validDetections();
    const row = detections.defer_all_js as Record<string, unknown>;
    expect(
      parseWprDetections({
        ...detections,
        defer_all_js: { ...row, scripts: ['/a.js'], deferredScripts: 1 }
      })
    ).not.toBeNull();
    // Counting fewer scripts than the carried URLs is contradictory.
    expect(
      parseWprDetections({
        ...detections,
        defer_all_js: { ...row, scripts: ['/a.js'], deferredScripts: 0 }
      })
    ).toBeNull();
    expect(
      parseWprDetections({ ...detections, defer_all_js: { ...row, deferredScripts: 1.5 } })
    ).toBeNull();
  });
});
