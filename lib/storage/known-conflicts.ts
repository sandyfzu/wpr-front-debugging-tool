/**
 * The Known Conflicts database storage contract.
 *
 * The database is a JSON list of rows about plugin/theme/server combos that
 * conflict with WP Rocket. Only the background module reads and writes this
 * store: it seeds from the committed snapshot on an empty storage and
 * refreshes it from the plugin's public endpoint — surfaces get rows through
 * messaging, never through this store (the content-script bundles must stay
 * free of the ~46 KB data file). The seed lives in the known-conflicts
 * module (`../known-conflicts/known-conflicts-db.json`) and is frozen.
 */

import { storage } from 'wxt/utils/storage';
import dbSeed from '../known-conflicts/known-conflicts-db.json';
import { parseKnownConflicts } from '../messaging/validate';

/** One Known Conflicts DB row. Field values mirror the plugin's endpoint. */
export interface KnownConflict {
  /** Stable row UUID. */
  id: string;
  /** Type tag: usually 'Plugin', could be a theme/server variant. */
  type: string;
  /** Human name displayed in conflict UIs; the match key in HS mode. */
  name: string;
  /** Substring identifying the conflicting asset in a plugin path, or null. */
  detection_pattern: string | null;
  /** One-line conflict summary, or null. */
  summary: string | null;
  /** Longer description (often ''; render substitutes the summary). */
  issue_description: string;
  /** Supporting article URL. */
  url: string;
}

/** Metadata tracked alongside the DB value (`storage meta`). */
export type KnownConflictsMeta = {
  /** Timestamp of the last completed fetch; absent when never fetched. */
  updatedAt?: number;
};

/** Freeze the committed seed so a mutating consumer cannot corrupt it for everyone. */
const TYPED_SEED: readonly KnownConflict[] = Object.freeze(
  (dbSeed as KnownConflict[]).map((row) => Object.freeze({ ...row }))
);

/** The `local:known-conflicts-db` store, seeded with the committed snapshot. */
export const knownConflictsStore = storage.defineItem<KnownConflict[], KnownConflictsMeta>(
  'local:known-conflicts-db',
  {
    fallback: TYPED_SEED as KnownConflict[]
  }
);

/** Row count of the committed snapshot (pinned to exactly 137 by a unit test). */
export const KNOWN_CONFLICTS_SEED_LENGTH = TYPED_SEED.length;

/**
 * Read the conflict rows through the validator: a corrupted storage value
 * (partial write, foreign data) degrades to the committed seed instead of
 * reaching matchers with wrong-typed rows.
 *
 * @returns Validated rows — never null (the seed is the floor).
 */
export async function getKnownConflicts(): Promise<KnownConflict[]> {
  const raw = await knownConflictsStore.getValue();
  const validated = parseKnownConflicts(raw);
  return validated ?? [...TYPED_SEED];
}
