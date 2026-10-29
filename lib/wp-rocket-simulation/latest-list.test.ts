/**
 * The latest list's validation: the size cap before parsing, JSON object
 * shape, only `delay_js_exclusions` and the two Defer JS lists read, rows
 * within the engine bounds and reproduced by the transforms; the Defer JS
 * lists' miss never fails the document.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LATEST_LIST_ENDPOINT,
  LATEST_LIST_MAX_BYTES,
  parseLatestList,
  validateDeferLists,
  validateLatestListRows
} from './latest-list';
import { SIMULATION_DATA_PATH } from './simulation-data';
import { SIMULATION_LIST_LIMITS } from './spec';

/** The packaged data file (its lists = the endpoint's on 2026-10-28/29: same sha256s). */
const DATA = JSON.parse(
  readFileSync(join(process.cwd(), 'public', SIMULATION_DATA_PATH), 'utf8')
) as {
  rowLists: Record<string, string[]>;
  versions: Record<string, Record<string, { sha256: string }>>;
};
/** A bundled list of the reference version, by its data-file entry key. */
const bundled = (key: string): string[] => {
  const sha256 = DATA.versions['3.24']?.[key]?.sha256 ?? '';
  return DATA.rowLists[sha256] ?? [];
};
/** The bundled reference lists. */
const BUNDLED_ROWS = bundled('delayJsExclusions');
const DEFER = {
  external: bundled('deferJsExternalExclusions'),
  inline: bundled('deferJsInlineExclusions')
};

/** A document shaped like the endpoint's: the lists among other keys, one of them an integer. */
const documentWith = (rows: unknown, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    defer_js_external_exclusions: DEFER.external,
    defer_js_inline_exclusions: DEFER.inline,
    rocket_insights_add_homepage_expiry_interval: 266,
    delay_js_exclusions: rows,
    ...extra
  });

describe('LATEST_LIST_ENDPOINT', () => {
  it('is WP Media’s list endpoint, asked with no query', () => {
    expect(LATEST_LIST_ENDPOINT).toBe('https://b.rucss.wp-rocket.me/api/v2/exclusions/list');
  });
});

describe('parseLatestList', () => {
  it('reads the endpoint-shaped document: the rows only, other keys ignored', () => {
    expect(BUNDLED_ROWS).toHaveLength(75);
    expect([DEFER.external.length, DEFER.inline.length]).toEqual([37, 10]);
    expect(parseLatestList(documentWith(BUNDLED_ROWS))).toEqual({
      ok: true,
      rows: BUNDLED_ROWS,
      defer: { ok: true, lists: DEFER }
    });
  });

  it('ignores extra keys of any type, never reading them', () => {
    const text = documentWith(['jquery'], {
      unknown: { nested: [1, null] },
      another: null,
      toString: 'x'
    });
    expect(parseLatestList(text)).toEqual({
      ok: true,
      rows: ['jquery'],
      defer: { ok: true, lists: DEFER }
    });
  });

  it('refuses a text over the cap before parsing it (oversize)', () => {
    const atCap = documentWith(['jquery']).padEnd(LATEST_LIST_MAX_BYTES, ' ');
    expect(parseLatestList(atCap)).toMatchObject({ ok: true });
    expect(parseLatestList(`${atCap} `)).toMatchObject({ ok: false, miss: 'oversize' });
    // Not JSON at all, yet oversize: the cap comes first.
    expect(parseLatestList('x'.repeat(LATEST_LIST_MAX_BYTES + 1))).toMatchObject({
      miss: 'oversize'
    });
  });

  it.each([
    ['not JSON', '<html>404</html>'],
    ['empty', ''],
    ['a JSON array', JSON.stringify([['jquery']])],
    ['JSON null', 'null'],
    ['a JSON string', '"delay_js_exclusions"'],
    ['the key missing', JSON.stringify({ defer_js_external_exclusions: ['a'] })],
    ['the key a string', documentWith('jquery')],
    ['the key an object', documentWith({ 0: 'jquery' })],
    ['the key null', documentWith(null)]
  ])('refuses %s (malformed)', (_name, text) => {
    expect(parseLatestList(text)).toMatchObject({ ok: false, miss: 'malformed' });
  });

  it('never reads the key from the prototype', () => {
    expect(parseLatestList('{"__proto__":{"delay_js_exclusions":["x"]}}')).toMatchObject({
      ok: false,
      miss: 'malformed'
    });
  });

  it.each([
    ['empty', []],
    ['a non-string row', ['jquery', 3]],
    ['a null row', [null]],
    ['an empty row', ['jquery', '']],
    ['an over-long row', ['x'.repeat(SIMULATION_LIST_LIMITS.rowChars + 1)]],
    ['too many rows', Array.from({ length: SIMULATION_LIST_LIMITS.rows + 1 }, () => 'x')],
    ['a row the transform cannot reproduce', ['jquery', '(?R)']]
  ])('refuses a list %s (invalid)', (_name, rows) => {
    expect(parseLatestList(documentWith(rows))).toMatchObject({ ok: false, miss: 'invalid' });
  });

  it('names the unreproducible row', () => {
    const read = parseLatestList(documentWith(['jquery', '(?R)']));
    expect(read.ok ? '' : read.detail).toMatch(/row 1 cannot be reproduced/);
  });

  it('keeps rows at the bounds, and a row PCRE rejects (it never matches, as on WP Rocket)', () => {
    const longest = 'x'.repeat(SIMULATION_LIST_LIMITS.rowChars);
    expect(parseLatestList(documentWith([longest, '(unclosed']))).toEqual({
      ok: true,
      rows: [longest, '(unclosed'],
      defer: { ok: true, lists: DEFER }
    });
    const most = Array.from({ length: SIMULATION_LIST_LIMITS.rows }, (_, i) => `row${String(i)}`);
    expect(parseLatestList(documentWith(most))).toMatchObject({ ok: true });
  });
});

describe('validateLatestListRows', () => {
  it('returns a fresh array', () => {
    const rows = ['jquery'];
    const read = validateLatestListRows(rows);
    expect(read).toEqual({ ok: true, rows });
    expect(read.ok && read.rows).not.toBe(rows);
  });
});

describe('parseLatestList — the Defer JS lists', () => {
  it.each([
    ['the external key missing', { defer_js_external_exclusions: undefined }, 'malformed'],
    ['the inline key missing', { defer_js_inline_exclusions: undefined }, 'malformed'],
    ['the external list a string', { defer_js_external_exclusions: 'jquery' }, 'malformed'],
    ['the inline list null', { defer_js_inline_exclusions: null }, 'malformed'],
    ['an empty external list', { defer_js_external_exclusions: [] }, 'invalid'],
    ['an empty inline list', { defer_js_inline_exclusions: [] }, 'invalid'],
    ['a non-string inline row', { defer_js_inline_exclusions: ['a', 1] }, 'invalid'],
    [
      'an over-long external row',
      { defer_js_external_exclusions: ['x'.repeat(SIMULATION_LIST_LIMITS.rowChars + 1)] },
      'invalid'
    ],
    [
      'an external row the transform cannot reproduce',
      { defer_js_external_exclusions: ['(?R)'] },
      'invalid'
    ]
  ] as const)('keeps the Delay JS rows when %s (Defer JS miss: %s)', (_name, extra, miss) => {
    const read = parseLatestList(documentWith(['jquery'], extra));
    expect(read).toMatchObject({ ok: true, rows: ['jquery'], defer: { ok: false, miss } });
  });

  it('never reads the Defer JS lists from the prototype', () => {
    const text = `{"delay_js_exclusions":["jquery"],"__proto__":${JSON.stringify({
      defer_js_external_exclusions: ['a'],
      defer_js_inline_exclusions: ['b']
    })}}`;
    expect(parseLatestList(text)).toMatchObject({ defer: { ok: false, miss: 'malformed' } });
  });

  it('keeps an external list whose joined pattern PCRE rejects (WP Rocket then defers nothing)', () => {
    expect(validateDeferLists(['(unclosed'], ['a'])).toEqual({
      ok: true,
      lists: { external: ['(unclosed'], inline: ['a'] }
    });
  });

  it('keeps inline rows as literal texts, slashes and quotes included', () => {
    expect(validateDeferLists(['a.js'], ['a/b', '"q"', '#'])).toMatchObject({ ok: true });
  });

  it('names the failing list in the detail', () => {
    const read = validateDeferLists(['(?R)'], ['a']);
    expect(read.ok ? '' : read.detail).toMatch(/^defer_js_external_exclusions: /);
    const inline = validateDeferLists(['a'], []);
    expect(inline.ok ? '' : inline.detail).toBe('defer_js_inline_exclusions is empty');
  });
});
