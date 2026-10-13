/**
 * The inspector-origin store: validator matrix, cap eviction, the
 * corrupt-storage degradations, and the toggle's read-modify-write
 * (the one toggling semantics the context-menu row and the later
 * popup/Detections/options rows all share).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  INSPECTOR_ORIGINS_CAP,
  getInspectorOrigins,
  inspectorOriginsStore,
  isInspectorOriginEnabled,
  originEnabled,
  parseInspectorOrigins,
  toggleInspectorOrigin
} from './inspector-origins';

const VALID = { 'https://example.com': { enabled: true } };

beforeEach(() => {
  fakeBrowser.reset();
});

describe('parseInspectorOrigins', () => {
  it('validates a well-formed map and its entries', () => {
    expect(
      parseInspectorOrigins({
        'https://a.com': { enabled: true },
        'http://127.0.0.1:8493': { enabled: false }
      })
    ).toEqual({
      'https://a.com': { enabled: true },
      'http://127.0.0.1:8493': { enabled: false }
    });
  });

  it('rejects non-map values wholesale (arrays, scalars, null)', () => {
    for (const rejected of [null, 'x', 42, [], true]) {
      expect(parseInspectorOrigins(rejected)).toBeNull();
    }
  });

  it('drops wrong-shaped entries, not the whole map', () => {
    expect(
      parseInspectorOrigins({
        'https://a.com': { enabled: true },
        'https://b.com': { enabled: 'yes' },
        'https://c.com': 'nope',
        '': { enabled: true },
        'https://d.com': null
      })
    ).toEqual({ 'https://a.com': { enabled: true } });
  });

  it('caps the map, evicting the oldest-inserted rows', () => {
    const map: Record<string, { enabled: boolean }> = {};
    for (let i = 0; i < INSPECTOR_ORIGINS_CAP + 10; i += 1) {
      map[`https://${String(i)}.test`] = { enabled: true };
    }
    const capped = parseInspectorOrigins(map);
    expect(capped && Object.keys(capped)).toHaveLength(INSPECTOR_ORIGINS_CAP);
    // The evicted rows are the INSERTION-ORDER oldest (a stable snapshot,
    // not the re-indexed live list — the mutation-during-delete lesson).
    expect(capped?.['https://0.test']).toBeUndefined();
    expect(capped?.['https://9.test']).toBeUndefined();
    expect(capped?.['https://10.test']).toEqual({ enabled: true });
    expect(capped?.[`https://${String(INSPECTOR_ORIGINS_CAP + 9)}.test`]).toEqual({
      enabled: true
    });
  });
});

describe('getInspectorOrigins with corrupt storage', () => {
  it('fresh storage reads empty', async () => {
    expect(await getInspectorOrigins()).toEqual({});
    expect(await inspectorOriginsStore.getValue()).toEqual({});
  });

  it('a corrupt value degrades to empty (the widget stays hidden, the safe default)', async () => {
    await fakeBrowser.storage.sync.set({ 'inspector-origins': 'corrupted' });
    expect(await getInspectorOrigins()).toEqual({});
    expect(await isInspectorOriginEnabled('https://example.com')).toBe(false);
    await fakeBrowser.storage.sync.set({ 'inspector-origins': ['not-a-map'] });
    expect(await getInspectorOrigins()).toEqual({});
    // A wrong-shaped ENTRY is dropped; a valid-looking one survives (the
    // validator's floor is a non-empty key with a boolean entry — keys are
    // `new URL().origin` strings from producers, never re-validated further).
    await fakeBrowser.storage.sync.set({ 'inspector-origins': { a: { enabled: true } } });
    expect(await getInspectorOrigins()).toEqual({ a: { enabled: true } });
  });

  it('round-trips valid writes', async () => {
    await inspectorOriginsStore.setValue({
      'https://example.com': { enabled: true },
      'http://127.0.0.1:8493': { enabled: false }
    });
    expect(await getInspectorOrigins()).toEqual({
      'https://example.com': { enabled: true },
      'http://127.0.0.1:8493': { enabled: false }
    });
  });
});

describe('originEnabled / isInspectorOriginEnabled', () => {
  it('defaults disabled; enabled only for an explicit enabled entry', () => {
    expect(originEnabled({}, 'https://example.com')).toBe(false);
    expect(originEnabled(VALID, 'https://example.com')).toBe(true);
    expect(originEnabled(VALID, 'https://other.com')).toBe(false);
  });

  it('reads the stored map per origin', async () => {
    await inspectorOriginsStore.setValue({ 'https://example.com': { enabled: true } });
    expect(await isInspectorOriginEnabled('https://example.com')).toBe(true);
    expect(await isInspectorOriginEnabled('https://other.com')).toBe(false);
  });
});

describe('toggleInspectorOrigin (the shared toggle semantics)', () => {
  it('flips an unknown origin to enabled and persists exactly one entry', async () => {
    expect(await toggleInspectorOrigin('https://example.com')).toBe(true);
    expect(await getInspectorOrigins()).toEqual({ 'https://example.com': { enabled: true } });
  });

  it('cycles: on → off → on', async () => {
    expect(await toggleInspectorOrigin('https://example.com')).toBe(true);
    expect(await toggleInspectorOrigin('https://example.com')).toBe(false);
    expect(await toggleInspectorOrigin('https://example.com')).toBe(true);
    expect(await getInspectorOrigins()).toEqual({ 'https://example.com': { enabled: true } });
  });

  it('preserves every sibling origin while the map stays under the cap', async () => {
    const seeded: Record<string, { enabled: boolean }> = {
      'https://a.com': { enabled: true },
      'https://b.com': { enabled: false }
    };
    // One slot below the cap: the toggle's new entry completes it, evicting
    // nothing.
    for (let i = 0; i < INSPECTOR_ORIGINS_CAP - 3; i += 1) {
      seeded[`https://filler-${String(i)}.test`] = { enabled: i === 0 };
    }
    await inspectorOriginsStore.setValue(seeded);
    expect(await toggleInspectorOrigin('https://new.com')).toBe(true);
    const stored = await getInspectorOrigins();
    expect(Object.keys(stored)).toHaveLength(INSPECTOR_ORIGINS_CAP);
    expect(stored['https://new.com']?.enabled).toBe(true);
    expect(stored['https://a.com']).toEqual({ enabled: true });
    expect(stored['https://b.com']).toEqual({ enabled: false });
    expect(stored['https://filler-0.test']).toEqual({ enabled: true });
  });

  it('re-applies the cap on write: the inserted-order oldest rows evict', async () => {
    const seeded: Record<string, { enabled: boolean }> = {
      'https://a.com': { enabled: true },
      'https://b.com': { enabled: false }
    };
    // Two slots over the cap: the toggle's write must evict the two oldest.
    for (let i = 0; i < INSPECTOR_ORIGINS_CAP - 1; i += 1) {
      seeded[`https://filler-${String(i)}.test`] = { enabled: true };
    }
    await inspectorOriginsStore.setValue(seeded);
    expect(await toggleInspectorOrigin('https://new.com')).toBe(true);
    const stored = await getInspectorOrigins();
    expect(Object.keys(stored)).toHaveLength(INSPECTOR_ORIGINS_CAP);
    // The two oldest rows (a, b) evicted; the cap stays closed.
    expect(stored['https://a.com']).toBeUndefined();
    expect(stored['https://b.com']).toBeUndefined();
    expect(stored['https://new.com']?.enabled).toBe(true);
  });

  it('toggling over corrupt storage writes the fresh valid map (self-healing)', async () => {
    await fakeBrowser.storage.sync.set({ 'inspector-origins': 'corrupted' });
    expect(await toggleInspectorOrigin('https://example.com')).toBe(true);
    expect(await getInspectorOrigins()).toEqual({ 'https://example.com': { enabled: true } });
  });
});
