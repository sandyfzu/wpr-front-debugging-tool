/**
 * How much backtracking WP Rocket's `<meta charset>` pattern does on a page
 * — to tell when PCRE's backtrack limit could stop it (then WP Rocket
 * leaves the page's metas where they are, which this transform does not
 * reproduce). The pattern is explored here as PCRE explores it: every
 * branch and every lazy stopping point in PCRE's order, each attempt from
 * each `<meta` of the whole page (its `preg_replace` reads all of them),
 * the lookahead `(?=.*</head>)` charged the bytes it reads. The count is an
 * upper estimate of the JIT's own (calibrated on the plugin; the caller
 * applies the margin). Exploring is capped — past the cap the page is
 * simply "too costly to tell", never explored to the end.
 *
 * Bytes: run on the page's byte view (`./utf8`).
 */
import { cachedForwardSearch } from '../../utils/next-occurrence';
import { asciiCaselessAt } from './pcre-text';

/** One piece of the pattern. */
type PatternNode =
  | { readonly kind: 'literal'; readonly text: string }
  | {
      readonly kind: 'class';
      readonly test: (code: number) => boolean;
      readonly min: number;
      readonly max: number;
    }
  | { readonly kind: 'branches'; readonly branches: readonly (readonly PatternNode[])[] }
  | { readonly kind: 'head-ahead' };

/**
 * A caseless literal.
 *
 * @param text The literal, lowercase.
 */
const literal = (text: string): PatternNode => ({ kind: 'literal', text });

/**
 * A lazy repeat of a byte class.
 *
 * @param test The class.
 * @param min Fewest repeats.
 * @param max Most repeats.
 */
const lazy = (test: (code: number) => boolean, min = 0, max = Infinity): PatternNode => ({
  kind: 'class',
  test,
  min,
  max
});

/**
 * One byte of a class.
 *
 * @param test The class.
 */
const one = (test: (code: number) => boolean): PatternNode => lazy(test, 1, 1);

const isQuote = (code: number): boolean => code === 39 || code === 34;
const notH = (code: number): boolean => code !== 104 && code !== 72;
const notEquals = (code: number): boolean => code !== 61;
const isEquals = (code: number): boolean => code === 61;
const notQuote = (code: number): boolean => !isQuote(code);
const quoteOrSpace = (code: number): boolean => isQuote(code) || code === 32;
const isSpace = (code: number): boolean => code === 32;
const notGt = (code: number): boolean => code !== 62;
const tripletEdge = (code: number): boolean => !isQuote(code) && code !== 62 && code !== 32;
const tripletMiddle = (code: number): boolean => !isQuote(code) && code !== 62;

/** The pattern's `T`: `[^'"> ][^'">]+?[^'"> ]`. */
const TRIPLET: readonly PatternNode[] = [
  one(tripletEdge),
  lazy(tripletMiddle, 1),
  one(tripletEdge)
];

/** WP Rocket's meta-charset pattern, `U` written out (every quantifier lazy). */
const PATTERN: readonly PatternNode[] = [
  literal('<meta'),
  lazy(notH),
  {
    kind: 'branches',
    branches: [
      [
        literal('http-equiv'),
        lazy(notEquals),
        literal('='),
        lazy(notQuote),
        one(quoteOrSpace),
        literal('content-type'),
        one(isQuote),
        lazy(isSpace),
        lazy(notGt)
      ],
      []
    ]
  },
  {
    kind: 'branches',
    branches: [
      [
        literal('charset'),
        lazy(notEquals),
        literal('='),
        lazy(isSpace),
        lazy(quoteOrSpace),
        ...TRIPLET,
        lazy(quoteOrSpace)
      ],
      [literal('charset'), lazy(notEquals), lazy(isEquals), ...TRIPLET]
    ]
  },
  { kind: 'branches', branches: [[lazy(notGt)], []] },
  literal('>'),
  { kind: 'head-ahead' }
];

/** Thrown to stop an exploration at its cap. */
class ExplorationCapped extends Error {}

/** The exploration's outcome. */
export interface MetaCharsetCost {
  /**
   * Whether every attempt was explored within the caps (else the page is
   * too costly to tell: treat it as one that may hit the limit).
   */
  readonly complete: boolean;
  /** The most steps one attempt took (when complete). */
  readonly mostSteps: number;
  /** The pattern's matches as byte spans (when complete). */
  readonly matches: readonly (readonly [number, number])[];
}

/** Caps of one exploration. */
export interface ExplorationCaps {
  /** Steps one attempt may take before the page counts as too costly. */
  readonly attempt: number;
  /**
   * Pattern nodes all attempts together may visit (the exploration's own
   * work: lookahead bytes are counted, not read, so they cost nothing here).
   */
  readonly work: number;
}

/**
 * Explore every attempt of the pattern over a page's bytes.
 *
 * @param bytes The page's byte view (all of it: the lookahead reads to its end).
 * @param caps The step caps.
 */
export function metaCharsetCost(bytes: string, caps: ExplorationCaps): MetaCharsetCost {
  const headCloseAfter = cachedForwardSearch((from, to) => {
    const at = bytes.slice(Math.max(from, 0), Math.min(to, bytes.length) + 6).search(/<\/head>/i);
    return at === -1 ? -1 : Math.max(from, 0) + at;
  });
  let steps = 0;
  let work = 0;
  /**
   * Count a visit: `steps` for PCRE's estimate, one node of own work.
   *
   * @param count The steps the visit costs PCRE.
   */
  const charge = (count: number): void => {
    steps += count;
    work++;
    if (steps > caps.attempt || work > caps.work) throw new ExplorationCapped();
  };

  /**
   * Match `sequence[index…]` at `pos`, then `next`.
   *
   * @param sequence The nodes.
   * @param index The node to match.
   * @param pos The byte offset.
   * @param next The continuation (match end or `-1`).
   */
  const match = (
    sequence: readonly PatternNode[],
    index: number,
    pos: number,
    next: (pos: number) => number
  ): number => {
    const node = sequence[index];
    if (node === undefined) return next(pos);
    switch (node.kind) {
      case 'literal': {
        charge(1);
        return asciiCaselessAt(bytes, pos, node.text)
          ? match(sequence, index + 1, pos + node.text.length, next)
          : -1;
      }
      case 'class': {
        for (let count = 0; ; count++) {
          charge(1);
          if (count >= node.min) {
            const end = match(sequence, index + 1, pos + count, next);
            if (end !== -1) return end;
          }
          const at = pos + count;
          if (count === node.max || at >= bytes.length || !node.test(bytes.charCodeAt(at))) {
            return -1;
          }
        }
      }
      case 'branches': {
        for (const branch of node.branches) {
          const end = match(branch, 0, pos, (after) => match(sequence, index + 1, after, next));
          if (end !== -1) return end;
        }
        return -1;
      }
      case 'head-ahead': {
        const head = headCloseAfter(pos);
        charge((head === -1 ? bytes.length : head + 7) - pos);
        return head === -1 ? -1 : next(pos);
      }
    }
  };

  const hAfter = cachedForwardSearch((from, to) => {
    const stop = Math.min(to, bytes.length);
    for (let at = Math.max(from, 0); at < stop; at++) if (!notH(bytes.charCodeAt(at))) return at;
    return -1;
  });
  let mostSteps = 0;
  const matches: [number, number][] = [];
  const meta = /<meta/gi;
  try {
    for (let found = meta.exec(bytes); found !== null; found = meta.exec(bytes)) {
      const after = found.index + found[0].length;
      const h1 = hAfter(after);
      if (!literalAtFirstH(bytes, h1)) {
        // No group can start: the exploration only walks `[^h]*?` up to
        // `h1` (or the end), 4 visits per byte — counted, not walked.
        mostSteps = Math.max(mostSteps, 1 + 4 * ((h1 === -1 ? bytes.length : h1) - after + 1));
        continue;
      }
      steps = 0;
      const end = match(PATTERN, 0, found.index, (pos) => pos);
      mostSteps = Math.max(mostSteps, steps);
      if (end !== -1) {
        matches.push([found.index, end]);
        meta.lastIndex = end;
      }
    }
  } catch (error) {
    if (error instanceof ExplorationCapped) return { complete: false, mostSteps, matches };
    throw error;
  }
  return { complete: true, mostSteps, matches };
}

/**
 * Whether a group can start at an attempt's first `h` (`h1`): `charset`
 * at `h1 - 1` or `http-equiv` at `h1` — `[^h]*?` cannot reach past `h1`.
 *
 * @param bytes The byte view.
 * @param h1 The first `h`/`H` after the attempt's `<meta` (`-1`: none).
 */
function literalAtFirstH(bytes: string, h1: number): boolean {
  return (
    h1 !== -1 &&
    (asciiCaselessAt(bytes, h1 - 1, 'charset') || asciiCaselessAt(bytes, h1, 'http-equiv'))
  );
}
