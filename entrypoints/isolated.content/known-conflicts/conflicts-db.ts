/**
 * The scan surface's view of the Known Conflicts DB.
 *
 * Load asks the background only when storage has no usable value (fresh
 * install, wiped value, corrupt rows): the background owns seeding and
 * updating — a snapshot read at startup never updates, while this surface
 * follows the live value. Anything the background writes lands in storage,
 * so the storage watch is the update channel every open page follows.
 */

import { knownConflictsStore } from '../../../lib/storage/known-conflicts';
import { parseKnownConflicts } from '../../../lib/messaging/validate';
import { sendMessage } from '../../../lib/messaging/index';
import type { KnownConflict } from '../../../lib/storage/known-conflicts';
import { createLogger } from '../../../lib/logger';

const log = createLogger('known-conflicts');

/**
 * Read the DB rows through the validator; a structurally broken storage value
 * (partial write, foreign data) is treated exactly like "nothing stored" so
 * the same recovery path applies.
 *
 * @returns Validated rows, or `null` when nothing usable is stored.
 */
export function readStoredConflicts(stored: unknown): KnownConflict[] | null {
  return parseKnownConflicts(stored);
}

/**
 * One DB snapshot plus its update channel. `load` tolerates an unseeded
 * background: rows stay empty and any storage write (seeding, an update)
 * replaces them through `watch`.
 */
export interface ConflictsDb {
  /** The rows last seen (empty until the first successful load). */
  readonly rows: readonly KnownConflict[];
  /**
   * Load once: stored value first (validated), one `getKnownConflictsDb` ask
   * when nothing usable is stored. The ask is best-effort — no background
   * listener (extension reload race, serve-mode worker) resolves empty, and
   * the watcher populates rows as soon as a background write lands.
   */
  load(): Promise<readonly KnownConflict[]>;
  /**
   * Subscribe to DB writes arriving over storage.
   *
   * @param onRows Callback with the fresh validated rows, or null when a
   *   write delivered unreadable data (corruption is a degradation, not a
   *   crash — the previous snapshot keeps serving).
   * @returns The unsubscribe handle.
   */
  watch(onRows: (rows: readonly KnownConflict[] | null) => void): () => void;
}

/**
 * Build the module's DB handle over shared storage.
 *
 * @returns The handle; rows start empty.
 */
export function createConflictsDb(): ConflictsDb {
  let rows: readonly KnownConflict[] = [];
  return {
    get rows() {
      return rows;
    },
    async load() {
      const stored = readStoredConflicts(await knownConflictsStore.getValue());
      if (stored !== null) {
        rows = stored;
        return rows;
      }
      log.debug('Conflict database not stored yet — asking the background to provide it');
      try {
        const seeded = parseKnownConflicts(await sendMessage('getKnownConflictsDb'));
        if (seeded !== null) rows = seeded;
      } catch (error) {
        // Expected when the background is not listening yet (reloads, races);
        // stays empty until a storage write (or the next load attempt) lands.
        log.debug(
          'Conflict-database request to the background failed',
          error instanceof Error ? error.message : error
        );
      }
      return rows;
    },
    watch(onRows) {
      // The item's watch rides storage.onChanged, so background writes arrive
      // here without any page reload. Valid writes also adopt themselves into
      // the handle so the module's next scan reads fresh rows.
      return knownConflictsStore.watch((fresh) => {
        const parsed = readStoredConflicts(fresh);
        if (parsed === null) {
          log.warn('Unreadable conflict database received — keeping the previous rows');
        } else {
          rows = parsed;
        }
        onRows(parsed);
      });
    }
  };
}
