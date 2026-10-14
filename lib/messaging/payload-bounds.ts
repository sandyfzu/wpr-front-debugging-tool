/**
 * The size contract of page-derived payloads, shared by both ends of the
 * boundary: the producers bound their output with the functions below, the
 * receiving guards (`./validate`) enforce the same caps.
 *
 * Pages are unbounded, so legitimate page data can exceed any cap (a page with
 * 1,226 preloaded images is real). A producer therefore never sends an
 * oversize row: it keeps the first `count` entries (document order) and clips
 * strings to their `chars`, and marks every row it cut with `truncated: true`
 * (see `TruncationMark`) so consumers can say the list is partial. The guards
 * keep rejecting any violation wholesale — a bounded payload always passes,
 * and only a forged or drifted sender can fail them.
 *
 * Why the totals matter, not just the per-item caps: Chrome refuses any
 * extension message over 64 MiB
 * (https://developer.chrome.com/docs/extensions/develop/concepts/messaging,
 * "Message size limits"), so the one unbounded-in-practice field — inline
 * script text — also carries a per-payload character budget.
 */

import type {
  DelayedScriptRecord,
  LazyloadImageRecord,
  PageHeader,
  PageHeaderCapture,
  PreloadedResources,
  WprDetections
} from '../wp-rocket/types';

/**
 * Count/length caps per page-derived structure. Generous (real pages sit far
 * below), and the single declaring site for producer and guard alike.
 */
export const PAYLOAD_LIMITS = {
  /** Captured response headers: rows, and per-row name/value lengths. */
  headers: { count: 256, name: 512, value: 4096 },
  /**
   * Delay JS: script rows, src URL, inline content per script, and inline
   * content summed over the whole list (8 Mi chars stays far inside the
   * message ceiling even when every char serializes as a 6-byte escape).
   */
  delayScripts: { count: 5_000, src: 4096, content: 512 * 1024, contentTotal: 8 * 1024 * 1024 },
  /** Defer JS sources. */
  deferScripts: { count: 5_000, chars: 4096 },
  /** Lazyload per-image records. */
  images: { count: 5_000, src: 4096 },
  /** Preloaded subresource rows. */
  preloaded: { count: 5_000, href: 4096, type: 64 },
  /** Preloaded critical-image URL lists. */
  preloadedImages: { count: 1_000, chars: 4096 },
  /** Priority-Elements: font-preload list and preconnect domain list. */
  fonts: { count: 1_000, chars: 4096 },
  domains: { count: 500, chars: 2048 },
  /** Version strings read off the page. */
  versions: 64
} as const;

/** Whether anything was cut while one row was rebuilt. */
interface CutTracker {
  cut: boolean;
}

/**
 * Clip a string to `max` UTF-16 units, never ending on half a surrogate pair
 * (a lone high surrogate would render as a replacement glyph).
 *
 * @param value The string to bound.
 * @param max The cap (≥ 1 for the non-empty fields, so a clip stays non-empty).
 * @param tracker Set when the string was clipped.
 * @returns The value itself when within the cap, else its clipped prefix.
 */
export function clipString(value: string, max: number, tracker: CutTracker): string {
  if (value.length <= max) return value;
  tracker.cut = true;
  const lastKept = value.charCodeAt(max - 1);
  const splitsPair = max > 1 && lastKept >= 0xd800 && lastKept <= 0xdbff;
  return value.slice(0, splitsPair ? max - 1 : max);
}

/**
 * Keep the first `max` items of a list, each bounded by `bound`.
 *
 * @returns A new bounded list (the caller discards it when nothing was cut).
 */
function boundList<T>(
  items: readonly T[],
  max: number,
  tracker: CutTracker,
  bound: (item: T) => T
): T[] {
  if (items.length > max) tracker.cut = true;
  return items.slice(0, max).map(bound);
}

/** Bound a list of strings by count and per-item length. */
function boundStrings(
  items: readonly string[],
  limits: { count: number; chars: number },
  tracker: CutTracker
): string[] {
  return boundList(items, limits.count, tracker, (item) => clipString(item, limits.chars, tracker));
}

/**
 * Bound one row: `rebuild` returns the row's bounded fields while recording
 * any cut on the tracker.
 *
 * @returns The row itself when nothing was cut (no copy, no mark), else the
 *   row with its bounded fields and `truncated: true`.
 */
function boundRow<R extends object>(row: R, rebuild: (tracker: CutTracker) => Partial<R>): R {
  const tracker: CutTracker = { cut: false };
  const bounded = rebuild(tracker);
  return tracker.cut ? { ...row, ...bounded, truncated: true } : row;
}

/** A nullable page version within its cap. */
function boundVersion(version: string | null, tracker: CutTracker): string | null {
  return version === null ? null : clipString(version, PAYLOAD_LIMITS.versions, tracker);
}

/**
 * Delay JS records: src and inline content within their per-script caps, and
 * the inline content within the list's total budget (document order — once
 * spent, later scripts carry empty content, a legitimate engine value).
 */
function boundDelayedScripts(
  scripts: readonly DelayedScriptRecord[],
  tracker: CutTracker
): DelayedScriptRecord[] {
  const caps = PAYLOAD_LIMITS.delayScripts;
  let budget = caps.contentTotal;
  return boundList(scripts, caps.count, tracker, (script) => {
    const out = { ...script };
    if (script.src !== undefined) out.src = clipString(script.src, caps.src, tracker);
    if (script.content !== undefined) {
      out.content = clipString(script.content, Math.min(caps.content, budget), tracker);
      budget -= out.content.length;
    }
    return out;
  });
}

/**
 * Bound a detection result to {@link PAYLOAD_LIMITS} before it crosses the
 * boundary. Rows within their caps come back as the same objects.
 *
 * @param detections The engine's full result (left untouched).
 * @returns The bounded result; each cut row carries `truncated: true`.
 */
export function boundWprDetections(detections: WprDetections): WprDetections {
  const limits = PAYLOAD_LIMITS;
  const atf = detections.rocket_above_the_fold_optimization;
  return {
    ...detections,
    wpr: boundRow(detections.wpr, (t) => ({ version: boundVersion(detections.wpr.version, t) })),
    delay_js: boundRow(detections.delay_js, (t) => ({
      scripts: boundDelayedScripts(detections.delay_js.scripts, t),
      version: boundVersion(detections.delay_js.version, t)
    })),
    defer_all_js: boundRow(detections.defer_all_js, (t) => ({
      scripts: boundStrings(detections.defer_all_js.scripts, limits.deferScripts, t)
    })),
    lazyload: boundRow(detections.lazyload, (t) => ({
      images: boundList(
        detections.lazyload.images,
        limits.images.count,
        t,
        (image): LazyloadImageRecord => ({
          ...image,
          src: clipString(image.src, limits.images.src, t)
        })
      )
    })),
    rocket_above_the_fold_optimization: boundRow(atf, (t) =>
      atf.preloadedImages === undefined
        ? {}
        : { preloadedImages: boundStrings(atf.preloadedImages, limits.preloadedImages, t) }
    ),
    auto_preload_fonts: boundRow(detections.auto_preload_fonts, (t) => ({
      fonts: boundStrings(detections.auto_preload_fonts.fonts, limits.fonts, t)
    })),
    preconnect_external_domains: boundRow(detections.preconnect_external_domains, (t) => ({
      domains: boundStrings(detections.preconnect_external_domains.domains, limits.domains, t)
    }))
  };
}

/**
 * Bound the preloaded-resources report to {@link PAYLOAD_LIMITS}.
 *
 * @param report The engine's full report (left untouched).
 * @returns The bounded report, `truncated: true` when anything was cut; the
 *   report itself when nothing was.
 */
export function boundPreloadedResources(report: PreloadedResources): PreloadedResources {
  const caps = PAYLOAD_LIMITS.preloaded;
  const resources = report.resources;
  if (resources === undefined) return report;
  return boundRow(report, (t) => ({
    resources: boundList(resources, caps.count, t, (resource) => ({
      href: clipString(resource.href, caps.href, t),
      type: clipString(resource.type, caps.type, t)
    }))
  }));
}

/**
 * Bound a main frame's captured headers: the first rows up to the count cap,
 * names and values clipped. Shape problems (a non-string name, …) are left
 * for the guard to reject — bounding never repairs a malformed capture.
 *
 * @param headers The rows as captured.
 * @returns The bounded capture, `truncated: true` when anything was cut.
 */
export function boundPageHeaders(headers: readonly PageHeader[]): PageHeaderCapture {
  const caps = PAYLOAD_LIMITS.headers;
  return boundRow({ headers }, (t) => ({
    headers: boundList(headers, caps.count, t, (row) => {
      if (typeof row.name !== 'string') return row;
      const name = clipString(row.name, caps.name, t);
      return typeof row.value === 'string'
        ? { name, value: clipString(row.value, caps.value, t) }
        : { name };
    })
  }));
}
