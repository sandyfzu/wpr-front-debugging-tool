/**
 * The kept latest Delay JS exclusion list and its refresh record
 * (`local:` — it outlives browser restarts, so a copy fetched once keeps
 * serving offline). The background is the only writer.
 *
 * Reads are tolerant: a stored copy that fails re-validation reads as no
 * copy with the miss `unreadable` and no attempt time (so a refresh is due
 * at once), a malformed attempt field as absent, unknown fields are
 * ignored — a damaged value never reaches a page, and the next refresh
 * rewrites it.
 */
import { storage } from 'wxt/utils/storage';
import { isCount } from '../messaging/guard-policy';
import { isRecord, ownValue } from '../../utils/is-record';
import { validateLatestListRows } from '../wp-rocket-simulation/latest-list';
import { LATEST_LIST_MISSES, type LatestListMiss } from '../wp-rocket-simulation/spec';

/** The store key. */
export const LATEST_EXCLUSION_LIST_KEY = 'local:latest-exclusion-list';

/** One validated fetched list. */
export interface LatestListCopy {
  /** When it was fetched (epoch ms). */
  readonly fetchedAt: number;
  /** SHA-256 (lowercase hex) of the rows' JSON text — tells a changed list from a re-fetched one. */
  readonly sha256: string;
  readonly rows: readonly string[];
}

/** The kept state: the last valid copy and the last refresh attempt. */
export interface LatestListRecord {
  /** The last valid copy (absent: none fetched yet, or the kept one was unreadable). */
  readonly copy?: LatestListCopy;
  /** When the last refresh was attempted (epoch ms; absent: never). */
  readonly attemptedAt?: number;
  /** Why the last attempt failed (absent: it succeeded, or none was made). */
  readonly lastMiss?: LatestListMiss;
}

/** A refresh attempt's own misses (`never-fetched`, `unreadable` and `expired` are never an attempt's). */
export type LatestListAttemptMiss = Exclude<
  LatestListMiss,
  'never-fetched' | 'unreadable' | 'expired'
>;

/** The store (no fallback: an unset value reads `null`, parsed as the empty record). */
const latestListStore = storage.defineItem<unknown>(LATEST_EXCLUSION_LIST_KEY);

/** A SHA-256 digest's form: 64 lowercase hex digits. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Read a stored copy back.
 *
 * @param value The stored copy.
 * @returns The copy, or undefined when any part is invalid.
 */
function parseCopy(value: unknown): LatestListCopy | undefined {
  if (!isRecord(value)) return undefined;
  const fetchedAt = ownValue(value, 'fetchedAt');
  const sha256 = ownValue(value, 'sha256');
  if (!isCount(fetchedAt) || typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
    return undefined;
  }
  const rows = validateLatestListRows(ownValue(value, 'rows'));
  return rows.ok ? { fetchedAt, sha256, rows: rows.rows } : undefined;
}

/**
 * Read a stored record back, tolerant of damage: each invalid part reads
 * as absent, unknown fields are ignored. A stored copy that fails
 * re-validation reads as `{ lastMiss: 'unreadable' }` alone: the bundled
 * list runs with that miss named, and without an attempt time a refresh
 * is due immediately rather than a day (or an hour) later.
 *
 * @param input The stored value.
 * @returns The record (empty when nothing usable is stored).
 */
export function parseLatestListRecord(input: unknown): LatestListRecord {
  if (!isRecord(input)) return {};
  const storedCopy = ownValue(input, 'copy');
  const copy = parseCopy(storedCopy);
  if (storedCopy !== undefined && copy === undefined) return { lastMiss: 'unreadable' };
  const attemptedAt = ownValue(input, 'attemptedAt');
  const lastMiss = ownValue(input, 'lastMiss');
  const miss = LATEST_LIST_MISSES.find((known) => known === lastMiss);
  return {
    ...(copy === undefined ? {} : { copy }),
    ...(isCount(attemptedAt) ? { attemptedAt } : {}),
    ...(miss === undefined ? {} : { lastMiss: miss })
  };
}

/** Read the kept record (validated; rejects only when storage itself fails). */
export async function getLatestListRecord(): Promise<LatestListRecord> {
  return parseLatestListRecord(await latestListStore.getValue());
}

/**
 * Keep a record (the caller builds it from a refresh outcome).
 *
 * @param record The record to keep.
 */
export function setLatestListRecord(record: LatestListRecord): Promise<void> {
  return latestListStore.setValue(record);
}
