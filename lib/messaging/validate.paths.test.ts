/**
 * Rejection-path coverage for every guard arm: each arm that can reject is
 * driven by a minimal payload mutation, so a guard that stops rejecting
 * silently (security regression) fails here.
 */
import { describe, expect, it } from 'vitest';
import {
  parseDetectionSummary,
  parseErrorWords,
  parseFdtData,
  parseKnownConflicts,
  parsePageHeaders,
  parsePanelSearchAction,
  parsePreloadedResources,
  parseWprDetections
} from './validate';
import { validDetections, validFdtPayload } from './validate.fixtures';

describe('parseErrorWords — rejection arms', () => {
  it('rejects a batch with a non-string among strings', () => {
    expect(parseErrorWords(['a', null, 'b'])).toBeNull();
    expect(parseErrorWords([undefined])).toBeNull();
  });

  it('rejects empty-string and boundary-length items', () => {
    expect(parseErrorWords([''])).toBeNull();
    expect(parseErrorWords([`${'x'.repeat(199)}y`])).toEqual([`${'x'.repeat(199)}y`]);
  });

  it('rejects a control character in the middle of a word', () => {
    expect(parseErrorWords(['a\x01b'])).toBeNull();
    expect(parseErrorWords(['a\u009fb'])).toBeNull();
  });
});

describe('parsePageHeaders — rejection arms', () => {
  it('rejects rows with extra keys', () => {
    expect(parsePageHeaders([{ name: 'a', value: 'b', extra: 'c' }])).toBeNull();
  });

  it('accepts exactly name+value rows', () => {
    expect(parsePageHeaders([{ name: 'a', value: 'b' }])).toEqual([{ name: 'a', value: 'b' }]);
  });
});

describe('parseKnownConflicts — rejection arms', () => {
  const row = {
    id: 'r',
    type: 'Plugin',
    name: 'Name',
    detection_pattern: null,
    summary: null,
    issue_description: '',
    url: 'https://u'
  };

  it('rejects empty-string fields individually', () => {
    for (const key of ['id', 'type', 'name', 'url'] as const) {
      expect(parseKnownConflicts([{ ...row, [key]: '' }])).toBeNull();
    }
  });

  it('rejects non-string fields', () => {
    expect(parseKnownConflicts([{ ...row, id: 5 }])).toBeNull();
    expect(parseKnownConflicts([{ ...row, issue_description: undefined }])).toBeNull();
  });
});

describe('parsePreloadedResources — rejection arms', () => {
  it('rejects non-record resource rows and bad fields', () => {
    expect(parsePreloadedResources({ present: true, resources: [null] })).toBeNull();
    expect(parsePreloadedResources({ present: true, resources: [{ href: 'x' }] })).toBeNull();
    expect(
      parsePreloadedResources({ present: true, resources: [{ href: 'x', type: 1, extra: 1 }] })
    ).toBeNull();
  });
});

describe('parseWprDetections — rejection arms', () => {
  it('rejects a wpr row missing any of the four keys', () => {
    const payload = validDetections();
    expect(
      parseWprDetections({ ...payload, wpr: { present: true, cached: false, version: '3' } })
    ).toBeNull();
  });

  it('rejects a delay row with wrong key count or hostile records', () => {
    const payload = validDetections();
    const delayRow = payload.delay_js as Record<string, unknown>;
    expect(parseWprDetections({ ...payload, delay_js: { ...delayRow, extra: 1 } })).toBeNull();
    // Empty src/content are legitimate engine outputs (empty attributes,
    // empty inline scripts) — they must survive the boundary, not kill it.
    const delayedEmptySrc = {
      inline: false,
      src: '',
      delayed: true,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: null
    };
    expect(
      parseWprDetections({
        ...payload,
        delay_js: { ...delayRow, scripts: [delayedEmptySrc] }
      })
    ).not.toBeNull();
    const delayedEmptyContent = {
      inline: true,
      content: '',
      delayed: true,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: null
    };
    expect(
      parseWprDetections({
        ...payload,
        delay_js: { ...delayRow, scripts: [delayedEmptyContent] }
      })
    ).not.toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        delay_js: {
          ...delayRow,
          scripts: [
            {
              inline: false,
              content: '',
              delayed: true,
              deferred: false,
              deferredByWPR: false,
              fdtExcluded: null
            }
          ]
        }
      })
    ).not.toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        delay_js: { ...delayRow, delayedScripts: Number.POSITIVE_INFINITY }
      })
    ).toBeNull();
    expect(
      parseWprDetections({ ...payload, delay_js: { ...delayRow, delayedScripts: -1 } })
    ).toBeNull();
    // The count cap: beyond it the row rejects wholesale.
    expect(
      parseWprDetections({
        ...payload,
        delay_js: {
          ...delayRow,
          scripts: Array.from({ length: 5_001 }, () => ({
            inline: true,
            content: 'x',
            delayed: false,
            deferred: false,
            deferredByWPR: false,
            fdtExcluded: null
          }))
        }
      })
    ).toBeNull();
  });

  it('rejects defer rows beyond the size bound and non-string entries', () => {
    const payload = validDetections();
    const deferRow = payload.defer_all_js as Record<string, unknown>;
    expect(
      parseWprDetections({ ...payload, defer_all_js: { ...deferRow, scripts: ['a', 5] } })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        defer_all_js: { ...deferRow, scripts: Array.from({ length: 5_001 }, () => 'a') }
      })
    ).toBeNull();
    // 1000+ scripts on a huge page is legitimate engine output — accepted.
    expect(
      parseWprDetections({
        ...payload,
        defer_all_js: { ...deferRow, scripts: Array.from({ length: 1_001 }, () => 'a') }
      })
    ).not.toBeNull();
  });

  it('rejects lazyload rows with wrong keys and malformed reasons', () => {
    const payload = validDetections();
    const lazyRow = payload.lazyload as Record<string, unknown>;
    expect(
      parseWprDetections({
        ...payload,
        lazyload: {
          ...lazyRow,
          images: [{ src: '/a', lazyloadDetected: false, excludedReasonsFound: [5] }]
        }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        lazyload: { ...lazyRow, images: [{ src: '/a', lazyloadDetected: false, extra: 1 }] }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        lazyload: {
          ...lazyRow,
          images: [
            {
              src: '/a',
              lazyloadDetected: false,
              excludedReasonsFound: Array.from({ length: 25 }, () => 'data-src')
            }
          ]
        }
      })
    ).toBeNull();
  });

  it('rejects script records with a non-string exclusion marker', () => {
    const payload = validDetections();
    const delayRow = payload.delay_js as Record<string, unknown>;
    expect(
      parseWprDetections({
        ...payload,
        delay_js: {
          ...delayRow,
          scripts: [
            { inline: false, delayed: true, deferred: false, deferredByWPR: false, fdtExcluded: 7 }
          ]
        }
      })
    ).toBeNull();
  });

  it('rejects iframes rows with wrong-typed fields', () => {
    const payload = validDetections();
    expect(
      parseWprDetections({ ...payload, lazyload_iframes: { present: 'yes', replaceImage: true } })
    ).toBeNull();
    expect(
      parseWprDetections({ ...payload, lazyload_iframes: { present: true, replaceImage: 'no' } })
    ).toBeNull();
  });

  it('rejects above-the-fold rows that are inconsistent with their list', () => {
    const payload = validDetections();
    expect(
      parseWprDetections({
        ...payload,
        rocket_above_the_fold_optimization: { present: true, lcpComment: 'yes' }
      })
    ).toBeNull();
    // The old pre-P1.1 shape (beacon field) is foreign now.
    expect(
      parseWprDetections({
        ...payload,
        rocket_above_the_fold_optimization: { present: true, beacon: true }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        rocket_above_the_fold_optimization: {
          present: true,
          lcpComment: false,
          preloadedImages: [5]
        }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        rocket_above_the_fold_optimization: {
          present: false,
          lcpComment: false,
          preloadedImages: ['/a.jpg']
        }
      })
    ).toBeNull();
  });

  it('rejects lazy-render rows with wrong counts, types or key sets', () => {
    const payload = validDetections();
    const row = {
      present: true,
      lazyRenderElements: 1,
      inlineCssPresent: true,
      locationHashes: 0
    };
    expect(parseWprDetections({ ...payload, automatic_lazy_rendering: row })).not.toBeNull();
    expect(
      parseWprDetections({ ...payload, automatic_lazy_rendering: { ...row, extra: 1 } })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        automatic_lazy_rendering: { ...row, lazyRenderElements: 1.5 }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        automatic_lazy_rendering: { ...row, lazyRenderElements: -1 }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        automatic_lazy_rendering: { ...row, lazyRenderElements: Number.POSITIVE_INFINITY }
      })
    ).toBeNull();
    expect(
      parseWprDetections({ ...payload, automatic_lazy_rendering: { ...row, locationHashes: '0' } })
    ).toBeNull();
    // present ⇔ count ≥ 1, enforced both directions.
    expect(
      parseWprDetections({
        ...payload,
        automatic_lazy_rendering: { ...row, present: false }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        automatic_lazy_rendering: { ...row, present: true, lazyRenderElements: 0 }
      })
    ).toBeNull();
  });

  it('rejects font-preload rows that are inconsistent or oversized', () => {
    const payload = validDetections();
    expect(
      parseWprDetections({
        ...payload,
        auto_preload_fonts: { present: true, fonts: ['https://s.com/a.woff2'] }
      })
    ).not.toBeNull();
    expect(
      parseWprDetections({ ...payload, auto_preload_fonts: { present: true, fonts: [] } })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        auto_preload_fonts: { present: false, fonts: ['https://s.com/a.woff2'] }
      })
    ).toBeNull();
    expect(
      parseWprDetections({ ...payload, auto_preload_fonts: { present: true, fonts: [''] } })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        auto_preload_fonts: { present: true, fonts: Array.from({ length: 1_001 }, () => 'x') }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        auto_preload_fonts: { present: true, fonts: ['x'.repeat(4097)] }
      })
    ).toBeNull();
  });

  it('rejects preconnect rows with wrong counts or oversized domain lists', () => {
    const payload = validDetections();
    expect(
      parseWprDetections({
        ...payload,
        preconnect_external_domains: {
          present: true,
          domains: ['https://example.org/'],
          preconnectCount: 1
        }
      })
    ).not.toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        preconnect_external_domains: {
          present: true,
          domains: [],
          preconnectCount: 0
        }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        preconnect_external_domains: {
          present: false,
          domains: ['https://example.org/'],
          preconnectCount: 0
        }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        preconnect_external_domains: {
          present: true,
          domains: ['https://example.org/'],
          preconnectCount: -1
        }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        preconnect_external_domains: {
          present: true,
          domains: ['https://example.org/'],
          preconnectCount: 1.5
        }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        preconnect_external_domains: {
          present: true,
          domains: Array.from({ length: 501 }, () => 'https://d.com/'),
          preconnectCount: 0
        }
      })
    ).toBeNull();
  });

  it('rejects beacon rows with config violations', () => {
    const payload = validDetections();
    const base = { present: true, status: { atf: true }, isMobile: false };
    expect(parseWprDetections({ ...payload, priority_elements_beacon: base })).not.toBeNull();
    // A known status key must be boolean.
    expect(
      parseWprDetections({
        ...payload,
        priority_elements_beacon: { ...base, status: { atf: 'yes' } }
      })
    ).toBeNull();
    // Unknown status keys survive only as bounded primitives.
    expect(
      parseWprDetections({
        ...payload,
        priority_elements_beacon: { ...base, status: { atf: true, future: 'kept' } }
      })
    ).not.toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        priority_elements_beacon: { ...base, status: { atf: true, future: [1] } }
      })
    ).toBeNull();
    // The status key cap.
    const manyKeys = Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [`k${String(i)}`, true])
    );
    expect(
      parseWprDetections({
        ...payload,
        priority_elements_beacon: { ...base, status: manyKeys }
      })
    ).toBeNull();
    // Own `__proto__` keys are hostile (assignment would hit the inherited
    // setter instead of preserving a value) — reject the whole payload. Built
    // via JSON.parse: an object literal would trigger the setter, not the
    // own key the boundary receives.
    expect(
      parseWprDetections({
        ...payload,
        priority_elements_beacon: {
          ...base,
          status: JSON.parse('{"__proto__": "evil", "atf": true}') as Record<string, unknown>
        }
      })
    ).toBeNull();
    // Wrong-typed device context, config-carried fields, degraded-config
    // inconsistencies, payload list violations and unknown row keys.
    expect(
      parseWprDetections({
        ...payload,
        priority_elements_beacon: { ...base, isMobile: 'yes' }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        priority_elements_beacon: { ...base, elements: ['array-not-string'] }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        priority_elements_beacon: { present: true, status: null, isMobile: null, elements: 'img' }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        priority_elements_beacon: { ...base, processed_extensions: [5] }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        priority_elements_beacon: { ...base, elements: 42 }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        priority_elements_beacon: { ...base, hostile: true }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...payload,
        priority_elements_beacon: { present: true, status: 5, isMobile: null }
      })
    ).toBeNull();
  });
});

describe('parseFdtData — tolerant reads', () => {
  it('passes future additive fields through untouched', () => {
    const payload = { ...validFdtPayload(), futureField: { any: 'shape' } };
    const parsed = parseFdtData(payload);
    expect(parsed).toEqual(validFdtPayload());
  });

  it('accepts diagnoser reports with unknown slot shapes', () => {
    const payload = {
      ...validFdtPayload(),
      diagnoserData: { noRocketData: { anything: [1, 2] }, rocketData: null }
    };
    const parsed = parseFdtData(payload);
    expect(parsed?.diagnoserData).toEqual({ noRocketData: { anything: [1, 2] }, rocketData: null });
  });
});

describe('parseErrorWords — boundary accepts', () => {
  it('accepts exactly 50 words (the cap is inclusive)', () => {
    const words = Array.from({ length: 50 }, (_, i) => `w${String(i)}`);
    expect(parseErrorWords(words)).toEqual(words);
  });
});

describe('parsePageHeaders — boundary accepts', () => {
  it('accepts a 512-char name and a 4096-char value (the caps are inclusive)', () => {
    expect(parsePageHeaders([{ name: 'n'.repeat(512), value: 'v'.repeat(4096) }])).not.toBeNull();
  });
});

describe('parseDetectionSummary — object-level prototype pollution', () => {
  it('rejects an object whose extra own key is __proto__', () => {
    const poisoned = JSON.parse(
      '{"__proto__": {"x": 1}, "wprPresent": true, "cached": false}'
    ) as Record<string, unknown>;
    expect(parseDetectionSummary(poisoned)).toBeNull();
  });
});

describe('parseDetectionSummary / parsePanelSearchAction — rejection arms', () => {
  it('summary: null input and non-object wrappers', () => {
    expect(parseDetectionSummary(undefined)).toBeNull();
    expect(parseDetectionSummary([])).toBeNull();
  });

  it('search: missing query key', () => {
    expect(parsePanelSearchAction({ action: 'performSearch' })).toBeNull();
  });
});
