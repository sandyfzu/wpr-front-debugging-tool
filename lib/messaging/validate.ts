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
 * A violation rejects the whole row/guard — never a silent partial cut here.
 * Page-derived rows are bounded by their producers to the same caps
 * (`./payload-bounds`), which mark a cut row `truncated: true`; the guards
 * accept that mark (absent or exactly `true`) and carry it through, so a
 * bounded payload always passes and a partial list is always labeled.
 */

import { isScriptSnapshotId } from './script-source';
import { isCount } from './guard-policy';
import type {
  BeaconFeatureStatus,
  BuilderFact,
  SimulationFact,
  DiagnoserDocData,
  FdtData,
  FeatureEvidenceSource,
  PageCookies,
  PageHeader,
  PageHeaders,
  PanelSearchAction,
  PreloadedResources,
  RucssTestModeFact,
  WprDetections
} from '../wp-rocket/types';
import type { KnownConflict } from '../storage/known-conflicts';
import {
  BEACON_CONFIG_LIMITS,
  BEACON_CONFIG_LIST_FIELDS,
  BEACON_STATUS_KEYS,
  LAZYLOAD_EXCLUSIONS_LIST,
  MAX_CACHE_STAMP_SECONDS
} from '../wp-rocket/constants';
import { COOKIE_NAME_LIMITS } from '../wp-rocket/cookies';
import { PANEL_SEARCH_ACTIONS } from '../wp-rocket/types';
import { hasOnlyKeys, isRecord } from '../../utils/is-record';
import { ERROR_WORD_LIMITS, isPrintable } from './error-words';
import { numericTabId } from './sender';
// The representable-stamp ceiling the boundary carries (capture stamps) is
// the same declared constant the cache-stamp defense uses — one declaring
// site, no second limit.
import { MAX_REPRESENTABLE_MS } from '../detection/describe';
import { PAYLOAD_LIMITS } from './payload-bounds';
import { isBuilderFactAllowed } from '../exclusion-builder/builder-marker';
import type { ExclusionFeatureId } from '../exclusion-builder/set';

/**
 * Count/length caps per structure. Generous by design (real pages sit orders
 * of magnitude below), uniform in behavior: violation ⇒ the guard returns
 * `null` for the whole row. Each shared row is owned by its contract: the
 * word row by `./error-words` (shared with the MAIN-world capture side), the
 * cookie row by `../wp-rocket/cookies`, the page-derived rows by
 * `./payload-bounds` (shared with the producers that bound to them).
 */
const LIMITS = {
  words: ERROR_WORD_LIMITS,
  cookies: COOKIE_NAME_LIMITS,
  ...PAYLOAD_LIMITS,
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
  searchQuery: 200
} as const;

/**
 * A list of at most `maxCount` strings. The cap is checked before any member
 * is read, so the work is bounded by the cap, never by the declared `length`
 * (a structured-cloned sparse array can claim 2^32−1 members in a few bytes).
 * Every index is visited, so a hole reads as `undefined` and rejects.
 *
 * @param value The untrusted list.
 * @param maxCount The largest member count the field allows.
 */
function isStringArray(value: unknown, maxCount: number): value is string[] {
  if (!Array.isArray(value) || value.length > maxCount) return false;
  for (const item of value) if (typeof item !== 'string') return false;
  return true;
}

/**
 * Read a row's optional truncation mark (see `TruncationMark`): absent, or
 * exactly `true` — anything else is not producer output.
 *
 * @param row The row's own-key copy.
 * @returns The number of keys the mark adds (0 or 1), or null when the key
 *   holds anything but `true`.
 */
function truncationKeys(row: Record<string, unknown>): 0 | 1 | null {
  if (!Object.hasOwn(row, 'truncated')) return 0;
  return row['truncated'] === true ? 1 : null;
}

/** The mark to spread into a rebuilt row (empty when the row is complete). */
function truncationOf(keys: 0 | 1): { truncated?: true } {
  return keys === 1 ? { truncated: true } : {};
}

/**
 * Rejection diagnostics. While an explained parse runs, every rejection site
 * on the unwinding path prepends its segment, so the trail names the first
 * failing field (`wprDetections.lazyload.images[3].src`) — field names and
 * indices only, never values. Outside an explained parse `reject` records
 * nothing (no cost, no state kept by the hot guards).
 */
let explaining = false;
let rejectionTrail: string[] = [];

/**
 * Reject at `segments` (outermost first).
 *
 * @returns null, so rejection sites read `return reject('field')`.
 */
function reject(...segments: string[]): null {
  if (explaining) rejectionTrail.unshift(...segments);
  return null;
}

/** An index segment (`[3]`), joined to its list name without a dot. */
function at(index: number): string {
  return `[${index.toString()}]`;
}

/** Join trail segments into a path (`a.b[3].c`); empty ⇒ the root itself. */
function joinTrail(segments: readonly string[]): string {
  const path = segments.reduce(
    (joined, segment) =>
      segment.startsWith('[') || joined === '' ? joined + segment : `${joined}.${segment}`,
    ''
  );
  return path === '' ? '(root)' : path;
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
  if (!Array.isArray(input)) return reject();
  if (input.length > LIMITS.words.count) return reject('length');
  const words: string[] = [];
  for (const [index, item] of input.entries()) {
    if (typeof item !== 'string' || item.length < 1 || item.length > LIMITS.words.chars)
      return reject(at(index));
    if (!isPrintable(item)) return reject(at(index));
    words.push(item);
  }
  return words;
}

/** The keys a header row may carry (see `PageHeader`). */
const PAGE_HEADER_KEYS: ReadonlySet<string> = new Set(['name', 'value', 'redacted', 'cookieName']);

/**
 * Parse captured response headers: `{ name, value? }` rows, or withheld
 * `{ name, redacted: true, cookieName? }` rows, bounded per
 * {@link LIMITS.headers}. A withheld row carrying a `value` is contradictory
 * (a secret may have travelled) and rejects; `cookieName` only rides a
 * withheld row. Rows without the flag (payloads predating it) still parse.
 * Rows are rebuilt as own-key objects with only the known keys; a missing
 * value key (or an `undefined` one, which is indistinguishable) stays missing.
 */
export function parsePageHeaders(input: unknown): PageHeaders | null {
  if (!Array.isArray(input)) return reject();
  if (input.length > LIMITS.headers.count) return reject('length');
  const rows: PageHeader[] = [];
  for (const [index, item] of input.entries()) {
    if (!isRecord(item)) return reject(at(index));
    if (Object.keys(item).some((key) => !PAGE_HEADER_KEYS.has(key)))
      return reject(at(index), 'keys');
    const name = item['name'];
    if (typeof name !== 'string' || name.length < 1 || name.length > LIMITS.headers.name)
      return reject(at(index), 'name');
    const value = item['value'];
    if (value !== undefined && (typeof value !== 'string' || value.length > LIMITS.headers.value))
      return reject(at(index), 'value');
    const redacted = item['redacted'];
    if (redacted !== undefined && (redacted !== true || value !== undefined))
      return reject(at(index), 'redacted');
    const cookieName = item['cookieName'];
    if (
      cookieName !== undefined &&
      (redacted !== true ||
        typeof cookieName !== 'string' ||
        cookieName.length < 1 ||
        cookieName.length > LIMITS.headers.value)
    )
      return reject(at(index), 'cookieName');
    if (redacted === true) {
      rows.push(
        typeof cookieName === 'string' ? { name, redacted, cookieName } : { name, redacted }
      );
    } else {
      rows.push(typeof value === 'string' ? { name, value } : { name });
    }
  }
  return rows;
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

/**
 * Validate the captured-cookie payload: names already redacted to name-only
 * strings by the capture side (`sampleCookieNames`), a finite capture stamp.
 * The shape is exact (own keys only, the shared caps in `COOKIE_NAME_LIMITS`)
 * so a forged or drifting sender can neither smuggle a value-shaped field in
 * nor sneak oversized rows through.
 *
 * Two more contract rules are re-checked here so the type's doc stays true
 * for every payload that passes:
 *
 * - **Unique names** — the capture side dedupes (its dedupe key is the
 *   clipped name), so a duplicated list means a forged or drifted payload:
 *   rejected as a unit, never silently cut (the validator's standing
 *   size policy).
 * - **Representable stamp** — `capturedAt` is capped at the platform's
 *   representable-instant ceiling (`MAX_REPRESENTABLE_MS`, the same declared
 *   constant the cache-stamp defense uses — one declaring site, no second
 *   limit), so downstream date math on the stamp can never construct a
 *   garbage `Date` or throw.
 */
export function parsePageCookies(input: unknown): PageCookies | null {
  if (!isRecord(input) || Object.keys(input).length !== 2) return null;
  const rawCapturedAt = input['capturedAt'];
  if (
    typeof rawCapturedAt !== 'number' ||
    !Number.isInteger(rawCapturedAt) ||
    rawCapturedAt < 0 ||
    rawCapturedAt > MAX_REPRESENTABLE_MS
  ) {
    return null;
  }
  const rawNames = input['names'];
  if (!isStringArray(rawNames, LIMITS.cookies.count)) return null;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of rawNames) {
    if (!isUsableString(name, LIMITS.cookies.name)) return null;
    // Unique-names contract (see above): a repeat name rejects the payload.
    if (seen.has(name)) return null;
    seen.add(name);
    names.push(name);
  }
  return { names, capturedAt: rawCapturedAt };
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
  if (!isRecord(input)) return reject();
  const present = input['present'];
  if (typeof present !== 'boolean') return reject('present');
  const keys = new Set(Object.keys(input));
  if (!present) return keys.size === 1 ? { present: false } : reject('keys');
  const mark = truncationKeys(input);
  if (mark === null) return reject('truncated');
  if (!keys.has('resources') || keys.size !== 2 + mark) return reject('keys');
  const resources = input['resources'];
  if (!Array.isArray(resources)) return reject('resources');
  if (resources.length > LIMITS.preloaded.count) return reject('resources', 'length');
  // Only a non-empty list can have been cut.
  if (mark === 1 && resources.length === 0) return reject('truncated');
  const out: PreloadedResources['resources'] = [];
  for (const [index, item] of resources.entries()) {
    if (!isRecord(item)) return reject('resources', at(index));
    if (Object.keys(item).length !== 2) return reject('resources', at(index), 'keys');
    // An empty href is legitimate engine output (a srcset-only preload hint
    // has no href attribute — the same '' entry the image lists carry).
    if (!isBoundedString(item['href'], LIMITS.preloaded.href))
      return reject('resources', at(index), 'href');
    if (!isBoundedString(item['type'], LIMITS.preloaded.type))
      return reject('resources', at(index), 'type');
    out.push({ href: item['href'], type: item['type'] });
  }
  return { present: true, resources: out, ...truncationOf(mark) };
}

/**
 * Deep structural check of page detections delivered through messaging.
 * Every detection row must be present and correctly shaped — the content
 * script is our own code, so a missing row means a corrupt or foreign
 * payload, which the panel renders as an error state rather than guessing.
 */
export function parseWprDetections(input: unknown): WprDetections | null {
  if (!isRecord(input)) return reject();
  const wpr = parseWprRow(input['wpr']);
  if (wpr === null) return reject('wpr');
  /** One row through its parser; a rejection names the row. */
  const row = <T>(key: string, parse: (value: unknown) => T | null): T | null => {
    const parsed = parse(input[key]);
    return parsed === null ? reject(key) : parsed;
  };
  const removeUnusedCss = row('remove_unused_css', parsePresenceRow);
  if (removeUnusedCss === null) return null;
  const asyncCss = row('async_css', parseAsyncCssRow);
  if (asyncCss === null) return null;
  const lazyloadCssBgImg = row('lazyload_css_bg_img', parsePresenceRow);
  if (lazyloadCssBgImg === null) return null;
  const selfHostedFonts = row('self_hosted_fonts', parsePresenceRow);
  if (selfHostedFonts === null) return null;
  const imageDimensions = row('image_dimensions', parseDeclarationOnlyRow);
  if (imageDimensions === null) return null;
  const minifyCss = row('minify_css', parsePresenceRow);
  if (minifyCss === null) return null;
  const minifyJs = row('minify_js', parsePresenceRow);
  if (minifyJs === null) return null;
  const combineJs = row('minify_concatenate_js', parseDeclarationOnlyRow);
  if (combineJs === null) return null;
  const preloadLinks = row('preload_links', parsePresenceRow);
  if (preloadLinks === null) return null;
  const rocketCdn = row('rocket_cdn', parsePresenceRow);
  if (rocketCdn === null) return null;
  const delayJs = row('delay_js', parseDelayJsRow);
  if (delayJs === null) return null;
  const deferAllJs = row('defer_all_js', parseDeferRow);
  if (deferAllJs === null) return null;
  const lazyload = row('lazyload', parseLazyloadRow);
  if (lazyload === null) return null;
  const lazyloadIframes = row('lazyload_iframes', parseIframesRow);
  if (lazyloadIframes === null) return null;
  const aboveTheFold = row('rocket_above_the_fold_optimization', parseOptimizeCriticalImagesRow);
  if (aboveTheFold === null) return null;
  const lazyRender = row('automatic_lazy_rendering', parseLazyRenderRow);
  if (lazyRender === null) return null;
  const preloadFonts = row('auto_preload_fonts', parsePreloadFontsRow);
  if (preloadFonts === null) return null;
  const preconnectDomains = row('preconnect_external_domains', parsePreconnectRow);
  if (preconnectDomains === null) return null;
  const beacon = row('priority_elements_beacon', parseBeaconRow);
  if (beacon === null) return null;
  return {
    wpr,
    remove_unused_css: removeUnusedCss,
    async_css: asyncCss,
    lazyload_css_bg_img: lazyloadCssBgImg,
    self_hosted_fonts: selfHostedFonts,
    image_dimensions: imageDimensions,
    minify_css: minifyCss,
    minify_js: minifyJs,
    minify_concatenate_js: combineJs,
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

/**
 * The WP Rocket footprint row: presence, signature/cache state, version, stamp.
 *
 * The semantic invariants are defense in depth: the engine only sets the
 * marker and `cached` on a present page, and only parses a stamp inside the
 * debug branch, so a payload contradicting them is corrupt. The stamp is held
 * to the display domain (non-negative integer seconds through 9999-12-31),
 * the same guard the formatter applies.
 */
function parseWprRow(input: unknown): WprDetections['wpr'] | null {
  if (!isRecord(input)) return reject();
  const wpr = { ...input };
  const mark = truncationKeys(wpr);
  if (mark === null) return reject('truncated');
  if (Object.keys(wpr).length !== 5 + mark) return reject('keys');
  const present = wpr['present'];
  const cacheMarkerFound = wpr['cacheMarkerFound'];
  const cached = wpr['cached'];
  const version = wpr['version'];
  const timeStamp = wpr['timeStamp'];
  if (typeof present !== 'boolean') return reject('present');
  if (typeof cacheMarkerFound !== 'boolean') return reject('cacheMarkerFound');
  if (typeof cached !== 'boolean') return reject('cached');
  if (!present && (cacheMarkerFound || cached)) return reject('present');
  if (cached && !cacheMarkerFound) return reject('cacheMarkerFound');
  if (!isBoundedNullableString(version, LIMITS.versions)) return reject('version');
  // The version is the row's only cuttable field: a null one was never cut.
  if (mark === 1 && version === null) return reject('truncated');
  if (
    timeStamp !== null &&
    (typeof timeStamp !== 'number' ||
      !Number.isInteger(timeStamp) ||
      timeStamp < 0 ||
      timeStamp > MAX_CACHE_STAMP_SECONDS)
  )
    return reject('timeStamp');
  if (timeStamp !== null && !cached) return reject('timeStamp');
  return { present, cacheMarkerFound, cached, version, timeStamp, ...truncationOf(mark) };
}

/**
 * The feature rows' optional evidence-source field (`source`), read at the
 * boundary: absent (undecided row — the engines omit it when no evidence
 * class decided the verdict), or one of the two valid sources. Anything else
 * is not engine output. An own `source: undefined` property rejects via the
 * key-count rule — deliberate fail-closed semantics (messaging JSON drops
 * such properties today, so only a hand-built or drifted sender can produce
 * it), not the tolerant undefined-as-absent shape some header parsers use.
 *
 * @param value The raw `source` value of a feature row.
 * @returns The validated source, `undefined` when absent, or null when invalid.
 */
function parseOptionalSource(value: unknown): FeatureEvidenceSource | undefined | null {
  if (value === undefined) return undefined;
  return value === 'meta' || value === 'footprint' ? value : null;
}

/**
 * The key-count a feature row must present given its base keys and an
 * optional `source`: the source's presence is itself part of the shape, so
 * the exact-key checks can stay exact without accepting unknown keys.
 *
 * @param baseKeys The row's key count without `source` (truncation excluded).
 * @param source The row's validated source (undefined when absent).
 */
function featureRowKeyCount(baseKeys: number, source: FeatureEvidenceSource | undefined): number {
  return baseKeys + (source === undefined ? 0 : 1);
}

/**
 * A builder row's optional `builder` field (the Exclusion Builder's in-tab
 * fact): absent (the document stated none — every payload predating the
 * field), or exactly one fact the row's feature can have — `{ off:
 * 'feature' | 'page' }` or `{ excluded: 1…9999 }` (the grammar's own bounds,
 * via `isBuilderFactAllowed`: one declaring site). Anything else (another
 * key, an extra key, a state the feature cannot have, an out-of-range
 * count) is not engine output.
 *
 * @param value The raw `builder` value.
 * @param feature The row's feature.
 * @returns The validated fact, `undefined` when absent, or null when invalid.
 */
function parseOptionalBuilder(
  value: unknown,
  feature: ExclusionFeatureId
): BuilderFact | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  let fact: BuilderFact;
  if (keys[0] === 'off') {
    const off = value['off'];
    if (off !== 'feature' && off !== 'page') return null;
    fact = { off };
  } else if (keys[0] === 'excluded') {
    const excluded = value['excluded'];
    if (typeof excluded !== 'number') return null;
    // The count's range (1…9999, an integer) is the grammar's, checked below.
    fact = { excluded };
  } else {
    return null;
  }
  return isBuilderFactAllowed(feature, fact) ? fact : null;
}

/** The keys an optional `builder` field adds to its row (0 or 1). */
function builderKeys(builder: BuilderFact | undefined): 0 | 1 {
  return builder === undefined ? 0 : 1;
}

/** The field to spread into a rebuilt row (empty when absent). */
function builderOf(builder: BuilderFact | undefined): { builder?: BuilderFact } {
  return builder === undefined ? {} : { builder };
}

/**
 * A simulated row's optional `simulation` field: absent (the document
 * states no simulation of the feature — every payload predating the
 * field), `'simulated'` or `'unverified'`. Anything else is not engine
 * output.
 *
 * @param value The raw `simulation` value.
 * @returns The fact, `undefined` when absent, or null when invalid.
 */
function parseOptionalSimulation(value: unknown): SimulationFact | undefined | null {
  if (value === undefined) return undefined;
  return value === 'simulated' || value === 'unverified' ? value : null;
}

/** How many keys an optional `simulation` field adds to its row (0 or 1). */
function simulationKeys(simulation: SimulationFact | undefined): number {
  return simulation === undefined ? 0 : 1;
}

/** The parsed `simulation` field to spread into its row (nothing when absent). */
function simulationOf(simulation: SimulationFact | undefined): { simulation?: SimulationFact } {
  return simulation === undefined ? {} : { simulation };
}

/** `{ present }`-shaped row with exactly that key, own keys only. */
function parsePresenceRow(
  input: unknown
): { present: boolean; source?: FeatureEvidenceSource } | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  const source = parseOptionalSource(row['source']);
  if (source === null || Object.keys(row).length !== featureRowKeyCount(1, source)) return null;
  if (typeof row['present'] !== 'boolean') return null;
  const parsed: { present: boolean; source?: FeatureEvidenceSource } = {
    present: row['present']
  };
  if (source !== undefined) parsed.source = source;
  return parsed;
}

/**
 * Load CSS asynchronously row: the presence row plus the `criticalStyle`
 * fact. Additive field: a producer that predates it never looked for the
 * style, so absent reads as `false`; any other non-boolean (`null` too)
 * rejects.
 */
function parseAsyncCssRow(input: unknown): WprDetections['async_css'] | null {
  if (!isRecord(input)) return reject();
  const { criticalStyle: rawCriticalStyle, ...presenceRow } = input;
  const criticalStyle = rawCriticalStyle === undefined ? false : rawCriticalStyle;
  if (typeof criticalStyle !== 'boolean') return reject('criticalStyle');
  const parsed = parsePresenceRow(presenceRow);
  if (parsed === null) return reject();
  const row: WprDetections['async_css'] = { present: parsed.present, criticalStyle };
  if (parsed.source !== undefined) row.source = parsed.source;
  return row;
}

/** Delay JS row: script list plus presence/version/count bookkeeping. */
function parseDelayJsRow(input: unknown): WprDetections['delay_js'] | null {
  if (!isRecord(input)) return reject();
  const row = { ...input };
  const mark = truncationKeys(row);
  if (mark === null) return reject('truncated');
  const source = parseOptionalSource(row['source']);
  if (source === null) return reject('source');
  const builder = parseOptionalBuilder(row['builder'], 'delay_js');
  if (builder === null) return reject('builder');
  const simulation = parseOptionalSimulation(row['simulation']);
  if (simulation === null) return reject('simulation');
  const optionalKeys = builderKeys(builder) + simulationKeys(simulation);
  if (Object.keys(row).length !== featureRowKeyCount(4, source) + mark + optionalKeys)
    return reject('keys');
  if (typeof row['present'] !== 'boolean') return reject('present');
  if (!isBoundedNullableString(row['version'], LIMITS.versions)) return reject('version');
  // A simulated row is never served: the engine clears both.
  if (simulation === 'simulated' && (row['present'] || row['version'] !== null))
    return reject('simulation');
  const delayedScripts = row['delayedScripts'];
  if (
    typeof delayedScripts !== 'number' ||
    !Number.isSafeInteger(delayedScripts) ||
    delayedScripts < 0 ||
    delayedScripts > LIMITS.scriptCount
  ) {
    return reject('delayedScripts');
  }
  const rawScripts = row['scripts'];
  if (!Array.isArray(rawScripts)) return reject('scripts');
  if (rawScripts.length > LIMITS.delayScripts.count) return reject('scripts', 'length');
  // Every page script is in the list, so an uncut list bounds the delayed
  // count; only truncation can drop delayed entries from it.
  if (mark === 0 && delayedScripts > rawScripts.length) return reject('delayedScripts');
  // The cuttable fields are the list and the version: neither present ⇒ uncut.
  if (mark === 1 && rawScripts.length === 0 && row['version'] === null) return reject('truncated');
  const scripts: WprDetections['delay_js']['scripts'] = [];
  /** Inline text left in the list's total budget (the producer's same budget). */
  let contentBudget: number = LIMITS.delayScripts.contentTotal;
  for (const [index, rawItem] of rawScripts.entries()) {
    // Spread first: only own keys survive, so inherited (poisoned) records
    // arrive as empty objects and fail the shape checks below.
    if (!isRecord(rawItem)) return reject('scripts', at(index));
    const item = { ...rawItem };
    const inline = item['inline'];
    if (typeof inline !== 'boolean') return reject('scripts', at(index), 'inline');
    const src = item['src'];
    const content = item['content'];
    // Empty src/content are legitimate engine outputs (empty attributes,
    // empty inline scripts) — only non-strings or oversizes reject.
    if (src !== undefined && !isBoundedString(src, LIMITS.delayScripts.src))
      return reject('scripts', at(index), 'src');
    if (content !== undefined) {
      if (!isBoundedString(content, Math.min(LIMITS.delayScripts.content, contentBudget)))
        return reject('scripts', at(index), 'content');
      contentBudget -= content.length;
    }
    const delayed = item['delayed'];
    const deferred = item['deferred'];
    const deferredByWPR = item['deferredByWPR'];
    const fdtExcluded = item['fdtExcluded'];
    if (typeof delayed !== 'boolean') return reject('scripts', at(index), 'delayed');
    if (typeof deferred !== 'boolean') return reject('scripts', at(index), 'deferred');
    if (typeof deferredByWPR !== 'boolean') return reject('scripts', at(index), 'deferredByWPR');
    if (fdtExcluded !== null && typeof fdtExcluded !== 'string')
      return reject('scripts', at(index), 'fdtExcluded');
    // Additive field: a producer that predates it never saw the stamp, so
    // absent reads as `false`; any other non-boolean (`null` too) rejects.
    const rawMinifyAttribute = item['minifyAttribute'];
    const minifyAttribute = rawMinifyAttribute === undefined ? false : rawMinifyAttribute;
    if (typeof minifyAttribute !== 'boolean')
      return reject('scripts', at(index), 'minifyAttribute');
    const record: WprDetections['delay_js']['scripts'][number] = {
      delayed,
      inline,
      deferred,
      deferredByWPR,
      fdtExcluded,
      minifyAttribute
    };
    if (src !== undefined) record.src = src;
    if (content !== undefined) record.content = content;
    scripts.push(record);
  }
  return {
    present: row['present'],
    scripts,
    version: row['version'],
    delayedScripts,
    ...truncationOf(mark),
    ...(source === undefined ? {} : { source }),
    ...builderOf(builder),
    ...simulationOf(simulation)
  };
}

/**
 * Defer JS row: the URL list of every WP Rocket-deferred script that carries
 * one, plus the total attributed count (URL-bearing and inline).
 */
function parseDeferRow(input: unknown): WprDetections['defer_all_js'] | null {
  if (!isRecord(input)) return reject();
  const row = { ...input };
  const mark = truncationKeys(row);
  if (mark === null) return reject('truncated');
  const source = parseOptionalSource(row['source']);
  if (source === null) return reject('source');
  const builder = parseOptionalBuilder(row['builder'], 'defer_all_js');
  if (builder === null) return reject('builder');
  const simulation = parseOptionalSimulation(row['simulation']);
  if (simulation === null) return reject('simulation');
  if (
    Object.keys(row).length !==
    featureRowKeyCount(3, source) + mark + builderKeys(builder) + simulationKeys(simulation)
  )
    return reject('keys');
  if (typeof row['present'] !== 'boolean') return reject('present');
  // A simulated row is never served: the engine clears its presence.
  if (simulation === 'simulated' && row['present']) return reject('simulation');
  const scripts = row['scripts'];
  if (!Array.isArray(scripts)) return reject('scripts');
  if (scripts.length > LIMITS.deferScripts.count) return reject('scripts', 'length');
  if (mark === 1 && scripts.length === 0) return reject('truncated');
  for (const [index, src] of scripts.entries()) {
    if (!isBoundedString(src, LIMITS.deferScripts.chars)) return reject('scripts', at(index));
  }
  const deferredScripts = row['deferredScripts'];
  if (
    typeof deferredScripts !== 'number' ||
    !Number.isSafeInteger(deferredScripts) ||
    deferredScripts < scripts.length ||
    deferredScripts > LIMITS.scriptCount
  ) {
    return reject('deferredScripts');
  }
  return {
    present: row['present'],
    scripts: [...(scripts as string[])],
    deferredScripts,
    ...truncationOf(mark),
    ...(source === undefined ? {} : { source }),
    ...builderOf(builder),
    ...simulationOf(simulation)
  };
}

/** The reason domain is the exclusion list itself; more entries is malformed. */
const LAZYLOAD_REASON_LIMIT = LAZYLOAD_EXCLUSIONS_LIST.length;

/** Lazyload row: one record per <img>, in document order. */
function parseLazyloadRow(input: unknown): WprDetections['lazyload'] | null {
  if (!isRecord(input)) return reject();
  const row = { ...input };
  const mark = truncationKeys(row);
  if (mark === null) return reject('truncated');
  const source = parseOptionalSource(row['source']);
  if (source === null) return reject('source');
  const builder = parseOptionalBuilder(row['builder'], 'lazyload');
  if (builder === null) return reject('builder');
  const simulation = parseOptionalSimulation(row['simulation']);
  if (simulation === null) return reject('simulation');
  if (
    Object.keys(row).length !==
    featureRowKeyCount(2, source) + mark + builderKeys(builder) + simulationKeys(simulation)
  )
    return reject('keys');
  if (typeof row['present'] !== 'boolean') return reject('present');
  // A simulated row is never served: the engine clears its presence.
  if (simulation === 'simulated' && row['present']) return reject('simulation');
  const rawImages = row['images'];
  if (!Array.isArray(rawImages)) return reject('images');
  if (rawImages.length > LIMITS.images.count) return reject('images', 'length');
  if (mark === 1 && rawImages.length === 0) return reject('truncated');
  const images: WprDetections['lazyload']['images'] = [];
  for (const [index, rawItem] of rawImages.entries()) {
    if (!isRecord(rawItem)) return reject('images', at(index));
    const item = { ...rawItem };
    if (Object.keys(item).length !== 3) return reject('images', at(index), 'keys');
    if (!isBoundedString(item['src'], LIMITS.images.src)) return reject('images', at(index), 'src');
    if (typeof item['lazyloadDetected'] !== 'boolean')
      return reject('images', at(index), 'lazyloadDetected');
    const reasons = item['excludedReasonsFound'];
    if (!isStringArray(reasons, LAZYLOAD_REASON_LIMIT))
      return reject('images', at(index), 'excludedReasonsFound');
    images.push({
      src: item['src'],
      lazyloadDetected: item['lazyloadDetected'],
      excludedReasonsFound: [...reasons]
    });
  }
  return {
    present: row['present'],
    images,
    ...truncationOf(mark),
    ...(source === undefined ? {} : { source }),
    ...builderOf(builder),
    ...simulationOf(simulation)
  };
}

/** Iframes row: presence plus the youtube-replacement script marker. */
function parseIframesRow(input: unknown): WprDetections['lazyload_iframes'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  const source = parseOptionalSource(row['source']);
  if (source === null || Object.keys(row).length !== featureRowKeyCount(2, source)) return null;
  if (typeof row['present'] !== 'boolean' || typeof row['replaceImage'] !== 'boolean') return null;
  // The replacement marker is applied evidence: it cannot exist on a refuted row.
  if (row['replaceImage'] && !row['present']) return null;
  const parsed: WprDetections['lazyload_iframes'] = {
    present: row['present'],
    replaceImage: row['replaceImage']
  };
  if (source !== undefined) parsed.source = source;
  return parsed;
}

/**
 * A declaration-only row (image dimensions, Combine JavaScript files): the
 * only deciding source is the generator meta. A footprint source (or a
 * declared presence without one) is not engine output — neither standard
 * `width`/`height` markup nor a digest-named bundle attributes its feature.
 */
function parseDeclarationOnlyRow(
  input: unknown
): WprDetections['image_dimensions' | 'minify_concatenate_js'] | null {
  const parsed = parsePresenceRow(input);
  if (parsed === null || parsed.source === 'footprint') return null;
  if (parsed.present && parsed.source !== 'meta') return null;
  return parsed;
}

/**
 * Optimize-critical-images row: the verdict (`present`) and the observed
 * preload inventory are independent — meta authority can declare the feature
 * without markup, and a refuted row keeps remnant preloads as inventory. The
 * feature comment is corroboration carried either way.
 */
function parseOptimizeCriticalImagesRow(
  input: unknown
): WprDetections['rocket_above_the_fold_optimization'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  const present = row['present'];
  const lcpComment = row['lcpComment'];
  if (typeof present !== 'boolean' || typeof lcpComment !== 'boolean') return null;
  const source = parseOptionalSource(row['source']);
  if (source === null) return null;
  const mark = truncationKeys(row);
  if (mark === null) return reject('truncated');
  const hasImages = Object.hasOwn(row, 'preloadedImages');
  if (Object.keys(row).length !== featureRowKeyCount(2 + (hasImages ? 1 : 0), source) + mark)
    return reject('keys');
  if (mark === 1 && !hasImages) return reject('truncated');
  const parsed: WprDetections['rocket_above_the_fold_optimization'] = { present, lcpComment };
  if (hasImages) {
    const rawImages = row['preloadedImages'];
    if (!Array.isArray(rawImages)) return reject('preloadedImages');
    // Count bounds before any member is read (bounded work on a sparse list).
    if (rawImages.length < 1 || rawImages.length > LIMITS.preloadedImages.count)
      return reject('preloadedImages', 'length');
    const preloadedImages: string[] = [];
    for (const [index, url] of rawImages.entries()) {
      if (typeof url !== 'string' || url.length > LIMITS.preloadedImages.chars)
        return reject('preloadedImages', at(index));
      preloadedImages.push(url);
    }
    parsed.preloadedImages = preloadedImages;
  }
  if (mark === 1) parsed.truncated = true;
  if (source !== undefined) parsed.source = source;
  return parsed;
}

/**
 * Automatic-Lazy-Rendering row: `present` is the feature verdict (a meta
 * declaration can set it with zero converted elements; a refuted row keeps
 * the observed counts as inventory). The style marker and hash count ride
 * along as independent page facts.
 */
function parseLazyRenderRow(input: unknown): WprDetections['automatic_lazy_rendering'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  const source = parseOptionalSource(row['source']);
  const builder = parseOptionalBuilder(row['builder'], 'automatic_lazy_rendering');
  if (source === null || builder === null) return null;
  if (Object.keys(row).length !== featureRowKeyCount(4, source) + builderKeys(builder)) return null;
  const present = row['present'];
  const inlineCssPresent = row['inlineCssPresent'];
  if (typeof present !== 'boolean' || typeof inlineCssPresent !== 'boolean') return null;
  const lazyRenderElements = parseElementCount(row['lazyRenderElements']);
  const locationHashes = parseElementCount(row['locationHashes']);
  if (lazyRenderElements === null || locationHashes === null) return null;
  // `present` is the feature verdict (meta authority can declare it while a
  // partial render carries no converted element); the counts are observed
  // markup, so they stay independent.
  const parsed: WprDetections['automatic_lazy_rendering'] = {
    present,
    lazyRenderElements,
    inlineCssPresent,
    locationHashes
  };
  if (source !== undefined) parsed.source = source;
  if (builder !== undefined) parsed.builder = builder;
  return parsed;
}

/**
 * A non-negative safe-integer element count within the page-sanity cap.
 * Scalars (not lists) still get the cap so a forged 1e18 cannot render.
 */
function parseElementCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value <= LIMITS.scriptCount ? value : null;
}

/**
 * Preload-fonts row: the verdict and the observed attributed list are
 * independent (a meta declaration may arrive with an empty list; a refuted
 * row may keep remnant preloads).
 */
function parsePreloadFontsRow(input: unknown): WprDetections['auto_preload_fonts'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  const mark = truncationKeys(row);
  const source = parseOptionalSource(row['source']);
  if (
    mark === null ||
    source === null ||
    Object.keys(row).length !== featureRowKeyCount(2, source) + mark
  )
    return null;
  const present = row['present'];
  if (typeof present !== 'boolean') return null;
  const fonts = parseCappedStringList(row['fonts'], LIMITS.fonts);
  if (fonts === null) return reject('fonts');
  if (mark === 1 && fonts.length === 0) return reject('truncated');
  return {
    present,
    fonts,
    ...truncationOf(mark),
    ...(source === undefined ? {} : { source })
  };
}

/**
 * Preconnect row: the verdict and the observed attributed list are
 * independent (a meta declaration may arrive with an empty list; a refuted
 * row may keep remnant hints).
 */
function parsePreconnectRow(input: unknown): WprDetections['preconnect_external_domains'] | null {
  if (!isRecord(input)) return null;
  const row = { ...input };
  const mark = truncationKeys(row);
  const source = parseOptionalSource(row['source']);
  if (
    mark === null ||
    source === null ||
    Object.keys(row).length !== featureRowKeyCount(3, source) + mark
  )
    return null;
  const present = row['present'];
  if (typeof present !== 'boolean') return null;
  const preconnectCount = parseElementCount(row['preconnectCount']);
  if (preconnectCount === null) return null;
  const domains = parseCappedStringList(row['domains'], LIMITS.domains);
  if (domains === null) return reject('domains');
  if (mark === 1 && domains.length === 0) return reject('truncated');
  return {
    present,
    domains,
    preconnectCount,
    ...truncationOf(mark),
    ...(source === undefined ? {} : { source })
  };
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
    if (list === null) return reject(field);
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

/**
 * An array of non-empty bounded strings, rebuilt fresh (rejects wholesale on
 * violation). The count cap is checked before any member is read; a bad
 * member — wrong type, hole, empty or too long — rejects at its index.
 *
 * @returns The rebuilt list, or null (a non-array records no segment; the
 *   caller names the field).
 */
function parseCappedStringList(
  value: unknown,
  limits: { count: number; chars: number }
): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > limits.count) return reject('length');
  const list: string[] = [];
  for (const [index, item] of value.entries()) {
    if (!isUsableString(item, limits.chars)) return reject(at(index));
    list.push(item);
  }
  return list;
}

/**
 * The page's RUCSS test fact: exactly `{ runs }`, a positive safe integer
 * (the field is present only once a test applied).
 *
 * @param input The boundary value.
 * @returns The rebuilt fact, or null on any violation.
 */
export function parseRucssTestModeFact(input: unknown): RucssTestModeFact | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['runs'])) return reject();
  const runs = input['runs'];
  return isCount(runs) && runs >= 1 ? { runs } : reject('runs');
}

/** Full panel payload. Every part is validated; any miss rejects the payload. */
export function parseFdtData(input: unknown): FdtData | null {
  if (!isRecord(input)) return reject();
  // Fields the tool keeps adding live on `FdtData`; only the established keys
  // are required here (tolerant read of future additive fields).
  const pageHeadersRaw = input['pageHeaders'];
  const pageHeaders = pageHeadersRaw === null ? null : parsePageHeaders(pageHeadersRaw);
  if (pageHeadersRaw !== null && pageHeaders === null) return reject('pageHeaders');
  // The list-level header mark: absent, or `true` beside a non-empty list
  // (an absent or empty capture was never cut).
  const headersMark = input['pageHeadersTruncated'];
  if (headersMark !== undefined && (headersMark !== true || !pageHeaders?.length))
    return reject('pageHeadersTruncated');
  const undefinedReferencesRaw = input['undefinedReferencesOnPage'];
  if (undefinedReferencesRaw === null || undefinedReferencesRaw === undefined)
    return reject('undefinedReferencesOnPage');
  const undefinedReferencesOnPage = parseErrorWords(undefinedReferencesRaw);
  if (undefinedReferencesOnPage === null) return reject('undefinedReferencesOnPage');
  const wprDetections = parseWprDetections(input['wprDetections']);
  if (wprDetections === null) return reject('wprDetections');
  const preloadedResourcesRaw = input['preloadedResources'];
  if (preloadedResourcesRaw === null || preloadedResourcesRaw === undefined)
    return reject('preloadedResources');
  const preloadedResources = parsePreloadedResources(preloadedResourcesRaw);
  if (preloadedResources === null) return reject('preloadedResources');
  const diagnoserRaw = input['diagnoserData'];
  const diagnoserData = diagnoserRaw === null ? null : parseDiagnoserData(diagnoserRaw);
  if (diagnoserRaw !== null && diagnoserData === null) return reject('diagnoserData');
  if (typeof input['allScriptsLoaded'] !== 'boolean') return reject('allScriptsLoaded');
  const scriptSnapshotId = input['scriptSnapshotId'];
  if (scriptSnapshotId !== undefined && !isScriptSnapshotId(scriptSnapshotId))
    return reject('scriptSnapshotId');
  const payload = {
    ...(scriptSnapshotId === undefined ? {} : { scriptSnapshotId }),
    allScriptsLoaded: input['allScriptsLoaded'],
    pageHeaders,
    undefinedReferencesOnPage,
    wprDetections,
    preloadedResources,
    diagnoserData,
    ...(headersMark === true ? { pageHeadersTruncated: true as const } : {})
  };
  // Additive top-level field. An own `undefined` reads exactly like absence
  // here (just as JSON serialization drops it) — the strict-additive key-count
  // rule applies to row shapes such as `source`, not to this optional
  // envelope flag. Payloads from before the field existed stay valid; payloads
  // missing a newly required row key still reject below (an update invalidates
  // the old content-script world, so the existing reload path recovers).
  const cookiesRaw = input['cookies'];
  const bypassRaw = input['bypassAttested'];
  if (bypassRaw !== undefined && bypassRaw !== true) return reject('bypassAttested');
  const bypass = bypassRaw === true ? { bypassAttested: true as const } : {};
  // Same shape as the bypass flag: absent, or exactly `true`.
  const metaRaw = input['wprGeneratorMeta'];
  if (metaRaw !== undefined && metaRaw !== true) return reject('wprGeneratorMeta');
  const generatorMeta = metaRaw === true ? { wprGeneratorMeta: true as const } : {};
  // Additive envelope string: absent, or a non-empty version within its cap.
  const wordpressRaw = input['wordpressVersion'];
  if (
    wordpressRaw !== undefined &&
    (typeof wordpressRaw !== 'string' ||
      wordpressRaw.length < 1 ||
      wordpressRaw.length > LIMITS.versions)
  )
    return reject('wordpressVersion');
  const testModeRaw = input['rucssTestMode'];
  const rucssTestMode = testModeRaw === undefined ? undefined : parseRucssTestModeFact(testModeRaw);
  if (rucssTestMode === null) return reject('rucssTestMode');
  const extras = {
    ...bypass,
    ...generatorMeta,
    ...(wordpressRaw === undefined ? {} : { wordpressVersion: wordpressRaw }),
    ...(rucssTestMode === undefined ? {} : { rucssTestMode })
  };
  if (cookiesRaw !== undefined) {
    const cookies = parsePageCookies(cookiesRaw);
    if (cookies === null) return reject('cookies');
    return { ...payload, cookies, ...extras };
  }
  return { ...payload, ...extras };
}

/** A panel-payload parse with its rejection site (see `parseFdtDataExplained`). */
export type ExplainedFdtData =
  { readonly ok: true; readonly data: FdtData } | { readonly ok: false; readonly path: string };

/**
 * {@link parseFdtData}, naming the first failing field on rejection — the
 * path (`wprDetections.lazyload.images[3].src`) is safe to log: field names
 * and indices only, never a value.
 *
 * @param input The untrusted payload.
 * @returns The parsed payload, or the rejection path.
 */
export function parseFdtDataExplained(input: unknown): ExplainedFdtData {
  explaining = true;
  rejectionTrail = [];
  try {
    const data = parseFdtData(input);
    return data !== null ? { ok: true, data } : { ok: false, path: joinTrail(rejectionTrail) };
  } finally {
    explaining = false;
    rejectionTrail = [];
  }
}

/**
 * DevTools search relay; unknown actions, a missing/malformed relay tab id or
 * extra keys are dropped. The tab id is the panel's scoping basis (the
 * protocol row's documented exception), so it is validated here like any
 * other boundary field.
 */
export function parsePanelSearchAction(input: unknown): PanelSearchAction | null {
  if (!isRecord(input)) return null;
  const action = input['action'];
  if (typeof action !== 'string') return null;
  const tabId = numericTabId(input['tabId']);
  if (tabId === null) return null;
  if (action === PANEL_SEARCH_ACTIONS.performSearch && Object.keys(input).length === 3) {
    const query = input['query'];
    if (typeof query !== 'string' || query.length > LIMITS.searchQuery) return null;
    return { action, query, tabId };
  }
  if (
    (action === PANEL_SEARCH_ACTIONS.cancelSearch ||
      action === PANEL_SEARCH_ACTIONS.nextSearchResult ||
      action === PANEL_SEARCH_ACTIONS.previousSearchResult) &&
    Object.keys(input).length === 2
  ) {
    return { action, tabId };
  }
  return null;
}
