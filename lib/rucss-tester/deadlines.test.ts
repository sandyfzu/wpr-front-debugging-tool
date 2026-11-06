/** RUCSS test deadlines: each waiting side outlasts the side it waits on; the run's worst case. */
import { describe, expect, it } from 'vitest';
import {
  RUCSS_APPLY_DEADLINE_MS,
  RUCSS_BUILD_TIMEOUT_MS,
  RUCSS_FETCH_ASK_DEADLINE_MS,
  RUCSS_FETCH_TIMEOUT_MS,
  RUCSS_RUN_WORST_CASE_MS,
  RUCSS_SNAPSHOT_TTL_MS,
  RUCSS_START_DEADLINE_MS
} from './deadlines';

describe('RUCSS deadlines', () => {
  it('nest: every waiting side outlasts the one it waits on', () => {
    expect(RUCSS_FETCH_ASK_DEADLINE_MS).toBeGreaterThan(RUCSS_FETCH_TIMEOUT_MS);
    expect(RUCSS_START_DEADLINE_MS).toBeGreaterThan(RUCSS_FETCH_ASK_DEADLINE_MS);
    expect(RUCSS_SNAPSHOT_TTL_MS).toBeGreaterThan(RUCSS_BUILD_TIMEOUT_MS + RUCSS_APPLY_DEADLINE_MS);
  });

  it('bounds a whole run by its three sequential steps (55 s today)', () => {
    expect(RUCSS_RUN_WORST_CASE_MS).toBe(
      RUCSS_START_DEADLINE_MS + RUCSS_BUILD_TIMEOUT_MS + RUCSS_APPLY_DEADLINE_MS
    );
    expect(RUCSS_RUN_WORST_CASE_MS).toBe(55_000);
  });
});
