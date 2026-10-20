/**
 * Bounded deterministic fuzz over the payload guards: 2,000 seeded mutations
 * of real payloads, plus an exhaustive sweep putting every hostile value in
 * every detections slot, must never throw — a guard's only two outcomes are
 * the rebuilt value or null. A throw would surface as an unhandled rejection
 * on the message path instead of an error state, so the no-throw property is
 * gate-level, not incidental. The sweep also checks every accepted output:
 * no array in it may hold a hole or `undefined` (a guard that skipped a hole
 * would copy it through).
 */
import { describe, expect, it } from 'vitest';
import { parseWprDetections } from './validate';
import { validDetections } from './validate.fixtures';
import {
  parseExclusionSetPayload,
  parseExclusionSessionRecord,
  parseExclusionSessionStatus,
  parseExclusionSessionTabStatus
} from './exclusion-session';
import { activeRecord, validSet } from './exclusion-session.fixtures';

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
  // A leading hole before a valid string (structured clone keeps holes):
  // the hole is the value under test.
  [, 'https://s.com/x'],
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

  it('every path × every hostile value: no throw, no hole in an accepted output', () => {
    // The random run samples; this sweep guarantees each slot meets each
    // hostile shape at least once (e.g. a hole inside every string list).
    const paths = pathsOf(validDetections());
    expect(paths.length).toBeGreaterThan(50);
    for (const path of paths) {
      for (const [index, hostile] of HOSTILE.entries()) {
        const payload = structuredClone(validDetections());
        setAt(payload, path, hostile);
        const label = `${path.join('.')} ← HOSTILE[${String(index)}]`;
        let parsed: unknown = null;
        expect(() => (parsed = parseWprDetections(payload)), label).not.toThrow();
        expect(holeyArrayPath(parsed), label).toBeNull();
      }
    }
  });
});

/**
 * Every key path in a plain JSON tree, parents before children (array
 * indices included), so a sweep can replace any slot.
 */
function pathsOf(node: unknown, prefix: readonly string[] = []): string[][] {
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, child]) => {
    const path = [...prefix, key];
    return [path, ...pathsOf(child, path)];
  });
}

/**
 * The path of the first array in `node` with a hole or an `undefined`
 * member, or null when there is none — guard output is plain data, so either
 * means a member that was never validated.
 */
function holeyArrayPath(node: unknown, path = '$'): string | null {
  if (node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      if (!(index in node) || node[index] === undefined) return `${path}[${String(index)}]`;
    }
  }
  for (const [key, child] of Object.entries(node)) {
    const found = holeyArrayPath(child, `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}

/** Replace the slot at `path` (which {@link pathsOf} produced for this tree). */
function setAt(root: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = root;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
  node[path[path.length - 1] as string] = value;
}

/**
 * The session block's hostile values: the shared set plus the shapes the
 * session guards must reject inside row lists and texts — a sparse array
 * (holes skip `every`), a lone surrogate, and a control character.
 */
const SESSION_HOSTILE: unknown[] = [
  ...HOSTILE,
  // The hole is the value under test.
  ['a', , 'b'],
  'bad\uD800half',
  'ctl\u0007char'
];

/** The prefix of keys the fuzz injects (never a key any guard knows). */
const INJECTED = 'injected';

/**
 * Overwrite, drop or inject one key at a random depth of a plain JSON tree —
 * the session payloads nest deeper than the detections rows, so the walk
 * descends until it picks a level.
 */
function mutateDeep(root: Record<string, unknown>, rng: () => number, tag: number): void {
  const pick = (): unknown => SESSION_HOSTILE[Math.floor(rng() * SESSION_HOSTILE.length)];
  // Arrays index by string keys too — one record view walks both.
  let node: Record<string, unknown> = root;
  for (;;) {
    const keys = Object.keys(node);
    if (keys.length === 0) return;
    const key = keys[Math.floor(rng() * keys.length)] as string;
    const child = node[key];
    if (child !== null && typeof child === 'object' && rng() < 0.6) {
      node = child as Record<string, unknown>;
      continue;
    }
    const race = rng();
    const target = node;
    if (race < 0.5) target[key] = pick();
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the fuzz drops arbitrary keys; a real delete is the mutation under test
    else if (race < 0.75) delete target[key];
    else target[`${INJECTED}${String(tag)}`] = pick();
    return;
  }
}

/**
 * Whether an injected key survives on a non-array object of the tree — a
 * key every `'reject'` guard must refuse (array extras are not entries, so
 * guards rightly never see them).
 */
function hasInjectedKey(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (!Array.isArray(value) && Object.keys(record).some((key) => key.startsWith(INJECTED))) {
    return true;
  }
  return Object.values(record).some((child) => hasInjectedKey(child, seen));
}

describe('exclusion-session guards — deterministic fuzz', () => {
  /** One base payload and the `'reject'` guard of its shape. */
  interface FuzzCase {
    readonly base: () => Record<string, unknown>;
    readonly parse: (input: unknown) => unknown;
  }

  const cases: readonly FuzzCase[] = [
    { base: () => ({ set: validSet() }), parse: parseExclusionSetPayload },
    { base: () => ({ ...activeRecord() }), parse: parseExclusionSessionStatus },
    { base: () => ({ tabId: 4, status: activeRecord() }), parse: parseExclusionSessionTabStatus },
    {
      base: () => ({ state: 'unavailable', cause: 'detached', at: 1 }),
      parse: parseExclusionSessionStatus
    }
  ];

  it('2,000 mutated payloads: never throw, refuse injected keys, accepted values round-trip', () => {
    const rng = makeRng(7);
    let accepted = 0;
    let refusedInjections = 0;
    for (let i = 0; i < 2000; i++) {
      const { base, parse } = cases[i % cases.length] as FuzzCase;
      const payload = structuredClone(base());
      const mutations = 1 + Math.floor(rng() * 3);
      for (let m = 0; m < mutations; m++) mutateDeep(payload, rng, m);
      const parsed = parse(payload);
      if (hasInjectedKey(payload)) {
        expect(parsed, JSON.stringify(payload)).toBeNull();
        refusedInjections++;
      }
      if (parsed !== null) {
        accepted++;
        // A guard's output is its own fixed point: re-parsing changes nothing.
        expect(parse(parsed)).toEqual(parsed);
      }
      // The tolerant store read must not throw either; when it accepts, its
      // rebuild is also a fixed point under the strict guard.
      const stored = parseExclusionSessionRecord(payload, 'ignore');
      if (stored !== null) expect(parseExclusionSessionRecord(stored, 'reject')).toEqual(stored);
    }
    // The run must exercise both arms, or it proves nothing.
    expect(accepted).toBeGreaterThan(0);
    expect(refusedInjections).toBeGreaterThan(0);
  });
});
