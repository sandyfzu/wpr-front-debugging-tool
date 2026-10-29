/**
 * The matches of WP Rocket's `<meta charset>` pattern, found in linear time
 * on any input — the pattern itself backtracks polynomially (a kilobyte of
 * `<meta charset` takes seconds as a regex). `U` makes every quantifier
 * lazy; written out, with `'` `"` as quotes:
 *
 * ```
 * <meta [^h]*? ( http-equiv [^=]*? = [^'"]*? ['" ] Content-Type ['"] [ ]*? [^>]*? | )
 *   ( charset [^=]*? = [ ]*? ['" ]*? T ['" ]*?  |  charset [^=]*? =*? T )
 *   ( [^>]*? | ) >            T = [^'"> ] [^'">]+? [^'"> ]
 * ```
 *
 * caseless (ASCII), on bytes, matched only before the last `</head>` (its
 * lookahead: the caller passes that text). Each lazy piece has few useful
 * stopping points, so an attempt at a `<meta` reduces to a handful of
 * "first X after Y" searches (derivation below), shared between attempts
 * through cached finders: each search region is read about once.
 *
 * From the attempt's `<meta`, `[^h]*?` cannot pass the first `h`/`H` (at
 * `h1`): `charset` can only start at `h1 - 1` (case A) and `http-equiv`
 * only at `h1` (case B) — both cannot hold. The `charset` group at `c`:
 *
 * - first branch: `[^=]*?=` stops at the first `=` (`q`); the quote/space
 *   run after it ends where `T` must start (`t`); nothing after `t` can
 *   pass a `>`, so the match ends past the first `>` after `t` — when `T`
 *   fits at `t` ({@link fitsTripletAt});
 * - second branch: `T` may start at any `t` from `c + 7` through the
 *   first `=` run after it; the first `t` where `T` fits wins (a later
 *   `t` never ends earlier), ending past the first `>` after it.
 *
 * In case B, `[^'"]*?` cannot pass the first quote (`Q`) after the first
 * `=`, so `Content-Type` sits at `Q - 12` (a space before it) or `Q + 1`
 * (the quote before it); `charset` then starts anywhere before the next
 * `>`, the first one whose group matches winning.
 */
import { cachedForwardSearch, type NextOccurrence } from '../../utils/next-occurrence';
import { asciiCaselessAt } from './pcre-text';

const QUOTE = 39;
const DOUBLE_QUOTE = 34;
const GT = 62;
const SPACE = 32;
const EQUALS = 61;
const H_LOWER = 104;
const H_UPPER = 72;

/** `charset` / `http-equiv` / `content-type`: the pattern's literals (lowercase). */
const CHARSET = 'charset';
const HTTP_EQUIV = 'http-equiv';
const CONTENT_TYPE = 'content-type';

/**
 * Whether a byte is a quote.
 *
 * @param code The byte (`NaN` past the end).
 */
function isQuote(code: number): boolean {
  return code === QUOTE || code === DOUBLE_QUOTE;
}

/**
 * A finder for the first byte satisfying `test`.
 *
 * @param bytes The byte view.
 * @param test The byte test.
 */
function byteFinder(bytes: string, test: (code: number) => boolean): NextOccurrence {
  return cachedForwardSearch((from, to) => {
    const stop = Math.min(to, bytes.length);
    for (let at = Math.max(from, 0); at < stop; at++) if (test(bytes.charCodeAt(at))) return at;
    return -1;
  });
}

/**
 * Whether `T` (`[^'"> ][^'">]+?[^'"> ]`) fits from `t`: `t` is no quote,
 * `>` or space, and a non-space byte follows at `t + 2` or later before
 * the next quote or `>`.
 *
 * @param bytes The byte view.
 * @param t Where `T` would start.
 * @returns Whether it fits, and where the walk stopped (the run's end when
 *   it does not: no later `t` in that run fits either).
 */
function fitsTripletAt(bytes: string, t: number): { readonly fits: boolean; readonly end: number } {
  const first = bytes.charCodeAt(t);
  if (Number.isNaN(first) || isQuote(first) || first === GT || first === SPACE) {
    return { fits: false, end: t };
  }
  for (let at = t + 1; at < bytes.length; at++) {
    const code = bytes.charCodeAt(at);
    if (isQuote(code) || code === GT) return { fits: false, end: at };
    if (at >= t + 2 && code !== SPACE) return { fits: true, end: at };
  }
  return { fits: false, end: bytes.length };
}

/**
 * A finder for the first `t` where `T` fits.
 *
 * @param bytes The byte view.
 */
function tripletFinder(bytes: string): NextOccurrence {
  return cachedForwardSearch((from, to) => {
    const stop = Math.min(to, bytes.length);
    for (let at = Math.max(from, 0); at < stop;) {
      const fit = fitsTripletAt(bytes, at);
      if (fit.fits) return at;
      // A failed walk proves every start up to where it stopped fails too.
      at = Math.max(at + 1, fit.end);
    }
    return -1;
  });
}

/** The `charset` group's matcher at a start: the match end, or `null`. */
type CharsetGroup = (c: number) => number | null;

/**
 * The `charset` group, with its own finders (each caller asks in
 * ascending order, which keeps every finder's reads linear).
 *
 * @param bytes The byte view.
 */
function charsetGroup(bytes: string): CharsetGroup {
  const equalsAfter = byteFinder(bytes, (code) => code === EQUALS);
  const gtAfterFirst = byteFinder(bytes, (code) => code === GT);
  const gtAfterSecond = byteFinder(bytes, (code) => code === GT);
  const tripletAfter = tripletFinder(bytes);
  // Both branches past one `=` depend on it only: remembered for the last one.
  let lastEquals = -2;
  let lastFirstEnd: number | null = null;
  let lastRunEnd = 0;
  const atEquals = (q: number): void => {
    if (q === lastEquals) return;
    lastEquals = q;
    let t = q + 1;
    while (t < bytes.length) {
      const code = bytes.charCodeAt(t);
      if (!isQuote(code) && code !== SPACE) break;
      t++;
    }
    const gt = fitsTripletAt(bytes, t).fits ? gtAfterFirst(t) : -1;
    lastFirstEnd = gt === -1 ? null : gt + 1;
    let run = q;
    while (bytes.charCodeAt(run) === EQUALS) run++;
    lastRunEnd = run;
  };
  return (c) => {
    const from = c + CHARSET.length;
    const q = equalsAfter(from);
    if (q !== -1) {
      atEquals(q);
      if (lastFirstEnd !== null) return lastFirstEnd;
    }
    const t = tripletAfter(from);
    // `[^=]*?=*?` reaches through the first `=` run (or the end without one).
    if (t === -1 || (q !== -1 && t > lastRunEnd)) return null;
    const gt = gtAfterSecond(t);
    return gt === -1 ? null : gt + 1;
  };
}

/**
 * Case B from `http-equiv` at `h1`: the match end, or `null`.
 *
 * @param bytes The byte view.
 * @param h1 Where `http-equiv` starts.
 * @param finders Case B's finders.
 * @param finders.equalsAfter `=` finder.
 * @param finders.quoteAfter Quote finder.
 * @param finders.gtAfter `>` finder.
 * @param finders.matchingCharsetAfter First `charset` whose group matches.
 * @param group Case B's `charset` group.
 */
function httpEquivEnd(
  bytes: string,
  h1: number,
  finders: {
    readonly equalsAfter: NextOccurrence;
    readonly quoteAfter: NextOccurrence;
    readonly gtAfter: NextOccurrence;
    readonly matchingCharsetAfter: NextOccurrence;
  },
  group: CharsetGroup
): number | null {
  const q1 = finders.equalsAfter(h1 + HTTP_EQUIV.length);
  if (q1 === -1) return null;
  const quote = finders.quoteAfter(q1 + 1);
  if (quote === -1) return null;
  const typeStarts: number[] = [];
  const spaced = quote - CONTENT_TYPE.length - 1;
  if (
    spaced >= q1 + 1 &&
    bytes.charCodeAt(spaced) === SPACE &&
    asciiCaselessAt(bytes, spaced + 1, CONTENT_TYPE)
  ) {
    typeStarts.push(spaced);
  }
  if (
    asciiCaselessAt(bytes, quote + 1, CONTENT_TYPE) &&
    isQuote(bytes.charCodeAt(quote + 1 + CONTENT_TYPE.length))
  ) {
    typeStarts.push(quote);
  }
  for (const r of typeStarts) {
    const from = r + CONTENT_TYPE.length + 2;
    const gt = finders.gtAfter(from);
    const c = finders.matchingCharsetAfter(from);
    if (c !== -1 && (gt === -1 || c < gt)) return group(c);
  }
  return null;
}

/**
 * Every match of the pattern, left to right, as byte spans.
 *
 * @param bytes The byte view of the text before the last `</head>`.
 * @returns `[start, end)` per match.
 */
export function metaCharsetByteSpans(bytes: string): [number, number][] {
  const spans: [number, number][] = [];
  const hAfter = byteFinder(bytes, (code) => code === H_LOWER || code === H_UPPER);
  const caseA = charsetGroup(bytes);
  const caseB = charsetGroup(bytes);
  const charsetWord = /charset/gi;
  const finders = {
    equalsAfter: byteFinder(bytes, (code) => code === EQUALS),
    quoteAfter: byteFinder(bytes, isQuote),
    gtAfter: byteFinder(bytes, (code) => code === GT),
    matchingCharsetAfter: cachedForwardSearch((from, to) => {
      // Bounded by `to`: a gap search must not read past it.
      const text =
        to === Number.POSITIVE_INFINITY ? bytes : bytes.slice(0, to + CHARSET.length - 1);
      charsetWord.lastIndex = Math.max(from, 0);
      for (let found = charsetWord.exec(text); found !== null; found = charsetWord.exec(text)) {
        if (caseB(found.index) !== null) return found.index;
      }
      return -1;
    })
  };
  // Attempts sharing `h1` share their outcome (case A needs `h1 - 1` past `<meta`).
  let lastH1 = -1;
  let lastEnd: number | null = null;
  const meta = /<meta/gi;
  for (let found = meta.exec(bytes); found !== null; found = meta.exec(bytes)) {
    const after = found.index + found[0].length;
    const h1 = hAfter(after);
    // No `h` left: no later attempt can match either.
    if (h1 === -1) break;
    if (h1 !== lastH1) {
      lastH1 = h1;
      if (asciiCaselessAt(bytes, h1 - 1, CHARSET)) lastEnd = caseA(h1 - 1);
      else if (asciiCaselessAt(bytes, h1, HTTP_EQUIV)) {
        lastEnd = httpEquivEnd(bytes, h1, finders, caseB);
      } else lastEnd = null;
    }
    // `charset` at `h1 - 1` always lies past this `<meta` (its `a` is no `c`).
    if (lastEnd !== null) {
      spans.push([found.index, lastEnd]);
      meta.lastIndex = lastEnd;
    }
  }
  return spans;
}
