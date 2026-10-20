/**
 * Tab-session store over the fake browser: the `session:` area, status
 * resolution (absence = inactive), the concurrent-session cap, corrupt and
 * foreign values, and serialized read-modify-writes.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { activeRecord } from '../messaging/exclusion-session.fixtures';
import type {
  ActiveExclusionSession,
  UnavailableExclusionSession
} from '../messaging/exclusion-session';
import {
  EXCLUSION_SESSIONS_KEY,
  EXCLUSION_SESSION_LIMIT,
  EXCLUSION_WARNING_LIMIT,
  exclusionSessionsStore,
  getExclusionSessionRecords,
  getExclusionSessionStatus,
  parseExclusionSessionRecords,
  putExclusionSessionRecord,
  removeExclusionSessionRecord
} from './exclusion-sessions';

beforeEach(() => {
  fakeBrowser.reset();
});

/** An unavailable record observed at `at`. */
function unavailable(at: number): UnavailableExclusionSession {
  return { state: 'unavailable', cause: 'infobar-cancelled', at };
}

/** An active record started at `startedAt`. */
function active(startedAt: number): ActiveExclusionSession {
  return { ...activeRecord(), startedAt };
}

describe('exclusion-sessions store', () => {
  it('lives in the session area and reports inactive for unknown tabs', async () => {
    expect(EXCLUSION_SESSIONS_KEY.startsWith('session:')).toBe(true);
    expect(await getExclusionSessionStatus(1)).toEqual({ state: 'inactive' });
  });

  it('stores, replaces and removes per tab, in the session area only', async () => {
    expect(await putExclusionSessionRecord(4, activeRecord())).toBe('stored');
    expect(await putExclusionSessionRecord(9, unavailable(5))).toBe('stored');
    expect(await getExclusionSessionStatus(4)).toEqual(activeRecord());
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({});

    expect(await putExclusionSessionRecord(4, unavailable(6))).toBe('stored');
    expect(await getExclusionSessionStatus(4)).toEqual(unavailable(6));

    await removeExclusionSessionRecord(4);
    await removeExclusionSessionRecord(123);
    await removeExclusionSessionRecord(-1);
    expect(await getExclusionSessionStatus(4)).toEqual({ state: 'inactive' });
    expect(Object.keys(await getExclusionSessionRecords())).toEqual(['9']);
  });

  it('resolves a malformed tab id to inactive', async () => {
    await putExclusionSessionRecord(0, activeRecord());
    expect(await getExclusionSessionStatus(0)).toEqual(activeRecord());
    expect(await getExclusionSessionStatus(-1)).toEqual({ state: 'inactive' });
    expect(await getExclusionSessionStatus(0.5)).toEqual({ state: 'inactive' });
  });

  it('refuses a new live session past the cap, never evicting one; replacing still works', async () => {
    for (let tab = 1; tab <= EXCLUSION_SESSION_LIMIT; tab++) {
      expect(await putExclusionSessionRecord(tab, active(tab))).toBe('stored');
    }
    expect(await putExclusionSessionRecord(99, active(99))).toBe('limit-reached');
    expect(await getExclusionSessionStatus(99)).toEqual({ state: 'inactive' });
    expect(await putExclusionSessionRecord(1, active(100))).toBe('stored');
    expect(await getExclusionSessionStatus(1)).toEqual(active(100));
    expect(Object.keys(await getExclusionSessionRecords())).toHaveLength(EXCLUSION_SESSION_LIMIT);
  });

  it('stores the session-limit warning at the live cap; a warning never takes a live slot', async () => {
    for (let tab = 1; tab <= EXCLUSION_SESSION_LIMIT; tab++) {
      await putExclusionSessionRecord(tab, active(tab));
    }
    const warning: UnavailableExclusionSession = {
      state: 'unavailable',
      cause: 'session-limit',
      at: 9
    };
    expect(await putExclusionSessionRecord(99, warning)).toBe('stored');
    expect(await getExclusionSessionStatus(99)).toEqual(warning);
    // The warned tab still cannot go live until a slot frees…
    expect(await putExclusionSessionRecord(99, active(10))).toBe('limit-reached');
    expect(await getExclusionSessionStatus(99)).toEqual(warning);
    // …and turning a live tab into a warning frees one.
    expect(await putExclusionSessionRecord(1, unavailable(11))).toBe('stored');
    expect(await putExclusionSessionRecord(99, active(12))).toBe('stored');
  });

  it('only warnings fill the store: they never block a live session', async () => {
    for (let tab = 1; tab <= EXCLUSION_SESSION_LIMIT * 2; tab++) {
      await putExclusionSessionRecord(tab, unavailable(tab));
    }
    expect(await putExclusionSessionRecord(500, active(1))).toBe('stored');
  });

  it('bounds warnings: past the cap the oldest other warnings go, the new one stays', async () => {
    await putExclusionSessionRecord(1000, active(1));
    for (let tab = 1; tab <= EXCLUSION_WARNING_LIMIT; tab++) {
      await putExclusionSessionRecord(tab, unavailable(100 + tab));
    }
    // Written last but stamped oldest: the just-written record is never the one dropped.
    expect(await putExclusionSessionRecord(999, unavailable(0))).toBe('stored');
    const keys = Object.keys(await getExclusionSessionRecords());
    expect(keys).toHaveLength(EXCLUSION_WARNING_LIMIT + 1);
    expect(keys).toContain('999');
    expect(keys).toContain('1000');
    expect(keys).not.toContain('1');
  });

  it('serializes concurrent writes — no writer reverts another', async () => {
    await Promise.all([
      putExclusionSessionRecord(1, activeRecord()),
      putExclusionSessionRecord(2, unavailable(2)),
      removeExclusionSessionRecord(1),
      putExclusionSessionRecord(3, unavailable(3))
    ]);
    expect(Object.keys(await getExclusionSessionRecords()).sort()).toEqual(['2', '3']);
  });

  it('rejects (never throws synchronously) on a broken caller, before touching storage', async () => {
    let pending: Promise<unknown> | undefined;
    expect(() => {
      pending = putExclusionSessionRecord(-1, activeRecord());
    }).not.toThrow();
    await expect(pending).rejects.toThrow(/tab id/);
    await expect(putExclusionSessionRecord(1.5, activeRecord())).rejects.toThrow(/tab id/);
    await expect(putExclusionSessionRecord(2 ** 60, activeRecord())).rejects.toThrow(/tab id/);
    await expect(
      putExclusionSessionRecord(1, { ...activeRecord(), origin: 'https://a.example/' })
    ).rejects.toThrow(/record guard/);
    expect(await exclusionSessionsStore.getValue()).toEqual({});
  });
});

describe('parseExclusionSessionRecords (corrupt / foreign values)', () => {
  it('rejects non-maps outright; a corrupt stored value degrades to no sessions', async () => {
    for (const input of [null, 'x', 5, []]) {
      expect(parseExclusionSessionRecords(input)).toBeNull();
    }
    await fakeBrowser.storage.session.set({ 'exclusion-sessions': [1, 2] });
    expect(await getExclusionSessionRecords()).toEqual({});
    expect(await getExclusionSessionStatus(1)).toEqual({ state: 'inactive' });
  });

  it('drops non-canonical tab keys and bad records, ignores unknown fields', () => {
    expect(
      parseExclusionSessionRecords({
        '7': { ...activeRecord(), future: 1 },
        '07': activeRecord(),
        '-1': activeRecord(),
        '1.5': activeRecord(),
        '1e+21': activeRecord(),
        '+3': activeRecord(),
        ' 4': activeRecord(),
        '1152921504606846976': activeRecord(),
        tab: activeRecord(),
        '8': { state: 'inactive' },
        '9': { state: 'unavailable', cause: 'nope', at: 1 }
      })
    ).toEqual({ '7': activeRecord() });
  });

  it('keeps the most recent records of each kind past its cap (no writer produces more)', () => {
    const map: Record<string, unknown> = {};
    for (let tab = 1; tab <= EXCLUSION_SESSION_LIMIT + 3; tab++) map[String(tab)] = active(tab);
    for (let tab = 100; tab < 100 + EXCLUSION_WARNING_LIMIT + 3; tab++) {
      map[String(tab)] = unavailable(tab);
    }
    const kept = parseExclusionSessionRecords(map) ?? {};
    const keys = Object.keys(kept);
    expect(keys).toHaveLength(EXCLUSION_SESSION_LIMIT + EXCLUSION_WARNING_LIMIT);
    expect(Object.values(kept).filter((record) => record.state === 'active')).toHaveLength(
      EXCLUSION_SESSION_LIMIT
    );
    expect(keys).toContain(String(EXCLUSION_SESSION_LIMIT + 3));
    expect(keys).not.toContain('1');
    expect(keys).not.toContain('100');
  });
});
