/**
 * Exclusion-session contract guards: every accept and reject arm of the
 * set, record/status, apply request/reply and panel guards, both
 * unknown-key policies, the size caps at their exact edges, and the wire
 * round trip of the new protocol rows.
 */
import { describe, expect, it } from 'vitest';
import { applyPipeline } from '../exclusion-builder/pipeline';
import { prevalidateExclusionSet } from '../exclusion-builder/validate';
import { EMPTY_EXCLUSION_SET, EXCLUSION_FEATURES } from '../exclusion-builder/set';
import {
  EXCLUSION_DOCUMENT_FAILURES,
  EXCLUSION_SESSION_DEADLINES_MS,
  EXCLUSION_SET_LIMITS,
  EXCLUSION_SAVE_FAILURES,
  INTERCEPTION_UNAVAILABLE_CAUSES,
  invalidApplyReply,
  isInterceptionUnavailableCause,
  parseExclusionApplyReply,
  parseExclusionSaveReply,
  parseSavedExclusionSetReply,
  parseExclusionSetPayload,
  parseExclusionSessionRecord,
  parseExclusionSessionStatus,
  parseExclusionSessionTabQuery,
  parseExclusionSessionTabStatus,
  parseExclusionOverlayPresentation,
  parseExclusionSet,
  parseServedDocument,
  SERVED_DOCUMENT_LIMITS
} from './exclusion-session';
import { activeRecord, validSet } from './exclusion-session.fixtures';
import { onMessage, sendMessage } from './index';

/** A deep-cloned plain-object copy the cases mutate freely. */
function clone(value: unknown): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

/** The document outcome of a parsed record, or undefined for a rejection / non-active record. */
function documentOf(record: ReturnType<typeof parseExclusionSessionRecord>): unknown {
  return record?.state === 'active' ? record.document : undefined;
}

/** The fixture set with one row list replaced. */
function setWithRows(key: string, rows: unknown): Record<string, unknown> {
  const set = clone(validSet());
  (set['rows'] as Record<string, unknown>)[key] = rows;
  return set;
}

describe('INTERCEPTION_UNAVAILABLE_CAUSES', () => {
  it('declares every cause with an explicit retry rule', () => {
    expect(INTERCEPTION_UNAVAILABLE_CAUSES).toEqual({
      'attach-denied': { retryable: true },
      'debugging-policy': { retryable: false },
      'infobar-cancelled': { retryable: true },
      detached: { retryable: true },
      'unsupported-page': { retryable: false },
      'unsupported-browser': { retryable: false },
      'session-limit': { retryable: true }
    });
  });

  it('recognizes own causes only — inherited names and non-strings are not causes', () => {
    expect(isInterceptionUnavailableCause('infobar-cancelled')).toBe(true);
    for (const value of ['toString', '__proto__', 'hasOwnProperty', '', 'Detached', 5, null]) {
      expect(isInterceptionUnavailableCause(value)).toBe(false);
    }
  });

  it('keeps every deadline positive, the apply one the longest (it includes the attach)', () => {
    const { apply, ...others } = EXCLUSION_SESSION_DEADLINES_MS;
    for (const ms of Object.values(EXCLUSION_SESSION_DEADLINES_MS)) expect(ms).toBeGreaterThan(0);
    expect(apply).toBeGreaterThanOrEqual(Math.max(...Object.values(others)));
  });
});

describe('parseExclusionSet', () => {
  it('rebuilds a valid set and the empty set exactly, as fresh objects', () => {
    const input = validSet();
    const parsed = parseExclusionSet(input, 'reject');
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed?.rows.delayJs).not.toBe(input.rows.delayJs);
    expect(parseExclusionSet(EMPTY_EXCLUSION_SET, 'reject')).toEqual(EMPTY_EXCLUSION_SET);
  });

  it('lets rows the engine rejects through — validity is the engine’s to name', () => {
    const set = setWithRows('delayJs', ['', '   ', '(unclosed']);
    const parsed = parseExclusionSet(set, 'reject');
    expect(parsed?.rows.delayJs).toEqual(['', '   ', '(unclosed']);
    expect(parsed && prevalidateExclusionSet(parsed).invalid).toHaveLength(3);
  });

  it('rejects non-records and missing parts', () => {
    for (const input of [null, undefined, 'set', 5, [], { rows: validSet().rows }]) {
      expect(parseExclusionSet(input, 'ignore')).toBeNull();
    }
    expect(parseExclusionSet({ ...validSet(), rows: [] }, 'reject')).toBeNull();
    expect(parseExclusionSet({ ...validSet(), disable: null }, 'reject')).toBeNull();
  });

  it('requires every registry row list and toggle under both policies', () => {
    for (const { rowsKey } of EXCLUSION_FEATURES) {
      const set = clone(validSet());
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- dropping each registry key in turn is the case
      delete (set['rows'] as Record<string, unknown>)[rowsKey];
      expect(parseExclusionSet(set, 'ignore'), rowsKey).toBeNull();
    }
    for (const toggle of ['delayJs', 'deferJs', 'lazyRender']) {
      const set = clone(validSet());
      (set['disable'] as Record<string, unknown>)[toggle] = 'yes';
      expect(parseExclusionSet(set, 'ignore'), toggle).toBeNull();
    }
  });

  it('rejects unknown keys at every level under reject, drops them under ignore', () => {
    const top = { ...clone(validSet()), extra: 1 };
    const rows = clone(validSet());
    (rows['rows'] as Record<string, unknown>)['iframes'] = [];
    const disable = clone(validSet());
    (disable['disable'] as Record<string, unknown>)['lazyload'] = true;
    for (const input of [top, rows, disable]) {
      expect(parseExclusionSet(input, 'reject')).toBeNull();
      expect(parseExclusionSet(input, 'ignore')).toEqual(validSet());
    }
  });

  it('rejects wrong-typed, unprintable and over-long rows', () => {
    for (const rows of [
      'gtag',
      [5],
      [null],
      ['a\u0001b'],
      ['\ud800'],
      ['x'.repeat(EXCLUSION_SET_LIMITS.rowChars + 1)]
    ]) {
      expect(parseExclusionSet(setWithRows('deferJs', rows), 'reject')).toBeNull();
    }
    // A sparse list's hole is not a row (an `every` check would skip it).
    expect(parseExclusionSet(setWithRows('deferJs', ['a', , 'b']), 'reject')).toBeNull();
    // Tabs and newlines are printable text, and the per-row cap is inclusive.
    const edge = ['a\tb\nc', 'x'.repeat(EXCLUSION_SET_LIMITS.rowChars)];
    expect(parseExclusionSet(setWithRows('deferJs', edge), 'reject')?.rows.deferJs).toEqual(edge);
  });

  it('caps rows per feature at the limit, inclusive', () => {
    const atCap = Array.from({ length: EXCLUSION_SET_LIMITS.rowsPerFeature }, () => 'r');
    expect(parseExclusionSet(setWithRows('lazyload', atCap), 'reject')).not.toBeNull();
    expect(parseExclusionSet(setWithRows('lazyload', [...atCap, 'r']), 'reject')).toBeNull();
  });

  it('caps the characters summed over the whole set, inclusive', () => {
    const row = 'x'.repeat(EXCLUSION_SET_LIMITS.rowChars);
    const rowsPerList = EXCLUSION_SET_LIMITS.totalChars / EXCLUSION_SET_LIMITS.rowChars / 4;
    const full = Array.from({ length: rowsPerList }, () => row);
    const atCap = {
      rows: { delayJs: full, deferJs: full, lazyload: full, lazyRender: full },
      disable: EMPTY_EXCLUSION_SET.disable
    };
    expect(parseExclusionSet(atCap, 'reject')).not.toBeNull();
    const over = structuredClone(atCap);
    over.rows.lazyRender = [...full, 'y'];
    expect(parseExclusionSet(over, 'reject')).toBeNull();
  });

  it('keeps a worst-case set under the ~200 KiB the store budgets assume', () => {
    // 3-byte UTF-8 chars at the whole-set cap: the heaviest printable set.
    const row = '€'.repeat(EXCLUSION_SET_LIMITS.rowChars);
    const rowsPerList = EXCLUSION_SET_LIMITS.totalChars / EXCLUSION_SET_LIMITS.rowChars / 4;
    const full = Array.from({ length: rowsPerList }, () => row);
    const set = parseExclusionSet(
      {
        rows: { delayJs: full, deferJs: full, lazyload: full, lazyRender: full },
        disable: EMPTY_EXCLUSION_SET.disable
      },
      'reject'
    );
    expect(set).not.toBeNull();
    expect(new TextEncoder().encode(JSON.stringify(set)).length).toBeLessThan(200 * 1024);
  });
});

describe('parseExclusionSessionStatus', () => {
  it('accepts inactive with exact keys only', () => {
    expect(parseExclusionSessionStatus({ state: 'inactive' })).toEqual({ state: 'inactive' });
    expect(parseExclusionSessionStatus({ state: 'inactive', cause: 'detached' })).toBeNull();
  });

  it('accepts an active session in every document outcome', () => {
    const record = activeRecord();
    expect(parseExclusionSessionStatus(record)).toEqual(record);
    for (const document of [
      null,
      { outcome: 'rewritten', reports: [] },
      { outcome: 'over-budget', feature: 'delay_js', row: 'gtag', budgetMs: 2000 },
      { outcome: 'over-budget', feature: 'defer_all_js', row: null, budgetMs: 1 },
      ...EXCLUSION_DOCUMENT_FAILURES.map((reason) => ({ outcome: 'failed', reason }))
    ]) {
      const status = { ...record, document };
      expect(parseExclusionSessionStatus(status), JSON.stringify(document)).toEqual(status);
    }
  });

  it('pins the unmodified-document reasons (encode-failed is its own reason)', () => {
    expect(EXCLUSION_DOCUMENT_FAILURES).toEqual([
      'body-unavailable',
      'decode-failed',
      'encode-failed',
      'engine-failed',
      'not-served'
    ]);
    const encodeFailed = {
      ...activeRecord(),
      document: { outcome: 'failed', reason: 'encode-failed' }
    };
    expect(parseExclusionSessionRecord(encodeFailed, 'reject')).toEqual(encodeFailed);
    expect(parseExclusionSessionRecord(encodeFailed, 'ignore')).toEqual(encodeFailed);
    // A reason this build does not know drops the record on read-back, never fabricates one.
    const unknown = { ...activeRecord(), document: { outcome: 'failed', reason: 'later-reason' } };
    expect(parseExclusionSessionRecord(unknown, 'ignore')).toBeNull();
  });

  it("accepts the engine's own reports for a real document", () => {
    const html =
      '<!doctype html><script type="rocketlazyloadscript" data-rocket-src="/gtag.js"></script>' +
      '<img src="data:image/svg+xml,x" data-lazy-src="/hero.webp">';
    const set = {
      rows: { delayJs: ['gtag', 'nomatch'], deferJs: [], lazyload: ['hero.webp'], lazyRender: [] },
      disable: { delayJs: false, deferJs: false, lazyRender: true }
    };
    const { reports } = applyPipeline(html, set);
    // The reports belong to the set they ran with — the record carries that set.
    const status = { ...activeRecord(), set, document: { outcome: 'rewritten', reports } };
    expect(parseExclusionSessionStatus(status)).toEqual(status);
  });

  it('accepts every unavailable cause, rejects unknown ones and bad stamps', () => {
    for (const cause of Object.keys(INTERCEPTION_UNAVAILABLE_CAUSES)) {
      const status = { state: 'unavailable', cause, at: 0 };
      expect(parseExclusionSessionStatus(status)).toEqual(status);
    }
    for (const status of [
      { state: 'unavailable', cause: 'toString', at: 1 },
      { state: 'unavailable', cause: 'detached', at: -1 },
      { state: 'unavailable', cause: 'detached', at: 1.5 },
      { state: 'unavailable', cause: 'detached' },
      { state: 'unavailable', cause: 'detached', at: 1, extra: true }
    ]) {
      expect(parseExclusionSessionStatus(status)).toBeNull();
    }
  });

  it('rejects unknown states and non-records', () => {
    for (const input of [null, 'active', [], {}, { state: 'armed' }]) {
      expect(parseExclusionSessionStatus(input)).toBeNull();
    }
  });

  it('rejects an active session with a bad origin, stamp, set or extra key', () => {
    for (const patch of [
      { origin: 'https://example.com/' },
      { origin: 'chrome://settings' },
      { origin: `https://${'a'.repeat(EXCLUSION_SET_LIMITS.originChars)}.com` },
      { origin: 5 },
      { startedAt: -1 },
      { startedAt: '1' },
      { set: EMPTY_EXCLUSION_SET.rows },
      { document: undefined },
      { document: 'rewritten' },
      { extra: 1 }
    ]) {
      expect(
        parseExclusionSessionStatus({ ...activeRecord(), ...patch }),
        JSON.stringify(patch)
      ).toBeNull();
    }
  });

  it('rejects malformed document outcomes', () => {
    const report = activeRecord().document;
    const goodReport =
      report?.outcome === 'rewritten' ? report.reports[0] : expect.fail('fixture changed');
    const reportWith = (patch: Record<string, unknown>): unknown => ({
      outcome: 'rewritten',
      reports: [{ ...goodReport, ...patch }]
    });
    for (const document of [
      { outcome: 'unknown' },
      { outcome: 'rewritten' },
      { outcome: 'rewritten', reports: {} },
      { outcome: 'rewritten', reports: [goodReport], extra: 1 },
      { outcome: 'rewritten', reports: Array.from({ length: 5 }, () => goodReport) },
      { outcome: 'rewritten', reports: [null] },
      reportWith({ feature: 'iframes' }),
      reportWith({ featureWide: 'no' }),
      reportWith({ candidates: -1 }),
      reportWith({ rewritten: 1.5 }),
      reportWith({ regionRemovals: Number.NaN }),
      reportWith({ rewritten: 4, candidates: 3 }),
      reportWith({ matchedRows: 'gtag' }),
      reportWith({
        matchedRows: Array.from({ length: EXCLUSION_SET_LIMITS.rowsPerFeature + 1 }, () => ({
          row: 'r',
          rowKind: 'pattern',
          matches: 1
        }))
      }),
      reportWith({ matchedRows: [null] }),
      reportWith({ matchedRows: [{ row: 'gtag', rowKind: 'literal', matches: 1 }] }),
      reportWith({ matchedRows: [{ row: 'gtag', rowKind: 'pattern', matches: 0 }] }),
      reportWith({ matchedRows: [{ row: 5, rowKind: 'pattern', matches: 1 }] }),
      reportWith({ matchedRows: [{ row: 'g', rowKind: 'pattern', matches: 1, x: 1 }] }),
      reportWith({ unmatchedRows: [5] }),
      reportWith({ extra: 1 }),
      { outcome: 'over-budget', feature: 'delay_js', row: 'gtag', budgetMs: 0 },
      { outcome: 'over-budget', feature: 'delay_js', row: 'gtag', budgetMs: 600_001 },
      { outcome: 'over-budget', feature: 'delay_js', row: 5, budgetMs: 10 },
      { outcome: 'over-budget', feature: 'nope', row: null, budgetMs: 10 },
      { outcome: 'over-budget', feature: 'delay_js', row: null, budgetMs: 10, x: 1 },
      { outcome: 'failed', reason: 'timeout' },
      { outcome: 'failed', reason: 'engine-failed', x: 1 }
    ]) {
      expect(
        parseExclusionSessionStatus({ ...activeRecord(), document }),
        JSON.stringify(document)
      ).toBeNull();
    }
  });
});

describe('document reports are tied to the session set', () => {
  /** The fixture record with its document's single report patched. */
  function withReport(patch: Record<string, unknown>, extra: unknown[] = []): unknown {
    const document = activeRecord().document;
    const report = document?.outcome === 'rewritten' ? document.reports[0] : undefined;
    if (report === undefined) expect.fail('fixture changed');
    return {
      ...activeRecord(),
      document: { outcome: 'rewritten', reports: [{ ...report, ...patch }, ...extra] }
    };
  }

  it('accepts the fixture (rows drawn from the set, matches within candidates)', () => {
    expect(parseExclusionSessionStatus(withReport({}))).not.toBeNull();
  });

  it('rejects rows the set does not hold for that feature, or more often than it holds them', () => {
    for (const patch of [
      { unmatchedRows: ['not-in-set'] },
      { unmatchedRows: ['jquery\\.min\\.js', 'jquery\\.min\\.js'] },
      { unmatchedRows: ['hero.webp'] },
      { matchedRows: [{ row: 'elsewhere', rowKind: 'pattern', matches: 1 }] },
      {
        matchedRows: [{ row: 'gtag', rowKind: 'pattern', matches: 1 }],
        unmatchedRows: ['gtag']
      }
    ]) {
      expect(parseExclusionSessionStatus(withReport(patch)), JSON.stringify(patch)).toBeNull();
    }
  });

  it('rejects summed row matches above the candidates', () => {
    expect(
      parseExclusionSessionStatus(
        withReport({
          candidates: 2,
          rewritten: 2,
          matchedRows: [
            { row: 'gtag', rowKind: 'pattern', matches: 2 },
            { row: 'jquery\\.min\\.js', rowKind: 'pattern', matches: 1 }
          ],
          unmatchedRows: []
        })
      )
    ).toBeNull();
  });

  it('rejects row attributions on a feature-wide run, accepts a bare one', () => {
    expect(parseExclusionSessionStatus(withReport({ featureWide: true }))).toBeNull();
    expect(
      parseExclusionSessionStatus(
        withReport({ featureWide: true, matchedRows: [], unmatchedRows: [] })
      )
    ).not.toBeNull();
  });

  it('rejects a second report for the same feature', () => {
    const document = activeRecord().document;
    const report = document?.outcome === 'rewritten' ? document.reports[0] : undefined;
    expect(parseExclusionSessionStatus(withReport({}, [report]))).toBeNull();
  });

  it('rejects an over-budget row the feature does not hold', () => {
    for (const [feature, row] of [
      ['delay_js', 'not-in-set'],
      ['lazyload', 'gtag']
    ] as const) {
      const status = {
        ...activeRecord(),
        document: { outcome: 'over-budget', feature, row, budgetMs: 10 }
      };
      expect(parseExclusionSessionStatus(status), row).toBeNull();
    }
  });

  it('keeps a worst-case active record under 512 KiB of JSON (the session-store bound)', () => {
    // 3-byte UTF-8 chars at the whole-set cap, every row in the report with
    // the widest counts the matches-within-candidates rule allows.
    // Every row slot used (per-row JSON overhead), the whole char budget spent.
    const rowsPerList = EXCLUSION_SET_LIMITS.rowsPerFeature;
    const rowCount = rowsPerList * EXCLUSION_FEATURES.length;
    const baseChars = Math.floor(EXCLUSION_SET_LIMITS.totalChars / rowCount);
    const longer = EXCLUSION_SET_LIMITS.totalChars - baseChars * rowCount;
    const lists = EXCLUSION_FEATURES.map((feature, list) => ({
      feature,
      rows: Array.from({ length: rowsPerList }, (_, index) => {
        const chars = baseChars + (list * rowsPerList + index < longer ? 1 : 0);
        return `${String(index).padStart(3, '0')}${'€'.repeat(chars - 3)}`;
      })
    }));
    const set = {
      rows: Object.fromEntries(lists.map(({ feature, rows }) => [feature.rowsKey, rows])),
      disable: EMPTY_EXCLUSION_SET.disable
    };
    const candidates = Number.MAX_SAFE_INTEGER;
    const perRow = Math.floor(candidates / rowsPerList);
    const reports = lists.map(({ feature, rows }) => ({
      feature: feature.id,
      featureWide: false,
      candidates,
      rewritten: candidates,
      regionRemovals: Number.MAX_SAFE_INTEGER,
      matchedRows: rows.map((row) => ({ row, rowKind: feature.rowKind, matches: perRow })),
      unmatchedRows: []
    }));
    const record = parseExclusionSessionRecord(
      {
        state: 'active',
        origin: `https://${'a'.repeat(63)}.${'b'.repeat(63)}.example:65535`,
        set,
        startedAt: Number.MAX_SAFE_INTEGER,
        document: {
          outcome: 'rewritten',
          reports,
          served: {
            // A serialized URL is ASCII: one byte per character at the cap.
            urlPath: `https://a.example/${'a'.repeat(SERVED_DOCUMENT_LIMITS.urlPathChars - 18)}`,
            urlDigest: 'f'.repeat(64),
            token: 't'.repeat(SERVED_DOCUMENT_LIMITS.tokenChars),
            order: Number.MAX_SAFE_INTEGER,
            receivedAt: Number.MAX_SAFE_INTEGER,
            speculationRules: {
              removedFromDocument: SERVED_DOCUMENT_LIMITS.speculationRules,
              headerRemoved: true,
              guarded: true
            },
            copy: true,
            serviceWorkersBypassed: true
          }
        }
      },
      'reject'
    );
    expect(record).not.toBeNull();
    // Measured 490,779 bytes (≈ 479 KiB) with the widest served identity — 33 KiB under
    // the bound (488,307 without; the query-free path keeps the identity small).
    console.log('SIZE', new TextEncoder().encode(JSON.stringify(record)).length);
    expect(new TextEncoder().encode(JSON.stringify(record)).length).toBeLessThan(512 * 1024);
  });
});

describe('own properties only', () => {
  it('rejects fields supplied by the prototype, under both policies', () => {
    const inheritedSet: unknown = Object.create({
      rows: validSet().rows,
      disable: validSet().disable
    });
    const inheritedRecord: unknown = Object.create(activeRecord());
    for (const policy of ['reject', 'ignore'] as const) {
      expect(parseExclusionSet(inheritedSet, policy)).toBeNull();
      expect(parseExclusionSessionRecord(inheritedRecord, policy)).toBeNull();
    }
    expect(parseExclusionSetPayload(Object.create({ set: validSet() }))).toBeNull();
    expect(parseExclusionApplyReply(Object.create({ outcome: 'applying' }))).toBeNull();
    expect(parseExclusionSessionTabQuery(Object.create({ tabId: 1 }))).toBeNull();
  });
});

describe('whole-set character budget', () => {
  it('bails at the first row past the budget, reading no further rows', () => {
    const full = Array.from(
      { length: EXCLUSION_SET_LIMITS.totalChars / EXCLUSION_SET_LIMITS.rowChars },
      () => 'x'.repeat(EXCLUSION_SET_LIMITS.rowChars)
    );
    let reads = 0;
    const counted = new Proxy(
      Array.from({ length: EXCLUSION_SET_LIMITS.rowsPerFeature }, () => 'y'),
      {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
          return Reflect.get(target, key, receiver) as unknown;
        }
      }
    );
    const set = {
      rows: { delayJs: full, deferJs: counted, lazyload: [], lazyRender: [] },
      disable: EMPTY_EXCLUSION_SET.disable
    };
    expect(parseExclusionSet(set, 'reject')).toBeNull();
    expect(reads).toBe(1);
  });
});

/** A valid served identity. */
function served(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    urlPath: 'https://example.com/page',
    urlDigest: '0123456789abcdef'.repeat(4),
    token: 'interception-job-7.0',
    order: 1_800_000_000_123,
    receivedAt: 1_800_000_000_000,
    speculationRules: { removedFromDocument: 2, headerRemoved: true, guarded: false },
    copy: true,
    serviceWorkersBypassed: true,
    ...overrides
  };
}

/** A speculation summary with one field replaced. */
function rules(overrides: Record<string, unknown>): Record<string, unknown> {
  return { removedFromDocument: 0, headerRemoved: false, guarded: true, ...overrides };
}

describe('parseServedDocument', () => {
  it('accepts a valid identity and rebuilds it', () => {
    expect(parseServedDocument(served(), 'reject')).toEqual(served());
  });

  it('accepts the caps at their exact edges', () => {
    const edge = served({
      urlPath: `https://e.x/${'a'.repeat(SERVED_DOCUMENT_LIMITS.urlPathChars - 12)}`,
      token: 't'.repeat(SERVED_DOCUMENT_LIMITS.tokenChars),
      speculationRules: rules({ removedFromDocument: SERVED_DOCUMENT_LIMITS.speculationRules })
    });
    expect(parseServedDocument(edge, 'reject')).toEqual(edge);
  });

  it.each([
    ['not a record', 'x'],
    ['an unknown key (reject)', served({ extra: 1 })],
    ['a non-http path', served({ urlPath: 'chrome://version' })],
    ['a relative path', served({ urlPath: '/page' })],
    ['a URL with its query (never stored)', served({ urlPath: 'https://e.x/a?email=x' })],
    ['an empty query mark', served({ urlPath: 'https://e.x/a?' })],
    ['a URL with a fragment', served({ urlPath: 'https://e.x/a#top' })],
    [
      'an over-long path',
      served({ urlPath: `https://e.x/${'a'.repeat(SERVED_DOCUMENT_LIMITS.urlPathChars)}` })
    ],
    ['a short digest', served({ urlDigest: 'ab' })],
    ['an uppercase digest', served({ urlDigest: 'A'.repeat(64) })],
    ['an empty token', served({ token: '' })],
    ['an over-long token', served({ token: 't'.repeat(SERVED_DOCUMENT_LIMITS.tokenChars + 1) })],
    ['an unprintable token', served({ token: 'a\u0000b' })],
    ['a negative order', served({ order: -1 })],
    ['a negative time', served({ receivedAt: -1 })],
    ['a fractional count', served({ speculationRules: rules({ removedFromDocument: 1.5 }) })],
    [
      'an over-cap count',
      served({
        speculationRules: rules({
          removedFromDocument: SERVED_DOCUMENT_LIMITS.speculationRules + 1
        })
      })
    ],
    ['a non-boolean header flag', served({ speculationRules: rules({ headerRemoved: 1 }) })],
    ['a non-boolean guard flag', served({ speculationRules: rules({ guarded: 'yes' }) })],
    ['an unknown speculation key (reject)', served({ speculationRules: rules({ x: 1 }) })],
    ['a missing speculation summary', served({ speculationRules: undefined })],
    ['a non-boolean copy flag', served({ copy: 'yes' })],
    ['a non-boolean bypass flag', served({ serviceWorkersBypassed: 0 })]
  ])('refuses %s', (_label, input) => {
    expect(parseServedDocument(input, 'reject')).toBeNull();
  });

  it('drops unknown keys under ignore, at both levels', () => {
    expect(
      parseServedDocument(
        served({ extra: 1, speculationRules: { ...rules({}), later: true } }),
        'ignore'
      )
    ).toEqual(served({ speculationRules: rules({}) }));
  });
});

describe('document outcomes carry an optional served identity', () => {
  const outcomes = [
    { outcome: 'failed', reason: 'decode-failed' },
    { outcome: 'over-budget', feature: 'lazyload', row: null, budgetMs: 5 }
  ];

  it('keeps it on every outcome kind, and absence stays absent', () => {
    const rewritten = clone(activeRecord()['document']);
    for (const outcome of [rewritten, ...outcomes]) {
      const record = { ...activeRecord(), document: { ...outcome, served: served() } };
      expect(documentOf(parseExclusionSessionRecord(record, 'reject'))).toEqual({
        ...outcome,
        served: served()
      });
      const bare = { ...activeRecord(), document: outcome };
      expect(documentOf(parseExclusionSessionRecord(bare, 'reject'))).not.toHaveProperty('served');
    }
  });

  it('refuses the whole record for a malformed identity', () => {
    for (const outcome of outcomes) {
      const record = { ...activeRecord(), document: { ...outcome, served: served({ copy: 1 }) } };
      expect(parseExclusionSessionRecord(record, 'reject')).toBeNull();
      expect(parseExclusionSessionRecord(record, 'ignore')).toBeNull();
    }
  });
});

describe('parseExclusionSessionRecord (store reads)', () => {
  it('ignores unknown fields at every level under ignore, rebuilding known ones only', () => {
    const record = clone(activeRecord());
    record['futureField'] = { anything: true };
    const document = record['document'] as Record<string, unknown>;
    document['url'] = 'https://example.com/a';
    const report = (document['reports'] as Record<string, unknown>[])[0] as Record<string, unknown>;
    report['durationMs'] = 3;
    const [match] = report['matchedRows'] as Record<string, unknown>[];
    if (match === undefined) expect.fail('fixture changed: no matched row');
    match['note'] = 'x';
    expect(parseExclusionSessionRecord(record, 'ignore')).toEqual(activeRecord());
    expect(parseExclusionSessionRecord(record, 'reject')).toBeNull();
    const unavailable = { state: 'unavailable', cause: 'detached', at: 3, note: 'x' };
    expect(parseExclusionSessionRecord(unavailable, 'ignore')).toEqual({
      state: 'unavailable',
      cause: 'detached',
      at: 3
    });
    const failed = {
      ...activeRecord(),
      document: { outcome: 'failed', reason: 'decode-failed', x: 1 }
    };
    expect(documentOf(parseExclusionSessionRecord(failed, 'ignore'))).toEqual({
      outcome: 'failed',
      reason: 'decode-failed'
    });
    const overBudget = {
      ...activeRecord(),
      document: { outcome: 'over-budget', feature: 'lazyload', row: null, budgetMs: 5, x: 1 }
    };
    expect(documentOf(parseExclusionSessionRecord(overBudget, 'ignore'))).toEqual({
      outcome: 'over-budget',
      feature: 'lazyload',
      row: null,
      budgetMs: 5
    });
  });

  it('never accepts inactive — absence is how a store says inactive', () => {
    expect(parseExclusionSessionRecord({ state: 'inactive' }, 'ignore')).toBeNull();
  });
});

describe('parseExclusionSetPayload', () => {
  it('accepts exactly { set }', () => {
    expect(parseExclusionSetPayload({ set: validSet() })).toEqual({ set: validSet() });
  });

  it('rejects extra keys (a tab id never rides a payload), a bad set, non-records', () => {
    for (const input of [
      { set: validSet(), tabId: 3 },
      { set: { ...validSet(), extra: 1 } },
      { set: null },
      {},
      null,
      [validSet()]
    ]) {
      expect(parseExclusionSetPayload(input)).toBeNull();
    }
  });
});

describe('parseExclusionApplyReply', () => {
  it('accepts each outcome with exact keys', () => {
    expect(parseExclusionApplyReply({ outcome: 'applying' })).toEqual({ outcome: 'applying' });
    const unavailable = { outcome: 'unavailable', cause: 'debugging-policy' };
    expect(parseExclusionApplyReply(unavailable)).toEqual(unavailable);
    const invalidSet = { ...validSet(), rows: { ...validSet().rows, deferJs: ['(', ' '] } };
    const invalid = { outcome: 'invalid', invalid: prevalidateExclusionSet(invalidSet).invalid };
    expect(parseExclusionApplyReply(invalid)).toEqual(invalid);
  });

  it('rejects malformed answers', () => {
    const row = { feature: 'delay_js', index: 0, row: '(', reason: 'Invalid regular expression' };
    const tooMany = EXCLUSION_SET_LIMITS.rowsPerFeature * EXCLUSION_FEATURES.length + 1;
    for (const input of [
      null,
      { outcome: 'armed' },
      { outcome: 'applying', extra: 1 },
      { outcome: 'unavailable', cause: 'nope' },
      { outcome: 'unavailable', cause: 'detached', extra: 1 },
      { outcome: 'invalid', invalid: [] },
      { outcome: 'invalid', invalid: 'x' },
      { outcome: 'invalid', invalid: [row], extra: 1 },
      { outcome: 'invalid', invalid: Array.from({ length: tooMany }, () => row) },
      { outcome: 'invalid', invalid: [null] },
      { outcome: 'invalid', invalid: [{ ...row, extra: 1 }] },
      { outcome: 'invalid', invalid: [{ ...row, feature: 'iframes' }] },
      { outcome: 'invalid', invalid: [{ ...row, index: -1 }] },
      { outcome: 'invalid', invalid: [{ ...row, index: EXCLUSION_SET_LIMITS.rowsPerFeature }] },
      { outcome: 'invalid', invalid: [{ ...row, row: 5 }] },
      { outcome: 'invalid', invalid: [{ ...row, reason: '' }] },
      { outcome: 'invalid', invalid: [{ ...row, reason: 5 }] },
      { outcome: 'invalid', invalid: [{ ...row, reason: 'x\u0000' }] },
      {
        outcome: 'invalid',
        invalid: [{ ...row, reason: 'x'.repeat(EXCLUSION_SET_LIMITS.reasonChars + 1) }]
      }
    ]) {
      expect(parseExclusionApplyReply(input), JSON.stringify(input)).toBeNull();
    }
  });
});

describe('invalid-row reasons fit the wire', () => {
  it('derives the reason cap from the row cap — a reason may echo its whole row', () => {
    expect(EXCLUSION_SET_LIMITS.reasonChars).toBeGreaterThan(EXCLUSION_SET_LIMITS.rowChars);
  });

  it('carries the engine reason for a max-length broken pattern', () => {
    const row = `(${'a'.repeat(EXCLUSION_SET_LIMITS.rowChars - 1)}`;
    const set = { ...EMPTY_EXCLUSION_SET, rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: [row] } };
    const { invalid } = prevalidateExclusionSet(set);
    expect(parseExclusionApplyReply({ outcome: 'invalid', invalid })).not.toBeNull();
    expect(parseExclusionApplyReply(invalidApplyReply(invalid))).toEqual({
      outcome: 'invalid',
      invalid
    });
  });

  it('truncates an over-cap reason without splitting a surrogate pair', () => {
    const cap = EXCLUSION_SET_LIMITS.reasonChars;
    const row = { feature: 'delay_js', index: 0, row: '(' } as const;
    // A pair straddling the cut: the high half lands on the last kept index.
    const straddling = `${'r'.repeat(cap - 3)}😀${'r'.repeat(10)}`;
    for (const reason of ['r'.repeat(cap * 3), straddling]) {
      const reply = invalidApplyReply([{ ...row, reason }]);
      const bounded = reply.invalid[0]?.reason ?? '';
      expect(bounded.length).toBeLessThanOrEqual(cap);
      expect(bounded.endsWith('…')).toBe(true);
      expect(parseExclusionApplyReply(reply)).toEqual(reply);
    }
    const short = invalidApplyReply([{ ...row, reason: 'short' }]);
    expect(short.invalid[0]?.reason).toBe('short');
  });
});

describe('saved-set rows', () => {
  it('parses the restore answer: a set, or null for none', () => {
    expect(parseSavedExclusionSetReply({ set: validSet() })).toEqual({ set: validSet() });
    expect(parseSavedExclusionSetReply({ set: null })).toEqual({ set: null });
    for (const input of [
      {},
      { set: undefined },
      { set: { ...validSet(), extra: 1 } },
      { set: null, extra: 1 },
      null,
      []
    ]) {
      expect(parseSavedExclusionSetReply(input), JSON.stringify(input)).toBeNull();
    }
  });

  it('parses the save answer with exact keys and known reasons', () => {
    expect(parseExclusionSaveReply({ outcome: 'saved' })).toEqual({ outcome: 'saved' });
    for (const reason of EXCLUSION_SAVE_FAILURES) {
      const reply = { outcome: 'not-saved', reason };
      expect(parseExclusionSaveReply(reply)).toEqual(reply);
    }
    for (const input of [
      { outcome: 'saved', extra: 1 },
      { outcome: 'not-saved' },
      { outcome: 'not-saved', reason: 'toString' },
      { outcome: 'not-saved', reason: 'storage-failed', extra: 1 },
      { outcome: 'stored' },
      null
    ]) {
      expect(parseExclusionSaveReply(input), JSON.stringify(input)).toBeNull();
    }
  });
});

describe('panel rows', () => {
  it('parses the tab query: exactly a numeric tab id', () => {
    expect(parseExclusionSessionTabQuery({ tabId: 7 })).toEqual({ tabId: 7 });
    for (const input of [
      { tabId: '7' },
      { tabId: -1 },
      { tabId: 2 ** 60 },
      { tabId: 7, x: 1 },
      {},
      null
    ]) {
      expect(parseExclusionSessionTabQuery(input)).toBeNull();
    }
  });

  it('parses the push: a tab id plus a valid status', () => {
    const push = { tabId: 3, status: activeRecord() };
    expect(parseExclusionSessionTabStatus(push)).toEqual(push);
    for (const input of [
      { tabId: 3.5, status: { state: 'inactive' } },
      { tabId: 3, status: { state: 'gone' } },
      { tabId: 3, status: { state: 'inactive' }, x: 1 },
      { status: { state: 'inactive' } },
      null
    ]) {
      expect(parseExclusionSessionTabStatus(input)).toBeNull();
    }
  });
});

describe('overlay presentation row', () => {
  it('parses the presentation push: exactly a boolean `open`', () => {
    expect(parseExclusionOverlayPresentation({ open: true })).toEqual({ open: true });
    expect(parseExclusionOverlayPresentation({ open: false })).toEqual({ open: false });
    for (const input of [
      { open: 'true' },
      { open: 1 },
      { open: true, x: 1 },
      {},
      Object.create({ open: true }),
      null,
      true
    ]) {
      expect(parseExclusionOverlayPresentation(input)).toBeNull();
    }
  });
});

describe('protocol rows over the fake runtime', () => {
  it('round-trips an apply: the receiver guards the payload and answers a guarded reply', async () => {
    const remove = onMessage('applyExclusionSession', ({ data }) => {
      const request = parseExclusionSetPayload(data);
      return request === null
        ? { outcome: 'unavailable', cause: 'unsupported-page' }
        : { outcome: 'applying' };
    });
    try {
      const reply = await sendMessage('applyExclusionSession', { set: validSet() });
      expect(parseExclusionApplyReply(reply)).toEqual({ outcome: 'applying' });
    } finally {
      remove();
    }
  });

  it('round-trips the saved-set rows: restore before any session, then save', async () => {
    const removeGet = onMessage('getSavedExclusionSet', () => ({ set: null }));
    const removeSave = onMessage('saveExclusionSet', ({ data }) =>
      parseExclusionSetPayload(data) === null
        ? { outcome: 'not-saved', reason: 'invalid-request' }
        : { outcome: 'saved' }
    );
    try {
      expect(parseSavedExclusionSetReply(await sendMessage('getSavedExclusionSet'))).toEqual({
        set: null
      });
      const reply = await sendMessage('saveExclusionSet', { set: validSet() });
      expect(parseExclusionSaveReply(reply)).toEqual({ outcome: 'saved' });
    } finally {
      removeGet();
      removeSave();
    }
  });
});
