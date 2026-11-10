/**
 * THE shared headers model: `PageHeaders` → the typed rows both header
 * surfaces render — the Detections page's response-headers preview and the
 * full Headers & Cookies page. One declaring site for the grouping and the
 * verdict copy, so the two consumers can never drift apart (adding a row or
 * retuning a hint is one edit here).
 *
 * Grouping: the caching-relevant rows come first, in the declared evidence
 * order (`cache-control`, the cache's `age` counter, the edge `x-cache`
 * probe, the WP Rocket headers, the host-layer markers (`host-layers`),
 * then the remaining probe and proxy hint names), each
 * keeping its capture order inside its group; every other header renders in
 * capture order after them. The whole capture stays present — rows are
 * moved into the caching group, never dropped.
 *
 * Honesty rules the copy: a hint is plain language about what the captured
 * row itself says ("HIT/MISS", a no-store directive, a positive `age`) —
 * hedgeable evidence, never a conflated verdict about whether the page as a
 * whole is cached. Each hint carries its evidence direction as a status
 * tone (`ok` served / `warn` not-served / `info` neutral) for the shared
 * status tables; the words, never the tone alone, state the verdict. A row
 * a template cannot read (unknown value shape, mixed/ambiguous tokens)
 * renders with its value and no hint instead of an invented one.
 */

import type { PageHeaders } from '../wp-rocket/types';
import { HOST_LAYERS, type MarkerReading } from '../detection/host-layers';
import { hostLayerHint } from '../detection/host-layer-hints';
import { PAYLOAD_LIMITS } from '../messaging/payload-bounds';
import { countNoun, formatCount, type CountNoun } from '../../utils/format-count';

/**
 * The status-vocabulary kinds a verdict hint can carry (rendered through the
 * shared `STATUS_*` tables). A hint is caching evidence, never a failure or a
 * mere absence, so `error`/`neutral` are not hint tones: `ok` marks evidence
 * a cache served the response, `warn` marks evidence it did not, `info`
 * marks a neutral intermediary fact. The tone never carries the verdict
 * alone — every hint's wording states it.
 */
export type HintTone = 'ok' | 'warn' | 'info';

/** A verdict hint: its plain copy and the tone that presents it. */
export interface VerdictHint {
  /** The plain-copy caching verdict (hedgeable evidence, never a page verdict). */
  readonly text: string;
  /** The evidence direction the copy states, for the status-vocabulary icon. */
  readonly tone: HintTone;
}

/** One typed header row: the captured pair plus its verdict hint (may be none). */
export interface HeaderRowVM {
  /** The header name exactly as captured. */
  readonly name: string;
  /** The captured value; null when the row carried no value or was withheld. */
  readonly value: string | null;
  /** The plain-copy caching verdict with its tone, or null when the row yields no hint. */
  readonly hint: VerdictHint | null;
  /** True when the capture withheld the value (a hint is then never computed). */
  readonly redacted: boolean;
  /** On a withheld `Set-Cookie` row only: the cookie name the capture kept. */
  readonly cookieName?: string;
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
  | { readonly exact: string; hint(value: string): VerdictHint | null }
  | { readonly prefix: string; hint(value: string): VerdictHint | null };

/** Name classification for one row: exact names compare, prefixes cover families. */
function classMatches(cachingClass: CachingHeaderClass, nameLower: string): boolean {
  if ('exact' in cachingClass) return nameLower === cachingClass.exact;
  return nameLower.startsWith(cachingClass.prefix);
}

/** First-cache-token reading for the HIT/MISS probe values (null = not clear). */
function hitMissVerdict(value: string, hitCopy: string, missCopy: string): VerdictHint | null {
  const token = (value.split(',')[0] ?? '').trim().toUpperCase();
  const hit = token.includes('HIT');
  const miss = token.includes('MISS');
  if (hit && miss) return null;
  if (hit) return { text: hitCopy, tone: 'ok' };
  if (miss) return { text: missCopy, tone: 'warn' };
  return null;
}

/**
 * The cache-control reading: the directives that decide whether the
 * response can be cached at all, whether it must revalidate first, or
 * whether it carries a freshness lifetime intermediates may serve from.
 */
function cacheControlVerdict(value: string): VerdictHint | null {
  const directives = value.toLowerCase();
  if (directives.includes('no-store')) {
    return {
      text: 'Instructs receivers not to cache anything — a likely reason no request ever hit a cache.',
      tone: 'warn'
    };
  }
  if (directives.includes('no-cache')) {
    return {
      text: 'Allows caching but requires revalidation before every reuse — no stale copy is served.',
      tone: 'info'
    };
  }
  if (/(?:s-)?max-age=0(?:[,\s]|$)/.test(directives)) {
    return {
      text: 'Zero freshness lifetime — every use must be revalidated first.',
      tone: 'warn'
    };
  }
  if (/(?:s-)?max-age=[1-9]/.test(directives)) {
    return {
      text: 'Carries a freshness lifetime — intermediate caches may serve the (fresh) copy: hittable.',
      tone: 'ok'
    };
  }
  return null;
}

/** The `age` counter's unit. */
const SECOND_NOUN: CountNoun = { one: 'second', other: 'seconds' };

/**
 * The `age` reading: the cache's own seconds-since-served counter. A
 * positive age is middle-cache evidence (the response was served by one);
 * a missing/zero/unparseable age says nothing on its own.
 */
function ageVerdict(value: string): VerdictHint | null {
  if (!/^\d+$/.test(value)) return null;
  const seconds = Number.parseInt(value, 10);
  return seconds > 0
    ? {
        text: `Served from an intermediate cache ${seconds.toString()} ${countNoun(seconds, SECOND_NOUN)} ago (the cache's own counter).`,
        tone: 'ok'
      }
    : null;
}

/** The status tone each host-layer reading presents. */
const READING_TONE: Readonly<Record<MarkerReading, HintTone>> = {
  served: 'ok',
  'not-served': 'warn',
  present: 'info'
};

/**
 * One caching class per host-layer marker, in the vocabulary's order: the
 * hint is the vocabulary's own copy, so the Headers page and the cache
 * verdict read a header one way.
 */
const HOST_LAYER_CLASSES: readonly CachingHeaderClass[] = HOST_LAYERS.flatMap((layer) =>
  layer.markers.map((marker) => ({
    exact: marker.header,
    hint: (value: string): VerdictHint | null => {
      const read = marker.read(value);
      const text = read === null ? null : hostLayerHint(marker.header, read);
      return read === null || text === null ? null : { text, tone: READING_TONE[read.reading] };
    }
  }))
);

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
    hint: () => ({
      text: "WP Rocket cache evidence on this response — the value is the plugin's own marker.",
      tone: 'ok'
    })
  },
  ...HOST_LAYER_CLASSES,
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
    hint: () => ({
      text: 'An edge cache layer handled the response (its id sits in the value).',
      tone: 'info'
    })
  },
  {
    exact: 'via',
    hint: () => ({
      text: 'An intermediary (proxy or CDN) passed this response along.',
      tone: 'info'
    })
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
    const placed = buckets.find(({ cachingClass }) => classMatches(cachingClass, nameLower));
    if (row.redacted === true) {
      // Withheld at capture: no value to read a verdict from, and the kept
      // cookie name (if any) is the row's only shown part.
      const withheld: HeaderRowVM = {
        name: row.name,
        value: null,
        hint: null,
        redacted: true,
        ...(row.cookieName === undefined ? {} : { cookieName: row.cookieName })
      };
      (placed?.rows ?? other).push(withheld);
      continue;
    }
    const base = {
      name: row.name,
      value: row.value === undefined ? null : row.value,
      redacted: false
    };
    if (placed === undefined) {
      // Unrelated inventory: full capture kept, capture order kept.
      other.push({ ...base, hint: null });
      continue;
    }
    // The verdict copy rides the classification: the registry class owns
    // its reading (copy + tone together, so they never drift), the trim
    // normalizes the compare against capture noise.
    placed.rows.push({ ...base, hint: placed.cachingClass.hint((row.value ?? '').trim()) });
  }
  return { caching: buckets.flatMap((bucket) => bucket.rows), other };
}

/** The renderable-empty shape (absent capture / nothing to render). */
function emptyViewModel(): HeadersViewModel {
  return { caching: [], other: [] };
}

/**
 * The one-line note for a capture the producer bounded (`pageHeadersTruncated`),
 * shared by the headers preview and the support report. The mark itself does
 * not say what was cut, so the cause is read off the rows: a list at the row
 * cap was capped; a name or value exactly at its length cap was clipped. A
 * mark neither explains falls back to a generic line.
 *
 * @param headers The served (bounded) rows.
 * @param truncated The capture's list-level mark.
 * @returns The note, or null when the capture is complete.
 */
export function headersTruncationNote(
  headers: PageHeaders,
  truncated: boolean | undefined
): string | null {
  if (truncated !== true) return null;
  const caps = PAYLOAD_LIMITS.headers;
  const capped = headers.length >= caps.count;
  // A withheld row's kept cookie name is clipped to the value cap too.
  const valuesClipped = headers.some(
    (row) => row.value?.length === caps.value || row.cookieName?.length === caps.value
  );
  const namesClipped = headers.some((row) => row.name.length === caps.name);
  const parts: string[] = [];
  if (valuesClipped)
    parts.push(`some header values were clipped to ${formatCount(caps.value)} characters`);
  if (namesClipped)
    parts.push(`some header names were clipped to ${formatCount(caps.name)} characters`);
  if (capped) parts.push(`the list was capped at ${formatCount(caps.count)} headers`);
  if (parts.length === 0) return 'Some headers were clipped.';
  const sentence = parts.join('; ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
