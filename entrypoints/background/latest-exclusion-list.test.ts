/**
 * The latest list service: one fetch's request and every miss, the due
 * policy, the record after a refresh (last valid copy kept on a miss), the
 * service's memory, single flight and failure paths, the update drop, and
 * the alarm + update wiring.
 */
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LATEST_LIST_ENDPOINT,
  LATEST_LIST_MAX_BYTES
} from '../../lib/wp-rocket-simulation/latest-list';
import { rowListKeyText } from '../../lib/wp-rocket-simulation/simulation-data';
import type { LatestListRecord } from '../../lib/storage/latest-exclusion-list';
import { sha256Hex } from '../../utils/sha256';
import {
  createLatestListService,
  fetchLatestList,
  LATEST_LIST_ALARM,
  LATEST_LIST_FETCH_TIMEOUT_MS,
  LATEST_LIST_REFRESH_MS,
  LATEST_LIST_RETRY_MS,
  latestListRefreshDue,
  nextLatestListRecord,
  registerLatestExclusionList,
  type LatestListFetch,
  type LatestListService,
  type LatestListServiceDeps
} from './latest-exclusion-list';

beforeEach(() => {
  fakeBrowser.reset();
});

const ROWS = ['jquery', 'gtag'];
const ROWS_SHA = sha256Hex(rowListKeyText(ROWS));
const BODY = JSON.stringify({
  delay_js_exclusions: ROWS,
  rocket_insights_add_homepage_expiry_interval: 266
});
const NOW = 1_790_000_000_000;
const sha256 = (text: string): Promise<string> => Promise.resolve(sha256Hex(text));

/** A fetch double answering `response` (a fresh one per call). */
function answering(response: () => Response): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(() => Promise.resolve(response()));
}

const ok = (body = BODY): Response =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } });

describe('fetchLatestList', () => {
  it('asks the endpoint with GET, no credentials, no HTTP cache, a timeout signal, no query', async () => {
    const fetch = answering(() => ok());
    await expect(fetchLatestList({ fetch, sha256 })).resolves.toEqual({
      ok: true,
      rows: ROWS,
      sha256: ROWS_SHA
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(LATEST_LIST_ENDPOINT);
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(init ?? {}).sort()).toEqual(['cache', 'credentials', 'method', 'signal']);
    expect(LATEST_LIST_FETCH_TIMEOUT_MS).toBe(10_000);
  });

  it.each([206, 204, 301, 404, 429, 500, 503])('reads status %i as http-error', async (status) => {
    const fetch = answering(() => new Response(status === 204 ? null : BODY, { status }));
    await expect(fetchLatestList({ fetch, sha256 })).resolves.toMatchObject({
      ok: false,
      miss: 'http-error',
      detail: `answered ${String(status)}`
    });
  });

  it.each([
    [new TypeError('Failed to fetch'), 'network-error'],
    [new DOMException('signal timed out', 'TimeoutError'), 'timeout'],
    [new DOMException('aborted', 'AbortError'), 'timeout']
  ])('reads a rejected request (%s) as %s', async (cause, miss) => {
    const rejecting = vi.fn<typeof fetch>(() => Promise.reject(cause));
    await expect(fetchLatestList({ fetch: rejecting, sha256 })).resolves.toMatchObject({
      ok: false,
      miss
    });
  });

  it('reads a body failing mid-read as its transport miss', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new DOMException('signal timed out', 'TimeoutError'));
      }
    });
    const fetch = answering(() => new Response(body, { status: 200 }));
    await expect(fetchLatestList({ fetch, sha256 })).resolves.toMatchObject({
      ok: false,
      miss: 'timeout'
    });
  });

  it('refuses a body over the cap (oversize)', async () => {
    const fetch = answering(() => ok(' '.repeat(LATEST_LIST_MAX_BYTES + 1)));
    await expect(fetchLatestList({ fetch, sha256 })).resolves.toMatchObject({
      ok: false,
      miss: 'oversize'
    });
  });

  it('refuses a non-UTF-8 body and a non-JSON one (malformed)', async () => {
    const binary = answering(() => new Response(new Uint8Array([0xff, 0xfe]), { status: 200 }));
    await expect(fetchLatestList({ fetch: binary, sha256 })).resolves.toMatchObject({
      miss: 'malformed'
    });
    const html = answering(() => ok('<!DOCTYPE html><title>Not Found</title>'));
    await expect(fetchLatestList({ fetch: html, sha256 })).resolves.toMatchObject({
      miss: 'malformed'
    });
  });

  it('refuses rows outside the bounds (invalid)', async () => {
    const fetch = answering(() => ok(JSON.stringify({ delay_js_exclusions: ['(?R)'] })));
    await expect(fetchLatestList({ fetch, sha256 })).resolves.toMatchObject({
      ok: false,
      miss: 'invalid'
    });
  });
});

describe('latestListRefreshDue', () => {
  const copy = { fetchedAt: NOW, sha256: ROWS_SHA, rows: ROWS };

  it('is due when never attempted', () => {
    expect(latestListRefreshDue({}, NOW)).toBe(true);
  });

  it('waits a day after a success', () => {
    const record = { copy, attemptedAt: NOW };
    expect(latestListRefreshDue(record, NOW + LATEST_LIST_REFRESH_MS - 1)).toBe(false);
    expect(latestListRefreshDue(record, NOW + LATEST_LIST_REFRESH_MS)).toBe(true);
  });

  it('retries an hour after a miss, with or without a kept copy', () => {
    for (const record of [
      { attemptedAt: NOW, lastMiss: 'timeout' },
      { copy, attemptedAt: NOW, lastMiss: 'http-error' }
    ] satisfies LatestListRecord[]) {
      expect(latestListRefreshDue(record, NOW + LATEST_LIST_RETRY_MS - 1)).toBe(false);
      expect(latestListRefreshDue(record, NOW + LATEST_LIST_RETRY_MS)).toBe(true);
    }
  });

  it('falls back to the copy’s fetch time when no attempt time is kept', () => {
    expect(latestListRefreshDue({ copy }, NOW + 1)).toBe(false);
    expect(latestListRefreshDue({ copy }, NOW + LATEST_LIST_REFRESH_MS)).toBe(true);
  });

  it('is due when the clock went back (one fetch re-anchors it)', () => {
    expect(latestListRefreshDue({ copy, attemptedAt: NOW }, NOW - 1)).toBe(true);
  });
});

describe('nextLatestListRecord', () => {
  const old = { fetchedAt: NOW - 5, sha256: 'b'.repeat(64), rows: ['old'] };
  const fetched: LatestListFetch = { ok: true, rows: ROWS, sha256: ROWS_SHA };

  it('replaces the copy on success and clears the miss', () => {
    expect(
      nextLatestListRecord({ copy: old, attemptedAt: 1, lastMiss: 'timeout' }, fetched, NOW)
    ).toEqual({ copy: { fetchedAt: NOW, sha256: ROWS_SHA, rows: ROWS }, attemptedAt: NOW });
  });

  it('keeps the last valid copy on a miss and records it', () => {
    const miss: LatestListFetch = { ok: false, miss: 'invalid', detail: 'x' };
    expect(nextLatestListRecord({ copy: old, attemptedAt: 1 }, miss, NOW)).toEqual({
      copy: old,
      attemptedAt: NOW,
      lastMiss: 'invalid'
    });
    expect(nextLatestListRecord({}, miss, NOW)).toEqual({ attemptedAt: NOW, lastMiss: 'invalid' });
  });
});

/** A service over doubles: a kept record, a fetch answering `response`, a clock. */
function service(overrides: Partial<LatestListServiceDeps> & { stored?: LatestListRecord } = {}): {
  service: LatestListService;
  deps: LatestListServiceDeps & {
    fetch: ReturnType<typeof vi.fn<typeof fetch>>;
    write: ReturnType<typeof vi.fn<LatestListServiceDeps['write']>>;
    read: ReturnType<typeof vi.fn<LatestListServiceDeps['read']>>;
  };
  log: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
} {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = {
    fetch: answering(() => ok()),
    sha256,
    now: () => NOW,
    read: vi.fn<LatestListServiceDeps['read']>(() => Promise.resolve(overrides.stored ?? {})),
    write: vi.fn<LatestListServiceDeps['write']>(() => Promise.resolve()),
    log,
    ...overrides
  } as ReturnType<typeof service>['deps'];
  return { service: createLatestListService(deps), deps, log };
}

describe('createLatestListService', () => {
  it('refreshes when due: keeps the copy in storage and memory', async () => {
    const { service: s, deps, log } = service();
    await s.refreshIfDue();
    const kept = { copy: { fetchedAt: NOW, sha256: ROWS_SHA, rows: ROWS }, attemptedAt: NOW };
    expect(deps.write).toHaveBeenCalledWith(kept);
    await expect(s.record()).resolves.toEqual(kept);
    expect(deps.read).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith('Latest exclusion list refreshed', {
      rows: 2,
      sha256: ROWS_SHA,
      changed: true
    });
  });

  it('does not fetch when not due', async () => {
    const stored = {
      copy: { fetchedAt: NOW - 1, sha256: ROWS_SHA, rows: ROWS },
      attemptedAt: NOW - 1
    };
    const { service: s, deps } = service({ stored });
    await s.refreshIfDue();
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
  });

  it('keeps the last valid copy on a failed refresh, the miss recorded and logged', async () => {
    const copy = { fetchedAt: NOW - LATEST_LIST_REFRESH_MS, sha256: ROWS_SHA, rows: ROWS };
    const {
      service: s,
      deps,
      log
    } = service({
      stored: { copy, attemptedAt: copy.fetchedAt },
      fetch: answering(() => new Response('', { status: 503 }))
    });
    await s.refreshIfDue();
    const next = { copy, attemptedAt: NOW, lastMiss: 'http-error' };
    expect(deps.write).toHaveBeenCalledWith(next);
    await expect(s.record()).resolves.toEqual(next);
    expect(log.warn).toHaveBeenCalledWith('Latest exclusion list refresh missed', {
      miss: 'http-error',
      detail: 'answered 503',
      keptCopy: true
    });
  });

  it('logs an unchanged list as unchanged', async () => {
    const copy = { fetchedAt: NOW - LATEST_LIST_REFRESH_MS, sha256: ROWS_SHA, rows: ROWS };
    const { service: s, log } = service({ stored: { copy } });
    await s.refreshIfDue();
    expect(log.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ changed: false })
    );
  });

  it('runs one refresh at a time (single flight)', async () => {
    let release = (): void => undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve(ok());
          };
        })
    );
    const { service: s } = service({ fetch });
    const first = s.refreshIfDue();
    const second = s.refreshIfDue();
    expect(second).toBe(first);
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    release();
    await first;
    // Done and no longer due: a later call starts a new check, which fetches nothing.
    await s.refreshIfDue();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps a fetched list in memory when the write fails (logged)', async () => {
    const { service: s, log } = service({
      write: vi.fn(() => Promise.reject(new Error('quota')))
    });
    await s.refreshIfDue();
    await expect(s.record()).resolves.toMatchObject({ copy: { rows: ROWS } });
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('refreshes after an unreadable record (unknown history), logged', async () => {
    const {
      service: s,
      deps,
      log
    } = service({
      read: vi.fn(() => Promise.reject(new Error('storage down')))
    });
    await s.refreshIfDue();
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      'Kept record unreadable before a refresh',
      expect.any(Error)
    );
  });

  it('neither writes nor keeps a miss after an unreadable record (a stored copy survives)', async () => {
    const copy = { fetchedAt: NOW - 1, sha256: ROWS_SHA, rows: ROWS };
    const read = vi
      .fn<LatestListServiceDeps['read']>()
      .mockRejectedValueOnce(new Error('storage down'))
      .mockResolvedValue({ copy, attemptedAt: copy.fetchedAt });
    const {
      service: s,
      deps,
      log
    } = service({ read, fetch: answering(() => new Response('', { status: 503 })) });
    await s.refreshIfDue();
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(deps.write).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      'Latest exclusion list refresh missed (kept record unreadable, left as is)',
      { miss: 'http-error', detail: 'answered 503' }
    );
    // Memory kept nothing: the next read gets the stored copy back.
    await expect(s.record()).resolves.toEqual({ copy, attemptedAt: copy.fetchedAt });
  });

  it('retries a failed record read on the next call', async () => {
    const read = vi
      .fn<LatestListServiceDeps['read']>()
      .mockRejectedValueOnce(new Error('storage down'))
      .mockResolvedValueOnce({ lastMiss: 'timeout' });
    const { service: s } = service({ read });
    await expect(s.record()).rejects.toThrow('storage down');
    await expect(s.record()).resolves.toEqual({ lastMiss: 'timeout' });
    await expect(s.record()).resolves.toEqual({ lastMiss: 'timeout' });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never rejects, even when the refresh crashes (logged)', async () => {
    const { service: s, log } = service({ sha256: () => Promise.reject(new Error('no digest')) });
    await expect(s.refreshIfDue()).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      'Latest exclusion list refresh crashed',
      expect.any(Error)
    );
  });
});

describe('dropPreviousBuildCopy', () => {
  const OLD = { fetchedAt: NOW - 1, sha256: 'b'.repeat(64), rows: ['old'] };

  it('drops a copy kept before this lifetime, in storage and memory, then refetches once', async () => {
    const { service: s, deps } = service({ stored: { copy: OLD, attemptedAt: OLD.fetchedAt } });
    await s.refreshIfDue();
    expect(deps.fetch).not.toHaveBeenCalled();
    await s.dropPreviousBuildCopy();
    expect(deps.write).toHaveBeenNthCalledWith(1, {});
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const fresh = { copy: { fetchedAt: NOW, sha256: ROWS_SHA, rows: ROWS }, attemptedAt: NOW };
    expect(deps.write).toHaveBeenLastCalledWith(fresh);
    await expect(s.record()).resolves.toEqual(fresh);
  });

  it('leaves no previous-build copy when the refetch misses (the bundled list runs)', async () => {
    const { service: s } = service({
      stored: { copy: OLD, attemptedAt: OLD.fetchedAt },
      fetch: answering(() => new Response('', { status: 503 }))
    });
    await s.dropPreviousBuildCopy();
    await expect(s.record()).resolves.toEqual({ attemptedAt: NOW, lastMiss: 'http-error' });
  });

  it('keeps a copy this lifetime fetched, even one still in flight (no second fetch)', async () => {
    let release = (): void => undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve(ok());
          };
        })
    );
    const { service: s, deps } = service({ fetch });
    const refreshing = s.refreshIfDue();
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    const dropping = s.dropPreviousBuildCopy();
    release();
    await Promise.all([refreshing, dropping]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(deps.write).toHaveBeenCalledTimes(1);
    await expect(s.record()).resolves.toMatchObject({ copy: { rows: ROWS } });
  });

  it('still drops from memory and refetches when the drop write fails (logged)', async () => {
    const write = vi
      .fn<LatestListServiceDeps['write']>()
      .mockRejectedValueOnce(new Error('quota'))
      .mockResolvedValue();
    const {
      service: s,
      deps,
      log
    } = service({ stored: { copy: OLD, attemptedAt: OLD.fetchedAt }, write });
    await expect(s.dropPreviousBuildCopy()).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      'Dropping the kept latest exclusion list failed',
      expect.any(Error)
    );
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    await expect(s.record()).resolves.toMatchObject({ copy: { rows: ROWS } });
  });
});

describe('registerLatestExclusionList', () => {
  /** A fired alarm named `name`. */
  const alarm = (name: string): Browser.alarms.Alarm => ({
    name,
    scheduledTime: NOW,
    persistAcrossSessions: true
  });

  /** A service double counting refreshes and drops. */
  const counting = (): LatestListService & {
    refreshIfDue: ReturnType<typeof vi.fn>;
    dropPreviousBuildCopy: ReturnType<typeof vi.fn>;
  } => ({
    record: () => Promise.resolve({}),
    refreshIfDue: vi.fn(() => Promise.resolve()),
    dropPreviousBuildCopy: vi.fn(() => Promise.resolve())
  });

  it('provisions the hourly due-check alarm once and refreshes when due at boot', async () => {
    const s = counting();
    const { prime } = registerLatestExclusionList(s);
    await prime();
    await prime();
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatchObject({ name: LATEST_LIST_ALARM.name, periodInMinutes: 60 });
    expect(s.refreshIfDue).toHaveBeenCalledTimes(2);
  });

  it('runs the due check on its own alarm only', async () => {
    const s = counting();
    registerLatestExclusionList(s);
    await fakeBrowser.alarms.onAlarm.trigger(alarm('update-known-conflicts-db'));
    expect(s.refreshIfDue).not.toHaveBeenCalled();
    await fakeBrowser.alarms.onAlarm.trigger(alarm(LATEST_LIST_ALARM.name));
    expect(s.refreshIfDue).toHaveBeenCalledTimes(1);
  });

  it('drops the previous build’s copy on an update only', async () => {
    const s = counting();
    registerLatestExclusionList(s);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'chrome_update' });
    expect(s.dropPreviousBuildCopy).not.toHaveBeenCalled();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.0.0' });
    expect(s.dropPreviousBuildCopy).toHaveBeenCalledTimes(1);
  });

  it('still refreshes when the alarm cannot be provisioned (logged)', async () => {
    const s = counting();
    const create = vi.spyOn(fakeBrowser.alarms, 'create').mockRejectedValue(new Error('denied'));
    const { prime } = registerLatestExclusionList(s);
    await prime();
    expect(s.refreshIfDue).toHaveBeenCalledTimes(1);
    create.mockRestore();
  });
});
