/**
 * Boundary-guard tests. Every guard is exercised with valid payloads, the
 * shapes it must reject, and hostile inputs (oversized, wrong types,
 * prototype-pollution keys) — a validator that never saw an attack has not
 * tested anything.
 */
import { describe, expect, it } from 'vitest';
import {
  parseDbUpdateResult,
  parseDetectionSummary,
  parseDiagnoserData,
  parseErrorWords,
  parseFdtData,
  parseKnownConflicts,
  parsePageHeaders,
  parsePanelSearchAction,
  parsePreloadedResources,
  parseWprDetections
} from './validate';
import { minimalDetections, validFdt } from './validate.fixtures';

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
    expect(
      parsePreloadedResources({ present: true, resources: [{ href: '', type: '' }] })
    ).toBeNull();
    expect(parsePreloadedResources({ present: false, resources: [] })).toBeNull();
    expect(parsePreloadedResources([{ present: false }])).toBeNull();
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

  it('keeps the beacon and preloaded-images variants separate', () => {
    const detections = minimalDetections();
    const withBeacon = {
      ...detections,
      rocket_above_the_fold_optimization: { present: true, beacon: true }
    };
    expect(parseWprDetections(withBeacon)?.rocket_above_the_fold_optimization).toEqual({
      present: true,
      beacon: true
    });
    const withImages = {
      ...detections,
      rocket_above_the_fold_optimization: {
        present: true,
        beacon: false,
        preloadedImages: ['/a.jpg']
      }
    };
    expect(parseWprDetections(withImages)?.rocket_above_the_fold_optimization).toEqual({
      present: true,
      beacon: false,
      preloadedImages: ['/a.jpg']
    });
    // present ⇔ preloadedImages non-empty (inconsistent rows are rejected).
    const inconsistent = {
      ...detections,
      rocket_above_the_fold_optimization: { present: true, beacon: false, preloadedImages: [] }
    };
    expect(parseWprDetections(inconsistent)).toBeNull();
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

describe('parsePanelSearchAction', () => {
  it('accepts every action with exact keys', () => {
    expect(parsePanelSearchAction({ action: 'performSearch', query: 'foo' })).toEqual({
      action: 'performSearch',
      query: 'foo'
    });
    expect(parsePanelSearchAction({ action: 'cancelSearch' })).toEqual({ action: 'cancelSearch' });
    expect(parsePanelSearchAction({ action: 'nextSearchResult' })).toEqual({
      action: 'nextSearchResult'
    });
    expect(parsePanelSearchAction({ action: 'previousSearchResult' })).toEqual({
      action: 'previousSearchResult'
    });
  });

  it('rejects unknown actions, oversizes and extra keys', () => {
    expect(parsePanelSearchAction({ action: 'scroll' })).toBeNull();
    expect(parsePanelSearchAction({ action: 'performSearch', query: 'a'.repeat(201) })).toBeNull();
    expect(parsePanelSearchAction({ action: 'cancelSearch', query: 'x' })).toBeNull();
    expect(parsePanelSearchAction({ action: 'performSearch', query: 1 })).toBeNull();
    expect(parsePanelSearchAction('performSearch')).toBeNull();
  });
});
