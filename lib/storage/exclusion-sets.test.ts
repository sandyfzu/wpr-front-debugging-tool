/**
 * Per-origin exclusion-set store over the fake browser: the `local:` area,
 * validated and tolerant reads, corrupt/absent degradation, the byte
 * budget's eviction order, and serialized read-modify-writes.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_EXCLUSION_SET } from '../exclusion-builder/set';
import { EXCLUSION_SET_LIMITS } from '../messaging/exclusion-session';
import { validSet } from '../messaging/exclusion-session.fixtures';
import {
  EXCLUSION_SETS_BYTE_BUDGET,
  EXCLUSION_SETS_KEY,
  exclusionSetsStore,
  getSavedExclusionSet,
  getSavedExclusionSets,
  parseSavedExclusionSets,
  removeSavedExclusionSet,
  saveExclusionSet
} from './exclusion-sets';

beforeEach(() => {
  fakeBrowser.reset();
});

/** A set at the whole-set character cap (the heaviest a guard accepts, ASCII). */
function heavySet(): typeof EMPTY_EXCLUSION_SET {
  const row = 'x'.repeat(EXCLUSION_SET_LIMITS.rowChars);
  const perList = EXCLUSION_SET_LIMITS.totalChars / EXCLUSION_SET_LIMITS.rowChars / 4;
  const full = Array.from({ length: perList }, () => row);
  return {
    rows: { delayJs: full, deferJs: full, lazyload: full, lazyRender: full },
    disable: EMPTY_EXCLUSION_SET.disable
  };
}

describe('exclusion-sets store', () => {
  it('lives in the local area (never synced) and starts empty', async () => {
    expect(EXCLUSION_SETS_KEY.startsWith('local:')).toBe(true);
    expect(await getSavedExclusionSets()).toEqual({});
    expect(await getSavedExclusionSet('https://example.com')).toBeNull();
  });

  it('saves, reads back and forgets one origin, leaving the others', async () => {
    await saveExclusionSet('https://a.example', validSet(), 10);
    await saveExclusionSet('http://127.0.0.1:8493', EMPTY_EXCLUSION_SET, 20);
    expect(await getSavedExclusionSet('https://a.example')).toEqual(validSet());
    expect(await fakeBrowser.storage.local.get('exclusion-sets')).toEqual({
      'exclusion-sets': {
        'https://a.example': { set: validSet(), updatedAt: 10 },
        'http://127.0.0.1:8493': { set: EMPTY_EXCLUSION_SET, updatedAt: 20 }
      }
    });
    await removeSavedExclusionSet('https://a.example');
    await removeSavedExclusionSet('https://never-saved.example');
    expect(await getSavedExclusionSets()).toEqual({
      'http://127.0.0.1:8493': { set: EMPTY_EXCLUSION_SET, updatedAt: 20 }
    });
  });

  it('does not resolve inherited names as origins', async () => {
    expect(await getSavedExclusionSet('toString')).toBeNull();
    expect(await getSavedExclusionSet('__proto__')).toBeNull();
  });

  it('serializes concurrent saves — no writer reverts another', async () => {
    await Promise.all([
      saveExclusionSet('https://a.example', validSet(), 1),
      saveExclusionSet('https://b.example', validSet(), 2),
      saveExclusionSet('https://c.example', validSet(), 3),
      removeSavedExclusionSet('https://a.example')
    ]);
    expect(Object.keys(await getSavedExclusionSets())).toEqual([
      'https://b.example',
      'https://c.example'
    ]);
  });

  it('rejects (never throws synchronously) on a broken caller, before touching storage', async () => {
    let pending: Promise<unknown> | undefined;
    expect(() => {
      pending = saveExclusionSet('https://a.example/', validSet());
    }).not.toThrow();
    await expect(pending).rejects.toThrow(/canonical/);
    await expect(
      saveExclusionSet('https://a.example', { ...validSet(), extra: 1 } as never)
    ).rejects.toThrow(/guard/);
    expect(await exclusionSetsStore.getValue()).toEqual({});
  });

  it('propagates a storage write rejection to the caller and keeps the queue flowing', async () => {
    const original = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
    fakeBrowser.storage.local.set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
    await expect(saveExclusionSet('https://a.example', validSet(), 1)).rejects.toThrow(/QUOTA/);
    fakeBrowser.storage.local.set = original;
    await saveExclusionSet('https://b.example', validSet(), 2);
    expect(Object.keys(await getSavedExclusionSets())).toEqual(['https://b.example']);
  });
});

describe('parseSavedExclusionSets (corrupt / foreign values)', () => {
  it('rejects non-maps outright', () => {
    for (const input of [null, undefined, 'x', 5, []]) {
      expect(parseSavedExclusionSets(input)).toBeNull();
    }
  });

  it('degrades a non-map stored value to no saved sets', async () => {
    await fakeBrowser.storage.local.set({ 'exclusion-sets': 'corrupted' });
    expect(await getSavedExclusionSets()).toEqual({});
  });

  it('drops bad keys and bad entries, keeps good ones, ignores unknown entry fields', () => {
    const good = { set: validSet(), updatedAt: 5 };
    expect(
      parseSavedExclusionSets({
        'https://good.example': { ...good, pinned: true },
        'https://good.example/path': good,
        'file:///x': good,
        'https://no-stamp.example': { set: validSet() },
        'https://neg-stamp.example': { set: validSet(), updatedAt: -1 },
        'https://float-stamp.example': { set: validSet(), updatedAt: 1.5 },
        'https://bad-set.example': { set: { rows: {} }, updatedAt: 1 },
        'https://not-object.example': 'set'
      })
    ).toEqual({ 'https://good.example': good });
  });

  it('reads a newer build’s set with unknown keys (tolerant), dropping them', () => {
    const set = { ...validSet(), mode: 'v2', rows: { ...validSet().rows, iframes: ['x'] } };
    expect(parseSavedExclusionSets({ 'https://a.example': { set, updatedAt: 1 } })).toEqual({
      'https://a.example': { set: validSet(), updatedAt: 1 }
    });
  });
});

describe('byte budget', () => {
  it('a worst-case set alone fits many times over', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ set: heavySet(), updatedAt: 1 }));
    expect(bytes.length * 20).toBeLessThan(EXCLUSION_SETS_BYTE_BUDGET);
  });

  it('evicts the least recently updated origins first, never the one just saved', async () => {
    // ~66 KiB per heavy set → the budget holds ~63; write 70 with rising stamps.
    const map: Record<string, unknown> = {};
    for (let index = 0; index < 70; index++) {
      map[`https://site${String(index)}.example`] = { set: heavySet(), updatedAt: 100 + index };
    }
    await fakeBrowser.storage.local.set({ 'exclusion-sets': map });
    const read = await getSavedExclusionSets();
    const kept = Object.keys(read);
    expect(kept.length).toBeLessThan(70);
    expect(kept).not.toContain('https://site0.example');
    expect(kept).toContain('https://site69.example');
    const json = JSON.stringify({ 'exclusion-sets': read });
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(EXCLUSION_SETS_BYTE_BUDGET);

    // A save with an older clock than every survivor is still kept.
    const written = await saveExclusionSet('https://late.example', heavySet(), 0);
    expect(Object.keys(written)).toContain('https://late.example');
    expect(
      new TextEncoder().encode(JSON.stringify({ 'exclusion-sets': written })).length
    ).toBeLessThanOrEqual(EXCLUSION_SETS_BYTE_BUDGET);
  });
});
