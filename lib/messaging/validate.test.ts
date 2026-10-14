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
  parseDiagnoserData,
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
import { minimalDetections, validFdt, validFdtPayload } from './validate.fixtures';
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

describe('parseDiagnoserData', () => {
  it('passes object reports through and coerces wrong-typed slots to null', () => {
    const report = { noRocketData: { server_info: {} }, rocketData: { options: {} } };
    expect(parseDiagnoserData(report)).toEqual(report);
    expect(parseDiagnoserData({ noRocketData: 'bad', rocketData: {} })).toEqual({
      noRocketData: null,
      rocketData: {}
    });
  });

  it('accepts both-null and rejects arrays/wrappers', () => {
    expect(parseDiagnoserData({ noRocketData: null, rocketData: null })).toEqual({
      noRocketData: null,
      rocketData: null
    });
    expect(parseDiagnoserData([{}, {}])).toBeNull();
    expect(parseDiagnoserData({ noRocketData: [], rocketData: {} })).toEqual({
      noRocketData: null,
      rocketData: {}
    });
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
    // present without the list is not engine output.
    expect(
      parseWprDetections({
        ...detections,
        rocket_above_the_fold_optimization: { present: true, lcpComment: false }
      })
    ).toBeNull();
    // Lazy rendering: present ⇔ converted elements ≥ 1.
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
      })
    ).toBeNull();
    // Fonts + preconnect: present ⇔ non-empty lists.
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
    ).toBeNull();
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
});

describe('parseFdtData', () => {
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
    expect(parseFdtData({ ...full, diagnoserData: 'nope' })).toBeNull();
    expect(parseFdtData(null)).toBeNull();
    expect(parseFdtData('nope')).toBeNull();
  });

  it('requires every optional slot rather than guessing', () => {
    const full = { ...validFdt(), wprDetections: minimalDetections() };
    expect(parseFdtData({ ...full, diagnoserData: undefined })).toBeNull();
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
    // The audit's P2-2 repro shapes: a stamp past what `new Date` can
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
    ['wpr', { present: true, cached: false, version: '3.20', timeStamp: null }],
    ['delay_js', { present: false, scripts: [], version: '2.0', delayedScripts: 0 }],
    ['defer_all_js', { present: true, scripts: ['/a.js'] }],
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
    ]
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
      ['preconnect_external_domains', { present: false, domains: [], preconnectCount: 0 }]
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
      'wprDetections.auto_preload_fonts.fonts',
      ['wprDetections', 'auto_preload_fonts', 'fonts'],
      [1]
    ],
    ['wprDetections.rocket_cdn', ['wprDetections', 'rocket_cdn'], { present: 1 }],
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
      ['wpr', { present: true, cached: false, version: null, timeStamp: null, truncated: true }],
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
