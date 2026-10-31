/**
 * The latest Delay JS exclusion list service, background-owned: refreshes
 * the kept copy from WP Media's endpoint on its own schedule and serves it
 * to the simulation's list source from memory.
 *
 * - Freshness: a due check at every background start and on an hourly
 *   alarm; a refresh runs only when due — 24 h after a successful one,
 *   1 h after a failed one — so the endpoint (60 requests per window) is
 *   asked at most about once an hour, never in a storm.
 * - Safety: the request carries no credentials, no query, no site data;
 *   the answer is data only, capped, parsed and validated before it is
 *   kept (`lib/wp-rocket-simulation/latest-list`).
 * - Availability: a failed refresh keeps the last valid copy (the miss is
 *   recorded); without one — or past its trusted age — the simulation runs
 *   the bundled list, the miss named. Pages never wait on the network: the
 *   transform path reads the kept record only.
 * - Updates: an extension update drops a copy fetched under the previous
 *   build (the new build's bundled list must never be overridden by it)
 *   and refreshes at once.
 */
import { createLogger, type Logger } from '../../lib/logger';
import {
  createLatestDeferListsSource,
  createLatestListSource
} from '../../lib/exclusion-session/latest-list-source';
import type { SimulationSources } from '../../lib/exclusion-session/simulation-sources';
import {
  getLatestListRecord,
  setLatestListRecord,
  type LatestListAttemptMiss,
  type LatestListRecord
} from '../../lib/storage/latest-exclusion-list';
import {
  LATEST_LIST_ENDPOINT,
  LATEST_LIST_MAX_BYTES,
  parseLatestList,
  type DeferListsValidation
} from '../../lib/wp-rocket-simulation/latest-list';
import { rowListKeyText } from '../../lib/wp-rocket-simulation/simulation-data';
import { fetchFailureKind } from '../../utils/fetch-failure';
import { readCappedText } from '../../utils/read-capped-text';
import { webSha256Hex } from '../../utils/web-sha256';

const log = createLogger('latest-exclusion-list');

/** Fetch cap (ms) over the request and the body read: the endpoint answered in 0.8–1.5 s. */
export const LATEST_LIST_FETCH_TIMEOUT_MS = 10_000;

/** A successful refresh is repeated after this long (ms). */
export const LATEST_LIST_REFRESH_MS = 24 * 60 * 60 * 1_000;

/** A failed refresh is retried after this long (ms). */
export const LATEST_LIST_RETRY_MS = 60 * 60 * 1_000;

/** The due-check alarm's name and period (minutes). */
export const LATEST_LIST_ALARM = { name: 'refresh-latest-exclusion-list', periodInMinutes: 60 };

/**
 * A fetch's answer: the validated Delay JS rows with their digest and the
 * same document's Defer JS lists' outcome, or the miss and what failed.
 */
export type LatestListFetch =
  | {
      readonly ok: true;
      readonly rows: readonly string[];
      readonly sha256: string;
      readonly defer: DeferListsValidation;
    }
  | { readonly ok: false; readonly miss: LatestListAttemptMiss; readonly detail: string };

/** What a fetch needs from its platform. */
export interface LatestListFetchDeps {
  readonly fetch: typeof fetch;
  /** SHA-256 hex of a text's UTF-8. */
  readonly sha256: (text: string) => Promise<string>;
}

/**
 * Fetch and validate the latest list once: `GET` with no credentials, no
 * HTTP cache, under {@link LATEST_LIST_FETCH_TIMEOUT_MS}. Only `200` is an
 * answer (the endpoint's "unchanged" `206` replies only to a `hash` this
 * request never sends); its `content-type` is ignored (it says `text/html`).
 *
 * @param deps Transport and digest.
 * @returns The rows and their digest, or the miss.
 */
export async function fetchLatestList(deps: LatestListFetchDeps): Promise<LatestListFetch> {
  const signal = AbortSignal.timeout(LATEST_LIST_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await deps.fetch(LATEST_LIST_ENDPOINT, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      signal
    });
  } catch (cause) {
    return { ok: false, miss: fetchFailureKind(cause), detail: String(cause) };
  }
  if (response.status !== 200) {
    return { ok: false, miss: 'http-error', detail: `answered ${String(response.status)}` };
  }
  let body;
  try {
    body = await readCappedText(response, LATEST_LIST_MAX_BYTES);
  } catch (cause) {
    return { ok: false, miss: fetchFailureKind(cause), detail: `body: ${String(cause)}` };
  }
  if (!body.ok) {
    return body.problem === 'oversize'
      ? { ok: false, miss: 'oversize', detail: `over ${String(LATEST_LIST_MAX_BYTES)} bytes` }
      : { ok: false, miss: 'malformed', detail: 'not UTF-8 text' };
  }
  const list = parseLatestList(body.text);
  if (!list.ok) return list;
  return {
    ok: true,
    rows: list.rows,
    sha256: await deps.sha256(rowListKeyText(list.rows)),
    defer: list.defer
  };
}

/**
 * Whether a refresh is due: never attempted, the clock went back, a kept
 * copy whose Defer JS lists were never read after a successful attempt (a
 * copy kept before they were), or the last attempt is older than
 * {@link LATEST_LIST_REFRESH_MS} (success) or {@link LATEST_LIST_RETRY_MS}
 * (failure).
 *
 * @param record The kept record.
 * @param now The current time (epoch ms).
 */
export function latestListRefreshDue(record: LatestListRecord, now: number): boolean {
  const last = record.attemptedAt ?? record.copy?.fetchedAt;
  if (last === undefined || now < last) return true;
  if (record.copy?.deferMiss === 'never-fetched' && record.lastMiss === undefined) return true;
  return (
    now - last >= (record.lastMiss === undefined ? LATEST_LIST_REFRESH_MS : LATEST_LIST_RETRY_MS)
  );
}

/**
 * Whether a fetched document changed the kept copy: its Delay JS rows'
 * digest, or its Defer JS lists (or their usability).
 *
 * @param copy The copy kept before the fetch.
 * @param fetched The fetch's valid answer.
 */
export function copyChanged(
  copy: LatestListRecord['copy'],
  fetched: Extract<LatestListFetch, { ok: true }>
): boolean {
  if (copy?.sha256 !== fetched.sha256) return true;
  const before = copy.defer === undefined ? null : [copy.defer.external, copy.defer.inline];
  const after = fetched.defer.ok
    ? [fetched.defer.lists.external, fetched.defer.lists.inline]
    : null;
  return JSON.stringify(before) !== JSON.stringify(after);
}

/**
 * The record after a refresh: a new copy on success; on a miss, the last
 * valid copy kept and the miss recorded.
 *
 * @param record The record before.
 * @param fetched The fetch's answer.
 * @param now The attempt time (epoch ms).
 */
export function nextLatestListRecord(
  record: LatestListRecord,
  fetched: LatestListFetch,
  now: number
): LatestListRecord {
  if (fetched.ok) {
    const defer = fetched.defer.ok
      ? { defer: fetched.defer.lists }
      : { deferMiss: fetched.defer.miss };
    return {
      copy: { fetchedAt: now, sha256: fetched.sha256, rows: fetched.rows, ...defer },
      attemptedAt: now
    };
  }
  return {
    ...(record.copy === undefined ? {} : { copy: record.copy }),
    attemptedAt: now,
    lastMiss: fetched.miss
  };
}

/** What the service needs from its platform. */
export interface LatestListServiceDeps extends LatestListFetchDeps {
  readonly now: () => number;
  /** The kept record (validated). */
  readonly read: () => Promise<LatestListRecord>;
  readonly write: (record: LatestListRecord) => Promise<void>;
  readonly log: Pick<Logger, 'info' | 'warn' | 'error'>;
}

/** The service: the kept record (memory after its first read), the due refresh, the update drop. */
export interface LatestListService {
  /** The kept record: read from storage once, then served from memory. Rejects when the read fails (retried next call). */
  readonly record: () => Promise<LatestListRecord>;
  /** Refresh when due (single-flight). Never rejects. */
  readonly refreshIfDue: () => Promise<void>;
  /**
   * Forget a copy fetched before this background lifetime (an extension
   * update: it came from the previous build), then refresh. A copy this
   * lifetime fetched is kept. Never rejects.
   */
  readonly dropPreviousBuildCopy: () => Promise<void>;
}

/**
 * Build the service. The record is held in memory once read and replaced
 * by each refresh (the service is its only writer), so documents never
 * wait on storage after the first read; a failed write still updates
 * memory (this lifetime keeps the fetched list and its attempt time).
 * A miss after an unreadable record is neither written nor kept: storage
 * may still hold a valid copy, which the next read gets back.
 *
 * @param deps Platform seams.
 */
export function createLatestListService(deps: LatestListServiceDeps): LatestListService {
  let kept: Promise<LatestListRecord> | undefined;
  let refreshing: Promise<void> | undefined;
  /** Whether a refresh of this lifetime succeeded (its copy is the running build's). */
  let fetchedThisLifetime = false;

  const record = (): Promise<LatestListRecord> => {
    if (kept === undefined) {
      const reading = deps.read();
      kept = reading;
      // A failed read is not kept: the next call reads again.
      reading.catch(() => {
        if (kept === reading) kept = undefined;
      });
    }
    return kept;
  };

  const refresh = async (): Promise<void> => {
    let before: LatestListRecord;
    let known = true;
    try {
      before = await record();
    } catch (cause) {
      // Unknown attempt history: refresh (bounded by the start and hourly triggers).
      deps.log.warn('Kept record unreadable before a refresh', cause);
      before = {};
      known = false;
    }
    const now = deps.now();
    if (!latestListRefreshDue(before, now)) return;
    const fetched = await fetchLatestList(deps);
    const next = nextLatestListRecord(before, fetched, now);
    if (!fetched.ok && !known) {
      // Writing would erase a copy storage may still hold; the next read retries it.
      deps.log.warn('Latest exclusion list refresh missed (kept record unreadable, left as is)', {
        miss: fetched.miss,
        detail: fetched.detail
      });
      return;
    }
    kept = Promise.resolve(next);
    if (fetched.ok) {
      fetchedThisLifetime = true;
      deps.log.info('Latest exclusion list refreshed', {
        rows: fetched.rows.length,
        sha256: fetched.sha256,
        changed: copyChanged(before.copy, fetched)
      });
      if (!fetched.defer.ok) {
        deps.log.warn('Latest Defer JS lists unusable — Defer JS runs the bundled lists', {
          miss: fetched.defer.miss,
          detail: fetched.defer.detail
        });
      }
    } else {
      deps.log.warn('Latest exclusion list refresh missed', {
        miss: fetched.miss,
        detail: fetched.detail,
        keptCopy: next.copy !== undefined
      });
    }
    try {
      await deps.write(next);
    } catch (cause) {
      deps.log.error(
        'Keeping the latest exclusion list failed — kept for this lifetime only',
        cause
      );
    }
  };

  const refreshIfDue = (): Promise<void> => {
    refreshing ??= refresh()
      .catch((cause: unknown) => {
        // Defensive: every expected failure resolves above; this is a defect.
        deps.log.error('Latest exclusion list refresh crashed', cause);
      })
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  };

  const dropPreviousBuildCopy = async (): Promise<void> => {
    // Let an in-flight refresh settle first, so its outcome is not lost
    // and no refresh can rewrite the dropped copy afterwards.
    while (refreshing !== undefined) await refreshing;
    if (fetchedThisLifetime) return;
    // Memory first, synchronously after the settle: no refresh can start in between.
    kept = Promise.resolve({});
    deps.log.info('Extension updated — the kept latest exclusion list is dropped and refetched');
    try {
      await deps.write({});
    } catch (cause) {
      deps.log.error('Dropping the kept latest exclusion list failed', cause);
    }
    await refreshIfDue();
  };

  return { record, refreshIfDue, dropPreviousBuildCopy };
}

/** The production service (one per background lifetime; creating it does no I/O). */
export const latestExclusionList = createLatestListService({
  fetch: (input, init) => fetch(input, init),
  sha256: webSha256Hex,
  now: () => Date.now(),
  read: getLatestListRecord,
  write: setLatestListRecord,
  log
});

/** The simulation's list source over the production service. */
export const latestListSource: SimulationSources['list'] = createLatestListSource(
  () => latestExclusionList.record(),
  () => Date.now(),
  log
);

/** The simulation's Defer JS lists source over the production service. */
export const latestDeferListsSource: SimulationSources['deferLists'] = createLatestDeferListsSource(
  () => latestExclusionList.record(),
  () => Date.now(),
  log
);

/**
 * Provision the due-check alarm (an existing one is reused).
 *
 * @throws The alarms API's failure.
 */
async function ensureLatestListAlarm(): Promise<void> {
  if ((await browser.alarms.get(LATEST_LIST_ALARM.name)) !== undefined) return;
  await browser.alarms.create(LATEST_LIST_ALARM.name, {
    periodInMinutes: LATEST_LIST_ALARM.periodInMinutes
  });
}

/**
 * Register the alarm and update listeners (synchronously, so no wake-up is
 * missed) and return the boot step: provision the alarm, then refresh
 * when due.
 *
 * @param service The service to drive.
 */
export function registerLatestExclusionList(service: LatestListService = latestExclusionList): {
  prime: () => Promise<void>;
} {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== LATEST_LIST_ALARM.name) return;
    void service.refreshIfDue();
  });
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'update') return;
    void service.dropPreviousBuildCopy();
  });
  return {
    prime: async () => {
      try {
        await ensureLatestListAlarm();
      } catch (cause) {
        log.error(
          'Latest list alarm provisioning failed — refreshes wait for the next start',
          cause
        );
      }
      await service.refreshIfDue();
    }
  };
}
