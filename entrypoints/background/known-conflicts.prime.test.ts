/**
 * The boot prime over real (fake-browser) storage, for every stored state an
 * in-place update can hand it: rows without the `updatedAt` stamp (a meta
 * object holding only unrelated fields included), stamped rows, a value that
 * is not the row shape, and nothing at all. The endpoint and the packaged
 * snapshot answer through one stubbed `fetch`, installed before the module
 * binds its transport at import.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnownConflict } from '../../lib/storage/known-conflicts';

/** The stubbed transport: the module binds `globalThis.fetch` when imported. */
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>();
  globalThis.fetch = mock;
  return mock;
});

const { DB_ENDPOINT, primeKnownConflictsDb } = await import('./known-conflicts');

/** One well-formed row, the shape the endpoint serves. */
function row(id: string): KnownConflict {
  return {
    id,
    type: 'Plugin',
    name: `Conflict ${id}`,
    detection_pattern: `/${id}/`,
    summary: 'Prevent Caching',
    issue_description: '',
    url: `https://example.com/${id}`
  };
}

/** What the packaged snapshot holds in these tests. */
const SEED_ROWS = [row('seed-1'), row('seed-2')];

/** What a successful endpoint refresh answers. */
const FRESH_ROWS = [row('fresh-1')];

/** Rows a previous version left in storage. */
const KEPT_ROWS = [row('kept-1'), row('kept-2'), row('kept-3')];

/** The meta field name the module never reads (only `updatedAt` counts). */
const FOREIGN_META = { lastUpdate: 1_700_000_000_000 };

/**
 * The address a `fetch` call asked for.
 *
 * @param input The call's first argument.
 */
function urlOf(input: string | URL | Request): string {
  if (input instanceof Request) return input.url;
  return input instanceof URL ? input.href : input;
}

/**
 * Route the stub: the endpoint answers per `endpoint`, anything else (the
 * packaged snapshot's URL) answers the seed rows.
 *
 * @param endpoint The endpoint's answer: rows, or `'down'` for a network error.
 */
function serve(endpoint: KnownConflict[] | 'down'): void {
  fetchMock.mockImplementation((input) => {
    const url = urlOf(input);
    if (url !== DB_ENDPOINT) return Promise.resolve(Response.json(SEED_ROWS));
    if (endpoint === 'down') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(Response.json(endpoint));
  });
}

/** How many endpoint requests the prime made. */
function endpointCalls(): number {
  return fetchMock.mock.calls.filter(([input]) => urlOf(input) === DB_ENDPOINT).length;
}

/**
 * Store the database value and its meta object as raw storage entries.
 *
 * @param value The `known-conflicts-db` value.
 * @param meta The `known-conflicts-db$` meta object, when any.
 */
async function store(value: unknown, meta?: Record<string, unknown>): Promise<void> {
  await fakeBrowser.storage.local.set({
    'known-conflicts-db': value,
    ...(meta === undefined ? {} : { 'known-conflicts-db$': meta })
  });
}

/** The raw stored value and meta object after the prime. */
async function stored(): Promise<{ value: unknown; meta: unknown }> {
  const all = await fakeBrowser.storage.local.get(['known-conflicts-db', 'known-conflicts-db$']);
  return { value: all['known-conflicts-db'], meta: all['known-conflicts-db$'] };
}

beforeEach(() => {
  fakeBrowser.reset();
  fetchMock.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('primeKnownConflictsDb', () => {
  it('refreshes rows whose meta has no `updatedAt`, keeping unrelated meta fields', async () => {
    await store(KEPT_ROWS, FOREIGN_META);
    serve(FRESH_ROWS);
    vi.spyOn(Date, 'now').mockReturnValue(42);
    await primeKnownConflictsDb();
    expect(endpointCalls()).toBe(1);
    expect(await stored()).toEqual({ value: FRESH_ROWS, meta: { ...FOREIGN_META, updatedAt: 42 } });
  });

  it('keeps unstamped valid rows untouched when the refresh fails', async () => {
    await store(KEPT_ROWS, FOREIGN_META);
    serve('down');
    await primeKnownConflictsDb();
    expect(endpointCalls()).toBe(1);
    expect(await stored()).toEqual({ value: KEPT_ROWS, meta: FOREIGN_META });
  });

  it('makes no request when stamped rows are stored', async () => {
    await store(KEPT_ROWS, { updatedAt: 7 });
    serve(FRESH_ROWS);
    await primeKnownConflictsDb();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await stored()).value).toEqual(KEPT_ROWS);
  });

  it('refreshes a stamped value that is not the row shape', async () => {
    await store({ error: 'not rows' }, { updatedAt: 7 });
    serve(FRESH_ROWS);
    await primeKnownConflictsDb();
    expect(endpointCalls()).toBe(1);
    expect((await stored()).value).toEqual(FRESH_ROWS);
  });

  it.each([
    ['an object', { error: 'not rows' }],
    ['a row missing a field', [{ id: 'x', name: 'No type' }]],
    ['a string', 'rows'],
    ['nothing', undefined]
  ])('replaces %s with the packaged snapshot when the refresh fails', async (_label, value) => {
    if (value !== undefined) await store(value, FOREIGN_META);
    serve('down');
    await primeKnownConflictsDb();
    expect((await stored()).value).toEqual(SEED_ROWS);
  });
});
