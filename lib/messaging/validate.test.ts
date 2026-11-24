/**
 * Boundary-guard tests. Every guard is exercised with valid payloads, the
 * shapes it must reject, and hostile inputs (oversized, wrong types,
 * prototype-pollution keys) — a validator that never saw an attack has not
 * tested anything.
 */
import { describe, expect, it } from 'vitest';
import {
  isPrintable,
  parseDbUpdateResult,
  parseDetectionSummary,
  parseErrorWords,
  parseFdtData,
  parseFdtDataExplained,
  parseKnownConflicts,
  parsePageCookies,
  parsePageHeaders,
  parsePanelSearchAction,
  parsePreloadedResources,
  parseWprDetections
} from './validate';
import { minimalDetections, validDetections, validFdt, validFdtPayload } from './validate.fixtures';
import { PAYLOAD_LIMITS } from './payload-bounds';
import { COOKIE_NAME_LIMITS, sampleCookieNames } from '../wp-rocket/cookies';
import { MAX_REPRESENTABLE_MS } from '../detection/describe';

/**
 * The hostile corpus for the cookie contract's two ends: the capture side
 * answers these with a unique, capped, name-only list — and the boundary
 * validator must accept exactly that, so a capture side and a receive side
 * can never drift apart.
 */
const countLine = (count: number): string =>
  Array.from({ length: count }, (_, i) => `c${String(i)}=1`).join('; ');

const captureCorpus: string[] = [
  '',
  'novalue; =a; ==x; b=1',
  'a="carol;margin=x"; c=2',
  'wprocket=1; wprocket=2; wprocket=3',
  `${'n'.repeat(COOKIE_NAME_LIMITS.name)}A=1; ${'n'.repeat(COOKIE_NAME_LIMITS.name)}B=2`,
  '  a  = 1 ; a=2 ;\ta\t=\t3',
  countLine(COOKIE_NAME_LIMITS.count + 20),
  'na\x01me=1; \x7f=2; ok=3',
  '🍪=1; cookie=a-b-c'
];

describe('parseErrorWords', () => {
  it('accepts a clean batch and copies it to a fresh array', () => {
    const words = ['jQuery', 'wp.domReady'];
    const result = parseErrorWords(words);
    expect(result).toEqual(words);
    // Mutation of the source must not leak through.
    words.push('more');
    expect(result).toEqual(['jQuery', 'wp.domReady']);
  });

  it('accepts an empty batch (nothing captured yet)', () => {
    expect(parseErrorWords([])).toEqual([]);
  });

  it('rejects wrong shapes and hostile oversizes', () => {
    expect(parseErrorWords(null)).toBeNull();
    expect(parseErrorWords('jQuery')).toBeNull();
    expect(parseErrorWords({ length: 1 })).toBeNull();
    expect(parseErrorWords(['word', 42])).toBeNull();
    // More than 50 items or a 201+ char deadline: the whole batch is rejected.
    expect(parseErrorWords(Array.from({ length: 51 }, (_, i) => `w${String(i)}`))).toBeNull();
    expect(parseErrorWords(['a'.repeat(200)])).toEqual(['a'.repeat(200)]);
    expect(parseErrorWords(['a'.repeat(201)])).toBeNull();
  });

  it('rejects control characters but accepts non-ASCII words', () => {
    expect(parseErrorWords(['has\x00nul'])).toBeNull();
    expect(parseErrorWords(['has\x7fdel'])).toBeNull();
    expect(parseErrorWords(['a\tb', 'c\nd', 'e\rf'])).toEqual(['a\tb', 'c\nd', 'e\rf']);
    expect(parseErrorWords(['раз-два'])).toEqual(['раз-два']);
  });

  it('refuses lone surrogates; paired astral code points pass through', () => {
    // Direct pin of the shared printability rule (`isPrintable`, one contract
    // for the receiving guard and the MAIN-world capture). The lone-surrogate
    // branch is what these rows guard:
    // - `\ud800`/`\udfff` iterate as unpaired 0xD800–0xDFFF code points and
    //   must be refused — this kills the branch-removed mutation (the check
    //   degrading to always-true), which would forward replacement garbage;
    // - `𝛕` is U+1D6D5, a paired astral code point that iterates whole (≥
    //   0x10000) and must pass — this kills the opposite mutation (checking
    //   UTF-16 units, which would reject every astral character).
    expect(isPrintable('\ud800')).toBe(false);
    expect(isPrintable('\udfff')).toBe(false);
    expect(isPrintable('𝛕')).toBe(true);
    // End to end, the same rule guards whole batches: an astral word stays a
    // word, a lone surrogate can never sneak in through the validator.
    expect(parseErrorWords(['𝛕 in a word'])).toEqual(['𝛕 in a word']);
    expect(parseErrorWords(['lone \ud800 surrogate'])).toBeNull();
  });
});

describe('parsePageHeaders', () => {
  it('accepts captured rows and keeps missing values absent', () => {
    const rows = [{ name: 'X-Cache' }, { name: 'Content-Type', value: 'text/html' }];
    expect(parsePageHeaders(rows)).toEqual([
      { name: 'X-Cache' },
      { name: 'Content-Type', value: 'text/html' }
    ]);
  });

  it('rejects malformed and oversized rows', () => {
    expect(parsePageHeaders('x-cache')).toBeNull();
    expect(parsePageHeaders([null])).toBeNull();
    expect(parsePageHeaders([42])).toBeNull();
    expect(parsePageHeaders([{ name: '' }])).toBeNull();
    expect(parsePageHeaders([{ name: 'a'.repeat(513) }])).toBeNull();
    expect(parsePageHeaders([{ name: 'ok', value: 'a'.repeat(4097) }])).toBeNull();
    expect(parsePageHeaders([{ name: 'ok', value: 7 }])).toBeNull();
  });

  it('accepts withheld rows, with or without a kept cookie name', () => {
    const rows = [
      { name: 'Set-Cookie', redacted: true, cookieName: 'sid' },
      { name: 'Authorization', redacted: true },
      { name: 'Location', value: 'https://a.example/?token=[redacted]' }
    ];
    expect(parsePageHeaders(rows)).toEqual(rows);
  });

  it('still accepts rows from before the withheld flag (old payloads)', () => {
    const old = [{ name: 'Set-Cookie', value: 'sid=1' }, { name: 'x-cache' }];
    expect(parsePageHeaders(old)).toEqual(old);
  });

  it.each([
    ['a withheld row that still carries a value', { name: 'A', redacted: true, value: 'secret' }],
    ['a flag other than true', { name: 'A', redacted: false }],
    ['a cookie name without the flag', { name: 'Set-Cookie', value: 'x', cookieName: 'sid' }],
    ['an empty cookie name', { name: 'Set-Cookie', redacted: true, cookieName: '' }],
    ['a non-string cookie name', { name: 'Set-Cookie', redacted: true, cookieName: 1 }],
    [
      'an over-long cookie name',
      { name: 'Set-Cookie', redacted: true, cookieName: 'c'.repeat(4097) }
    ],
    ['an unknown key', { name: 'A', value: 'v', extra: 1 }]
  ])('rejects %s', (_label, row) => {
    expect(parsePageHeaders([row])).toBeNull();
  });

  it('rebuilds rows with only the known keys', () => {
    const parsed = parsePageHeaders([{ name: 'A', redacted: true, cookieName: undefined }]);
    expect(parsed).toEqual([{ name: 'A', redacted: true }]);
    expect(Object.keys(parsed?.[0] ?? {})).toEqual(['name', 'redacted']);
  });
});

describe('parseDetectionSummary', () => {
  it('accepts the exact two-boolean shape', () => {
    expect(parseDetectionSummary({ wprPresent: true, cached: false })).toEqual({
      wprPresent: true,
      cached: false
    });
  });

  it('rejects wrong shapes, extra keys and pollution keys', () => {
    expect(parseDetectionSummary({ wprPresent: 1, cached: false })).toBeNull();
    expect(parseDetectionSummary({ wprPresent: true })).toBeNull();
    expect(parseDetectionSummary({ wprPresent: true, cached: true, extra: 1 })).toBeNull();
    expect(parseDetectionSummary('{ "__proto__": {}, "wprPresent": true }')).toBeNull();
  });
});

describe('parseDbUpdateResult', () => {
  it('accepts a timestamp or an explicit null', () => {
    expect(parseDbUpdateResult({ updatedAt: 123 })).toEqual({ updatedAt: 123 });
    expect(parseDbUpdateResult(null)).toBeNull();
  });

  it('rejects non-numeric or partial payloads', () => {
    expect(parseDbUpdateResult({ updatedAt: 'now' })).toBeNull();
    expect(parseDbUpdateResult({})).toBeNull();
    expect(parseDbUpdateResult(NaN)).toBeNull();
  });
});

describe('parseKnownConflicts', () => {
  const row = {
    id: '123ed22a-22f0-8018-9c4f-c6c934f35efe',
    type: 'Plugin',
    name: 'Menu Caching',
    detection_pattern: 'menu-caching/menu-caching.php',
    summary: 'Causes Fatal Errors',
    issue_description: 'Fatal error when clearing the cache',
    url: 'https://www.notion.so/Menu-Caching-123ed22a22f080189c4fc6c934f35efe'
  };

  it('accepts the committed snapshot shape', () => {
    expect(parseKnownConflicts([row])).toEqual([row]);
  });

  it('accepts nullable detection_pattern/summary and empty descriptions', () => {
    expect(
      parseKnownConflicts([
        { ...row, detection_pattern: null, summary: null, issue_description: '' }
      ])
    ).toEqual([{ ...row, detection_pattern: null, summary: null, issue_description: '' }]);
  });

  it('rejects rows without usable name/url and wrong field types', () => {
    expect(parseKnownConflicts([{ ...row, name: '' }])).toBeNull();
    expect(parseKnownConflicts([{ ...row, url: '' }])).toBeNull();
    expect(parseKnownConflicts([{ ...row, url: null }])).toBeNull();
    expect(parseKnownConflicts([{ ...row, detection_pattern: 7 }])).toBeNull();
    expect(parseKnownConflicts([{ ...row, issue_description: null }])).toBeNull();
    expect(parseKnownConflicts([42])).toBeNull();
    expect(parseKnownConflicts({})).toBeNull();
    expect(parseKnownConflicts([])).toEqual([]);
  });

  it('tolerates unknown extra fields (additive DB evolution) without carrying them', () => {
    expect(parseKnownConflicts([{ ...row, newField: 1 }])).toEqual([row]);
  });

  // The server-owned DB is untrusted: each field's character cap (pinned
  // literally) holds at the edge and one character past it rejects the batch.
  it.each([
    ['id', 64],
    ['type', 64],
    ['name', 256],
    ['detection_pattern', 512],
    ['summary', 512],
    ['issue_description', 8_192],
    ['url', 2_048]
  ])('caps %s at %i characters', (field, cap) => {
    expect(parseKnownConflicts([{ ...row, [field]: 'x'.repeat(cap) }])).toHaveLength(1);
    expect(parseKnownConflicts([{ ...row, [field]: 'x'.repeat(cap + 1) }])).toBeNull();
  });

  it('caps the batch at 500 rows', () => {
    expect(parseKnownConflicts(Array.from({ length: 500 }, () => row))).toHaveLength(500);
    expect(parseKnownConflicts(Array.from({ length: 501 }, () => row))).toBeNull();
  });

  it('rejects hostile row values: arrays, objects, a null row', () => {
    expect(parseKnownConflicts([{ ...row, url: ['https://x.test'] }])).toBeNull();
    expect(parseKnownConflicts([{ ...row, summary: { toString: () => 'x' } }])).toBeNull();
    expect(parseKnownConflicts([row, null])).toBeNull();
  });
});

describe('parsePreloadedResources', () => {
  it('accepts both shapes', () => {
    expect(parsePreloadedResources({ present: false })).toEqual({ present: false });
    expect(
      parsePreloadedResources({
        present: true,
        resources: [{ href: 'https://x/y.jpg', type: 'image' }]
      })
    ).toEqual({
      present: true,
      resources: [{ href: 'https://x/y.jpg', type: 'image' }]
    });
    expect(parsePreloadedResources({ present: true, resources: [] })).toEqual({
      present: true,
      resources: []
    });
  });

  it('rejects malformed shapes', () => {
    expect(parsePreloadedResources({ present: true })).toBeNull();
    expect(parsePreloadedResources({ present: 'yes' })).toBeNull();
    expect(parsePreloadedResources({ present: true, resources: 'all' })).toBeNull();
    expect(
      parsePreloadedResources({ present: true, resources: [{ href: 1, type: '' }] })
    ).toBeNull();
    expect(parsePreloadedResources({ present: false, resources: [] })).toBeNull();
    expect(parsePreloadedResources([{ present: false }])).toBeNull();
  });

  it('accepts empty href/type rows — engine outputs for srcset-only hints and as-less links', () => {
    expect(
      parsePreloadedResources({
        present: true,
        resources: [
          { href: 'https://s.com/hero.jpg', type: 'image' },
          { href: '', type: 'image' }
        ]
      })
    ).toEqual({
      present: true,
      resources: [
        { href: 'https://s.com/hero.jpg', type: 'image' },
        { href: '', type: 'image' }
      ]
    });
  });
});

describe('parsePreloadedResources — the hint inventory', () => {
  const hint = { rel: 'preconnect', href: 'https://a.example/', as: '' };
  const stamped = { rel: 'preload', href: '/f.woff2', as: 'font', mark: 'preload' };

  it('accepts the inventory beside either marker state, empty or with its mark', () => {
    for (const report of [
      { present: false, hints: [] },
      { present: false, hints: [hint, stamped] },
      { present: true, resources: [], hints: [hint] },
      { present: true, resources: [{ href: '/a', type: '' }], truncated: true, hints: [hint] },
      { present: false, hints: [hint], hintsTruncated: true },
      { present: true, resources: [], hints: [hint], hintsTruncated: true },
      ...['preload', 'modulepreload', 'preconnect', 'dns-prefetch'].map((rel) => ({
        present: false,
        hints: [{ rel, href: '', as: '' }]
      })),
      ...[
        ['preload', 'preload'],
        ['preload', 'async'],
        ['preconnect', 'preconnect'],
        ['dns-prefetch', 'prefetch']
      ].map(([rel, mark]) => ({ present: false, hints: [{ rel, href: '/x', as: '', mark }] }))
    ]) {
      expect(parsePreloadedResources(report)).toEqual(report);
    }
  });

  it.each([
    ['a non-list', { present: false, hints: 'all' }],
    ['an over-cap list', { present: false, hints: Array.from({ length: 5001 }, () => hint) }],
    ['a mark without a list', { present: false, hintsTruncated: true }],
    ['a mark on an empty list', { present: false, hints: [], hintsTruncated: true }],
    ['a false mark', { present: false, hints: [hint], hintsTruncated: false }],
    ['a non-record hint', { present: false, hints: ['x'] }],
    ['an unknown kind', { present: false, hints: [{ ...hint, rel: 'prefetch' }] }],
    ['a non-string href', { present: false, hints: [{ ...hint, href: 1 }] }],
    ['an over-cap href', { present: false, hints: [{ ...hint, href: 'h'.repeat(4097) }] }],
    ['an over-cap as', { present: false, hints: [{ ...hint, as: 'a'.repeat(65) }] }],
    ['a missing as', { present: false, hints: [{ rel: 'preconnect', href: '' }] }],
    ['an extra hint key', { present: false, hints: [{ ...hint, extra: 1 }] }],
    ['an extra key beside a stamp', { present: false, hints: [{ ...stamped, extra: 1 }] }],
    ['an unknown stamp', { present: false, hints: [{ ...stamped, mark: 'rocket' }] }],
    ['a stamp on another kind', { present: false, hints: [{ ...hint, mark: 'preload' }] }],
    ['an undefined stamp', { present: false, hints: [{ ...hint, mark: undefined }] }],
    ['an extra report key', { present: false, hints: [], extra: 1 }],
    ['the preload mark on an absent marker', { present: false, hints: [hint], truncated: true }]
  ])('rejects %s', (_label, report) => {
    expect(parsePreloadedResources(report)).toBeNull();
  });
});

describe('parseWprDetections', () => {
  it('passes a valid full payload', () => {
    const payload = minimalDetections();
    expect(parseWprDetections(payload)).toEqual(payload);
  });

  it('rejects missing/extra keys and hostile nested shapes', () => {
    const payload = validFdt().wprDetections as Record<string, unknown>;
    const wprRow = payload.wpr as Record<string, unknown>;
    const delayRow = payload.delay_js as Record<string, unknown>;
    expect(parseWprDetections({ ...payload, wpr: undefined })).toBeNull();
    expect(parseWprDetections({ ...payload, async_css: { present: 'yes', extra: 1 } })).toBeNull();
    expect(parseWprDetections({ ...payload, wpr: { ...wprRow, version: 3 } })).toBeNull();
    expect(parseWprDetections({ ...payload, delay_js: { ...delayRow, scripts: [{}] } })).toBeNull();
    expect(
      parseWprDetections({ ...payload, delay_js: { ...delayRow, scripts: [{ inline: 'no' }] } })
    ).toBeNull();
    // Prototype pollution inside a script record has no effect: the guard
    // rebuilds records field-by-field, so poisoned input yields clean rows
    // (and unknown/tolerated fields never reach the output).
    const poison = JSON.parse(
      '{"__proto__": {"isAdmin": true}, "extra": 1, "inline": true, "delayed": false, "deferred": false, "deferredByWPR": false, "fdtExcluded": null, "content": "x"}'
    ) as Record<string, unknown>;
    const poisonedRow = { ...delayRow, scripts: [poison] };
    const parsedPoison = parseWprDetections({ ...payload, delay_js: poisonedRow });
    expect(parsedPoison?.delay_js.scripts[0]).toEqual({
      inline: true,
      delayed: false,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: null,
      // Absent additive field: read as false (tolerant), never rejected.
      minifyAttribute: false,
      content: 'x'
    });
  });

  it('keeps the priority-elements rows consistent with their evidence', () => {
    const detections = minimalDetections();
    // Applied critical images: present ⇔ the list is non-empty, comment either way.
    expect(
      parseWprDetections({
        ...detections,
        rocket_above_the_fold_optimization: {
          present: true,
          lcpComment: true,
          preloadedImages: ['/a.jpg']
        }
      })?.rocket_above_the_fold_optimization
    ).toEqual({ present: true, lcpComment: true, preloadedImages: ['/a.jpg'] });
    expect(
      parseWprDetections({
        ...detections,
        rocket_above_the_fold_optimization: { present: false, lcpComment: true }
      })?.rocket_above_the_fold_optimization
    ).toEqual({ present: false, lcpComment: true });
    // A meta-declared verdict without observed markup is valid engine output.
    expect(
      parseWprDetections({
        ...detections,
        rocket_above_the_fold_optimization: { present: true, lcpComment: false }
      })?.rocket_above_the_fold_optimization
    ).toEqual({ present: true, lcpComment: false });
    // Lazy rendering: the verdict and the observed count are independent.
    expect(
      parseWprDetections({
        ...detections,
        automatic_lazy_rendering: {
          present: true,
          lazyRenderElements: 3,
          inlineCssPresent: true,
          locationHashes: 0
        }
      })?.automatic_lazy_rendering
    ).toEqual({ present: true, lazyRenderElements: 3, inlineCssPresent: true, locationHashes: 0 });
    expect(
      parseWprDetections({
        ...detections,
        automatic_lazy_rendering: {
          present: false,
          lazyRenderElements: 2,
          inlineCssPresent: false,
          locationHashes: 5
        }
      })?.automatic_lazy_rendering
    ).toEqual({
      present: false,
      lazyRenderElements: 2,
      inlineCssPresent: false,
      locationHashes: 5
    });
    // Fonts + preconnect: the verdict and the observed lists are independent.
    expect(
      parseWprDetections({
        ...detections,
        auto_preload_fonts: { present: true, fonts: ['https://s.com/a.woff2'] },
        preconnect_external_domains: {
          present: true,
          domains: ['https://example.org/'],
          preconnectCount: 0
        }
      })
    ).not.toBeNull();
    expect(
      parseWprDetections({
        ...detections,
        auto_preload_fonts: { present: true, fonts: [] }
      })
    ).not.toBeNull();
  });

  it('keeps the beacon row and its config payload separate from the feature rows', () => {
    const detections = minimalDetections();
    // Degraded config: the beacon tag alone is evidence.
    expect(
      parseWprDetections({
        ...detections,
        priority_elements_beacon: { present: true, status: null, isMobile: null }
      })?.priority_elements_beacon
    ).toEqual({ present: true, status: null, isMobile: null });
    // Parsed config with payloads.
    const withConfig = {
      ...detections,
      priority_elements_beacon: {
        present: true,
        status: { atf: true, lrc: false },
        isMobile: false,
        elements: 'img, video',
        preconnect_external_domain_elements: ['link'],
        processed_extensions: ['woff2']
      }
    };
    expect(parseWprDetections(withConfig)?.priority_elements_beacon).toEqual(
      withConfig.priority_elements_beacon
    );
    // A degraded config carries no device context and no payload.
    expect(
      parseWprDetections({
        ...detections,
        priority_elements_beacon: { present: true, status: null, isMobile: false }
      })
    ).toBeNull();
    // An absent beacon carries nothing at all.
    expect(
      parseWprDetections({
        ...detections,
        priority_elements_beacon: {
          present: false,
          status: { atf: true },
          isMobile: null
        }
      })
    ).toBeNull();
    // Payloads without a parsed status are not engine output.
    expect(
      parseWprDetections({
        ...detections,
        priority_elements_beacon: {
          present: true,
          status: null,
          isMobile: null,
          elements: 'img'
        }
      })
    ).toBeNull();
  });

  it('tolerates the optional evidence-source field on every feature row and carries it through', () => {
    const base = minimalDetections();
    // Every row except the identity and beacon rows may declare which
    // evidence class decided it; absence stays the old payloads' valid shape.
    const featureRows = Object.keys(base).filter(
      (key) => key !== 'wpr' && key !== 'priority_elements_beacon'
    );
    for (const key of featureRows) {
      for (const source of ['meta', 'footprint'] as const) {
        const row = { ...(base[key] as Record<string, unknown>), source };
        const parsed = parseWprDetections({ ...base, [key]: row });
        // The declaration-only rows: a footprint source is not engine output.
        if (
          (key === 'image_dimensions' ||
            key === 'minify_concatenate_js' ||
            key === 'mobile_cache' ||
            key === 'dns_prefetch') &&
          source === 'footprint'
        ) {
          expect(parsed, `${key}/${source}`).toBeNull();
          continue;
        }
        expect(parsed, `${key}/${source}`).not.toBeNull();
        expect((parsed as unknown as Record<string, unknown>)[key], `${key}/${source}`).toEqual(
          row
        );
      }
    }
  });

  it('rejects anything but the two evidence sources on feature rows', () => {
    const base = minimalDetections();
    for (const invalid of ['Meta', 'meta ', 1, true, null, {}]) {
      expect(
        parseWprDetections({ ...base, rocket_cdn: { present: false, source: invalid } }),
        JSON.stringify(invalid)
      ).toBeNull();
    }
  });

  it('keeps the identity and beacon rows source-free', () => {
    const base = minimalDetections();
    expect(
      parseWprDetections({
        ...base,
        wpr: { ...(base['wpr'] as Record<string, unknown>), source: 'meta' }
      })
    ).toBeNull();
    expect(
      parseWprDetections({
        ...base,
        priority_elements_beacon: {
          ...(base['priority_elements_beacon'] as Record<string, unknown>),
          source: 'footprint'
        }
      })
    ).toBeNull();
  });
});

describe('parseFdtData', () => {
  it('preserves an optional valid script snapshot identity and rejects malformed present values', () => {
    const full = validFdt();
    const scriptSnapshotId = '12345678123412341234123456789abc';
    expect(parseFdtData({ ...full, scriptSnapshotId })?.scriptSnapshotId).toBe(scriptSnapshotId);
    for (const invalid of [null, '', 'bad', 7, 'a'.repeat(1000)]) {
      expect(parseFdtData({ ...full, scriptSnapshotId: invalid })).toBeNull();
    }
  });

  it('passes the panel payload through', () => {
    const payload = minimalDetections();
    const full = { ...validFdt(), wprDetections: payload };
    expect(parseFdtData(full)).toEqual(full);
  });

  it('rejects corruption in any slot', () => {
    const full = { ...validFdt(), wprDetections: minimalDetections() };
    expect(parseFdtData({ ...full, allScriptsLoaded: 'yes' })).toBeNull();
    expect(parseFdtData({ ...full, pageHeaders: [{}] })).toBeNull();
    expect(parseFdtData({ ...full, undefinedReferencesOnPage: null })).toBeNull();
    expect(parseFdtData({ ...full, wprDetections: null })).toBeNull();
    expect(parseFdtData({ ...full, preloadedResources: null })).toBeNull();
    expect(parseFdtData(null)).toBeNull();
    expect(parseFdtData('nope')).toBeNull();
  });

  it('requires every optional slot rather than guessing', () => {
    const full = { ...validFdt(), wprDetections: minimalDetections() };
    expect(parseFdtData({ ...full, preloadedResources: undefined })).toBeNull();
    expect(parseFdtData({ ...full, undefinedReferencesOnPage: undefined })).toBeNull();
  });
});

describe('parsePageCookies', () => {
  it('accepts a valid redacted cookie list and rebuilds it fresh', () => {
    const input = { names: ['wprocket', 'fallback'], capturedAt: 1_800_000_000_000 };
    expect(parsePageCookies(input)).toEqual(input);
    // Mutation of the source must not leak through.
    const mutating = { names: ['a'], capturedAt: 1 };
    const parsed = parsePageCookies(mutating);
    mutating.names.push('b');
    expect(parsed?.names).toEqual(['a']);
  });

  it('accepts a name list with no capture-worthy cookie (empty honest list)', () => {
    expect(parsePageCookies({ names: [], capturedAt: 1_800_000_000_000 })).toEqual({
      names: [],
      capturedAt: 1_800_000_000_000
    });
  });

  it('rejects wrong shapes and hostile oversizes', () => {
    expect(parsePageCookies(null)).toBeNull();
    expect(parsePageCookies('wprocket')).toBeNull();
    expect(parsePageCookies({ names: 'wprocket', capturedAt: 1 })).toBeNull();
    expect(parsePageCookies({ names: ['wprocket'] })).toBeNull();
    expect(parsePageCookies({ names: [''], capturedAt: 1 })).toBeNull();
    // A captured value would be a contract break — the field must not exist.
    expect(parsePageCookies({ names: ['wprocket'], values: ['1'], capturedAt: 1 })).toBeNull();
    expect(
      parsePageCookies({ names: ['a'.repeat(513)], capturedAt: 1_800_000_000_000 })
    ).toBeNull();
    expect(
      parsePageCookies({
        names: Array.from({ length: 257 }, (_, i) => `c${String(i)}`),
        capturedAt: 1
      })
    ).toBeNull();
    expect(parsePageCookies({ names: ['wprocket'], capturedAt: 'now' })).toBeNull();
    expect(parsePageCookies({ names: ['wprocket'], capturedAt: -1 })).toBeNull();
    expect(parsePageCookies({ names: ['wprocket'], capturedAt: Number.NaN })).toBeNull();
  });

  it('caps the capture stamp at the platform representable-instant ceiling', () => {
    // An audit's repro shapes: a stamp past what `new Date` can
    // represent must not cross the boundary (downstream date math).
    expect(parsePageCookies({ names: ['wprocket'], capturedAt: 9e15 })).toBeNull();
    expect(parsePageCookies({ names: ['wprocket'], capturedAt: 1e21 })).toBeNull();
    // Acceptance band: day zero, a real wall-clock stamp and exactly the
    // platform ceiling are representable; one tick past the ceiling is not,
    // and a fractional stamp is not a wall-clock ms at all. The cap is the
    // cache-stamp defense's own ceiling (`MAX_REPRESENTABLE_MS`) — one
    // declaring site, no second limit in the codebase.
    const at = (capturedAt: number): { names: string[]; capturedAt: number } => ({
      names: ['wprocket'],
      capturedAt
    });
    expect(parsePageCookies(at(0))).toEqual(at(0));
    expect(parsePageCookies(at(1_800_000_000_000))).toEqual(at(1_800_000_000_000));
    expect(parsePageCookies(at(MAX_REPRESENTABLE_MS))).toEqual(at(MAX_REPRESENTABLE_MS));
    expect(parsePageCookies(at(MAX_REPRESENTABLE_MS + 1))).toBeNull();
    expect(parsePageCookies(at(1.5))).toBeNull();
  });

  it('rejects a payload with duplicate names (the unique-names contract)', () => {
    // The capture side dedupes (its dedupe key is the emitted, clipped name),
    // so a duplicated list means a forged or drifted payload: rejected as a
    // unit — no silent partial cut — and `PageCookies`' "unique names" doc
    // claim stays true for every payload the validator lets through.
    expect(parsePageCookies({ names: ['wprocket', 'wprocket'], capturedAt: 1 })).toBeNull();
    expect(parsePageCookies({ names: ['a', 'b', 'a'], capturedAt: 1 })).toBeNull();
  });

  it('control characters ride a name through (sibling-consistent, pinned deliberate)', () => {
    // Unreachable from a real browser (`document.cookie`'s grammar excludes
    // controls); the page-headers guard is printability-free too. Redaction
    // — the security property — is about values, never names.
    const names = sampleCookieNames('na\x01me=1');
    expect(names).toEqual(['na\x01me']);
    expect(parsePageCookies({ names, capturedAt: 1 })).toEqual({
      names: ['na\x01me'],
      capturedAt: 1
    });
  });
});

describe('parsePageCookies — capture-side ↔ validator consistency', () => {
  it('every list the capture side emits over the hostile corpus validates whole', () => {
    captureCorpus.forEach((documentCookie, index) => {
      const names = sampleCookieNames(documentCookie);
      const payload = { names, capturedAt: 1 };
      expect(
        parsePageCookies(payload),
        `corpus[${String(index)}] rejected the capture output`
      ).toEqual(payload);
    });
  });
});

describe('parseFdtData — the additive cookies field (tolerant payload contract)', () => {
  it('passes a payload carrying cookies through with the section intact', () => {
    const full = {
      ...validFdt(),
      cookies: { names: ['wprocket', 'fallback'], capturedAt: 1_800_000_000_000 }
    };
    expect(parseFdtData(full)).toEqual(full);
  });

  it('reads a payload without the field cleanly (the tolerance pin)', () => {
    const full = { ...validFdt(), wprDetections: minimalDetections() };
    const parsed = parseFdtData(full);
    expect(parsed).toEqual(full);
    expect(Object.hasOwn(parsed ?? {}, 'cookies')).toBe(false);
  });

  it('rejects a payload whose cookies slot does not validate as a unit', () => {
    const full = { ...validFdt(), wprDetections: minimalDetections() };
    expect(parseFdtData({ ...full, cookies: null })).toBeNull();
    expect(parseFdtData({ ...full, cookies: { names: 'wprocket', capturedAt: 1 } })).toBeNull();
    // The boundary rejects a value-shaped payload: values never cross.
    expect(
      parseFdtData({ ...full, cookies: { names: ['wprocket'], values: ['1'], capturedAt: 1 } })
    ).toBeNull();
  });
});

describe('parsePanelSearchAction', () => {
  it('accepts every action with exact keys (including the relay tab id)', () => {
    expect(parsePanelSearchAction({ action: 'performSearch', query: 'foo', tabId: 42 })).toEqual({
      action: 'performSearch',
      query: 'foo',
      tabId: 42
    });
    expect(parsePanelSearchAction({ action: 'cancelSearch', tabId: 42 })).toEqual({
      action: 'cancelSearch',
      tabId: 42
    });
    expect(parsePanelSearchAction({ action: 'nextSearchResult', tabId: 42 })).toEqual({
      action: 'nextSearchResult',
      tabId: 42
    });
    expect(parsePanelSearchAction({ action: 'previousSearchResult', tabId: 42 })).toEqual({
      action: 'previousSearchResult',
      tabId: 42
    });
  });

  it('rejects unknown actions, oversizes, missing/malformed tab ids and extra keys', () => {
    expect(parsePanelSearchAction({ action: 'scroll' })).toBeNull();
    expect(
      parsePanelSearchAction({ action: 'performSearch', query: 'a'.repeat(201), tabId: 42 })
    ).toBeNull();
    expect(parsePanelSearchAction({ action: 'cancelSearch', query: 'x', tabId: 42 })).toBeNull();
    expect(parsePanelSearchAction({ action: 'performSearch', query: 1, tabId: 42 })).toBeNull();
    expect(parsePanelSearchAction({ action: 'performSearch', query: 'x' })).toBeNull();
    expect(parsePanelSearchAction({ action: 'cancelSearch' })).toBeNull();
    expect(parsePanelSearchAction({ action: 'cancelSearch', tabId: -1 })).toBeNull();
    expect(parsePanelSearchAction({ action: 'cancelSearch', tabId: 1.5 })).toBeNull();
    expect(parsePanelSearchAction({ action: 'cancelSearch', tabId: '42' })).toBeNull();
    expect(parsePanelSearchAction({ action: 'cancelSearch', tabId: Number.NaN })).toBeNull();
    expect(parsePanelSearchAction('performSearch')).toBeNull();
  });
});

describe('the optional truncation mark (additive, tolerant contract)', () => {
  /** Each markable detections row: where it lives and a populated form of it. */
  const markableRows: readonly (readonly [string, Record<string, unknown>])[] = [
    [
      'wpr',
      { present: true, cacheMarkerFound: false, cached: false, version: '3.20', timeStamp: null }
    ],
    ['delay_js', { present: false, scripts: [], version: '2.0', delayedScripts: 0 }],
    ['defer_all_js', { present: true, scripts: ['/a.js'], deferredScripts: 1 }],
    [
      'lazyload',
      {
        present: true,
        images: [{ src: '/a.jpg', lazyloadDetected: true, excludedReasonsFound: [] }]
      }
    ],
    [
      'rocket_above_the_fold_optimization',
      { present: true, lcpComment: false, preloadedImages: ['/hero.webp'] }
    ],
    ['auto_preload_fonts', { present: true, fonts: ['/f.woff2'] }],
    [
      'preconnect_external_domains',
      { present: true, domains: ['https://cdn.example'], preconnectCount: 0 }
    ],
    ['dns_prefetch', { present: true, domains: ['https://cdn.example/'], source: 'meta' }]
  ];

  const withRow = (key: string, row: Record<string, unknown>): Record<string, unknown> => ({
    ...minimalDetections(),
    [key]: row
  });

  /** One parsed row by key (null-safe, no index-signature cast). */
  const rowOf = (parsed: object | null, key: string): unknown =>
    parsed === null ? undefined : new Map(Object.entries(parsed)).get(key);

  for (const [key, row] of markableRows) {
    it(`${key}: reads the row with and without the mark, carrying it through`, () => {
      expect(rowOf(parseWprDetections(withRow(key, row)), key)).toEqual(row);
      const marked = parseWprDetections(withRow(key, { ...row, truncated: true }));
      expect(rowOf(marked, key)).toEqual({
        ...row,
        truncated: true
      });
    });

    it(`${key}: rejects a mark that is not exactly true`, () => {
      for (const value of [false, 'true', 1, null, undefined]) {
        expect(parseWprDetections(withRow(key, { ...row, truncated: value }))).toBeNull();
      }
    });
  }

  it('rejects the mark on rows that cannot have been cut (empty/absent arms)', () => {
    const cases: readonly (readonly [string, Record<string, unknown>])[] = [
      ['rocket_above_the_fold_optimization', { present: false, lcpComment: false }],
      ['auto_preload_fonts', { present: false, fonts: [] }],
      ['preconnect_external_domains', { present: false, domains: [], preconnectCount: 0 }],
      ['dns_prefetch', { present: true, domains: [], source: 'meta' }]
    ];
    for (const [key, row] of cases) {
      expect(parseWprDetections(withRow(key, { ...row, truncated: true }))).toBeNull();
    }
    expect(parsePreloadedResources({ present: false, truncated: true })).toBeNull();
  });

  it('reads a marked preloaded-resources report, and nothing but a true mark', () => {
    const report = { present: true, resources: [{ href: '/a', type: 'image' }], truncated: true };
    expect(parsePreloadedResources(report)).toEqual(report);
    expect(parsePreloadedResources({ ...report, truncated: false })).toBeNull();
    // The mark is the only key added: a foreign key beside it still rejects.
    expect(parsePreloadedResources({ ...report, extra: 1 })).toBeNull();
  });

  it('a whole payload with marked rows survives parseFdtData', () => {
    const payload = validFdt();
    payload['wprDetections'] = withRow('rocket_above_the_fold_optimization', {
      present: true,
      lcpComment: false,
      preloadedImages: ['/hero.webp'],
      truncated: true
    });
    expect(parseFdtData(payload)).not.toBeNull();
  });
});

describe('parseFdtDataExplained — the first failing field, by path', () => {
  /**
   * A valid payload with the value at `keys` replaced (keys walk records by
   * name and arrays by index).
   */
  const broken = (keys: readonly (string | number)[], value: unknown): unknown => {
    const payload: unknown = structuredClone(validFdtPayload());
    let node: unknown = payload;
    keys.forEach((key, depth) => {
      if (typeof node !== 'object' || node === null) throw new Error(`no node at ${String(key)}`);
      const container = node as Record<string | number, unknown>;
      if (depth === keys.length - 1) container[key] = value;
      else node = container[key];
    });
    return payload;
  };

  it('passes a valid payload through', () => {
    const result = parseFdtDataExplained(validFdtPayload());
    expect(result).toEqual({ ok: true, data: parseFdtData(validFdtPayload()) });
  });

  it('names the root for a non-record payload', () => {
    expect(parseFdtDataExplained('not a payload')).toEqual({ ok: false, path: '(root)' });
  });

  const cases: readonly (readonly [string, readonly (string | number)[], unknown])[] = [
    ['allScriptsLoaded', ['allScriptsLoaded'], 'yes'],
    ['pageHeaders[0].value', ['pageHeaders', 0, 'value'], 7],
    ['pageHeadersTruncated', ['pageHeadersTruncated'], false],
    ['undefinedReferencesOnPage[0]', ['undefinedReferencesOnPage', 0], ''],
    ['wprDetections.wpr.timeStamp', ['wprDetections', 'wpr', 'timeStamp'], Infinity],
    [
      'wprDetections.delay_js.scripts[0].src',
      ['wprDetections', 'delay_js', 'scripts', 0, 'src'],
      1
    ],
    [
      'wprDetections.lazyload.images[0].src',
      ['wprDetections', 'lazyload', 'images', 0, 'src'],
      null
    ],
    [
      'wprDetections.rocket_above_the_fold_optimization.preloadedImages[0]',
      ['wprDetections', 'rocket_above_the_fold_optimization', 'preloadedImages', 0],
      'x'.repeat(5000)
    ],
    [
      'wprDetections.auto_preload_fonts.fonts[0]',
      ['wprDetections', 'auto_preload_fonts', 'fonts'],
      [1]
    ],
    [
      'wprDetections.auto_preload_fonts.fonts',
      ['wprDetections', 'auto_preload_fonts', 'fonts'],
      'not a list'
    ],
    ['wprDetections.rocket_cdn', ['wprDetections', 'rocket_cdn'], { present: 1 }],
    [
      'preloadedResources.hints[1].mark',
      ['preloadedResources'],
      {
        present: false,
        hints: [
          { rel: 'preload', href: '/a', as: 'image', mark: 'preload' },
          { rel: 'preconnect', href: '/b', as: '', mark: 'preload' }
        ]
      }
    ],
    [
      'preloadedResources.hintsTruncated',
      ['preloadedResources'],
      { present: false, hints: [], hintsTruncated: true }
    ],
    [
      'preloadedResources.resources[1].type',
      ['preloadedResources'],
      {
        present: true,
        resources: [
          { href: '/a', type: 'image' },
          { href: '/b', type: 9 }
        ]
      }
    ]
  ];
  for (const [path, keys, value] of cases) {
    it(`names ${path}`, () => {
      expect(parseFdtDataExplained(broken(keys, value))).toEqual({ ok: false, path });
    });
  }

  it('leaves no trail behind: a plain parse after an explained one records nothing', () => {
    parseFdtDataExplained('not a payload');
    expect(parseFdtData('still not a payload')).toBeNull();
    expect(parseFdtDataExplained(validFdtPayload()).ok).toBe(true);
  });
});

describe('the truncation mark on rows the producer cannot have cut', () => {
  const withRow = (key: string, row: Record<string, unknown>): Record<string, unknown> => ({
    ...minimalDetections(),
    [key]: row
  });

  it('rejects it beside empty lists and null versions', () => {
    const uncut: readonly (readonly [string, Record<string, unknown>])[] = [
      [
        'wpr',
        {
          present: true,
          cacheMarkerFound: false,
          cached: false,
          version: null,
          timeStamp: null,
          truncated: true
        }
      ],
      [
        'delay_js',
        { present: false, scripts: [], version: null, delayedScripts: 0, truncated: true }
      ],
      ['defer_all_js', { present: true, scripts: [], truncated: true }],
      ['lazyload', { present: true, images: [], truncated: true }]
    ];
    for (const [key, row] of uncut) {
      expect(parseWprDetections(withRow(key, row)), key).toBeNull();
    }
    expect(parsePreloadedResources({ present: true, resources: [], truncated: true })).toBeNull();
    const payload = validFdt();
    expect(parseFdtData({ ...payload, pageHeaders: null, pageHeadersTruncated: true })).toBeNull();
    expect(parseFdtData({ ...payload, pageHeaders: [], pageHeadersTruncated: true })).toBeNull();
  });

  it('accepts it where a cut was possible (a version alone, a non-empty list)', () => {
    expect(
      parseWprDetections(
        withRow('delay_js', {
          present: false,
          scripts: [],
          version: '2.0',
          delayedScripts: 0,
          truncated: true
        })
      )
    ).not.toBeNull();
    expect(parseFdtData({ ...validFdt(), pageHeadersTruncated: true })).toMatchObject({
      pageHeadersTruncated: true
    });
  });
});

describe('Delay JS inline content: the list-wide budget', () => {
  const { content: perScript, contentTotal } = PAYLOAD_LIMITS.delayScripts;
  const inline = (length: number): Record<string, unknown> => ({
    inline: true,
    content: 'c'.repeat(length),
    delayed: true,
    deferred: false,
    deferredByWPR: false,
    fdtExcluded: null
  });
  const row = (scripts: Record<string, unknown>[]): Record<string, unknown> => ({
    ...minimalDetections(),
    delay_js: { present: true, scripts, version: null, delayedScripts: scripts.length }
  });
  const full = Math.floor(contentTotal / perScript);

  it('accepts inline text summing exactly to the budget', () => {
    expect(
      parseWprDetections(row(Array.from({ length: full }, () => inline(perScript))))
    ).not.toBeNull();
  });

  it('rejects one character over it', () => {
    const scripts = [...Array.from({ length: full }, () => inline(perScript)), inline(1)];
    expect(parseFdtDataExplained({ ...validFdt(), wprDetections: row(scripts) })).toEqual({
      ok: false,
      path: `wprDetections.delay_js.scripts[${String(full)}].content`
    });
  });
});

/**
 * Sparse arrays: structured-clone runtime messaging (Firefox; Chrome only when
 * the manifest opts into structured-clone serialization) carries holes and a
 * declared `length` intact, where Chrome's default JSON transport turns holes
 * into `null`. Every string-list guard must reject a hole (never throw on it
 * or copy it as `undefined`) and check its count cap before reading a member,
 * so a list claiming 2^32−1 members costs nothing.
 */
describe('sparse arrays: holes reject, count caps bound the work', () => {
  /** The detections payload with `patch` merged into one row (uncloned). */
  const withRow = (row: string, patch: Record<string, unknown>): Record<string, unknown> => {
    const payload = validDetections();
    payload[row] = { ...(payload[row] as Record<string, unknown>), ...patch };
    return payload;
  };

  /** Every capped string-list field, as "put `list` there and parse". */
  const LIST_FIELDS: [string, (list: unknown) => unknown][] = [
    ['cookies.names', (list) => parsePageCookies({ names: list, capturedAt: 1 })],
    [
      'lazyload.images[].excludedReasonsFound',
      (list) =>
        parseWprDetections(
          withRow('lazyload', {
            images: [{ src: '/a.jpg', lazyloadDetected: false, excludedReasonsFound: list }]
          })
        )
    ],
    [
      'rocket_above_the_fold_optimization.preloadedImages',
      (list) =>
        parseWprDetections(withRow('rocket_above_the_fold_optimization', { preloadedImages: list }))
    ],
    [
      'auto_preload_fonts.fonts (present)',
      (list) => parseWprDetections(withRow('auto_preload_fonts', { present: true, fonts: list }))
    ],
    [
      'auto_preload_fonts.fonts (absent)',
      (list) => parseWprDetections(withRow('auto_preload_fonts', { present: false, fonts: list }))
    ],
    [
      'preconnect_external_domains.domains (present)',
      (list) =>
        parseWprDetections(withRow('preconnect_external_domains', { present: true, domains: list }))
    ],
    [
      'preconnect_external_domains.domains (absent)',
      (list) =>
        parseWprDetections(
          withRow('preconnect_external_domains', { present: false, domains: list })
        )
    ],
    [
      'dns_prefetch.domains (declared)',
      (list) =>
        parseWprDetections(
          withRow('dns_prefetch', { present: true, domains: list, source: 'meta' })
        )
    ],
    [
      'dns_prefetch.domains (undecided)',
      (list) => parseWprDetections(withRow('dns_prefetch', { present: false, domains: list }))
    ],
    [
      'priority_elements_beacon.processed_extensions',
      (list) =>
        parseWprDetections(withRow('priority_elements_beacon', { processed_extensions: list }))
    ]
  ];

  /**
   * A list claiming `length` members (none stored) that counts member
   * touches — reads and presence checks (`every` probes holes with `has`) —
   * so a test can prove a guard rejected before scanning.
   */
  const countingList = (length: number): { list: unknown[]; touches: () => number } => {
    let touches = 0;
    /** Count `key` when it is an array index. */
    const touch = (key: string | symbol): void => {
      if (typeof key === 'string' && /^\d+$/.test(key)) touches += 1;
    };
    const list = new Proxy(new Array<unknown>(length), {
      get(target, key, receiver): unknown {
        touch(key);
        return Reflect.get(target, key, receiver) as unknown;
      },
      has(target, key): boolean {
        touch(key);
        return Reflect.has(target, key);
      }
    });
    return { list, touches: () => touches };
  };

  it.each(LIST_FIELDS)('%s: an over-cap list rejects before any member is touched', (_, parse) => {
    // Over every field's cap (largest: 1,000), small enough that a scanning
    // guard fails here in milliseconds instead of hanging the run.
    const { list, touches } = countingList(100_000);
    expect(parse(list)).toBeNull();
    expect(touches()).toBe(0);
  });

  it.each(LIST_FIELDS)('%s: a cloned 2^29-length sparse list rejects at once', (_, parse) => {
    // A few bytes on the wire (the clone keeps the hole and the length).
    const sparse: string[] = ['x'];
    sparse.length = 2 ** 29;
    const cloned = structuredClone(sparse);
    const start = performance.now();
    expect(parse(cloned)).toBeNull();
    // Cap-first is O(1) (well under 1 ms); an index walk over 2^29 slots
    // takes seconds — 1 s sits far from both, so it cannot flake, and a
    // regression fails here instead of hanging (2^32−1 would take ~1 min).
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it.each([
    ['rocket_above_the_fold_optimization', 'preloadedImages'],
    ['auto_preload_fonts', 'fonts'],
    ['preconnect_external_domains', 'domains'],
    ['priority_elements_beacon', 'processed_extensions']
  ])('%s.%s with a hole rejects', (row, field) => {
    const payload = structuredClone(withRow(row, { [field]: [, 'https://s.com/x'] }));
    expect(() => parseWprDetections(payload)).not.toThrow();
    expect(parseWprDetections(payload)).toBeNull();
  });

  it('lazyload excludedReasonsFound with a hole rejects (never copied as undefined)', () => {
    const images = [
      { src: '/a.jpg', lazyloadDetected: false, excludedReasonsFound: [, 'data-src'] }
    ];
    expect(parseWprDetections(structuredClone(withRow('lazyload', { images })))).toBeNull();
  });

  it.each([
    ['auto_preload_fonts', 'fonts', ['https://s.com/a.woff2', ,], '[1]'],
    ['auto_preload_fonts', 'fonts', ['https://s.com/a.woff2', 5], '[1]'],
    ['rocket_above_the_fold_optimization', 'preloadedImages', [, '/a.jpg'], '[0]']
  ])('the explained path names the bad member of %s.%s (%j)', (row, field, list, index) => {
    const wprDetections = structuredClone(withRow(row, { [field]: list }));
    expect(parseFdtDataExplained({ ...validFdt(), wprDetections })).toEqual({
      ok: false,
      path: `wprDetections.${row}.${field}${index}`
    });
  });

  it('control: the dense payload passes the clone (the rejection is the hole, not the shape)', () => {
    expect(parseWprDetections(structuredClone(validDetections()))).not.toBeNull();
  });

  it('pin: cookie names, error words, headers, known conflicts reject a hole too', () => {
    // These guards already visited every index; pinned so they stay that way.
    expect(parsePageCookies(structuredClone({ names: [, 'wprocket'], capturedAt: 1 }))).toBeNull();
    expect(parseErrorWords(structuredClone(['jQuery', , 'x']))).toBeNull();
    expect(parsePageHeaders(structuredClone([{ name: 'X-Cache' }, ,]))).toBeNull();
    expect(parseKnownConflicts(structuredClone([,]))).toBeNull();
  });
});
