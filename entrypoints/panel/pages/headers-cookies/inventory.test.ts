/**
 * The Headers & Cookies row model: grouping order through the shared headers
 * model, the section/omission rules per payload shape, stable row ids, the
 * `Set-Cookie` redaction (the page's cookie-value guarantee), the copy
 * payloads, the row-height seeds and the honest timestamp sources.
 */
import { describe, expect, it } from 'vitest';
import { MAX_REPRESENTABLE_MS } from '../../../../lib/detection/describe';
import { buildHeadersViewModel } from '../../../../lib/panel/headers-view-model';
import type { PageCookies, PageHeaders } from '../../../../lib/wp-rocket/types';
import { makeFdtData } from '../../state/fixtures';
import {
  absoluteStamp,
  allHeadersCopyText,
  buildInventory,
  displayedHeader,
  estimateRowHeight,
  headerCopyText,
  heldFetchStamp,
  isoStamp,
  NO_CACHING_HEADERS_NOTE,
  NO_COOKIES_NOTE,
  REDACTED_VALUE,
  redactSetCookie,
  shownStamp,
  type InventoryRow
} from './inventory';

/** A capture mixing caching evidence and unrelated rows, in capture order. */
const CAPTURE: PageHeaders = [
  { name: 'Date', value: 'Wed, 14 Oct 2026 20:47:07 GMT' },
  { name: 'x-rocket-cache', value: 'hit' },
  { name: 'Server', value: 'Apache' },
  { name: 'age', value: '120' },
  { name: 'Cache-Control', value: 'max-age=3600' },
  { name: 'Set-Cookie', value: 'session=s3cr3t-token; Path=/; HttpOnly' },
  { name: 'x-empty' }
];

/** Build the inventory for a capture + cookie capture. */
function inventoryOf(headers: PageHeaders | null, cookies?: PageCookies) {
  return buildInventory(buildHeadersViewModel(headers), cookies);
}

/** The rows' compact signature: kind + id (the render contract in one line). */
function shape(rows: readonly InventoryRow[]): string[] {
  return rows.map((row) => `${row.kind}:${row.id}`);
}

describe('buildInventory', () => {
  it('lists caching evidence first (model order), then the rest, then cookies', () => {
    const inventory = inventoryOf(CAPTURE, { names: ['wpr_a', 'b'], capturedAt: 1 });
    expect(inventory.hasHeaders).toBe(true);
    expect(inventory.hasCookies).toBe(true);
    expect(shape(inventory.rows)).toEqual([
      'section:section:caching',
      'header:caching:0',
      'header:caching:1',
      'header:caching:2',
      'section:section:other',
      'header:other:0',
      'header:other:1',
      'header:other:2',
      'header:other:3',
      'section:section:cookies',
      'cookie:cookie:wpr_a',
      'cookie:cookie:b'
    ]);
    const names = inventory.rows.flatMap((row) => (row.kind === 'header' ? [row.header.name] : []));
    // The shared model's evidence order: cache-control, age, x-rocket-*.
    expect(names).toEqual([
      'Cache-Control',
      'age',
      'x-rocket-cache',
      'Date',
      'Server',
      'Set-Cookie',
      'x-empty'
    ]);
  });

  it('counts each section and carries the shared hint copy', () => {
    const inventory = inventoryOf(CAPTURE);
    const sections = inventory.rows.filter((row) => row.kind === 'section');
    expect(sections.map((row) => [row.section, row.count])).toEqual([
      ['caching', 3],
      ['other', 4]
    ]);
    const age = inventory.rows.find((row) => row.kind === 'header' && row.header.name === 'age');
    expect(age?.kind === 'header' && age.header.hint).toBe(
      "Served from an intermediate cache 120 seconds ago (the cache's own counter)."
    );
  });

  it('omits the cookie section entirely for a payload without the capture', () => {
    const inventory = inventoryOf(CAPTURE, undefined);
    expect(inventory.hasCookies).toBe(false);
    expect(inventory.rows.some((row) => row.kind === 'cookie')).toBe(false);
    expect(inventory.rows.some((row) => row.kind === 'section' && row.section === 'cookies')).toBe(
      false
    );
  });

  it('keeps the cookie section with its note when the capture read no names', () => {
    const inventory = inventoryOf(CAPTURE, { names: [], capturedAt: 5 });
    expect(inventory.rows.slice(-2)).toEqual([
      { kind: 'section', id: 'section:cookies', section: 'cookies', count: 0 },
      { kind: 'note', id: 'note:cookies', text: NO_COOKIES_NOTE }
    ]);
  });

  it.each([
    ['null', null],
    ['empty', []]
  ] as const)('resolves %s headers to no header rows (the page empty state)', (_label, headers) => {
    const withCookies = inventoryOf(headers, { names: ['a'], capturedAt: 1 });
    expect(withCookies.hasHeaders).toBe(false);
    expect(shape(withCookies.rows)).toEqual(['section:section:cookies', 'cookie:cookie:a']);
    const bare = inventoryOf(headers);
    expect(bare).toEqual({ hasHeaders: false, hasCookies: false, rows: [] });
  });

  it('says so when a non-empty capture carries no caching evidence', () => {
    const inventory = inventoryOf([{ name: 'Server', value: 'nginx' }]);
    expect(shape(inventory.rows)).toEqual([
      'section:section:caching',
      'note:note:caching',
      'section:section:other',
      'header:other:0'
    ]);
    expect(inventory.rows[1]).toEqual({
      kind: 'note',
      id: 'note:caching',
      text: NO_CACHING_HEADERS_NOTE
    });
  });

  it('drops the other section when every header is caching evidence', () => {
    const inventory = inventoryOf([{ name: 'age', value: '3' }]);
    expect(shape(inventory.rows)).toEqual(['section:section:caching', 'header:caching:0']);
  });

  it('keys repeated header names by position, so every row id is unique and stable', () => {
    const repeated: PageHeaders = [
      { name: 'link', value: '</a.css>; rel=preload' },
      { name: 'link', value: '</b.css>; rel=preload' }
    ];
    const first = inventoryOf(repeated).rows.map((row) => row.id);
    const second = inventoryOf(repeated).rows.map((row) => row.id);
    expect(new Set(first).size).toBe(first.length);
    expect(second).toEqual(first);
  });

  it('redacts cookie values in the rows it hands the page', () => {
    const rows = inventoryOf(CAPTURE).rows;
    const setCookie = rows.find((row) => row.kind === 'header' && row.header.name === 'Set-Cookie');
    expect(setCookie?.kind === 'header' && setCookie.header.value).toBe(
      `session=${REDACTED_VALUE}; Path=/; HttpOnly`
    );
    expect(JSON.stringify(rows)).not.toContain('s3cr3t-token');
  });
});

describe('redactSetCookie', () => {
  it('keeps the name and attributes, never the value', () => {
    expect(redactSetCookie('wp=abc; path=/; secure; HttpOnly')).toBe(
      `wp=${REDACTED_VALUE}; path=/; secure; HttpOnly`
    );
  });

  it('redacts a bare pair and a value that itself carries "="', () => {
    expect(redactSetCookie('a=b')).toBe(`a=${REDACTED_VALUE}`);
    expect(redactSetCookie('token=x=y==; Path=/')).toBe(`token=${REDACTED_VALUE}; Path=/`);
  });

  it('redacts every cookie of a newline-folded value', () => {
    expect(redactSetCookie('a=1; Path=/\nb=2')).toBe(
      `a=${REDACTED_VALUE}; Path=/\nb=${REDACTED_VALUE}`
    );
  });

  it('drops the whole pair when it has no name to keep', () => {
    expect(redactSetCookie('justavalue; Path=/')).toBe(`${REDACTED_VALUE}; Path=/`);
    expect(redactSetCookie('=orphan')).toBe(REDACTED_VALUE);
    expect(redactSetCookie('')).toBe(REDACTED_VALUE);
  });

  it('trims the kept name', () => {
    expect(redactSetCookie('  sid =v')).toBe(`sid=${REDACTED_VALUE}`);
  });
});

describe('displayedHeader', () => {
  it.each(['set-cookie', 'Set-Cookie', 'SET-COOKIE2'])('redacts %s', (name) => {
    const shown = displayedHeader({ name, value: 'k=v', hint: null });
    expect(shown.value).toBe(`k=${REDACTED_VALUE}`);
    expect(shown.name).toBe(name);
  });

  it('passes every other header (and valueless rows) through untouched', () => {
    const row = { name: 'cache-control', value: 'max-age=0', hint: 'hint' };
    expect(displayedHeader(row)).toBe(row);
    const valueless = { name: 'set-cookie', value: null, hint: null };
    expect(displayedHeader(valueless)).toBe(valueless);
  });
});

describe('copy payloads', () => {
  it('copies one header as its wire form', () => {
    expect(headerCopyText({ name: 'age', value: '12', hint: 'x' })).toBe('age: 12');
    expect(headerCopyText({ name: 'x-empty', value: null, hint: null })).toBe('x-empty:');
  });

  it('copies every header in list order, one per line, cookies and notes excluded', () => {
    const rows = inventoryOf(CAPTURE, { names: ['visible_name'], capturedAt: 1 }).rows;
    expect(allHeadersCopyText(rows)).toBe(
      [
        'Cache-Control: max-age=3600',
        'age: 120',
        'x-rocket-cache: hit',
        'Date: Wed, 14 Oct 2026 20:47:07 GMT',
        'Server: Apache',
        `Set-Cookie: session=${REDACTED_VALUE}; Path=/; HttpOnly`,
        'x-empty:'
      ].join('\n')
    );
    expect(allHeadersCopyText([])).toBe('');
  });
});

describe('estimateRowHeight', () => {
  it('seeds every row kind with a positive height close to its render', () => {
    const rows: InventoryRow[] = [
      { kind: 'section', id: 's1', section: 'caching', count: 1 },
      { kind: 'section', id: 's2', section: 'cookies', count: 1 },
      { kind: 'header', id: 'h1', section: 'other', header: { name: 'a', value: 'b', hint: null } },
      {
        kind: 'header',
        id: 'h2',
        section: 'caching',
        header: { name: 'age', value: '1', hint: 'hint' }
      },
      { kind: 'cookie', id: 'c', name: 'n' },
      { kind: 'note', id: 'n', text: 't' }
    ];
    expect(rows.map(estimateRowHeight)).toEqual([40, 64, 44, 62, 32, 32]);
  });
});

describe('heldFetchStamp', () => {
  const data = makeFdtData();

  it('takes the ready stamp and holds it across a refresh', () => {
    expect(heldFetchStamp({ status: 'ready', data, fetchedAt: 100 }, null)).toBe(100);
    expect(heldFetchStamp({ status: 'refreshing', data, requestedAt: 200 }, 100)).toBe(100);
    // A refresh with nothing held stays honest: no stamp, never the request time.
    expect(heldFetchStamp({ status: 'refreshing', data, requestedAt: 200 }, null)).toBeNull();
    expect(heldFetchStamp({ status: 'ready', data, fetchedAt: 300 }, 100)).toBe(300);
  });

  it.each([
    { status: 'idle' },
    { status: 'fetching' },
    { status: 'error', cause: 'x', hardReload: false }
  ] as const)('drops the stamp in the $status state', (state) => {
    expect(heldFetchStamp(state, 100)).toBeNull();
  });
});

describe('absoluteStamp / isoStamp', () => {
  it('formats a stamp in the panel UTC form, rounded to the second', () => {
    expect(absoluteStamp(Date.UTC(2026, 9, 14, 20, 47, 7, 400))).toBe('2026-10-14 20:47:07 UTC');
    expect(absoluteStamp(Date.UTC(2026, 9, 14, 20, 47, 7, 600))).toBe('2026-10-14 20:47:08 UTC');
    expect(isoStamp(Date.UTC(2026, 9, 14, 20, 47, 7, 400))).toBe('2026-10-14T20:47:07.400Z');
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    MAX_REPRESENTABLE_MS + 1,
    -MAX_REPRESENTABLE_MS - 1
  ])('answers no absolute form for %s (never a throw)', (ms) => {
    expect(absoluteStamp(ms)).toBeNull();
    expect(isoStamp(ms)).toBeUndefined();
  });

  it('accepts the representable edge exactly', () => {
    // The shared formatter owns the exact text; the edge only has to resolve.
    expect(absoluteStamp(MAX_REPRESENTABLE_MS)).toMatch(/^\+275760-09-13 .* UTC$/);
    expect(isoStamp(MAX_REPRESENTABLE_MS)).toBe('+275760-09-13T00:00:00.000Z');
  });
});

describe('shownStamp', () => {
  it('passes a representable stamp through and drops absent or garbage ones', () => {
    expect(shownStamp(0)).toBe(0);
    expect(shownStamp(NaN_STAMP)).toBeNull();
    expect(shownStamp(MAX_REPRESENTABLE_MS)).toBe(MAX_REPRESENTABLE_MS);
    expect(shownStamp(MAX_REPRESENTABLE_MS + 1)).toBeNull();
    expect(shownStamp(null)).toBeNull();
    expect(shownStamp(undefined)).toBeNull();
  });
});

/** A non-finite stamp (named so the intent reads at the call site). */
const NaN_STAMP = Number.NaN;
