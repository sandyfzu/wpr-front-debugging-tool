/**
 * Boundary guards for message payloads and storage reads.
 *
 * Everything crossing a boundary (message data, storage values, page-derived
 * JSON) is untrusted: hostile, oversized or wrong-shaped. Guards return the
 * typed value or `null` — a rejected payload is an expected branch for callers,
 * never an exception — and accepted values are freshly built, structurally
 * checked objects (own enumerable keys only, so prototype pollution carries
 * no meaning).
 *
 * Size policy: every repeated structure carries a generous count cap (real
 * pages stay far below; see `LIMITS`) and every string carries a length cap.
 * A violation rejects the whole row/guard — never a silent partial cut — so
 * callers branch on the rejection instead of rendering truncated data.
 */

import type {
  BeaconFeatureStatus,
  DiagnoserDocData,
  FdtData,
  PageHeaders,
  PanelSearchAction,
  PreloadedResources,
  WprDetections
} from '../wp-rocket/types';
import type { KnownConflict } from '../storage/known-conflicts';
import {
  BEACON_CONFIG_LIMITS,
  BEACON_CONFIG_LIST_FIELDS,
  BEACON_STATUS_KEYS,
  LAZYLOAD_EXCLUSIONS_LIST
} from '../wp-rocket/constants';
import { PANEL_SEARCH_ACTIONS } from '../wp-rocket/types';
import { isRecord } from '../../utils/is-record';
import { ERROR_WORD_LIMITS, isPrintable } from './error-words';

/**
 * Count/length caps per structure. Generous by design (real pages sit orders
 * of magnitude below), uniform in behavior: violation ⇒ the guard returns
 * `null` for the whole row. The word row is the error-words contract, shared
 * with the MAIN-world capture side (see `./error-words`).
 */
const LIMITS = {
  // The word row's acceptance caps live in the shared contract (`./error-words`),
  // sourced once by both sides of the window bridge.
  words: ERROR_WORD_LIMITS,
  /** Captured response headers: rows, and per-row name/value lengths. */
  headers: { count: 256, name: 512, value: 4096 },
  /** Delay JS: script rows, src URL, inline content. */
  delayScripts: { count: 5_000, src: 4096, content: 512 * 1024 },
  /** Defer JS sources. */
  deferScripts: { count: 5_000, chars: 4096 },
  /** Lazyload per-image records and their exclusion-reason lists. */
  images: { count: 5_000, src: 4096 },
  /** Preloaded subresource rows. */
  preloaded: { count: 5_000, href: 4096, type: 64 },
  /** Preloaded critical-image URL lists. */
  preloadedImages: { count: 1_000, chars: 4096 },
  /** Priority-Elements: font-preload list and preconnect domain list. */
  fonts: { count: 1_000, chars: 4096 },
  domains: { count: 500, chars: 2048 },
  knownConflicts: {
    count: 500,
    id: 64,
    type: 64,
    name: 256,
    detection_pattern: 512,
    summary: 512,
    issue_description: 8_192,
    url: 2_048
  },
  searchQuery: 200,
  versions: 64
} as const;

/** All members are strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// The printability rule and the word caps' canonical home is the shared
// contract; re-exported so every caller of this guard module reads one public
// path while the MAIN-world capture side imports the (side-effect-free) leaf.
export { ERROR_WORD_LIMITS, isPrintable } from './error-words';

/** Toolbar badge input: exactly two booleans about the page. */
export interface DetectionSummary {
  wprPresent: boolean;
  cached: boolean;
}

/** KC-DB refresh outcome relayed from the background to the options surface. */
export interface DbUpdateResult {
  updatedAt: number;
}

/**
 * Parse the undefined-references word list: strings of 1–200 printable chars,
 * at most 50 of them. A batch beyond the limits is rejected as a whole — the
 * capture side owns producing well-formed batches (its own cap is lower).
 *
 * @returns The words, or null when the batch violates shape/limits.
 */
export function parseErrorWords(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length > LIMITS.words.count) return null;
  const words: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string' || item.length < 1 || item.length > LIMITS.words.chars)
      return null;
    if (!isPrintable(item)) return null;
    words.push(item);
  }
  return words;
}

/**
 * Parse captured response headers: `{ name, value? }` rows, bounded per
 * {@link LIMITS.headers}. Rows are rebuilt as own-key objects with no keys
 * beyond name/value; a missing value key (or an `undefined` one, which is
 * indistinguishable) stays missing.
 */
export function parsePageHeaders(input: unknown): PageHeaders | null {
  if (!Array.isArray(input) || input.length > LIMITS.headers.count) return null;
  for (const item of input) {
    if (!isRecord(item)) return null;
    const keys = Object.keys(item);
    if (keys.length > 2) return null;
    for (const key of keys) {
      if (key !== 'name' && key !== 'value') return null;
    }
    const name = item['name'];
    if (typeof name !== 'string' || name.length < 1 || name.length > LIMITS.headers.name)
      return null;
    const value = item['value'];
    if (value !== undefined && (typeof value !== 'string' || value.length > LIMITS.headers.value))
      return null;
  }
  return input.map((item) => {
    const row = item as { name: string; value?: string };
    return typeof row.value === 'string'
      ? { name: row.name, value: row.value }
      : { name: row.name };
  });
}

/**
 * Total number of undefined-reference words a page's list may hold. Derived
 * from the batch cap above: whether the words arrive in one batch or several,
 * the accumulated list can never exceed what a single valid batch could carry.
 */
export const ERROR_WORD_LIMIT = LIMITS.words.count;

/** Exact two-boolean page summary consumed by the toolbar badge. */
export function parseDetectionSummary(input: unknown): DetectionSummary | null {
  if (!isRecord(input) || Object.keys(input).length !== 2) return null;
  const wprPresent = input['wprPresent'];
  const cached = input['cached'];
  if (typeof wprPresent !== 'boolean' || typeof cached !== 'boolean') return null;
  return { wprPresent, cached };
}

/** KC-DB refresh outcome relayed from the background to the options surface. */
export function parseDbUpdateResult(input: unknown): DbUpdateResult | null {
  if (input === null) return null;
  if (!isRecord(input)) return null;
  const updatedAt = input['updatedAt'];
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;
  return { updatedAt };
}

/**
 * Structural sanity for the parsed diagnoser report — the payload itself is
 * arbitrary page-provided JSON, so only the two report slots are checked here
 * (`null` or object) and both slots are rebuilt as fresh own-key objects;
 * depth, hostile values and rendering stay with consumers.
 */
export function parseDiagnoserData(input: unknown): DiagnoserDocData | null {
  if (!isRecord(input)) return null;
  const noRocket = input['noRocketData'];
  const rocket = input['rocketData'];
  return {
    noRocketData: isRecord(noRocket) ? { ...noRocket } : null,
    rocketData: isRecord(rocket) ? { ...rocket } : null
  };
}

/**
 * Validate KnownConflict rows (the committed seed or a fetched DB update).
 *
 * @returns The rows, or null when any entry lacks name/url, carries wrong
 *   field types, or exceeds the caps — the DB is checked as a unit so P2's
 *   updater can reject a corrupt fetch wholesale instead of storing partial
 *   rows. Unknown extra fields are tolerated (not rejected, not carried): a
 *   future DB version may add fields without breaking this reader, and the
 *   fresh rebuilt rows stay the canonical shape.
 */
export function parseKnownConflicts(input: unknown): KnownConflict[] | null {
  const caps = LIMITS.knownConflicts;
  if (!Array.isArray(input) || input.length > caps.count) return null;
  const rows: KnownConflict[] = [];
  for (const item of input) {
    if (!isRecord(item)) return null;
    // Explicit per-field checks narrow each value's type for the rebuild.
    const id = item['id'];
    const type = item['type'];
    const name = item['name'];
    const detectionPattern = item['detection_pattern'];
    const summary = item['summary'];
    const issueDescription = item['issue_description'];
    const url = item['url'];
    if (!isUsableString(id, caps.id) || !isUsableString(type, caps.type)) return null;
    if (!isUsableString(name, caps.name) || !isUsableString(url, caps.url)) return null;
    if (detectionPattern !== null && !isUsableString(detectionPattern, caps.detection_pattern))
      return null;
    if (summary !== null && !isUsableString(summary, caps.summary)) return null;
    if (!isBoundedString(issueDescription, caps.issue_description)) return null;
    rows.push({
      id,
      type,
      name,
      detection_pattern: detectionPattern,
      summary,
      issue_description: issueDescription,
      url
    });
  }
  return rows;
}

/** A string within a cap (no empty check — that stays explicit per field). */
function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

/** Null, or a non-empty string within a cap (the engines' version semantics). */
function isBoundedNullableString(value: unknown, max: number): value is string | null {
  if (value === null) return true;
  return isUsableString(value, max);
}

/** A non-empty string within a cap. */
function isUsableString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= max;
}

/** Structural sanity for the per-page preloaded-resources report. */
export function parsePreloadedResources(input: unknown): PreloadedResources | null {
  if (!isRecord(input)) return null;
  const present = input['present'];
  if (typeof present !== 'boolean') return null;
  const keys = new Set(Object.keys(input));
  if (!present) return keys.size === 1 ? { present: false } : null;
  if (!keys.has('resources') || keys.size !== 2 || !Array.isArray(input['resources'])) return null;
  if (input['resources'].length > LIMITS.preloaded.count) return null;
  const out: PreloadedResources['resources'] = [];
  for (const item of input['resources']) {
    if (!isRecord(item)) return null;
    if (Object.keys(item).length !== 2) return null;
    // An empty href is legitimate engine output (a srcset-only preload hint
    // has no href attribute — the same '' entry the image lists carry).
    if (!isBoundedString(item['href'], LIMITS.preloaded.href)) return null;
    if (!isBoundedString(item['type'], LIMITS.preloaded.type)) return null;
    out.push({ href: item['href'], type: item['type'] });
  }
  return { present: true, resources: out };
}

/**
 * Deep structural check of page detections delivered through messaging.
 * Every detection row must be present and correctly shaped — the content
 * script is our own code, so a missing row means a corrupt or foreign
 * payload, which the panel renders as an error state rather than guessing.
 */
export function parseWprDetections(input: unknown): WprDetections | null {
  if (!isRecord(input)) return null;
  const wprRaw = input['wpr'];
  if (!isRecord(wprRaw)) return null;
  const wpr = { ...wprRaw };
  if (
    typeof wpr['present'] !== 'boolean' ||
    typeof wpr['cached'] !== 'boolean' ||
    !isBoundedNullableString(wpr['version'], LIMITS.versions) ||
    (wpr['timeStamp'] !== null &&
      (typeof wpr['timeStamp'] !== 'number' || !Number.isFinite(wpr['timeStamp']))) ||
    Object.keys(wpr).length !== 4
  ) {
    return null;
  }

  const removeUnusedCss = parsePresenceRow(input['remove_unused_css']);
  const asyncCss = parsePresenceRow(input['async_css']);
  const lazyloadCssBgImg = parsePresenceRow(input['lazyload_css_bg_img']);
  const minifyCss = parsePresenceRow(input['minify_css']);
  const minifyJs = parsePresenceRow(input['minify_js']);
  const preloadLinks = parsePresenceRow(input['preload_links']);
  const rocketCdn = parsePresenceRow(input['rocket_cdn']);
  const delayJs = parseDelayJsRow(input['delay_js']);
  const deferAllJs = parseDeferRow(input['defer_all_js']);
  const lazyload = parseLazyloadRow(input['lazyload']);
  const lazyloadIframes = parseIframesRow(input['lazyload_iframes']);
  const aboveTheFold = parseOptimizeCriticalImagesRow(input['rocket_above_the_fold_optimization']);
  const lazyRender = parseLazyRenderRow(input['automatic_lazy_rendering']);
  const preloadFonts = parsePreloadFontsRow(input['auto_preload_fonts']);
  const preconnectDomains = parsePreconnectRow(input['preconnect_external_domains']);
  const beacon = parseBeaconRow(input['priority_elements_beacon']);
  if (
    removeUnusedCss === null ||
    asyncCss === null ||
    lazyloadCssBgImg === null ||
    minifyCss === null ||
    minifyJs === null ||
    preloadLinks === null ||
    rocketCdn === null ||
    delayJs === null ||
    deferAllJs === null ||
    lazyload === null ||
    lazyloadIframes === null ||
    aboveTheFold === null ||
    lazyRender === null ||
    preloadFonts === null ||
    preconnectDomains === null ||
    beacon === null
  ) {
    return null;
  }
  return {
    wpr: {
      present: wpr['present'],
      cached: wpr['cached'],
      version: wpr['version'],
      timeStamp: wpr['timeStamp']
    },
    remove_unused_css: removeUnusedCss,
    async_css: asyncCss,
    lazyload_css_bg_img: lazyloadCssBgImg,
    minify_css: minifyCss,
    minify_js: minifyJs,
    preload_links: preloadLinks,
    rocket_cdn: rocketCdn,
    delay_js: delayJs,
    defer_all_js: deferAllJs,
    lazyload,
    lazyload_iframes: lazyloadIframes,
    rocket_above_the_fold_optimization: aboveTheFold,
    automatic_lazy_rendering: lazyRender,
    auto_preload_fonts: preloadFonts,
    preconnect_external_domains: preconnectDomains,
    priority_elements_beacon: beacon
  };
}

/** `{ present }`-shaped row with exactly that key, own keys only. */
function parsePresenceRow(input: unknown): { present: boolean } | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  if (Object.keys(row).length !== 1) return null;
  return typeof row['present'] === 'boolean' ? { present: row['present'] } : null;
}

/** Delay JS row: script list plus presence/version/count bookkeeping. */
function parseDelayJsRow(input: unknown): WprDetections['delay_js'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  if (
    typeof row['present'] !== 'boolean' ||
    !isBoundedNullableString(row['version'], LIMITS.versions) ||
    typeof row['delayedScripts'] !== 'number' ||
    !Number.isFinite(row['delayedScripts']) ||
    row['delayedScripts'] < 0 ||
    Object.keys(row).length !== 4 ||
    !Array.isArray(row['scripts'])
  ) {
    return null;
  }
  const scripts: WprDetections['delay_js']['scripts'] = [];
  if (row['scripts'].length > LIMITS.delayScripts.count) return null;
  for (const rawItem of row['scripts']) {
    // Spread first: only own keys survive, so inherited (poisoned) records
    // arrive as empty objects and fail the shape checks below.
    if (!isRecord(rawItem)) return null;
    const item = { ...rawItem };
    const inline = item['inline'];
    if (typeof inline !== 'boolean') return null;
    const src = item['src'];
    const content = item['content'];
    // Empty src/content are legitimate engine outputs (empty attributes,
    // empty inline scripts) — only non-strings or oversizes reject.
    if (src !== undefined && !isBoundedString(src, LIMITS.delayScripts.src)) return null;
    if (content !== undefined && !isBoundedString(content, LIMITS.delayScripts.content))
      return null;
    const delayed = item['delayed'];
    const deferred = item['deferred'];
    const deferredByWPR = item['deferredByWPR'];
    const fdtExcluded = item['fdtExcluded'];
    if (
      typeof delayed !== 'boolean' ||
      typeof deferred !== 'boolean' ||
      typeof deferredByWPR !== 'boolean' ||
      (fdtExcluded !== null && typeof fdtExcluded !== 'string')
    ) {
      return null;
    }
    const record: WprDetections['delay_js']['scripts'][number] = {
      delayed,
      inline,
      deferred,
      deferredByWPR,
      fdtExcluded
    };
    if (src !== undefined) record.src = src;
    if (content !== undefined) record.content = content;
    scripts.push(record);
  }
  return {
    present: row['present'],
    scripts,
    version: row['version'],
    delayedScripts: row['delayedScripts']
  };
}

/** Defer JS row: the source list of every WP Rocket-deferred script. */
function parseDeferRow(input: unknown): WprDetections['defer_all_js'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  if (typeof row['present'] !== 'boolean') return null;
  if (Object.keys(row).length !== 2 || !Array.isArray(row['scripts'])) return null;
  if (!isStringArray(row['scripts'])) return null;
  if (row['scripts'].length > LIMITS.deferScripts.count) return null;
  if (row['scripts'].some((src) => src.length > LIMITS.deferScripts.chars)) return null;
  return { present: row['present'], scripts: [...row['scripts']] };
}

/** The reason domain is the exclusion list itself; more entries is malformed. */
const LAZYLOAD_REASON_LIMIT = LAZYLOAD_EXCLUSIONS_LIST.length;

/** Lazyload row: one record per <img>, in document order. */
function parseLazyloadRow(input: unknown): WprDetections['lazyload'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  if (typeof row['present'] !== 'boolean') return null;
  if (Object.keys(row).length !== 2 || !Array.isArray(row['images'])) return null;
  if (row['images'].length > LIMITS.images.count) return null;
  const images: WprDetections['lazyload']['images'] = [];
  for (const rawItem of row['images']) {
    if (!isRecord(rawItem)) return null;
    const item = { ...rawItem };
    if (Object.keys(item).length !== 3) return null;
    if (!isBoundedString(item['src'], LIMITS.images.src)) return null;
    if (typeof item['lazyloadDetected'] !== 'boolean') return null;
    if (!isStringArray(item['excludedReasonsFound'])) return null;
    const reasons = item['excludedReasonsFound'];
    if (reasons.length > LAZYLOAD_REASON_LIMIT) return null;
    images.push({
      src: item['src'],
      lazyloadDetected: item['lazyloadDetected'],
      excludedReasonsFound: [...reasons]
    });
  }
  return { present: row['present'], images };
}

/** Iframes row: presence plus the youtube-replacement script marker. */
function parseIframesRow(input: unknown): WprDetections['lazyload_iframes'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  if (Object.keys(row).length !== 2) return null;
  if (typeof row['present'] !== 'boolean' || typeof row['replaceImage'] !== 'boolean') return null;
  return { present: row['present'], replaceImage: row['replaceImage'] };
}

/**
 * Optimize-critical-images row: the applied evidence decides presence
 * (present ⇔ image list non-empty — the engines' contract); the feature
 * comment is independent corroboration carried either way.
 */
function parseOptimizeCriticalImagesRow(
  input: unknown
): WprDetections['rocket_above_the_fold_optimization'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  const present = row['present'];
  const lcpComment = row['lcpComment'];
  if (typeof present !== 'boolean' || typeof lcpComment !== 'boolean') return null;
  const keys = new Set(Object.keys(row));
  if (!keys.has('present') || !keys.has('lcpComment')) return null;
  if (!present) {
    // The engines emit exactly `{ present: false, lcpComment }` — an image
    // list alongside it is not engine output, so it rejects.
    if (keys.size !== 2) return null;
    return { present: false, lcpComment };
  }
  if (!keys.has('preloadedImages') || keys.size !== 3 || !isStringArray(row['preloadedImages'])) {
    return null;
  }
  if (row['preloadedImages'].length < 1) return null;
  if (row['preloadedImages'].length > LIMITS.preloadedImages.count) return null;
  if (row['preloadedImages'].some((url) => url.length > LIMITS.preloadedImages.chars)) return null;
  return {
    present,
    lcpComment,
    preloadedImages: [...row['preloadedImages']]
  };
}

/**
 * Automatic-Lazy-Rendering row: present ⇔ converted elements ≥ 1 (the
 * applied verdict); the style marker and hash count ride along as page facts.
 */
function parseLazyRenderRow(input: unknown): WprDetections['automatic_lazy_rendering'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  if (Object.keys(row).length !== 4) return null;
  const present = row['present'];
  const inlineCssPresent = row['inlineCssPresent'];
  if (typeof present !== 'boolean' || typeof inlineCssPresent !== 'boolean') return null;
  const lazyRenderElements = parseElementCount(row['lazyRenderElements']);
  const locationHashes = parseElementCount(row['locationHashes']);
  if (lazyRenderElements === null || locationHashes === null) return null;
  if (present !== lazyRenderElements > 0) return null;
  return { present, lazyRenderElements, inlineCssPresent, locationHashes };
}

/** A non-negative finite integer element count (a scalar — no size cap). */
function parseElementCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/** Preload-fonts row: present ⇔ the attributed font list is non-empty. */
function parsePreloadFontsRow(input: unknown): WprDetections['auto_preload_fonts'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  if (Object.keys(row).length !== 2) return null;
  const present = row['present'];
  if (typeof present !== 'boolean') return null;
  if (present) {
    const fonts = parseCappedStringList(row['fonts'], LIMITS.fonts);
    if (fonts === null || fonts.length < 1) return null;
    return { present: true, fonts };
  }
  // Absent feature: the engines emit an empty list, never a populated one.
  if (!isStringArray(row['fonts']) || row['fonts'].length !== 0) return null;
  return { present: false, fonts: [] };
}

/** Preconnect row: present ⇔ the attributed domain list is non-empty. */
function parsePreconnectRow(input: unknown): WprDetections['preconnect_external_domains'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  if (Object.keys(row).length !== 3) return null;
  const present = row['present'];
  if (typeof present !== 'boolean') return null;
  const preconnectCount = parseElementCount(row['preconnectCount']);
  if (preconnectCount === null) return null;
  if (present) {
    const domains = parseCappedStringList(row['domains'], LIMITS.domains);
    if (domains === null || domains.length < 1) return null;
    return { present: true, domains, preconnectCount };
  }
  if (!isStringArray(row['domains']) || row['domains'].length !== 0) return null;
  return { present: false, domains: [], preconnectCount };
}

/** Row keys beyond the three base ones the beacon row may carry. */
const BEACON_ROW_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  'elements',
  ...BEACON_CONFIG_LIST_FIELDS
]);

/**
 * Priority-Elements beacon row: the three base keys always; the config
 * payload only on a present beacon whose config parsed — status null ⇒ no
 * payload fields and isMobile null (a degraded config degrades wholesale).
 * The status map itself re-runs the config rules (known keys boolean,
 * unknown keys bounded primitives) so a forged sender gains nothing.
 */
function parseBeaconRow(input: unknown): WprDetections['priority_elements_beacon'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  const present = row['present'];
  if (typeof present !== 'boolean') return null;
  const keys = new Set(Object.keys(row));
  if (!keys.has('present') || !keys.has('status') || !keys.has('isMobile')) return null;

  const isMobile = row['isMobile'];
  if (isMobile !== null && typeof isMobile !== 'boolean') return null;
  const status = row['status'];
  if (status !== null && !isRecord(status)) return null;

  if (!present) {
    // Absent beacon: no config, no device context.
    if (keys.size !== 3 || status !== null || isMobile !== null) return null;
    return { present: false, status: null, isMobile: null };
  }

  // Payload fields are config-carried: they require a parsed status map, and
  // any unknown key is not engine output.
  const unknownKeys = [...keys].filter(
    (key) =>
      !BEACON_ROW_PAYLOAD_KEYS.has(key) &&
      key !== 'present' &&
      key !== 'status' &&
      key !== 'isMobile'
  );
  if (status === null) {
    if (isMobile !== null || keys.size !== 3) return null;
    return { present: true, status: null, isMobile: null };
  }
  if (unknownKeys.length > 0) return null;

  const parsedStatus = parseBeaconStatusMap(status);
  if (parsedStatus === null) return null;
  const out: WprDetections['priority_elements_beacon'] = {
    present: true,
    status: parsedStatus,
    isMobile
  };
  // The payload checks below reject any unknown key (only known config
  // fields survive), so `payloadKeys` needs no separate allowlist pass.
  if (row['elements'] !== undefined) {
    if (
      typeof row['elements'] !== 'string' ||
      row['elements'].length > BEACON_CONFIG_LIMITS.elements
    ) {
      return null;
    }
    out.elements = row['elements'];
  }
  for (const field of BEACON_CONFIG_LIST_FIELDS) {
    if (row[field] === undefined) continue;
    // Empty lists are legitimate config values (the plugin's defaults).
    const list = parseCappedStringList(row[field], BEACON_CONFIG_LIMITS.lists);
    if (list === null) return null;
    out[field] = list;
  }
  return out;
}

/**
 * The status map at the messaging boundary: same rules as the engine's parse
 * (independently enforced so a corrupt or forged payload never reaches the
 * panel) — known keys boolean, unknown keys bounded primitives, caps held.
 */
function parseBeaconStatusMap(status: Record<string, unknown>): BeaconFeatureStatus | null {
  const keys = Object.keys(status);
  if (keys.length > BEACON_CONFIG_LIMITS.status.keys) return null;
  const parsed: BeaconFeatureStatus = {};
  for (const key of keys) {
    const value = status[key];
    // An own `__proto__` key is never engine output; assigning through the
    // name would invoke the inherited setter — hostile, reject the row.
    if (key === '__proto__') return null;
    if ((BEACON_STATUS_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') return null;
      parsed[key] = value;
    } else if (isBoundedStatusPrimitive(value)) {
      parsed[key] = value;
    } else {
      return null;
    }
  }
  return parsed;
}

function isBoundedStatusPrimitive(value: unknown): boolean {
  if (typeof value === 'boolean' || value === null) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= BEACON_CONFIG_LIMITS.status.chars;
  return false;
}

/** An array of non-empty bounded strings, rebuilt fresh (rejects wholesale on violation). */
function parseCappedStringList(
  value: unknown,
  limits: { count: number; chars: number }
): string[] | null {
  if (!isStringArray(value) || value.length > limits.count) return null;
  if (value.some((item) => item.length < 1 || item.length > limits.chars)) return null;
  return [...value];
}

/** Full panel payload. Every part is validated; any miss rejects the payload. */
export function parseFdtData(input: unknown): FdtData | null {
  if (!isRecord(input)) return null;
  // Fields the tool keeps adding live on `FdtData`; only the established keys
  // are required here (tolerant read of future additive fields).
  const pageHeadersRaw = input['pageHeaders'];
  const pageHeaders = pageHeadersRaw === null ? null : parsePageHeaders(pageHeadersRaw);
  if (pageHeadersRaw !== null && pageHeaders === null) return null;
  const undefinedReferencesRaw = input['undefinedReferencesOnPage'];
  if (undefinedReferencesRaw === null || undefinedReferencesRaw === undefined) return null;
  const undefinedReferencesOnPage = parseErrorWords(undefinedReferencesRaw);
  if (undefinedReferencesOnPage === null) return null;
  const wprDetections = parseWprDetections(input['wprDetections']);
  if (wprDetections === null) return null;
  const preloadedResourcesRaw = input['preloadedResources'];
  if (preloadedResourcesRaw === null || preloadedResourcesRaw === undefined) return null;
  const preloadedResources = parsePreloadedResources(preloadedResourcesRaw);
  if (preloadedResources === null) return null;
  const diagnoserRaw = input['diagnoserData'];
  const diagnoserData = diagnoserRaw === null ? null : parseDiagnoserData(diagnoserRaw);
  if (diagnoserRaw !== null && diagnoserData === null) return null;
  if (typeof input['allScriptsLoaded'] !== 'boolean') return null;
  return {
    allScriptsLoaded: input['allScriptsLoaded'],
    pageHeaders,
    undefinedReferencesOnPage,
    wprDetections,
    preloadedResources,
    diagnoserData
  };
}

/** DevTools search relay; unknown actions or extra keys are dropped. */
export function parsePanelSearchAction(input: unknown): PanelSearchAction | null {
  if (!isRecord(input)) return null;
  const action = input['action'];
  if (typeof action !== 'string') return null;
  if (action === PANEL_SEARCH_ACTIONS.performSearch && Object.keys(input).length === 2) {
    const query = input['query'];
    if (typeof query !== 'string' || query.length > LIMITS.searchQuery) return null;
    return { action, query };
  }
  if (
    (action === PANEL_SEARCH_ACTIONS.cancelSearch ||
      action === PANEL_SEARCH_ACTIONS.nextSearchResult ||
      action === PANEL_SEARCH_ACTIONS.previousSearchResult) &&
    Object.keys(input).length === 1
  ) {
    return { action };
  }
  return null;
}
