/**
 * The saved set's optional simulation over the fake browser: round trip,
 * old entries unchanged, the contradictory stored pair read as the set
 * alone (logged), malformed or newer-build specs dropped with the set kept,
 * and the save guard refusing what it must never write.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { validSet } from '../messaging/exclusion-session.fixtures';
import { delaySimulate } from '../messaging/exclusion-simulation.fixtures';
import {
  exclusionSetsStore,
  getSavedExclusionEntry,
  getSavedExclusionSet,
  parseSavedExclusionSets,
  saveExclusionSet
} from './exclusion-sets';

const ORIGIN = 'https://example.com';

/** The fixture set with Delay JS disabled. */
function delayDisabledSet(): ReturnType<typeof validSet> {
  const set = validSet();
  return { ...set, disable: { ...set.disable, delayJs: true } };
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  fakeBrowser.reset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('saved simulation', () => {
  it('round-trips beside the set; the set reader is unchanged', async () => {
    await saveExclusionSet(ORIGIN, validSet(), 7, delaySimulate());
    expect(await getSavedExclusionEntry(ORIGIN)).toEqual({
      set: validSet(),
      simulate: delaySimulate(),
      updatedAt: 7
    });
    expect(await getSavedExclusionSet(ORIGIN)).toEqual(validSet());
    expect(await getSavedExclusionEntry('https://other.example')).toBeNull();
  });

  it('a save without a spec replaces the whole entry (the old spec does not survive)', async () => {
    await saveExclusionSet(ORIGIN, validSet(), 7, delaySimulate());
    await saveExclusionSet(ORIGIN, validSet(), 8);
    const entry = await getSavedExclusionEntry(ORIGIN);
    expect(entry).toEqual({ set: validSet(), updatedAt: 8 });
    expect(entry !== null && 'simulate' in entry).toBe(false);
  });

  it('reads an old entry (no spec) exactly as before', () => {
    const old = { [ORIGIN]: { set: validSet(), updatedAt: 3 } };
    expect(parseSavedExclusionSets(old)).toEqual(old);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads a stored contradictory pair as the set alone, logged', () => {
    const stored = {
      [ORIGIN]: { set: delayDisabledSet(), simulate: delaySimulate(), updatedAt: 3 }
    };
    expect(parseSavedExclusionSets(stored)).toEqual({
      [ORIGIN]: { set: delayDisabledSet(), updatedAt: 3 }
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain(ORIGIN);
  });

  it('logs a dropped spec once per origin, however many reads see it', () => {
    const origin = 'https://warn-once.example';
    const other = 'https://warn-once-other.example';
    const stored = {
      [origin]: { set: delayDisabledSet(), simulate: delaySimulate(), updatedAt: 3 },
      [other]: { set: validSet(), simulate: { features: [] }, updatedAt: 4 }
    };
    for (let read = 0; read < 3; read++) parseSavedExclusionSets(stored);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining(origin),
      expect.stringContaining(other)
    ]);
  });

  it('drops a malformed or newer-build spec, keeps the set; tolerates unknown spec keys', () => {
    for (const simulate of [null, {}, { features: ['lazyload_simulated'] }, { features: [] }]) {
      expect(
        parseSavedExclusionSets({ [ORIGIN]: { set: validSet(), simulate, updatedAt: 1 } })
      ).toEqual({
        [ORIGIN]: { set: validSet(), updatedAt: 1 }
      });
    }
    const extra = { features: ['delay_js'], next: true };
    expect(
      parseSavedExclusionSets({ [ORIGIN]: { set: validSet(), simulate: extra, updatedAt: 1 } })
    ).toEqual({ [ORIGIN]: { set: validSet(), simulate: delaySimulate(), updatedAt: 1 } });
  });

  it('refuses to save a contradictory pair or a malformed spec, touching nothing', async () => {
    await expect(saveExclusionSet(ORIGIN, delayDisabledSet(), 1, delaySimulate())).rejects.toThrow(
      /simulates a feature the set disables/
    );
    await expect(saveExclusionSet(ORIGIN, validSet(), 1, { features: [] })).rejects.toThrow(
      /fails its guard/
    );
    expect(await exclusionSetsStore.getValue()).toEqual({});
  });
});
