/**
 * The Known Conflicts database storage contract.
 *
 * The database is a JSON list of rows about plugin/theme/server combos that
 * conflict with WP Rocket. The background module is the only writer: it seeds
 * the store on first install from the snapshot bundled in its own surface and
 * refreshes it from the plugin's public endpoint — every other surface gets
 * rows through messaging (`getKnownConflictsDb`) and must never import the
 * ~77 KB data file. Two consequences by design:
 *
 * - **Seeding is explicit, never a fallback.** A fallback on the item would
 *   bake the seed JSON into every importing bundle, so an unset value reads
 *   `null` and callers distinguish "not bootstrapped yet" from "no rows".
 * - **Whoever writes rows owns metadata:** the background stamps a successful
 *   fetch time (`updatedAt`); storage written without it is a seeded snapshot
 *   waiting for freshness.
 *
 * Reads are validated, not trusted: like every storage value, rows may be
 * corrupt (partial writes, foreign data) and are checked wholesale.
 */

import { storage } from 'wxt/utils/storage';
import { parseKnownConflicts } from '../messaging/validate';

/** The `local:known-conflicts-db` store key, single-sourced for every user. */
export const KNOWN_CONFLICTS_DB_KEY = 'local:known-conflicts-db';

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

/**
 * The `local:known-conflicts-db` store. Holds whatever the background last
 * wrote — fetched rows (with `updatedAt` meta) or seeded snapshot rows
 * (without it) — and is unreadable-empty until the background first writes.
 */
export const knownConflictsStore = storage.defineItem<KnownConflict[], KnownConflictsMeta>(
  KNOWN_CONFLICTS_DB_KEY
);

/**
 * Read the conflict rows through the validator so corrupted or wrong-shaped
 * storage values (partial writes, foreign data) are rejected wholesale
 * instead of reaching matchers with unusable rows.
 *
 * @returns The validated rows, or null when no usable value is stored —
 *   callers without a row-producing fallback (every surface except the
 *   background) must treat null as "ask the background", not "no conflicts".
 */
export async function getKnownConflicts(): Promise<KnownConflict[] | null> {
  const raw = await knownConflictsStore.getValue();
  return parseKnownConflicts(raw);
}
