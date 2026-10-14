/**
 * THE shared headers model: `PageHeaders` → the typed rows both header
 * surfaces render — the Detections page's response-headers preview and the
 * full Headers & Cookies page. One declaring site for the grouping and the
 * verdict copy, so the two consumers can never drift apart (adding a row or
 * retuning a hint is one edit here).
 *
 * Grouping: the caching-relevant rows come first, in the declared evidence
 * order (`cache-control`, the cache's `age` counter, the edge `x-cache`
 * probes, the WP Rocket headers, then the CDN/proxy hint names), each
 * keeping its capture order inside its group; every other header renders in
 * capture order after them. The whole capture stays present — rows are
 * moved into the caching group, never dropped.
 *
 * Honesty rules the copy: a hint is plain language about what the captured
 * row itself says ("HIT/MISS", a no-store directive, a positive `age`) —
 * hedgeable evidence, never a conflated verdict about whether the page as a
 * whole is cached. A row a template cannot read (unknown value shape,
 * mixed/ambiguous tokens) renders with its value and no hint instead of an
 * invented one.
 */

import type { PageHeaders } from '../wp-rocket/types';

/** One typed header row: the captured pair plus its verdict hint (may be none). */
export interface HeaderRowVM {
  /** The header name exactly as captured. */
  readonly name: string;
  /** The captured value; null when the row carried no value. */
  readonly value: string | null;
  /** The plain-copy caching verdict, or null when the row yields no hint. */
  readonly hint: string | null;
}

/** The renderable header set: caching-relevant rows first, then the rest. */
export interface HeadersViewModel {
  readonly caching: readonly HeaderRowVM[];
  readonly other: readonly HeaderRowVM[];
}

/**
 * One caching-relevance class: how a header name classifies (exact name or
 * `x-rocket-` prefix) and what plain copy its value yields. Order in the
 * registry is the class's evidence precedence — a row lands in its first
 * matching class.
 */
type CachingHeaderClass =
  | { readonly exact: string; hint(value: string): string | null }
  | { readonly prefix: string; hint(value: string): string | null };

/** Name classification for one row: exact names compare, prefixes cover families. */
function classMatches(cachingClass: CachingHeaderClass, nameLower: string): boolean {
  if ('exact' in cachingClass) return nameLower === cachingClass.exact;
  return nameLower.startsWith(cachingClass.prefix);
}

/** First-cache-token reading for the HIT/MISS probe values (null = not clear). */
function hitMissVerdict(value: string, hitCopy: string, missCopy: string): string | null {
  const token = (value.split(',')[0] ?? '').trim().toUpperCase();
  const hit = token.includes('HIT');
  const miss = token.includes('MISS');
  if (hit && miss) return null;
  if (hit) return hitCopy;
  if (miss) return missCopy;
  return null;
}

/**
 * The cache-control reading: the directives that decide whether the
 * response can be cached at all, whether it must revalidate first, or
 * whether it carries a freshness lifetime intermediates may serve from.
 */
function cacheControlVerdict(value: string): string | null {
  const directives = value.toLowerCase();
  if (directives.includes('no-store')) {
    return 'Instructs receivers not to cache anything — a likely reason no request ever hit a cache.';
  }
  if (directives.includes('no-cache')) {
    return 'Allows caching but requires revalidation before every reuse — no stale copy is served.';
  }
  if (/(?:s-)?max-age=0(?:[,\s]|$)/.test(directives)) {
    return 'Zero freshness lifetime — every use must be revalidated first.';
  }
  if (/(?:s-)?max-age=[1-9]/.test(directives)) {
    return 'Carries a freshness lifetime — intermediate caches may serve the (fresh) copy: hittable.';
  }
  return null;
}

/**
 * The `age` reading: the cache's own seconds-since-served counter. A
 * positive age is middle-cache evidence (the response was served by one);
 * a missing/zero/unparseable age says nothing on its own.
 */
function ageVerdict(value: string): string | null {
  if (!/^\d+$/.test(value)) return null;
  const seconds = Number.parseInt(value, 10);
  return seconds > 0
    ? `Served from an intermediate cache ${seconds.toString()} second${seconds === 1 ? '' : 's'} ago (the cache's own counter).`
    : null;
}

/** The `cache-control` directive copy for Cloudflare's status values. */
function cloudflareVerdict(value: string): string | null {
  switch (value.toUpperCase()) {
    case 'DYNAMIC':
      return 'Cloudflare marks this response dynamic — it does not cache it here (DYNAMIC).';
    case 'BYPASS':
      return 'Cloudflare was told to skip its cache for this response (BYPASS).';
    case 'EXPIRED':
      return 'Cloudflare served its cached copy after it aged out and revalidated with origin (EXPIRED).';
    default:
      return hitMissVerdict(
        value,
        "Cloudflare's edge cache served this response from its cache (HIT).",
        "Cloudflare's edge cache did not serve this response (MISS)."
      );
  }
}

/**
 * The caching-relevance registry, in evidence precedence — first match
 * classifies. Names beyond it (the full header inventory) render grouped
 * after these, in capture order.
 */
const CACHING_CLASSES: readonly CachingHeaderClass[] = [
  { exact: 'cache-control', hint: cacheControlVerdict },
  { exact: 'age', hint: ageVerdict },
  {
    exact: 'x-cache',
    hint: (value) =>
      hitMissVerdict(
        value,
        'The edge/proxy cache reports it served this response from cache (HIT).',
        'The edge/proxy cache reports a miss — the response came from origin (MISS).'
      )
  },
  {
    prefix: 'x-rocket-',
    hint: () => "WP Rocket cache evidence on this response — the value is the plugin's own marker."
  },
  { exact: 'cf-cache-status', hint: cloudflareVerdict },
  {
    exact: 'x-cache-lookup',
    hint: (value) =>
      hitMissVerdict(
        value,
        'The lookup cache found this response (HIT).',
        'The lookup cache had to pass the request on (MISS).'
      )
  },
  {
    exact: 'x-litespeed-cache',
    hint: (value) =>
      hitMissVerdict(
        value,
        'The LiteSpeed cache served this response from cache (HIT).',
        'The LiteSpeed cache did not serve this response (MISS).'
      )
  },
  {
    exact: 'x-kinsta-cache',
    hint: (value) =>
      hitMissVerdict(
        value,
        "Kinsta's cache served this response from cache (HIT).",
        "Kinsta's cache did not serve this response (MISS)."
      )
  },
  {
    exact: 'x-served-by',
    hint: () => 'An edge cache layer handled the response (its id sits in the value).'
  },
  {
    exact: 'via',
    hint: () => 'An intermediary (proxy or CDN) passed this response along.'
  }
];

/**
 * Build the typed rows for one capture: caching-relevant rows first (their
 * registry order, capture order inside), then the rest in capture order.
 * Rows are moved, never dropped, so the model renders the whole capture.
 * A missing capture (`null`) and an empty capture both resolve to the
 * renderable-empty shape.
 *
 * @param headers The captured main-frame headers, or null when nothing was captured.
 */
export function buildHeadersViewModel(headers: PageHeaders | null): HeadersViewModel {
  if (headers === null) return emptyViewModel();
  // One bucket per class, pre-built in registry order; the unrelated rows
  // accumulate separately, in their capture order. Classification is
  // find-based (no index arithmetic), so the evidence order is structural.
  const buckets = CACHING_CLASSES.map((cachingClass) => ({
    cachingClass,
    rows: [] as HeaderRowVM[]
  }));
  const other: HeaderRowVM[] = [];
  for (const row of headers) {
    const nameLower = row.name.toLowerCase();
    const base = {
      name: row.name,
      value: row.value === undefined ? null : row.value
    };
    const placed = buckets.find(({ cachingClass }) => classMatches(cachingClass, nameLower));
    if (placed === undefined) {
      // Unrelated inventory: full capture kept, capture order kept.
      other.push({ ...base, hint: null });
      continue;
    }
    // The verdict copy rides the classification: the registry class owns
    // its reading, the trim normalizes the compare against capture noise.
    placed.rows.push({ ...base, hint: placed.cachingClass.hint((row.value ?? '').trim()) });
  }
  return { caching: buckets.flatMap((bucket) => bucket.rows), other };
}

/** The renderable-empty shape (absent capture / nothing to render). */
function emptyViewModel(): HeadersViewModel {
  return { caching: [], other: [] };
}
