/**
 * Unit tests for the defensive view bounds (`boundedJsonOf`): every cut path
 * (depth, node budget, cyclic re-entry), the pass-through paths (plain data,
 * shared references, non-JSON host objects left untouched) and purity (the
 * input emerges unmodified). The walk's finiteness is the contract — a
 * hostile composition must produce markers, never a hang or a crash.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  JSON_VIEW_BUDGET,
  JSON_VIEW_MAX_DEPTH,
  JSON_VIEW_MAX_NODES,
  boundedJsonOf,
  isTruncationMarker,
  warnTruncations
} from './json-value-bounds';

/** The reason the marker at `value's` slot carries. */
function markerReason(value: unknown): string {
  expect(isTruncationMarker(value)).toBe(true);
  return (value as { reason: string }).reason;
}

describe('boundedJsonOf — cut paths', () => {
  /**
   * A plain object chain `n0 → n1 → … → n<L-1>` ending in a leaf scalar —
   * built bottom-up so every level's key/value is unique (assertions target
   * the outermost kept prefix without ambiguous matches). Max node depth is
   * L + 1 (the leaf sits one past the last object).
   *
   * @param levels The number of nested object levels.
   */
  function nesting(levels: number): unknown {
    let value: unknown = 'leaf-bottom';
    for (let i = levels - 1; i >= 0; i -= 1) value = { [`n${String(i)}`]: value };
    return value;
  }

  /** Descend a chain of plain-object keys (guarded index helper). */
  function at(value: unknown, ...keys: string[]): unknown {
    return keys.reduce((node, key) => (node as Record<string, unknown>)[key], value);
  }

  it('replaces a deeper-than-maxDepth node with a depth marker', () => {
    const result = boundedJsonOf(nesting(6), { maxDepth: 4, maxNodes: 100 });
    expect(result.truncations).toEqual(['depth']);
    // Kept prefix: the chain n0 (d1), n1 (d2), n2 (d3), n3 (d4) — the depth-4
    // object (`at` via three keys) is within the cap.
    const kept = at(result.value, 'n0', 'n1', 'n2') as Record<string, unknown>;
    expect(kept).toBeTypeOf('object');
    // The breach is under key `n3` (the n4-object at depth 5): the slot shows
    // the depth marker.
    expect(markerReason(kept.n3)).toBe('depth');
  });

  it('keeps the whole tree when exactly at the max depth (cap is inclusive)', () => {
    // nesting(3): objects at depths 1–3, leaf scalar at depth 4 — all within the cap.
    const input = nesting(3);
    const result = boundedJsonOf(input, { maxDepth: 4, maxNodes: 100 });
    expect(result.truncations).toEqual([]);
    expect(result.value).toEqual(input);
  });

  it('cuts the remainder past the node budget at exactly one marker', () => {
    const result = boundedJsonOf([0, 1, 2, 3, 4, 5, 6], { maxDepth: 10, maxNodes: 5 });
    expect(result.truncations).toEqual(['nodes']);
    // Root (1) + children 0–3 (counts 2–5) kept; the 6th count breaches →
    // marker at that slot and everything after is cut (nothing at index 5/6).
    expect(result.value).toHaveLength(5);
    const arr = result.value as unknown[];
    expect(arr[0]).toBe(0);
    expect(arr[3]).toBe(3);
    expect(markerReason(arr[4])).toBe('nodes');
  });

  it('terminates on a cyclic composition and marks the re-entry as a cycle cut', () => {
    const cyc: Record<string, unknown> = { name: 'root' };
    cyc.self = cyc;
    const result = boundedJsonOf(cyc, { maxDepth: 20, maxNodes: 100 });
    expect(result.truncations).toEqual(['cycle']);
    const inner = (result.value as Record<string, unknown>).self;
    expect(inner).not.toBe(cyc); // the clamped view is a fresh structure
    expect(markerReason(inner)).toBe('cycle');
  });

  it('keeps a non-cyclic shared reference legal (walked twice, not cycle-cut)', () => {
    const shared = { x: 1 };
    const result = boundedJsonOf({ a: shared, b: shared }, { maxDepth: 20, maxNodes: 100 });
    expect(result.truncations).toEqual([]);
    const root = result.value as Record<string, unknown>;
    expect((root.a as Record<string, unknown>).x).toBe(1);
    expect((root.b as Record<string, unknown>).x).toBe(1);
  });
});

describe('boundedJsonOf — pass-through paths', () => {
  it('passes plain JSON data through scalars/arrays/objects unchanged in shape', () => {
    const input = { s: 'text', n: 42, b: false, nil: null, arr: [1, { k: 'v' }], obj: {} };
    const result = boundedJsonOf(input, { maxDepth: 10, maxNodes: 100 });
    expect(result.truncations).toEqual([]);
    expect(result.value).toEqual(input);
  });

  it('leaves non-JSON host objects untouched at their slot (renderer shows them, never walks them)', () => {
    const map = new Map([['k', 'v']]);
    const date = new Date(0);
    const result = boundedJsonOf({ m: map, d: date }, { maxDepth: 10, maxNodes: 100 });
    expect(result.truncations).toEqual([]);
    const root = result.value as Record<string, unknown>;
    expect(root.m).toBe(map);
    expect(root.d).toBe(date);
  });

  it('treats a null-prototype object as a plain JSON object (walked)', () => {
    const input = Object.create(null) as Record<string, unknown>;
    input.k = 'leaf';
    const result = boundedJsonOf(input, { maxDepth: 10, maxNodes: 100 });
    expect(result.truncations).toEqual([]);
    expect((result.value as Record<string, unknown>).k).toBe('leaf');
  });

  it('is pure: the input object is never mutated and the output is fresh', () => {
    const input = { a: { b: [1, 2] } };
    const before = JSON.stringify(input);
    const result = boundedJsonOf(input, { maxDepth: 10, maxNodes: 100 });
    expect(JSON.stringify(input)).toBe(before);
    expect(result.value).not.toBe(input);
    expect((result.value as Record<string, unknown>).a).not.toBe(input.a);
  });
});

describe('boundedJsonOf — defaults & operational record', () => {
  it('applies the production budget when the caller passes none', () => {
    expect(JSON_VIEW_BUDGET.maxDepth).toBe(JSON_VIEW_MAX_DEPTH);
    expect(JSON_VIEW_BUDGET.maxNodes).toBe(JSON_VIEW_MAX_NODES);
    // The documented defaults (the guard's whole point — pinned so a silent
    // relaxation cannot slip in): depth 32, 5000 nodes.
    expect(JSON_VIEW_MAX_DEPTH).toBe(32);
    expect(JSON_VIEW_MAX_NODES).toBe(5000);
  });

  it('walks the default budget over a real-size payload without cutting', () => {
    // ~1000 nodes of nested arrays/objects — under the default budget.
    const payload = Array.from({ length: 250 }, (_, i) => ({ i, t: [`t${String(i)}`, 1, true] }));
    const result = boundedJsonOf(payload);
    expect(result.truncations).toEqual([]);
    expect(result.value).toHaveLength(250);
  });

  it('warns exactly once per truncation event, with the reasons', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    warnTruncations([]);
    expect(warn).not.toHaveBeenCalled();
    warnTruncations(['cycle']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('truncated');
    warn.mockRestore();
  });
});
