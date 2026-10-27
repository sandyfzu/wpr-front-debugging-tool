/**
 * Whether a row's match on a subject depends on bytes nobody can know: the
 * ids of WP Rocket's Delay JS mask placeholders (`<!-- WPR_SVG_<id> -->`,
 * `<id>` a PHP `uniqid()` — 13 lowercase hex digits drawn from the clock).
 * Sampling ids cannot answer that soundly (a row `6adf` matches today's ids
 * only), so the row's parse is turned into an automaton and run over the
 * subject with each id byte standing for every hex digit at once:
 *
 * - **exact** patterns (byte sets, groups, alternation, counted repeats
 *   within bounds) — the automaton's language is the row's, so following
 *   every id choice tells whether it matches for all ids, none, or some;
 * - **other** patterns (assertions, back-references, `\R`, PCRE-only atoms,
 *   oversized repeats) — the automaton over-approximates the row's language,
 *   so it can only prove that no match touches an id byte; the row's own
 *   matcher then answers for any id. A lookaround that could read a hex byte
 *   is never proven blind. Assertions cannot see an id's value: `\b` sees
 *   word bytes on both sides of every id byte (`_` before, hex inside) and
 *   a space after, whatever the id; anchors never sit inside one.
 *
 * Any budget overrun answers `unknown` — never a guess.
 */
import { byteRanges, intersects, type ByteSet } from './byte-set';
import { withoutFreeEdges } from './free-edges';
import type { ParsedPattern, PatternNode } from './parse';

/** Bytes an id byte can be: lowercase hex. */
export const ID_BYTES: ByteSet = byteRanges([0x30, 0x39], [0x61, 0x66]);

/** {@link ID_BYTES}, listed. */
const ID_BYTE_LIST: readonly number[] = Array.from({ length: 256 }, (_, byte) => byte).filter(
  (byte) => ID_BYTES[byte] === 1
);

/** Every byte (a back-reference or an unknown atom may consume any). */
const ANY_BYTE: ByteSet = byteRanges([0x00, 0xff]);

/** `\R`'s single bytes (LF VT FF CR NEL). */
const LINEBREAK_BYTES: ByteSet = byteRanges([0x0a, 0x0d], [0x85, 0x85]);
const CR: ByteSet = byteRanges([0x0d, 0x0d]);
const LF: ByteSet = byteRanges([0x0a, 0x0a]);

/** Bounds on the work: past any, the answer is `unknown`. */
export const ID_PROBE_LIMITS = {
  /** Automaton states one row may build (counted repeats are expanded). */
  states: 4096,
  /** Distinct automaton state sets followed at once over the id choices. */
  configurations: 256,
  /** State visits per subject. */
  steps: 4_000_000,
  /**
   * State visits per document, split evenly over its scripts holding
   * masked regions (see {@link scriptProbeBudget}): what keeps a set of
   * costly rows on a page of masked scripts inside the transform's time;
   * past its share, a script's rows answer `unknown` (it is left
   * undetermined — never guessed). An even split keeps each script's
   * answer independent of the others and of their order.
   */
  documentSteps: 8_000_000
} as const;

/** The state visits one script has left for its probes (all its readings and rows; spent as they run). */
export interface ProbeBudget {
  left: number;
}

/**
 * One script's budget: its even share of the document's.
 *
 * @param maskedScripts How many of the document's scripts hold masked regions (≥ 1 counted).
 */
export function scriptProbeBudget(maskedScripts = 1): ProbeBudget {
  return { left: ID_PROBE_LIMITS.documentSteps / Math.max(1, maskedScripts) };
}

/**
 * A row's match on a subject over every id:
 * - `all` / `none` — it matches for every id / for none;
 * - `depends` — for some ids only;
 * - `blind` — no match can touch an id byte: the row's matcher, run with
 *   any id, answers for all;
 * - `unknown` — not proven either way (a budget, or a construct that could
 *   read an id).
 */
export type IdOutcome = 'all' | 'none' | 'depends' | 'blind' | 'unknown';

/** A Thompson automaton: each state has one byte-set move or epsilon moves. */
interface Automaton {
  readonly sets: readonly (ByteSet | null)[];
  readonly targets: readonly number[];
  readonly epsilons: readonly (readonly number[])[];
  readonly start: number;
  readonly accept: number;
  /** Its language is exactly the row's. */
  readonly exact: boolean;
  /** A lookaround could read an id byte. */
  readonly peeks: boolean;
}

/** Thrown when an automaton passes {@link ID_PROBE_LIMITS}`.states`. */
class TooLarge extends Error {}

/** Builds an {@link Automaton} from a parse. */
class Builder {
  readonly sets: (ByteSet | null)[] = [];
  readonly targets: number[] = [];
  readonly epsilons: number[][] = [];
  exact = true;
  peeks = false;

  /** A new state. */
  state(): number {
    if (this.sets.length >= ID_PROBE_LIMITS.states) throw new TooLarge();
    this.sets.push(null);
    this.targets.push(-1);
    this.epsilons.push([]);
    return this.sets.length - 1;
  }

  /** An epsilon move. */
  epsilon(from: number, to: number): void {
    this.epsilons[from]?.push(to);
  }

  /** A move on one byte of `set`. */
  move(from: number, set: ByteSet, to: number): void {
    const at = this.state();
    this.epsilon(from, at);
    this.sets[at] = set;
    this.targets[at] = to;
  }

  /** Any bytes, any number of times (an over-approximation). */
  anything(from: number, to: number): void {
    const loop = this.state();
    this.epsilon(from, loop);
    this.move(loop, ANY_BYTE, loop);
    this.epsilon(loop, to);
  }

  /** A sequence of nodes from `from` to `to`. */
  sequence(nodes: readonly PatternNode[], from: number, to: number): void {
    let at = from;
    for (const node of nodes) {
      const next = this.state();
      this.node(node, at, next);
      at = next;
    }
    this.epsilon(at, to);
  }

  /** Alternatives from `from` to `to`. */
  alternatives(branches: readonly (readonly PatternNode[])[], from: number, to: number): void {
    for (const branch of branches) this.sequence(branch, from, to);
  }

  /** One node from `from` to `to`. */
  node(node: PatternNode, from: number, to: number): void {
    switch (node.type) {
      case 'set':
        this.move(from, node.set, to);
        return;
      case 'keep':
        this.epsilon(from, to);
        return;
      case 'assert':
        // Only restricts where a match may be: dropping it widens the language.
        this.exact = false;
        this.epsilon(from, to);
        return;
      case 'option':
        if (!node.noop) this.exact = false;
        this.epsilon(from, to);
        return;
      case 'linebreak': {
        this.exact = false;
        this.move(from, LINEBREAK_BYTES, to);
        const middle = this.state();
        this.move(from, CR, middle);
        this.move(middle, LF, to);
        return;
      }
      case 'backref':
      case 'opaque':
        this.exact = false;
        this.anything(from, to);
        return;
      case 'group':
        this.group(node, from, to);
        return;
      case 'repeat':
        this.repeat(node, from, to);
        return;
    }
  }

  /** A group: its alternatives, or (a lookaround) nothing consumed. */
  group(node: Extract<PatternNode, { type: 'group' }>, from: number, to: number): void {
    if (node.kind.includes('look')) {
      this.exact = false;
      if (node.alternatives.some((branch) => branch.some(readsIdByte))) this.peeks = true;
      this.epsilon(from, to);
      return;
    }
    // Atomic and other PCRE-only groups only remove matches: widened, inexact.
    if (node.kind === 'opaque') this.exact = false;
    this.alternatives(node.alternatives, from, to);
  }

  /** A repeat, expanded exactly while its copies fit, else widened to `+`/`*`. */
  repeat(node: Extract<PatternNode, { type: 'repeat' }>, from: number, to: number): void {
    const copies = node.max ?? node.min + 1;
    if (copies > 64) {
      this.exact = false;
      let at = from;
      if (node.min > 0) {
        at = this.state();
        this.node(node.node, from, at);
      }
      this.star(node.node, at, to);
      return;
    }
    let at = from;
    for (let index = 0; index < node.min; index++) {
      const next = this.state();
      this.node(node.node, at, next);
      at = next;
    }
    if (node.max === null) {
      this.star(node.node, at, to);
      return;
    }
    for (let index = node.min; index < node.max; index++) {
      const next = this.state();
      this.epsilon(at, to);
      this.node(node.node, at, next);
      at = next;
    }
    this.epsilon(at, to);
  }

  /** Any number of `node`. */
  star(node: PatternNode, from: number, to: number): void {
    const loop = this.state();
    this.epsilon(from, loop);
    const back = this.state();
    this.node(node, loop, back);
    this.epsilon(back, loop);
    this.epsilon(loop, to);
  }
}

/** Whether a node could consume a hex byte (lookarounds and atoms included). */
function readsIdByte(node: PatternNode): boolean {
  switch (node.type) {
    case 'set':
      return intersects(node.set, ID_BYTES);
    case 'backref':
    case 'opaque':
      return true;
    case 'group':
      return node.alternatives.some((branch) => branch.some(readsIdByte));
    case 'repeat':
      return node.max !== 0 && readsIdByte(node.node);
    default:
      return false;
  }
}

/**
 * The automaton of a parsed row, or `null` when it cannot be built (an
 * incomplete parse, an issue, or past the state bound).
 *
 * @param parsed The row's runtime parse.
 */
function automatonOf(parsed: ParsedPattern): Automaton | null {
  if (!parsed.complete || parsed.issues.length > 0) return null;
  const builder = new Builder();
  try {
    const start = builder.state();
    const accept = builder.state();
    builder.alternatives(parsed.alternatives, start, accept);
    return {
      sets: builder.sets,
      targets: builder.targets,
      epsilons: builder.epsilons,
      start,
      accept,
      exact: builder.exact,
      peeks: builder.peeks
    };
  } catch (error) {
    if (error instanceof TooLarge) return null;
    throw error;
  }
}

/** A run of the automaton over a subject, counting its work. */
class Run {
  steps = 0;
  constructor(
    private readonly automaton: Automaton,
    private readonly budget: ProbeBudget = { left: Infinity }
  ) {}

  /** Add `state` and everything it reaches by epsilon moves to `into`. */
  close(state: number, into: Set<number>): void {
    const stack = [state];
    while (stack.length > 0) {
      const at = stack.pop() ?? 0;
      if (into.has(at)) continue;
      into.add(at);
      this.steps++;
      this.budget.left--;
      for (const next of this.automaton.epsilons[at] ?? []) stack.push(next);
    }
  }

  /** The states after reading `byte` from `states`, plus a new match start. */
  step(states: ReadonlySet<number>, byte: number): Set<number> {
    const next = new Set<number>();
    for (const state of states) {
      this.steps++;
      this.budget.left--;
      if (this.automaton.sets[state]?.[byte] === 1)
        this.close(this.automaton.targets[state] ?? 0, next);
    }
    this.close(this.automaton.start, next);
    return next;
  }

  /** Whether the work budget is spent. */
  get spent(): boolean {
    return this.steps > ID_PROBE_LIMITS.steps || this.budget.left < 0;
  }
}

/** The key of a state set (for merging id choices that lead to the same states). */
function keyOf(states: ReadonlySet<number>): string {
  return [...states].sort((left, right) => left - right).join(',');
}

/**
 * Follow every id choice (exact automata): all / none / some match.
 *
 * @param automaton The row's automaton.
 * @param subject The subject's bytes.
 * @param idAt Which bytes are id bytes.
 * @param budget The document's remaining work.
 */
function everyChoice(
  automaton: Automaton,
  subject: string,
  idAt: Uint8Array,
  budget: ProbeBudget
): 'all' | 'none' | 'depends' | 'unknown' {
  const run = new Run(automaton, budget);
  const initial = new Set<number>();
  run.close(automaton.start, initial);
  if (initial.has(automaton.accept)) return 'all';
  // The choices that have not matched yet (a match is final: it stays matched).
  let live = new Map([[keyOf(initial), initial]]);
  let matched = false;
  for (let at = 0; at < subject.length && live.size > 0; at++) {
    const bytes = idAt[at] === 1 ? ID_BYTE_LIST : [subject.charCodeAt(at)];
    const next = new Map<string, Set<number>>();
    for (const states of live.values()) {
      for (const byte of bytes) {
        const after = run.step(states, byte);
        if (after.has(automaton.accept)) matched = true;
        else next.set(keyOf(after), after);
      }
    }
    if (run.spent || next.size > ID_PROBE_LIMITS.configurations) return 'unknown';
    live = next;
  }
  if (live.size === 0) return 'all';
  return matched ? 'depends' : 'none';
}

/**
 * Whether any match could consume an id byte (widened automata): states
 * are tracked with a "touched an id" mark.
 *
 * @param automaton The row's automaton.
 * @param subject The subject's bytes.
 * @param idAt Which bytes are id bytes.
 * @param budget The document's remaining work.
 */
function touchesId(
  automaton: Automaton,
  subject: string,
  idAt: Uint8Array,
  budget: ProbeBudget
): boolean | null {
  const run = new Run(automaton, budget);
  const size = automaton.sets.length;
  let states = new Set<number>();
  run.close(automaton.start, states);
  for (let at = 0; at < subject.length; at++) {
    const next = new Set<number>();
    const isId = idAt[at] === 1;
    const byte = subject.charCodeAt(at);
    for (const marked of states) {
      run.steps++;
      budget.left--;
      const state = marked % size;
      const set = automaton.sets[state];
      if (set == null) continue;
      const touched = marked >= size || isId;
      if (isId ? !intersects(set, ID_BYTES) : set[byte] !== 1) continue;
      const reached = new Set<number>();
      run.close(automaton.targets[state] ?? 0, reached);
      for (const target of reached) next.add(touched ? target + size : target);
    }
    run.close(automaton.start, next);
    if (next.has(automaton.accept + size)) return true;
    if (run.spent) return null;
    states = next;
  }
  return false;
}

/** What follows an id: ` -->`. */
const AFTER_ID: readonly number[] = [0x20, 0x2d, 0x2d, 0x3e];

/**
 * Whether any match could consume an id byte, whatever the subject (a
 * widening, decided once per row): an id is 13 hex bytes after a `_` and
 * before ` -->`. A match enters it from a state reached just after
 * reading `_` (from any state — wider than any subject), or starts inside
 * it; it touches the id once it reads a hex byte there, and is taken to
 * match if it reaches its end inside the id, or is still alive after the
 * ` -->` that follows (what comes next is unknown here).
 *
 * @param automaton The row's automaton.
 */
function mayTouchId(automaton: Automaton): boolean {
  const run = new Run(automaton);
  const fresh = new Set<number>();
  run.close(automaton.start, fresh);
  let untouched = new Set(fresh);
  automaton.sets.forEach((set, state) => {
    if (set?.[0x5f] === 1) run.close(automaton.targets[state] ?? 0, untouched);
  });
  let touched = new Set<number>();
  for (let digit = 0; digit < 13; digit++) {
    const next = new Set<number>();
    for (const state of [...untouched, ...touched]) {
      const set = automaton.sets[state];
      if (set != null && intersects(set, ID_BYTES)) run.close(automaton.targets[state] ?? 0, next);
    }
    if (next.has(automaton.accept)) return true;
    touched = next;
    untouched = fresh;
  }
  for (const byte of AFTER_ID) {
    if (touched.size === 0) return false;
    const next = new Set<number>();
    for (const state of touched) {
      if (automaton.sets[state]?.[byte] === 1) run.close(automaton.targets[state] ?? 0, next);
    }
    if (next.has(automaton.accept)) return true;
    touched = next;
  }
  return touched.size > 0;
}

/**
 * The id bytes of a subject: 13 from each given start (where the caller
 * wrote its placeholders' ids — never found by searching the subject, which
 * may spell a placeholder itself).
 *
 * @param length The subject's length in bytes.
 * @param starts Each id's first byte.
 */
export function idBytesAt(length: number, starts: readonly number[]): Uint8Array {
  const idAt = new Uint8Array(length);
  for (const start of starts) idAt.fill(1, start, start + 13);
  return idAt;
}

/**
 * Compile a row's id probe (see the module doc).
 *
 * @param parsed The row's runtime parse.
 * @returns The probe over a subject's bytes, its id bytes ({@link idBytesAt})
 *   and the script's remaining work ({@link scriptProbeBudget}).
 */
export function compileIdProbe(
  row: ParsedPattern
): (subject: string, idAt: Uint8Array, budget: ProbeBudget) => IdOutcome {
  // Same answer on every subject, every id included (see `withoutFreeEdges`).
  const parsed = withoutFreeEdges(row);
  const automaton = automatonOf(parsed);
  const readsHex = parsed.alternatives.some((branch) => branch.some(readsIdByte));
  // Decided once per row: most rows cannot step into an id from its context.
  const reachesId = readsHex && (automaton === null || automaton.peeks || mayTouchId(automaton));
  return (subject, idAt, budget) => {
    if (!idAt.includes(1)) return 'blind';
    // Nothing in the row can consume or read a hex byte, or reach one past
    // a placeholder's `_`: no match sees an id.
    if (!reachesId) return 'blind';
    if (automaton === null || automaton.peeks) return 'unknown';
    if (budget.left <= 0) return 'unknown';
    if (automaton.exact) return everyChoice(automaton, subject, idAt, budget);
    const touches = touchesId(automaton, subject, idAt, budget);
    return touches === false ? 'blind' : 'unknown';
  };
}
