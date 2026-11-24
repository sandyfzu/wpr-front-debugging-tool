/**
 * The Known Conflicts database service, background-owned.
 *
 * Responsibilities around one data bundle that lives ONLY inside this
 * program (the committed snapshot is embedded here, in no other surface):
 *
 * - freshness — an hourly browser alarm plus a manual entry (context menu,
 *   options push) fetch the plugin's public endpoint, validate the payload
 *   shape, and only on a fully successful round trip write rows + a fetch
 *   timestamp to storage;
 * - availability — the page-facing `getKnownConflictsDb` request never
 *   leaves the caller without rows: storage first, then a fetch-and-store,
 *   then the embedded snapshot, exactly in that order of preference;
 * - fail-open recovery — a failed first install seeds the snapshot into
 *   storage so every later read works while freshness keeps retrying.
 *
 * Failure modes stay distinct on the log (network outage, timeout, HTTP
 * status, malformed JSON, an oversized body, invalid shape, storage write): one shared
 * "couldn't update" reading of the reason previously left failed installs
 * and transient outages indistinguishable, and the single-flight lock is
 * reset unconditionally so a failure can never wedge updates off.
 */

import { createLogger } from '../../lib/logger';
import {
  getKnownConflicts,
  knownConflictsStore,
  type KnownConflict
} from '../../lib/storage/known-conflicts';
import { onMessage } from '../../lib/messaging';
import { parseKnownConflicts, type DbUpdateResult } from '../../lib/messaging/validate';
import { ALARM_ID_UPDATE_KNOWN_CONFLICTS_DB } from '../../lib/wp-rocket/constants';
import dbSeedUrl from '../../lib/known-conflicts/known-conflicts-db.json?url&no-inline';
import { fetchFailureKind } from '../../utils/fetch-failure';
import { readCappedText } from '../../utils/read-capped-text';

const log = createLogger('known-conflicts');

/** The plugin's public Server endpoint the database refreshes from. */
export const DB_ENDPOINT = 'https://apps.wpr-support.com/kc/known-conflicts.json';

/**
 * Fetch cap in ms: the refresh must never hold the single-flight lock or an
 * awaited caller past a dying network — the server answers this payload well
 * under two seconds when reachable.
 */
export const DB_FETCH_TIMEOUT_MS = 10_000;

/**
 * The endpoint body's byte ceiling: far above any real database (~80 KB
 * today), so it never trips on one, while an oversized or endless answer is
 * cancelled mid-stream instead of being buffered and parsed whole. The row
 * validator caps characters, not bytes, so this is a transport guard, not a
 * mirror of the validator's limits.
 */
export const DB_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

/** Why a refresh round trip produced nothing; logged, never guessed. */
export type UpdateFailureReason =
  /** Transport refused/died before an answer. */
  | 'network-error'
  /** The answer took past the fetch cap (dead/slow network). */
  | 'timeout'
  /** Something answered, not with a success status. */
  | 'http-error'
  /** Something answered, not with parseable JSON (or not UTF-8 text). */
  | 'malformed-payload'
  /** The answer's body passed {@link DB_RESPONSE_MAX_BYTES}. */
  | 'oversize-payload'
  /** Parseable, not our row shape — storage stays untouched. */
  | 'invalid-payload'
  /** Valid rows, but the storage write itself failed. */
  | 'storage-error';

/** How a refresh ended: written rows + fetch time, or one distinct reason. */
export type UpdateOutcome =
  | { status: 'success'; rows: KnownConflict[]; updatedAt: number }
  | { status: 'failed'; reason: UpdateFailureReason; cause: unknown };

/** Storage effects the updater performs (injectable == the tests that count). */
export interface UpdateDeps {
  /** Network access; the endpoint is always fetched through this. */
  fetch: typeof fetch;
  /** Row cache: receives validated rows, keeps a completed fetch timestamp. */
  storage: {
    setValue(rows: readonly KnownConflict[]): Promise<void>;
    setUpdatedAt(timestamp: number): Promise<void>;
  };
  /** Wall-clock for the fetch timestamp; injectable for deterministic tests. */
  now(): number;
}

/**
 * One refresh round trip: fetch → validate → store, with every failure
 * classified instead of laundered. The single-flight lock lives ABOVE this
 * pure core — it wraps exactly one instance.
 *
 * @param deps Injected fetch/storage/clock.
 * @throws Never — every mode resolves as an outcome; callers branch.
 */
export async function fetchAndStoreKnownConflicts(deps: UpdateDeps): Promise<UpdateOutcome> {
  let response: Response;
  try {
    // `no-cache`: always revalidate with the server. The endpoint sends
    // `Last-Modified` without `Cache-Control`, so the default mode would serve
    // a heuristically "fresh" HTTP-cache copy with no network at all, and the
    // refresh would stamp stale rows as just fetched (even offline).
    // `omit`: never send the endpoint site's cookies, whatever a browser's
    // default for an extension-origin request — it carries nothing of the user.
    response = await deps.fetch(DB_ENDPOINT, {
      credentials: 'omit',
      cache: 'no-cache',
      signal: AbortSignal.timeout(DB_FETCH_TIMEOUT_MS)
    });
  } catch (cause) {
    return { status: 'failed', reason: fetchFailureKind(cause), cause };
  }
  if (!response.ok) {
    return {
      status: 'failed',
      reason: 'http-error',
      cause: new RangeError(`Endpoint answered ${String(response.status)}`)
    };
  }
  let read: Awaited<ReturnType<typeof readCappedText>>;
  try {
    read = await readCappedText(response, DB_RESPONSE_MAX_BYTES);
  } catch (cause) {
    // The body stream died (or the fetch cap fired) while reading.
    return { status: 'failed', reason: fetchFailureKind(cause), cause };
  }
  if (!read.ok) {
    const oversize = read.problem === 'oversize';
    return {
      status: 'failed',
      reason: oversize ? 'oversize-payload' : 'malformed-payload',
      cause: new RangeError(
        oversize
          ? `Endpoint body passed ${String(DB_RESPONSE_MAX_BYTES)} bytes`
          : 'Endpoint body is not UTF-8 text'
      )
    };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(read.text);
  } catch (cause) {
    return { status: 'failed', reason: 'malformed-payload', cause };
  }
  const rows = parseKnownConflicts(payload);
  if (rows === null) {
    return {
      status: 'failed',
      reason: 'invalid-payload',
      cause: new RangeError('Endpoint payload failed row-shape validation')
    };
  }
  const updatedAt = deps.now();
  try {
    await deps.storage.setValue(rows);
    await deps.storage.setUpdatedAt(updatedAt);
  } catch (cause) {
    return { status: 'failed', reason: 'storage-error', cause };
  }
  return { status: 'success', rows, updatedAt };
}

/**
 * Transport shared by the live updater bound and the seed loader: one bound
 * fetch for the whole service.
 */
const realFetch = globalThis.fetch.bind(globalThis);

/** Production bound of the update type described above (one per service worker). */
const liveUpdater = createKnownConflictsDbUpdater({
  fetch: realFetch,
  now: () => Date.now(),
  storage: {
    setValue: (rows) => knownConflictsStore.setValue([...rows]),
    setUpdatedAt: (timestamp) => knownConflictsStore.setMeta({ updatedAt: timestamp })
  }
});

/**
 * A single-flight refresh controller: at most one round trip at a time, and
 * the lock releases whether the trip succeeded, failed, or threw — a failed
 * refresh must never disable later ones.
 *
 * @param deps Injected fetch/storage/clock for the wrapped core.
 */
export function createKnownConflictsDbUpdater(deps: UpdateDeps): {
  update(): Promise<DbUpdateResult | null>;
} {
  let updating = false;
  return {
    async update(): Promise<DbUpdateResult | null> {
      if (updating) {
        log.warn('Refresh skipped: already in flight');
        return null;
      }
      updating = true;
      try {
        const outcome = await fetchAndStoreKnownConflicts(deps);
        if (outcome.status === 'success') {
          log.info('Database updated', { updatedAt: outcome.updatedAt, rows: outcome.rows.length });
          return { updatedAt: outcome.updatedAt };
        }
        log.warn('Database update failed', outcome.reason, outcome.cause);
        return null;
      } catch (cause) {
        // Defensive: the wrapped core resolves every transport and storage
        // failure itself, so a rejection means a defect elsewhere — log with
        // context, keep the result contract, and still release the lock.
        log.error('Refresh crashed', cause);
        return null;
      } finally {
        updating = false;
      }
    }
  };
}

/**
 * The module's refresh entry — alarms, manual requests, and context-menu
 * triggers all route through this one bound function.
 */
export function refreshKnownConflictsDb(): Promise<DbUpdateResult | null> {
  return liveUpdater.update();
}

/**
 * The embedded snapshot loader factory: reads the packaged asset exactly
 * once per loader instance, validating before any trust — a corrupted seed
 * asset is a build invariant, logged loudly and treated as unavailable
 * rather than trusted.
 *
 * @param fetcher Transport for the packaged asset URL.
 * @returns The loader: frozen snapshot rows, or null when unreadable.
 */
export function createKnownConflictsSeedLoader(
  fetcher: typeof fetch
): () => Promise<readonly KnownConflict[] | null> {
  let seedCache: readonly KnownConflict[] | null | undefined;
  return async (): Promise<readonly KnownConflict[] | null> => {
    if (seedCache === undefined) {
      try {
        const response = await fetcher(dbSeedUrl);
        const rows = parseKnownConflicts(await response.json());
        if (rows === null) {
          log.error('Seed asset failed validation; bundle treated as corrupted');
          seedCache = null;
        } else {
          seedCache = Object.freeze(rows.map((row) => Object.freeze({ ...row })));
        }
      } catch (cause) {
        log.error('Seed asset unreadable', cause);
        seedCache = null;
      }
    }
    return seedCache ?? null;
  };
}

/** The production loader bound to this program's own transport. */
export const loadKnownConflictsSeed = createKnownConflictsSeedLoader(realFetch);

/**
 * The serve path's composition, injectable for tests: read the stored rows,
 * fall back to one refresh attempt, then to the embedded snapshot — always
 * yielding usable rows (or throwing when even the packaged snapshot is
 * missing, which is a broken build, not an out-of-data condition).
 */
export function createKnownConflictsServe(deps: {
  read: () => Promise<KnownConflict[] | null>;
  attemptRefresh: () => Promise<DbUpdateResult | null>;
  loadSeed: () => Promise<readonly KnownConflict[] | null>;
}): () => Promise<KnownConflict[]> {
  return async (): Promise<KnownConflict[]> => {
    const stored = await deps.read();
    if (stored !== null) return stored;
    log.info('No rows in storage; refreshing');
    const refreshed = await deps.attemptRefresh();
    if (refreshed !== null) {
      const written = await deps.read();
      if (written !== null) return written;
    }
    const seed = await deps.loadSeed();
    if (seed === null) {
      throw new RangeError('Conflict database unusable: no rows in storage, seed asset unreadable');
    }
    log.info('Serving embedded snapshot rows', { rowCount: seed.length });
    return [...seed];
  };
}

/** Answer `getKnownConflictsDb` (the serve path's production wiring). */
const serveKnownConflictsRequest = createKnownConflictsServe({
  read: getKnownConflicts,
  attemptRefresh: refreshKnownConflictsDb,
  loadSeed: loadKnownConflictsSeed
});

/**
 * Install-time / boot seeding: when storage has no fetch record yet, attempt
 * one immediate refresh so a first install doesn't wait the full hour for
 * fresh rows; if the refresh fails while storage is empty, write the
 * embedded snapshot (unstamped) so readers everywhere have rows meanwhile.
 */
export async function primeKnownConflictsDb(): Promise<void> {
  const stored = await getKnownConflicts();
  const meta = await knownConflictsStore.getMeta();
  if (stored !== null && meta.updatedAt !== undefined) return;
  log.info('Refreshing database at startup');
  const ok = await refreshKnownConflictsDb();
  if (ok !== null) return;
  const afterRefresh = await getKnownConflicts();
  if (afterRefresh !== null) {
    log.info('Usable rows survived the refresh failure');
    return;
  }
  const seed = await loadKnownConflictsSeed();
  if (seed !== null) {
    try {
      await knownConflictsStore.setValue([...seed]);
      log.info('Storage seeded with the embedded snapshot');
    } catch (cause) {
      // Seeding is availability repair, not data truth: a failed write keeps
      // the snapshot servable through the request path above either way.
      log.warn('Seeding storage with the embedded snapshot failed', cause);
    }
  }
}

/**
 * Idempotent alarm provisioning: the hour alarm must exist before any
 * long-lived browser session relies on it; an existing alarm is reused
 * untouched. No cross-session persistence flag is passed — alarms persist
 * by default where the browser supports it, and the alarm is re-provisioned
 * on every service-worker start regardless, so the browser-dependent flag
 * would only add a `create` rejection on browsers that predate it.
 */
export async function ensureRefreshAlarm(): Promise<void> {
  const existing = await browser.alarms.get(ALARM_ID_UPDATE_KNOWN_CONFLICTS_DB);
  if (existing !== undefined) return;
  await browser.alarms.create(ALARM_ID_UPDATE_KNOWN_CONFLICTS_DB, { periodInMinutes: 60 });
}

/**
 * Register the data service's passive pieces: the (name-filtered) alarm
 * handler, the browser-start refresh, and the two protocol request handlers.
 * Listeners register synchronously so no wake-up event is missed while the
 * refresh work itself stays awaited and branched.
 *
 * @returns The pieces `main()` owns driving: the phase's prime step and the
 *   manual-refresh hook for shared context-menu routing.
 */
export function registerKnownConflictsService(): {
  prime: () => Promise<void>;
  refreshNow: () => Promise<DbUpdateResult | null>;
} {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_ID_UPDATE_KNOWN_CONFLICTS_DB) return;
    void refreshKnownConflictsDb();
  });

  browser.runtime.onStartup.addListener(() => {
    void refreshKnownConflictsDb();
  });

  onMessage('getKnownConflictsDb', serveKnownConflictsRequest);
  onMessage('updateKnownConflictsDb', () => refreshKnownConflictsDb());

  return {
    prime: async () => {
      // Independent guarded steps: one failing boot cause logs its own
      // failure and the remaining steps still run — a lost alarm must never
      // cost the first-install rows, and a failed refresh must never cost
      // the alarm (each retries anyway at the next worker start).
      try {
        await ensureRefreshAlarm();
      } catch (cause) {
        log.error(
          'Refresh alarm provisioning failed — hourly refresh waits for the next worker start',
          cause
        );
      }
      try {
        await primeKnownConflictsDb();
      } catch (cause) {
        log.error(
          'Database boot refresh failed — readers fall back to the embedded snapshot',
          cause
        );
      }
    },
    refreshNow: refreshKnownConflictsDb
  };
}
