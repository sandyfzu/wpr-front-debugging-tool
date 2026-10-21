/**
 * The exclusion builder's live sessions: tab id → the tab's session record
 * (active, or the unavailable warning), absence meaning inactive.
 *
 * Lives in the `session:` area on purpose — a session is tab-scoped and
 * must not outlive what scopes it:
 * - it persists across navigations in the tab until Stop or tab close
 *   (the writer removes the record), and survives a suspended background
 *   (an MV3 service worker or event page re-reads it on wake);
 * - the area is in memory and cleared when the browser shuts down (tab ids
 *   are not stable across a restart) and when the extension is disabled or
 *   uninstalled — never on disk nor synced (support-site data stays on the
 *   machine);
 * - by default only extension contexts can read it: content scripts ask the
 *   background (`getExclusionSession`), so one tab's page can never read
 *   another tab's session.
 *
 * A stored record is a hint, never proof of a live session: other
 * lifecycle events (an extension reload or update) may or may not clear
 * the area depending on the browser, so the backend re-validates a record
 * on wake — no live interception attachment/listener for its tab ⇒ the
 * record is stale and is cleared, the page served unmodified.
 *
 * Writers serialize through one write queue; the background is the only
 * writer. Reads validate: corrupt records are dropped, unknown fields
 * ignored, and the map is held to {@link EXCLUSION_SESSION_LIMIT} active
 * records plus {@link EXCLUSION_WARNING_LIMIT} warnings.
 */

import { storage } from 'wxt/utils/storage';
import {
  parseExclusionSessionRecord,
  type ExclusionSessionRecord,
  type ExclusionSessionStatus
} from '../messaging/exclusion-session';
import { isRecord } from '../../utils/is-record';
import { createWriteQueue } from './write-queue';
import { tabKey } from './tab-key';

/** The `session:exclusion-sessions` store key, single-sourced. */
export const EXCLUSION_SESSIONS_KEY = 'session:exclusion-sessions';

/** The stored map: decimal tab id → the tab's record. */
export type ExclusionSessionRecords = Record<string, ExclusionSessionRecord>;

/**
 * Concurrent live (`active`) sessions held at most. Each one holds an
 * interception attachment on a tab, so real use sits at one or two. A new
 * live session past the cap is refused (the background reports the
 * `session-limit` cause) — a live session is never evicted from under its
 * tab. It is also the size bound: an active record's JSON is ≤ 512 KiB in
 * the worst case (its set ≤ ~200 KiB, the report rows drawn from that set
 * plus their counts), so 8 stay ≤ 4 MiB — inside Chrome's 10 MiB
 * `storage.session` quota (`QUOTA_BYTES`, which estimates in-memory size;
 * JSON bytes are the proxy).
 */
export const EXCLUSION_SESSION_LIMIT = 8;

/**
 * `unavailable` warnings held at most (each ≤ ~100 bytes). They hold no
 * attachment, so they never count toward {@link EXCLUSION_SESSION_LIMIT} —
 * a `session-limit` warning is always storable; past this cap the oldest
 * other warnings are dropped (a warning is advisory, a live session is not).
 */
export const EXCLUSION_WARNING_LIMIT = 32;

/** The raw storage item (reads/writes go through the helpers below). */
export const exclusionSessionsStore = storage.defineItem<ExclusionSessionRecords>(
  EXCLUSION_SESSIONS_KEY,
  { fallback: {} }
);

/** The item's write queue. */
const enqueueWrite = createWriteQueue();

/** When a record last changed (start of an active one, observation of an unavailable one). */
function recordTime(record: ExclusionSessionRecord): number {
  return record.state === 'active' ? record.startedAt : record.at;
}

/**
 * Hold records to the caps: the most recent {@link EXCLUSION_SESSION_LIMIT}
 * active ones and the most recent {@link EXCLUSION_WARNING_LIMIT} warnings.
 *
 * @param entries Validated `[key, record]` pairs.
 * @param keep A key never dropped (the record just written).
 * @returns The capped map.
 */
function capRecords(
  entries: readonly (readonly [string, ExclusionSessionRecord])[],
  keep?: string
): ExclusionSessionRecords {
  const newestFirst = [...entries].sort(([keyA, a], [keyB, b]) =>
    keyA === keep ? -1 : keyB === keep ? 1 : recordTime(b) - recordTime(a)
  );
  const kept: ExclusionSessionRecords = {};
  let active = 0;
  let warnings = 0;
  for (const [key, record] of newestFirst) {
    if (
      record.state === 'active'
        ? active++ < EXCLUSION_SESSION_LIMIT
        : warnings++ < EXCLUSION_WARNING_LIMIT
    ) {
      kept[key] = record;
    }
  }
  return kept;
}

/**
 * Validate a raw (possibly corrupt, partial, or foreign) stored map.
 *
 * - the value must be a non-null, non-array object, else null;
 * - a key must be a canonical decimal tab id; its record must pass the
 *   session-record guard (unknown fields ignored) — anything else is
 *   dropped, not trusted;
 * - past the caps (no writer produces that) the most recent active records
 *   and warnings are kept, each up to its own cap.
 *
 * @param input Any storage-delivered value.
 * @returns The validated map, or null when the value is not a map at all.
 */
export function parseExclusionSessionRecords(input: unknown): ExclusionSessionRecords | null {
  if (!isRecord(input)) return null;
  const valid: [string, ExclusionSessionRecord][] = [];
  for (const [key, raw] of Object.entries(input)) {
    const canonical = tabKey(key);
    const record = canonical === null ? null : parseExclusionSessionRecord(raw, 'ignore');
    if (canonical !== null && record !== null) valid.push([canonical, record]);
  }
  return capRecords(valid);
}

/**
 * Read every record through the validator: corrupt storage degrades to no
 * sessions, never to fabricated ones.
 */
export async function getExclusionSessionRecords(): Promise<ExclusionSessionRecords> {
  return parseExclusionSessionRecords(await exclusionSessionsStore.getValue()) ?? {};
}

/**
 * One tab's status: its record, or `inactive` when it has none.
 *
 * @param tabId The tab to look up.
 */
export async function getExclusionSessionStatus(tabId: number): Promise<ExclusionSessionStatus> {
  const key = tabKey(tabId);
  const records = await getExclusionSessionRecords();
  return (key === null ? undefined : records[key]) ?? { state: 'inactive' };
}

/** What a {@link putExclusionSessionRecord} did. */
export type PutSessionOutcome = 'stored' | 'limit-reached';

/**
 * Store one tab's record (queued read-modify-write; other tabs survive).
 * An `active` record is refused, nothing written, when
 * {@link EXCLUSION_SESSION_LIMIT} other tabs already hold live sessions (a
 * tab that already is active is always replaced); an `unavailable` warning
 * is always stored, the oldest other warnings dropped past
 * {@link EXCLUSION_WARNING_LIMIT}.
 *
 * @param tabId The tab (sender-resolved by the caller).
 * @param record The record (re-validated: callers pass guarded records).
 * @returns Whether the record was stored or refused at the cap. Rejects
 *   with an {@link Error} when `tabId` is not a tab id or `record` fails the
 *   record guard (a broken caller — nothing touched), and with whatever the
 *   storage read/write rejects with (callers branch on it).
 */
export function putExclusionSessionRecord(
  tabId: number,
  record: ExclusionSessionRecord
): Promise<PutSessionOutcome> {
  const key = tabKey(tabId);
  if (key === null) {
    return Promise.reject(new Error(`putExclusionSessionRecord: not a tab id: ${String(tabId)}`));
  }
  const checked = parseExclusionSessionRecord(record, 'reject');
  if (checked === null) {
    return Promise.reject(
      new Error(`putExclusionSessionRecord: the record for tab ${key} fails the record guard`)
    );
  }
  return enqueueWrite(async () => {
    const current = parseExclusionSessionRecords(await exclusionSessionsStore.getValue()) ?? {};
    const othersActive = Object.entries(current).filter(
      ([other, stored]) => other !== key && stored.state === 'active'
    ).length;
    if (checked.state === 'active' && othersActive >= EXCLUSION_SESSION_LIMIT) {
      return 'limit-reached';
    }
    const others = Object.entries(current).filter(([other]) => other !== key);
    await exclusionSessionsStore.setValue(capRecords([...others, [key, checked]], key));
    return 'stored';
  });
}

/**
 * Drop one tab's record — Stop, tab close (queued read-modify-write; an
 * absent record is a no-op write).
 *
 * @param tabId The tab whose session ended.
 * @throws Whatever the storage read/write rejects with.
 */
export function removeExclusionSessionRecord(tabId: number): Promise<void> {
  const key = tabKey(tabId);
  return enqueueWrite(async () => {
    const next = {
      ...(parseExclusionSessionRecords(await exclusionSessionsStore.getValue()) ?? {})
    };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the map is keyed by tab; removing one key is the operation
    if (key !== null) delete next[key];
    await exclusionSessionsStore.setValue(next);
  });
}
