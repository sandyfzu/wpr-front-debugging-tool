/**
 * The defensive view bounds for recursive JSON rendering — one pure,
 * re-entrant traversal (`boundedJsonOf`) that turns any input value into a
 * structure that is safe to walk again without unbounded recursion or
 * unbounded size: cyclic re-entries, max-depth excesses and node-budget
 * excesses are cut and replaced by truncation markers, so the renderer (and
 * the match search, which clamps through this same guard) cannot be crashed
 * or hung by a hostile/deep/cyclic composition.
 *
 * The input contract is **JSON-decoded data** (the messaging/JSON.parse
 * protocol boundary): anything the decoder produced fits. The bounds are not
 * a data validator — they bound what happens when that contract is not met
 * (a host object, a 10⁶-node array, a composed cycle) or when a decoded
 * payload is simply enormous: the view truncates visibly instead of lying
 * silently.
 */
import { createLogger } from '../../lib/logger';

/** The renderer's logger — truncation events warn exactly once per event. */
const logger = createLogger('json-value');

/**
 * The hard production bounds for one rendered JSON payload.
 *
 * Depth 32: JSON-decoded payloads (page protocol objects, tool results) sit
 * far below this — a deeper nesting means composed hostile input. 5000
 * nodes: the debugging tool's payloads stay two orders of magnitude under it
 * in practice, and an expanded 5000-row view is around the point where the
 * DOM stops being responsive anyway.
 */
export const JSON_VIEW_MAX_DEPTH = 32;
/** @see {@link JSON_VIEW_MAX_DEPTH} for the rationale. */
export const JSON_VIEW_MAX_NODES = 5000;

/** The bounds set handed to {@link boundedJsonOf} (hard defaults; a test seam). */
export interface JsonBudget {
  /** Deepest renderable level (root = 1; deeper nodes become markers). */
  maxDepth: number;
  /** Node count of the bounded pre-order walk (beyond it, the remainder is cut). */
  maxNodes: number;
}

/** The production defaults — {@link JSON_VIEW_MAX_DEPTH}/{@link JSON_VIEW_MAX_NODES}. */
export const JSON_VIEW_BUDGET: JsonBudget = {
  maxDepth: JSON_VIEW_MAX_DEPTH,
  maxNodes: JSON_VIEW_MAX_NODES
};

/** Why one view walk stopped and left a marker behind. */
export type JsonTruncationReason = 'depth' | 'nodes' | 'cycle';

/**
 * One truncation marker value — a class instance precisely so it is **not** a
 * plain JSON object: real host objects and JSON data flows through the normal
 * shapes, while markers are recognized by identity in the renderer's first
 * match branch and can never be mistaken for entries to recurse into.
 */
export class JsonTruncationMarker {
  /** The bounds that produced the cut (drives the visible copy). */
  constructor(public readonly reason: JsonTruncationReason) {}
}

/** The module-identical markers the walk places (one per reason). */
const MARKERS: Record<JsonTruncationReason, JsonTruncationMarker> = {
  depth: new JsonTruncationMarker('depth'),
  nodes: new JsonTruncationMarker('nodes'),
  cycle: new JsonTruncationMarker('cycle')
};

/**
 * Narrow a value to a truncation marker (identity check against the walk's
 * own marker instances — page data can never construct these).
 *
 * @param value Any value.
 */
export function isTruncationMarker(value: unknown): value is JsonTruncationMarker {
  return value instanceof JsonTruncationMarker;
}

/**
 * Narrow a value to a plain JSON object: own-prototype `Object.prototype`
 * (or `null`). `null`, arrays, class instances and host objects (`Map`,
 * `document`, DOM nodes) are excluded — the input contract is decoded JSON,
 * and anything outside it renders through the scalar path (visible, e.g.
 * `[object Map]`) instead of being walked as an object and silently
 * rendering as `{}`.
 *
 * @param value Any value.
 */
export function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** What one {@link boundedJsonOf} walk produced. */
export interface BoundedJsonView {
  /**
   * A JSON-shaped structure that walks finite: plain objects/arrays/scalars
   * only, with every unreachable node replaced by a truncation marker.
   */
  value: unknown;
  /** Why the walk left markers behind (in first-cut order; empty = nothing cut). */
  truncations: JsonTruncationReason[];
}

/** The mutable walk state (owned by one {@link boundedJsonOf} call — never shared). */
interface WalkState {
  /** Nodes visited so far (pre-order). */
  count: number;
  /** Reached before the walk should stop producing new entries entirely. */
  exhausted: boolean;
  /** Reasons recorded so far (deduplicated by use). */
  reasons: JsonTruncationReason[];
  /** Plain objects on the current walk path (cycle detection; never page-shared). */
  path: Set<object>;
}

/**
 * Walk one node of the bounded pre-order walk.
 *
 * Order of checks per node: depth breach first (a marker can never gain
 * children), then the node budget (the first breaching node takes the
 * marker and `exhausted` stops every open entries loop — the remainder is
 * cut, never silently dropped mid-branch), then the cycle set (plain
 * objects currently on the walk path; removed on exit so a shared subtree
 * walked twice stays legal while a true cycle cuts), then the shapes.
 *
 * @param value The node to walk.
 * @param depth This node's level (root walk starts at 1).
 * @param state The call-owned counters.
 * @param budget The caller's bounds.
 * @returns The clamped node (input values pass through unmodified).
 */
function walkNode(value: unknown, depth: number, state: WalkState, budget: JsonBudget): unknown {
  if (depth > budget.maxDepth) {
    state.reasons.push('depth');
    return MARKERS.depth;
  }
  state.count += 1;
  if (state.count > budget.maxNodes) {
    state.exhausted = true;
    state.reasons.push('nodes');
    return MARKERS.nodes;
  }
  if (isTruncationMarker(value)) return value;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const child of value as unknown[]) {
      out.push(walkNode(child, depth + 1, state, budget));
      if (state.exhausted) break; // the marker at the breach point stands in for all later entries
    }
    return out;
  }
  if (isPlainJsonObject(value)) {
    if (state.path.has(value)) {
      state.reasons.push('cycle');
      return MARKERS.cycle;
    }
    state.path.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = walkNode(child, depth + 1, state, budget);
      if (state.exhausted) break; // see the array branch: cut, don't spam markers
    }
    state.path.delete(value); // a non-cyclic shared reference may be walked again (budget still counts it)
    return out;
  }
  return value;
}

/**
 * Bound a payload for recursive rendering (the pure guard both the renderer
 * and the match search clamp through). Pure: the input is never mutated, the
 * output is freshly built; every unreachable node is replaced by a visible
 * truncation marker instead of a silent drop.
 *
 * @param value The payload (JSON-decoded data; hostile compositions are bounded defensively).
 * @param budget The bounds — omitted for the production {@link JSON_VIEW_BUDGET}; tests pass tiny budgets.
 * @returns The clamped view with the recorded cut reasons.
 */
export function boundedJsonOf(
  value: unknown,
  budget: JsonBudget = JSON_VIEW_BUDGET
): BoundedJsonView {
  const state: WalkState = {
    count: 0,
    exhausted: false,
    reasons: [],
    path: new Set()
  };
  const bounded = walkNode(value, 1, state, budget);
  return { value: bounded, truncations: [...new Set(state.reasons)] };
}

/**
 * Warn once per truncation event — the renderer's visible markers carry the
 * feedback; this is the operational record (what got cut, by which bound).
 *
 * @param truncations The reasons the last walk produced.
 */
export function warnTruncations(truncations: JsonTruncationReason[]): void {
  if (truncations.length === 0) return;
  logger.warn('JsonValue: structure truncated by the view guard.', { reasons: truncations });
}
