/**
 * The latest list's validation: the size cap before parsing, JSON object
 * shape, only `delay_js_exclusions` read, rows within the engine bounds
 * and reproduced by the transform.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LATEST_LIST_ENDPOINT,
  LATEST_LIST_MAX_BYTES,
  parseLatestList,
  validateLatestListRows
} from './latest-list';
import { SIMULATION_DATA_PATH } from './simulation-data';
import { SIMULATION_LIST_LIMITS } from './spec';

/** The bundled reference list (= the endpoint's list on 2026-10-28/29: same sha256). */
const BUNDLED_ROWS = Object.values(
  (
    JSON.parse(readFileSync(join(process.cwd(), 'public', SIMULATION_DATA_PATH), 'utf8')) as {
      rowLists: Record<string, string[]>;
    }
  ).rowLists
)[0] as string[];

/** A document shaped like the endpoint's: the list among other keys, one of them an integer. */
const documentWith = (rows: unknown, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    defer_js_external_exclusions: ['a'],
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
    expect(parseLatestList(documentWith(BUNDLED_ROWS))).toEqual({ ok: true, rows: BUNDLED_ROWS });
  });

  it('ignores extra keys of any type, never reading them', () => {
    const text = documentWith(['jquery'], {
      unknown: { nested: [1, null] },
      another: null,
      toString: 'x'
    });
    expect(parseLatestList(text)).toEqual({ ok: true, rows: ['jquery'] });
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
      rows: [longest, '(unclosed']
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
