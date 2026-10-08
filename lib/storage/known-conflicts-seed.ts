/**
 * The committed Known Conflicts snapshot: frozen, typed rows over the one
 * shared data file (`../known-conflicts/known-conflicts-db.json`).
 *
 * The runtime seed path is the background's bundled asset of that same file;
 * this module is the in-memory view for tests and future consumers that need
 * the rows directly. It never re-declares the data — editing the JSON file is
 * the only way to change the snapshot.
 */

import dbSeed from '../known-conflicts/known-conflicts-db.json';
import { parseKnownConflicts } from '../messaging/validate';
import type { KnownConflict } from './known-conflicts';

/**
 * Validate and freeze the committed snapshot at import time — loudly, not
 * through an unchecked cast: a shape-broken data file (bad merge, bad edit)
 * must crash at import, never silently hand wrong-typed rows to any consumer.
 * A mutating consumer also cannot corrupt the shared view for everyone.
 */
const typedSeed = parseKnownConflicts(dbSeed);
if (!typedSeed) {
  throw new Error(
    '[WPR FDT] The committed Known Conflicts snapshot failed shape validation: fix lib/known-conflicts/known-conflicts-db.json.'
  );
}
const TYPED_SEED: readonly KnownConflict[] = Object.freeze(
  typedSeed.map((row) => Object.freeze({ ...row }))
);

/** Row count of the committed snapshot (pinned to exactly 175 by a unit test). */
export const KNOWN_CONFLICTS_SEED_LENGTH = TYPED_SEED.length;

/** The frozen committed rows, DB order preserved. */
export function getKnownConflictsSeed(): readonly KnownConflict[] {
  return TYPED_SEED;
}
