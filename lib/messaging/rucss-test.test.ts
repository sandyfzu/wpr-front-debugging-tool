/** The RUCSS test contracts: every guard rebuilds valid data and refuses hostile shapes. */
import { describe, expect, it } from 'vitest';
import {
  parseRucssApplyReply,
  parseRucssApplyRequest,
  parseRucssFetchFailure,
  parseRucssFetchReply,
  parseRucssFetchRequest,
  parseRucssStartReply,
  parseRucssStartRequest,
  RUCSS_APPLY_FAILURES,
  RUCSS_TEST_LIMITS
} from './rucss-test';

const RUN = '0123456789abcdef0123456789abcdef';
const FETCH = { pageUrl: 'https://a.test/p', safelist: ['x'], mobile: false, home: true };
const START = { safelist: ['x'], inlinePreserves: ['m'], mobile: true, home: false };
const APPLY = { runId: RUN, css: 'a{}', keepLinks: [2, 0] };
const SUMMARY = { removed: 3, preserved: 1, excluded: 1, gone: 0, cssChars: 3 };
const STARTED = {
  ok: true,
  runId: RUN,
  requestUrl: 'https://svc.test/?url=x',
  shakenCss: 'a{}',
  links: ['https://a.test/a.css', '']
};

/** A record whose prototype carries `key` (an inherited field must read as absent). */
function inheriting(key: string, value: unknown, own: object): object {
  return Object.assign(Object.create({ [key]: value }) as object, own);
}

describe('RUCSS_TEST_LIMITS', () => {
  it('derives its text bounds from the configuration and answer caps', () => {
    expect(RUCSS_TEST_LIMITS.listChars).toBe(32_768 + 1_024);
    expect(RUCSS_TEST_LIMITS.shakenCssChars).toBe(2 * 1024 * 1024);
    expect(RUCSS_TEST_LIMITS.cssChars).toBe(8 * 1024 * 1024);
  });
});

describe('parseRucssFetchFailure', () => {
  it('accepts every failure kind with exactly its fields', () => {
    for (const kind of ['network-error', 'timeout', 'cancelled', 'oversize', 'not-utf8']) {
      expect(parseRucssFetchFailure({ kind })).toEqual({ kind });
    }
    expect(parseRucssFetchFailure({ kind: 'http-status', httpStatus: 502 })).toEqual({
      kind: 'http-status',
      httpStatus: 502
    });
    expect(parseRucssFetchFailure({ kind: 'malformed', httpStatus: 200 })).toEqual({
      kind: 'malformed',
      httpStatus: 200
    });
    expect(
      parseRucssFetchFailure({ kind: 'service-code', httpStatus: 200, serviceCode: 401 })
    ).toEqual({ kind: 'service-code', httpStatus: 200, serviceCode: 401 });
  });

  it('refuses unknown kinds, extra or missing fields and bad numbers', () => {
    for (const input of [
      null,
      'timeout',
      { kind: 'toString' },
      { kind: 'timeout', extra: 1 },
      { kind: 'http-status' },
      { kind: 'http-status', httpStatus: 1000 },
      { kind: 'http-status', httpStatus: 2.5 },
      { kind: 'malformed', httpStatus: 200, serviceCode: 1 },
      { kind: 'service-code', httpStatus: 200 },
      { kind: 'service-code', httpStatus: 200, serviceCode: Number.NaN },
      { kind: 'service-code', httpStatus: 200, serviceCode: '200' },
      { kind: 'service-code', httpStatus: 200, serviceCode: 1, extra: 1 },
      { kind: 'nope', httpStatus: 200 },
      inheriting('kind', 'timeout', {})
    ]) {
      expect(parseRucssFetchFailure(input), JSON.stringify(input)).toBeNull();
    }
  });
});

describe('parseRucssFetchRequest', () => {
  it('rebuilds a valid request', () => {
    const parsed = parseRucssFetchRequest(FETCH);
    expect(parsed).toEqual(FETCH);
    expect(parsed?.safelist).not.toBe(FETCH.safelist);
  });

  it('refuses extra keys, wrong types, empty entries and oversize text', () => {
    for (const input of [
      null,
      [],
      { ...FETCH, extra: 1 },
      { ...FETCH, pageUrl: 7 },
      { ...FETCH, pageUrl: 'x'.repeat(RUCSS_TEST_LIMITS.urlChars + 1) },
      { ...FETCH, safelist: 'x' },
      { ...FETCH, safelist: [''] },
      { ...FETCH, safelist: [1] },
      { ...FETCH, safelist: ['x'.repeat(RUCSS_TEST_LIMITS.listChars + 1)] },
      { ...FETCH, mobile: 'true' },
      { pageUrl: FETCH.pageUrl, safelist: [], mobile: false },
      inheriting('home', true, { pageUrl: FETCH.pageUrl, safelist: [], mobile: false })
    ]) {
      expect(parseRucssFetchRequest(input), JSON.stringify(input)).toBeNull();
    }
  });
});

describe('parseRucssFetchReply', () => {
  it('accepts a refusal, a missing consent and both answered outcomes', () => {
    expect(parseRucssFetchReply({ kind: 'refused' })).toEqual({ kind: 'refused' });
    expect(parseRucssFetchReply({ kind: 'consent-missing' })).toEqual({ kind: 'consent-missing' });
    const ok = { kind: 'answered', requestUrl: 'u', outcome: { ok: true, shakenCss: '' } };
    expect(parseRucssFetchReply(ok)).toEqual(ok);
    const failed = {
      kind: 'answered',
      requestUrl: 'u',
      outcome: { ok: false, failure: { kind: 'timeout' } }
    };
    expect(parseRucssFetchReply(failed)).toEqual(failed);
  });

  it('refuses hostile shapes', () => {
    const outcome = { ok: true, shakenCss: 'a' };
    for (const input of [
      null,
      { kind: 'refused', why: 'x' },
      { kind: 'consent-missing', why: 'x' },
      { kind: 'answered', requestUrl: 'u' },
      { kind: 'answered', requestUrl: 1, outcome },
      { kind: 'answered', requestUrl: 'u', outcome, extra: 1 },
      { kind: 'other', requestUrl: 'u', outcome },
      { kind: 'answered', requestUrl: 'u', outcome: { ok: true, shakenCss: 1 } },
      { kind: 'answered', requestUrl: 'u', outcome: { ok: true, shakenCss: 'a', x: 1 } },
      {
        kind: 'answered',
        requestUrl: 'u',
        outcome: { ok: true, shakenCss: 'a'.repeat(RUCSS_TEST_LIMITS.shakenCssChars + 1) }
      },
      { kind: 'answered', requestUrl: 'u', outcome: { ok: false, failure: { kind: 'x' } } },
      {
        kind: 'answered',
        requestUrl: 'u',
        outcome: { ok: false, failure: { kind: 'timeout' }, x: 1 }
      },
      { kind: 'answered', requestUrl: 'u', outcome: { ok: 'yes' } },
      { kind: 'answered', requestUrl: 'u', outcome: 'ok' }
    ]) {
      expect(parseRucssFetchReply(input), JSON.stringify(input)).toBeNull();
    }
  });
});

describe('parseRucssStartRequest', () => {
  it('rebuilds a valid request', () => {
    expect(parseRucssStartRequest(START)).toEqual(START);
  });

  it('refuses hostile shapes', () => {
    for (const input of [
      null,
      { ...START, extra: 1 },
      { ...START, inlinePreserves: [''] },
      { ...START, inlinePreserves: null },
      { ...START, safelist: [{}] },
      { ...START, home: 1 }
    ]) {
      expect(parseRucssStartRequest(input), JSON.stringify(input)).toBeNull();
    }
  });
});

describe('parseRucssStartReply', () => {
  it('accepts a started run and every failure', () => {
    expect(parseRucssStartReply(STARTED)).toEqual(STARTED);
    for (const kind of [
      'refused',
      'consent-missing',
      'background-unreachable',
      'superseded',
      'too-many-styles',
      'inline-check-too-slow'
    ]) {
      expect(parseRucssStartReply({ ok: false, failure: { kind } })).toEqual({
        ok: false,
        failure: { kind }
      });
    }
    const fetch = {
      ok: false,
      failure: { kind: 'fetch', requestUrl: 'u', failure: { kind: 'oversize' } }
    };
    expect(parseRucssStartReply(fetch)).toEqual(fetch);
  });

  it('refuses hostile shapes', () => {
    for (const input of [
      null,
      { ok: 'true' },
      { ...STARTED, extra: 1 },
      { ...STARTED, runId: 'not-hex' },
      { ...STARTED, requestUrl: 1 },
      { ...STARTED, shakenCss: null },
      { ...STARTED, links: 'a' },
      { ...STARTED, links: [1] },
      { ...STARTED, links: Array.from({ length: RUCSS_TEST_LIMITS.links + 1 }, () => '') },
      { ...STARTED, links: ['x'.repeat(RUCSS_TEST_LIMITS.linkChars + 1)] },
      { ok: false, failure: { kind: 'refused', x: 1 } },
      { ok: false, failure: { kind: 'refused' }, x: 1 },
      { ok: false, failure: { kind: 'fetch', requestUrl: 'u' } },
      { ok: false, failure: { kind: 'fetch', requestUrl: 2, failure: { kind: 'timeout' } } },
      {
        ok: false,
        failure: { kind: 'fetch', requestUrl: 'u', failure: { kind: 'timeout' }, x: 1 }
      },
      { ok: false, failure: { kind: 'fetched', requestUrl: 'u', failure: { kind: 'timeout' } } },
      { ok: false, failure: 'refused' }
    ]) {
      expect(parseRucssStartReply(input), JSON.stringify(input).slice(0, 80)).toBeNull();
    }
  });
});

describe('parseRucssApplyRequest', () => {
  it('rebuilds a valid request', () => {
    expect(parseRucssApplyRequest(APPLY)).toEqual(APPLY);
  });

  it('refuses hostile shapes', () => {
    for (const input of [
      null,
      { ...APPLY, extra: 1 },
      { ...APPLY, runId: 'x' },
      { ...APPLY, css: 1 },
      { ...APPLY, css: 'a'.repeat(RUCSS_TEST_LIMITS.cssChars + 1) },
      { ...APPLY, keepLinks: [1, 1] },
      { ...APPLY, keepLinks: [-1] },
      { ...APPLY, keepLinks: [0.5] },
      { ...APPLY, keepLinks: ['0'] },
      { ...APPLY, keepLinks: Array.from({ length: RUCSS_TEST_LIMITS.links + 1 }, (_, i) => i) },
      { ...APPLY, keepLinks: {} }
    ]) {
      expect(parseRucssApplyRequest(input), JSON.stringify(input).slice(0, 80)).toBeNull();
    }
  });
});

describe('parseRucssApplyReply', () => {
  it('accepts a summary and every failure', () => {
    expect(parseRucssApplyReply({ ok: true, summary: SUMMARY })).toEqual({
      ok: true,
      summary: SUMMARY
    });
    for (const failure of RUCSS_APPLY_FAILURES) {
      expect(parseRucssApplyReply({ ok: false, failure })).toEqual({ ok: false, failure });
    }
  });

  it('refuses hostile shapes', () => {
    for (const input of [
      null,
      { ok: true },
      { ok: true, summary: { ...SUMMARY, removed: -1 } },
      { ok: true, summary: { ...SUMMARY, gone: 1.5 } },
      { ok: true, summary: { ...SUMMARY, extra: 0 } },
      { ok: true, summary: { removed: 1 } },
      { ok: true, summary: SUMMARY, extra: 1 },
      { ok: false, failure: 'other' },
      { ok: false, failure: 'stale-run', extra: 1 },
      { ok: 'false', failure: 'stale-run' }
    ]) {
      expect(parseRucssApplyReply(input), JSON.stringify(input)).toBeNull();
    }
  });
});
