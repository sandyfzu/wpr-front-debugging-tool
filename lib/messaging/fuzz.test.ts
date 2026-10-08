/**
 * Bounded deterministic fuzz over the payload guards: 2,000 mutated real
 * payloads must never throw — a guard's only two outcomes are the rebuilt
 * value or null. A throw would surface as an unhandled rejection on the
 * message path instead of an error state, so the no-throw property is
 * gate-level, not incidental.
 */
import { describe, expect, it } from 'vitest';
import { parseWprDetections } from './validate';
import { validDetections } from './validate.fixtures';

/** Deterministic LCG so every run exercises the exact same mutation set. */
function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Hostile and wrong-shaped values injected into any payload slot. */
const HOSTILE: unknown[] = [
  null,
  undefined,
  NaN,
  Infinity,
  -1,
  1e300,
  'x'.repeat(5000),
  '',
  { __proto__: null },
  Object.create(null),
  new Map(),
  { nested: { deep: { deeper: [1, 2, 3] } } },
  {},
  [],
  ['x', 5, null, {}],
  Symbol('no'),
  true,
  () => 'fn'
];

describe('payload guards — deterministic fuzz', () => {
  it('2,000 mutated payloads parse without throwing', () => {
    const rng = makeRng(42);
    const base = { ...validDetections() };
    const keys = Object.keys(base);
    let accepted = 0;
    for (let i = 0; i < 2000; i++) {
      const payload = structuredClone(base) as Record<string, unknown>;
      const mutations = 1 + Math.floor(rng() * 4);
      for (let m = 0; m < mutations; m++) {
        const key = keys[Math.floor(rng() * keys.length)] as string;
        const race = rng();
        if (race < 0.1) {
          // Replace the whole row.
          payload[key] = HOSTILE[Math.floor(rng() * HOSTILE.length)];
          continue;
        }
        const row = payload[key];
        if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
        const rowRecord = row as Record<string, unknown>;
        const rowKeys = Object.keys(rowRecord);
        if (rowKeys.length === 0) continue;
        const rowKey = rowKeys[Math.floor(rng() * rowKeys.length)] as string;
        if (race < 0.4) {
          // Overwrite a field…
          rowRecord[rowKey] = HOSTILE[Math.floor(rng() * HOSTILE.length)];
        } else if (race < 0.6) {
          // …drop a field…
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the fuzz drops arbitrary keys; a real delete is the mutation under test
          delete rowRecord[rowKey];
        } else {
          // …or inject an unknown one.
          rowRecord[`injected${String(m)}`] = HOSTILE[Math.floor(rng() * HOSTILE.length)];
        }
      }
      // A throw here is the failure (never an accepted corrupt payload).
      accepted += parseWprDetections(payload) !== null ? 1 : 0;
    }
    expect(accepted).toBeGreaterThanOrEqual(0);
  });
});
