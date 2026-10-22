/**
 * The updater's failure taxonomy and the serve path's guarantee, over
 * injected fetch/storage/clock — the exact behaviors the page-facing
 * requests depend on: distinct failure modes (never laundered into one),
 * a validated payload before any storage write, a fetch timestamp only on
 * success, a single-flight lock that releases however the attempt ends, and
 * a serve path that never leaves the caller without rows.
 */
import { describe, expect, it } from 'vitest';
import {
  DB_ENDPOINT,
  DB_FETCH_TIMEOUT_MS,
  createKnownConflictsDbUpdater,
  createKnownConflictsServe,
  createKnownConflictsSeedLoader,
  fetchAndStoreKnownConflicts,
  type UpdateDeps,
  type UpdateOutcome
} from './known-conflicts';
import type { KnownConflict } from '../../lib/storage/known-conflicts';
import type { DbUpdateResult } from '../../lib/messaging/validate';
import { type UpdateFailureReason } from './known-conflicts';

/** Two well-formed rows of the served shape (a null-pattern row included). */
const SAMPLE_ROWS: KnownConflict[] = [
  {
    id: 'row-1',
    type: 'Plugin',
    name: 'Sample Conflict',
    detection_pattern: 'sample-plugin',
    summary: 'Breaks caching',
    issue_description: '',
    url: 'https://example.com/sample'
  },
  {
    id: 'row-2',
    type: 'Theme',
    name: 'Sample Theme',
    detection_pattern: null,
    summary: null,
    issue_description: 'Static description',
    url: 'https://example.com/theme'
  }
];

/** A Response-typed stub over exactly what the updater reads. */
function stubResponse(json: () => Promise<unknown>, ok = true): Response {
  return { ok, json } as unknown as Response;
}

type PromiseSupplier<T> = () => Promise<T>;

/** The updater's storage-side contract, recorded for assertions. */
interface RecordingStorage {
  writtenRows: readonly KnownConflict[];
  writtenTimestamps: number[];
  setValue(rows: readonly KnownConflict[]): Promise<void>;
  setUpdatedAt(timestamp: number): Promise<void>;
}

function fakeStorage(): RecordingStorage {
  return {
    writtenRows: [],
    writtenTimestamps: [],
    setValue(rows: readonly KnownConflict[]): Promise<void> {
      this.writtenRows = rows;
      return Promise.resolve();
    },
    setUpdatedAt(timestamp: number): Promise<void> {
      this.writtenTimestamps.push(timestamp);
      return Promise.resolve();
    }
  };
}

/** Thin fake transport: one queued json/ok/error per call, fully recorded. */
function fakeFetch() {
  let callCount = 0;
  let queuedJson: PromiseSupplier<unknown> | null = (): Promise<unknown> => Promise.resolve({});
  let queuedOk = true;
  let queuedError: Error | null = null;
  const noPayloadSupplier = (): Promise<unknown> =>
    Promise.reject(new RangeError('no payload queued'));
  const requestedUrls: unknown[] = [];
  const requestSignals: unknown[] = [];
  const fetch: typeof globalThis.fetch = (url: unknown, init?: RequestInit): Promise<Response> => {
    callCount += 1;
    requestedUrls.push(url);
    requestSignals.push(init?.signal);
    if (queuedError !== null) throw queuedError;
    const json = queuedJson ?? noPayloadSupplier;
    return Promise.resolve(stubResponse(json, queuedOk));
  };
  return {
    fetch,
    calls: (): number => callCount,
    urls: requestedUrls,
    signals: requestSignals,
    queueJson(json: PromiseSupplier<unknown>): void {
      queuedJson = json;
      queuedError = null;
      queuedOk = true;
    },
    queueOk(ok: boolean): void {
      queuedOk = ok;
    },
    queueError(error: Error): void {
      queuedError = error;
      // A queued error represents one transport failure; the next call runs
      // on plain stub data again unless re-queued.
      queuedOk = true;
    }
  };
}

type Fetcher = ReturnType<typeof fakeFetch>;

/** Deps bundle the tests drive; every branch swaps only what it cares about. */
function makeDeps(options: { fetcher?: Fetcher; storage?: RecordingStorage; now?: () => number }): {
  deps: UpdateDeps;
  storage: RecordingStorage;
  fetcher: Fetcher;
} {
  const fetcher = options.fetcher ?? fakeFetch();
  const storage = options.storage ?? fakeStorage();
  const clock = { time: 1_759_827_600_000 };
  return {
    deps: {
      fetch: fetcher.fetch,
      now: options.now ?? ((): number => clock.time),
      storage
    },
    storage,
    fetcher
  };
}

/** Named timeout-shaped abort, as the runtime's own bounded fetch produces. */
function timeoutAbort(): DOMException {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

function failureReason(outcome: UpdateOutcome): UpdateFailureReason {
  if (outcome.status === 'success') throw new RangeError('expected a failed outcome');
  return outcome.reason;
}

describe('fetchAndStoreKnownConflicts', () => {
  it('writes validated rows and a fetch timestamp, and reports the update', async () => {
    const { deps, storage, fetcher } = makeDeps({
      now: () => 1_720_110_000
    });
    fetcher.queueJson((): Promise<unknown> => Promise.resolve(SAMPLE_ROWS));
    const outcome = await fetchAndStoreKnownConflicts(deps);
    expect(outcome).toEqual({ status: 'success', rows: SAMPLE_ROWS, updatedAt: 1_720_110_000 });
    // Exact validated rows stored, then exactly one fetch record — in that
    // order, so a half-written install cannot stamp itself as fresh.
    expect(storage.writtenRows).toEqual(SAMPLE_ROWS);
    expect(storage.writtenTimestamps).toEqual([1_720_110_000]);
  });

  it('hits the server endpoint with a bounded-abort signal', async () => {
    const { deps, fetcher } = makeDeps({});
    fetcher.queueJson((): Promise<unknown> => Promise.resolve(SAMPLE_ROWS));
    await fetchAndStoreKnownConflicts(deps);
    expect(fetcher.urls[0]).toBe(DB_ENDPOINT);
    expect(DB_ENDPOINT).toBe('https://apps.wpr-support.com/kc/known-conflicts.json');
    expect(fetcher.signals[0]).toBeInstanceOf(AbortSignal);
    expect(DB_FETCH_TIMEOUT_MS).toBe(10_000);
  });

  it('reports a distinct http-error outcome without touching storage', async () => {
    const { deps, storage, fetcher } = makeDeps({});
    fetcher.queueOk(false);
    const outcome = await fetchAndStoreKnownConflicts(deps);
    expect(outcome.status).toBe('failed');
    expect(failureReason(outcome)).toBe('http-error');
    expect(storage.writtenRows).toEqual([]);
    expect(storage.writtenTimestamps).toEqual([]);
  });

  it('reports malformed JSON as its own failure, storage untouched', async () => {
    const { deps, storage, fetcher } = makeDeps({});
    fetcher.queueJson((): Promise<unknown> =>
      Promise.reject(new SyntaxError('Unexpected end of JSON input'))
    );
    const outcome = await fetchAndStoreKnownConflicts(deps);
    expect(outcome.status).toBe('failed');
    expect(failureReason(outcome)).toBe('malformed-payload');
    expect(storage.writtenRows).toEqual([]);
    expect(storage.writtenTimestamps).toEqual([]);
  });

  it('separates a dead network from a timeout-shaped abort', async () => {
    const { deps, storage, fetcher } = makeDeps({});
    fetcher.queueError(new TypeError('fetch failed'));
    const networkLost = await fetchAndStoreKnownConflicts(deps);
    expect(failureReason(networkLost)).toBe('network-error');
    expect(storage.writtenRows).toEqual([]);
    fetcher.queueError(timeoutAbort());
    const timedOut = await fetchAndStoreKnownConflicts(deps);
    expect(failureReason(timedOut)).toBe('timeout');
    expect(fetcher.calls()).toBe(2);
    expect(storage.writtenTimestamps).toEqual([]);
  });

  it('rejects a wrong-shaped payload wholesale and stores nothing', async () => {
    const { deps, storage, fetcher } = makeDeps({});
    fetcher.queueJson((): Promise<unknown> =>
      Promise.resolve([
        {
          // The required name field missing → the row set is invalid as a unit.
          id: 'row-x',
          type: 'Plugin',
          name: null,
          detection_pattern: null,
          summary: null,
          issue_description: '',
          url: 'https://example.com/x'
        }
      ])
    );
    const outcome = await fetchAndStoreKnownConflicts(deps);
    expect(outcome.status).toBe('failed');
    expect(failureReason(outcome)).toBe('invalid-payload');
    expect(storage.writtenRows).toEqual([]);
    expect(storage.writtenTimestamps).toEqual([]);
  });

  it('classifies a failing storage write distinctly from fetch failures', async () => {
    const { deps, fetcher } = makeDeps({});
    fetcher.queueJson((): Promise<unknown> => Promise.resolve(SAMPLE_ROWS));
    deps.storage.setValue = (): Promise<void> =>
      Promise.reject(new TypeError('storage unavailable'));
    const outcome = await fetchAndStoreKnownConflicts(deps);
    expect(failureReason(outcome)).toBe('storage-error');
  });
});

describe('createKnownConflictsDbUpdater (single flight + lock reset)', () => {
  it('collapses concurrent refreshes into one fetch; the overlap reports null', async () => {
    const { deps, storage, fetcher } = makeDeps({});
    let releaseJson: (rows: unknown) => void = () => {};
    fetcher.queueJson(
      () =>
        new Promise<unknown>((resolve) => {
          releaseJson = resolve;
        })
    );
    const updater = createKnownConflictsDbUpdater(deps);
    const pending = updater.update();
    const overlapped = updater.update();
    expect(fetcher.calls()).toBe(1);
    await expect(overlapped).resolves.toBeNull();
    releaseJson(SAMPLE_ROWS);
    await expect(pending).resolves.toEqual({ updatedAt: 1_759_827_600_000 });
    expect(storage.writtenRows).toHaveLength(2);
    expect(storage.writtenTimestamps).toHaveLength(1);
  });

  it('releases the lock after a failed attempt: a later refresh can succeed', async () => {
    const { deps, storage, fetcher } = makeDeps({});
    fetcher.queueError(new TypeError('fetch failed'));
    const updater = createKnownConflictsDbUpdater(deps);
    await expect(updater.update()).resolves.toBeNull();
    expect(fetcher.calls()).toBe(1);
    // The second attempt must run after the first failed — the lock can
    // never wedge updates off permanently.
    fetcher.queueJson((): Promise<unknown> => Promise.resolve(SAMPLE_ROWS));
    const retried = await updater.update();
    expect(retried).toEqual({ updatedAt: 1_759_827_600_000 });
    expect(storage.writtenTimestamps).toHaveLength(1);
    expect(fetcher.calls()).toBe(2);
  });
});

type ServeDeps = Parameters<typeof createKnownConflictsServe>[0];

/**
 * The serve path over injectable read/refresh/seed — the guarantee the
 * page-facing request leans on: usable rows, always, in the cheapest order.
 */
describe('createKnownConflictsServe (the getKnownConflictsDb answer)', () => {
  function makeServe(overrides: Partial<ServeDeps> = {}): () => Promise<KnownConflict[]> {
    const deps: ServeDeps = {
      read: (): Promise<KnownConflict[] | null> => Promise.resolve(null),
      attemptRefresh: (): Promise<DbUpdateResult | null> => Promise.resolve(null),
      loadSeed: (): Promise<readonly KnownConflict[]> => Promise.resolve(SAMPLE_ROWS),
      ...overrides
    };
    return () => createKnownConflictsServe(deps)();
  }

  it('serves cached storage rows without any refresh attempt', async () => {
    const serve = makeServe({
      read: (): Promise<KnownConflict[]> => Promise.resolve(SAMPLE_ROWS),
      attemptRefresh: (): Promise<DbUpdateResult | null> =>
        Promise.reject(new RangeError('refresh must not run on a cache hit'))
    });
    expect(await serve()).toEqual(SAMPLE_ROWS);
  });

  it('on empty storage: refresh first, then serve what it wrote', async () => {
    let refreshed = false;
    const serve = makeServe({
      // Storage becomes usable after the refresh's write lands.
      read: (): Promise<KnownConflict[] | null> => Promise.resolve(refreshed ? SAMPLE_ROWS : null),
      attemptRefresh: (): Promise<DbUpdateResult | null> => {
        refreshed = true;
        return Promise.resolve({ updatedAt: 42 });
      }
    });
    expect(await serve()).toEqual(SAMPLE_ROWS);
    expect(refreshed).toBe(true);
  });

  it('on a failed refresh over still-empty storage: serves the embedded snapshot', async () => {
    const serve = makeServe({ read: (): Promise<KnownConflict[] | null> => Promise.resolve(null) });
    const rows = await serve();
    expect(rows).toEqual(SAMPLE_ROWS);
    expect(rows).toHaveLength(2);
  });

  it('on a failed refresh with usable-but-unstamped rows: serves those rows', async () => {
    const seededRows: KnownConflict[] = [SAMPLE_ROWS[0] as KnownConflict];
    const serve = makeServe({
      read: (): Promise<KnownConflict[]> => Promise.resolve(seededRows),
      attemptRefresh: (): Promise<DbUpdateResult | null> => Promise.resolve(null)
    });
    expect(await serve()).toEqual(seededRows);
  });

  it('throws when even the embedded snapshot is unavailable (broken package)', async () => {
    const serve = makeServe({
      read: (): Promise<KnownConflict[] | null> => Promise.resolve(null),
      attemptRefresh: (): Promise<DbUpdateResult | null> => Promise.resolve(null),
      loadSeed: (): Promise<readonly KnownConflict[] | null> => Promise.resolve(null)
    });
    await expect(serve()).rejects.toThrow(RangeError);
  });
});

describe('createKnownConflictsSeedLoader (embedded snapshot, cached per loader)', () => {
  it('loads, validates, freezes and caches the snapshot in one fetch', async () => {
    let fetches = 0;
    const loadOnce = (): Promise<Response> => {
      fetches += 1;
      return Promise.resolve(stubResponse((): Promise<unknown> => Promise.resolve(SAMPLE_ROWS)));
    };
    const loader = createKnownConflictsSeedLoader(loadOnce);
    const first = await loader();
    const second = await loader();
    expect(first).toEqual(SAMPLE_ROWS);
    expect(second).toEqual(first);
    expect(fetches).toBe(1);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen((first as readonly KnownConflict[])[0])).toBe(true);
  });

  it('rejects a corrupted packaged asset instead of trusting partial rows', async () => {
    const loader = createKnownConflictsSeedLoader((): Promise<Response> =>
      Promise.resolve(
        stubResponse((): Promise<unknown> =>
          Promise.resolve([{ id: 'x', type: 'Plugin', name: 3, url: 'https://example.com' }])
        )
      )
    );
    const rows = await loader();
    expect(rows).toBeNull();
  });

  it('treats an unreadable asset as unavailable, not as an empty database', async () => {
    const loader = createKnownConflictsSeedLoader((): Promise<Response> => {
      throw new TypeError('asset missing');
    });
    const rows = await loader();
    expect(rows).toBeNull();
  });
});
