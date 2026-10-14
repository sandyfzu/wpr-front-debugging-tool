/**
 * The inspector-origin store: validator matrix, the serialized-byte bound
 * (the sync platform's real quota — the audit round's replacement for the
 * untestable count cap), the corrupt-storage degradations, and the toggle's
 * read-modify-write (the one toggling semantics every writer shares).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  INSPECTOR_ORIGINS_BYTE_BUDGET,
  INSPECTOR_ORIGINS_KEY,
  INSPECTOR_ORIGINS_QUOTA_LIMIT,
  getInspectorOrigins,
  inspectorOriginsStore,
  isInspectorOriginEnabled,
  originEnabled,
  parseInspectorOrigins,
  toggleInspectorOrigin
} from './inspector-origins';

const VALID = { 'https://example.com': { enabled: true } };

/** The serialized item's real length: the key + the map's JSON. */
const serialized = (origins: unknown): number =>
  INSPECTOR_ORIGINS_KEY.length + 2 + 1 + JSON.stringify(origins).length;

/**
 * The audit pin's worst-possible corpus: the longest origins a real page can
 * produce — an IDNA-safe 253-character host (the platform's own limit).
 * `new URL().origin` can never hand out longer keys. The index is carried by
 * the host's leading digits so every key stays 253-hosted and distinct.
 */
function longOrigin(index: number): string {
  const host = `${String(1_000_000 + index)}${'a'.repeat(246)}`; // 253 hosts, distinct
  return `https://${host}`;
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('the byte bound vs the sync quota (audit pin)', () => {
  it("the budget keeps the serialized item inside the platform's 8192 per-item quota", () => {
    expect(INSPECTOR_ORIGINS_QUOTA_LIMIT).toBe(8192);
    // Even a FULL budget's JSON + the key overhead stays inside the quota.
    const full = `x`.repeat(INSPECTOR_ORIGINS_BYTE_BUDGET);
    expect(serialized(full)).toBeLessThanOrEqual(8192);
  });

  it('a worst-case corpus of the longest realistic origins truncates to the bound', () => {
    // 200 × 253-char origins serialize to ~28 KB — the old count cap's
    // proved failure (a rejected write no test could see under fake storage).
    const corpus: Record<string, { enabled: boolean }> = {};
    for (let i = 0; i < 200; i += 1) {
      corpus[longOrigin(i)] = { enabled: true };
    }
    expect(JSON.stringify(corpus).length).toBeGreaterThan(INSPECTOR_ORIGINS_QUOTA_LIMIT);
    const parsed = parseInspectorOrigins(corpus);
    expect(parsed && serialized(parsed)).toBeLessThanOrEqual(INSPECTOR_ORIGINS_QUOTA_LIMIT);
    // The survivors are the most-recent (oldest evicted first).
    expect(parsed?.[longOrigin(0)]).toBeUndefined();
    const keptLast = parsed ? Object.keys(parsed).some((k) => k === longOrigin(199)) : false;
    expect(keptLast, 'the newest row survives the trim of the worst-case corpus').toBe(true);
  });

  it('a comfortable middle corpus does not get trimmed at all', () => {
    const corpus: Record<string, { enabled: boolean }> = {};
    for (let i = 0; i < 20; i += 1) {
      corpus[`https://example-${String(i)}.test`] = { enabled: true };
    }
    expect(JSON.stringify(corpus).length).toBeLessThan(INSPECTOR_ORIGINS_QUOTA_LIMIT);
    expect(parseInspectorOrigins(corpus)).toEqual(corpus);
  });
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

  it('preserves every sibling origin while the map stays under the bound', async () => {
    // The one-slot-below-the-bound shape: the toggle's new entry completes it,
    // evicting nothing.
    const seeded: Record<string, { enabled: boolean }> = {
      'https://a.com': { enabled: true },
      'https://b.com': { enabled: false }
    };
    for (let i = 0; i < 100; i += 1) {
      seeded[`https://filler-${String(i)}.example.com`] = { enabled: i === 0 };
    }
    await inspectorOriginsStore.setValue(seeded);
    expect(await toggleInspectorOrigin('https://new.example.com')).toBe(true);
    const stored = await getInspectorOrigins();
    expect(stored['https://new.example.com']?.enabled).toBe(true);
    expect(stored['https://a.com']).toEqual({ enabled: true });
    expect(stored['https://b.com']).toEqual({ enabled: false });
    expect(stored['https://filler-0.example.com']).toEqual({ enabled: true });
    // And the bound was never crossed by the toggle's own write.
    expect(serialized(stored) <= INSPECTOR_ORIGINS_QUOTA_LIMIT).toBe(true);
  });

  it('a print-cap toggle keeps the map under the platform quota (end-to-end bound)', async () => {
    // Right-click many long-origin sites in a row: every write evicts the
    // oldest so the toggle never lands a map the platform would reject —
    // the audited dead-right-click case, now closed at the source.
    for (let i = 0; i < 120; i += 1) {
      const state = await toggleInspectorOrigin(longOrigin(i));
      expect(state, `toggle ${String(i)} persists truthfully`).toBe(true);
    }
    const stored = await getInspectorOrigins();
    expect(serialized(stored)).toBeLessThanOrEqual(INSPECTOR_ORIGINS_QUOTA_LIMIT);
    expect(stored[longOrigin(119)]?.enabled).toBe(true);
    // Budget sanity for an audit-time reference: the persisted map carries
    // nowhere near the count cap the old logic pretended to enforce.
    expect(Object.keys(stored).length).toBeGreaterThan(10);
    expect(Object.keys(stored).length).toBeLessThan(200);
  });

  it('toggling over corrupt storage writes the fresh valid map (self-healing)', async () => {
    await fakeBrowser.storage.sync.set({ 'inspector-origins': 'corrupted' });
    expect(await toggleInspectorOrigin('https://example.com')).toBe(true);
    expect(await getInspectorOrigins()).toEqual({ 'https://example.com': { enabled: true } });
  });
});
