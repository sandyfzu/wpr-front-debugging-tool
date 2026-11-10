/**
 * The Priority Elements subsystem: WP Rocket's measurement beacon and the
 * four features it serves — Optimize critical images, Automatic Lazy
 * Rendering, Preload fonts, Preconnect to external domains.
 *
 * The beacon pair (external tag + inline config) is injected when ≥ 1
 * enabled feature still lacks its applied row for the URL+device, so beacon
 * presence proves none of the four individually — it is the family's
 * "collecting / not yet applied" signal, never an error state, and it is
 * never used as feature evidence here. Each check is evidence-pure: it
 * reports only what the page's own markup proves; composing "collecting"
 * (feature enabled per the config's status map, no applied markup yet) is
 * view-model work.
 */

import type {
  AutomaticLazyRenderingDetection,
  AutoPreloadFontsDetection,
  BeaconFeatureStatus,
  OptimizeCriticalImagesDetection,
  PreconnectExternalDomainsDetection,
  PriorityElementsBeaconDetection
} from '../wp-rocket/types';
import {
  BEACON_CONFIG_LIMITS,
  BEACON_CONFIG_LIST_FIELDS,
  BEACON_CONFIG_PATTERN,
  BEACON_CONFIG_TRAILING_NOISE,
  BEACON_DATA_NAME,
  BEACON_SRC_PATTERN,
  BEACON_STATUS_KEYS,
  LAZY_RENDER_ATTRIBUTE,
  LAZY_RENDER_INLINE_CSS_ID,
  LOCATION_HASH_ATTRIBUTE,
  OPTIMIZE_CRITICAL_IMAGES_COMMENT,
  ROCKET_PREFETCH_ATTRIBUTE,
  ROCKET_PRECONNECT_ATTRIBUTE,
  WPR_PRELOAD_ATTRIBUTE
} from '../wp-rocket/constants';
import { isRecord } from '../../utils/is-record';
import type { ParsedPage } from './parse-page';
import { servedScriptSrc } from './served-script-src';

/** The inline beacon config parsed and validated — the beacon row minus presence. */
export type ParsedBeaconConfig = Omit<PriorityElementsBeaconDetection, 'present'>;

/**
 * Parse the inline beacon config (`<script>var rocket_beacon_data = {…}
 * </script>`): the first config script in document order wins (the plugin
 * injects exactly one; further matches are noise).
 *
 * @returns The validated config, or null when no config script exists or any
 *   part of it is malformed/hostile — a wholesale degrade (the beacon tag
 *   alone remains the row's evidence); never throws on page data.
 */
export function parseBeaconConfig(page: ParsedPage): ParsedBeaconConfig | null {
  for (const script of page.scripts) {
    const match = BEACON_CONFIG_PATTERN.exec(script.textContent);
    if (match === null) continue;
    return parseConfigJson(script.textContent.slice(match[0].length));
  }
  return null;
}

/**
 * Parse the config JSON — the inline script's text after the variable
 * assignment, with tolerated trailing `;`/whitespace. Strict JSON is the
 * plugin's emission (`wp_json_encode`, verified across 3.17-pilot → develop);
 * pages whose HTML was rewritten (prettified caches — the corpus carries
 * three such captures) hold the same values as a JavaScript object literal,
 * so the bounded literal parser is the fallback. Both paths land in the same
 * validation below.
 */
function parseConfigJson(json: string): ParsedBeaconConfig | null {
  const tail = json.replace(BEACON_CONFIG_TRAILING_NOISE, '');
  if (tail.length > BEACON_CONFIG_LIMITS.text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(tail);
  } catch {
    try {
      parsed = parseJsLiteral(tail);
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;

  const config: ParsedBeaconConfig = { status: null, isMobile: null };

  const status = parsed['status'];
  if (status !== undefined) {
    const parsedStatus = parseStatusMap(status);
    if (parsedStatus === null) return null;
    config.status = parsedStatus;
  }

  const isMobile = parsed['is_mobile'];
  if (isMobile !== undefined) {
    if (typeof isMobile !== 'boolean') return null;
    config.isMobile = isMobile;
  }

  const elements = parsed['elements'];
  if (elements !== undefined) {
    // A single comma-joined selector string in the plugin's output — carried
    // verbatim, not re-shaped into a list.
    if (typeof elements !== 'string' || elements.length > BEACON_CONFIG_LIMITS.elements)
      return null;
    config.elements = elements;
  }

  for (const field of BEACON_CONFIG_LIST_FIELDS) {
    const value = parsed[field];
    if (value === undefined) continue;
    const list = parseBoundedStringList(value);
    if (list === null) return null;
    config[field] = list;
  }
  return config;
}

/**
 * The config's `status` map: known keys must be booleans (the enablement
 * contract); unknown keys are preserved only when bounded JSON primitives —
 * future releases declare feature toggles there, while anything structured
 * or oversized is noise or hostile. Any violation degrades the whole map.
 */
function parseStatusMap(status: unknown): BeaconFeatureStatus | null {
  if (!isRecord(status)) return null;
  const keys = Object.keys(status);
  if (keys.length > BEACON_CONFIG_LIMITS.status.keys) return null;
  const parsed: BeaconFeatureStatus = {};
  for (const key of keys) {
    const value = status[key];
    // An own `__proto__` key is never plugin output (JSON-parsed or literal);
    // assigning through the name would invoke the inherited setter instead
    // of preserving the value — hostile, so the map degrades.
    if (key === '__proto__') return null;
    if ((BEACON_STATUS_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') return null;
      parsed[key] = value;
    } else if (isBoundedPrimitive(value)) {
      parsed[key] = value;
    } else {
      return null;
    }
  }
  return parsed;
}

/** A JSON primitive within the status string cap (booleans/null pass as-is). */
function isBoundedPrimitive(value: unknown): boolean {
  if (typeof value === 'boolean' || value === null) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= BEACON_CONFIG_LIMITS.status.chars;
  return false;
}

/**
 * Bounded recursive-descent parser for the config-as-JavaScript-literal
 * shape: objects (quoted or bare keys), strings in either quote style with
 * the JSON escape set (the prettified captures carry `\/`), finite numbers,
 * the true/false/null literals, and arrays. No eval and no string→JSON
 * regex transforms — values are read character-wise and the standard
 * validation below decides what survives. Any structural violation, escape
 * or bound breach throws; the caller catches and degrades.
 *
 * Bounds (see `BEACON_CONFIG_LIMITS.text` plus these): ≤ 4 nesting levels,
 * ≤ 2,000 values per config, and the input is consumed end-to-end —
 * trailing content is a parse failure, not silent data loss.
 */
function parseJsLiteral(text: string): unknown {
  const MAX_VALUES = 2_000;
  const MAX_DEPTH = 4;
  let pos = 0;
  let values = 0;

  function fail(why: string): never {
    throw new Error(`beacon config literal: ${why} (at ${String(pos)})`);
  }

  function skipWs(): void {
    while (pos < text.length && /\s/.test(text.charAt(pos))) pos += 1;
  }

  function parseValue(depth: number): unknown {
    values += 1;
    if (values > MAX_VALUES) fail('too many values');
    if (depth > MAX_DEPTH) fail('nesting too deep');
    skipWs();
    const c = text.charAt(pos);
    if (c === '{') return parseObject(depth + 1);
    if (c === '[') return parseArray(depth + 1);
    if (c === "'" || c === '"') return parseString(c);
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    if (text.startsWith('true', pos)) {
      pos += 4;
      return true;
    }
    if (text.startsWith('false', pos)) {
      pos += 5;
      return false;
    }
    if (text.startsWith('null', pos)) {
      pos += 4;
      return null;
    }
    fail(`unexpected character ${JSON.stringify(c)}`);
  }

  function parseObject(depth: number): Record<string, unknown> {
    pos += 1; // opening brace
    const object: Record<string, unknown> = {};
    skipWs();
    if (text.charAt(pos) === '}') {
      pos += 1;
      return object;
    }
    for (;;) {
      skipWs();
      const key = parseKey();
      // Assigning `__proto__` would set the object's prototype instead of a
      // key (hiding its values from every field check): never plugin output.
      if (key === '__proto__') fail('__proto__ key');
      skipWs();
      if (text.charAt(pos) !== ':') fail('expected :');
      pos += 1;
      object[key] = parseValue(depth);
      skipWs();
      if (text.charAt(pos) === ',') {
        pos += 1;
        skipWs();
        if (text.charAt(pos) === '}') {
          pos += 1;
          return object; // tolerated trailing comma
        }
        continue;
      }
      if (text.charAt(pos) === '}') {
        pos += 1;
        return object;
      }
      fail('expected , or }');
    }
  }

  function parseArray(depth: number): unknown[] {
    pos += 1; // opening bracket
    const array: unknown[] = [];
    skipWs();
    if (text.charAt(pos) === ']') {
      pos += 1;
      return array;
    }
    for (;;) {
      array.push(parseValue(depth));
      skipWs();
      if (text.charAt(pos) === ',') {
        pos += 1;
        skipWs();
        if (text.charAt(pos) === ']') {
          pos += 1;
          return array; // tolerated trailing comma
        }
        continue;
      }
      if (text.charAt(pos) === ']') {
        pos += 1;
        return array;
      }
      fail('expected , or ]');
    }
  }

  function parseKey(): string {
    skipWs();
    const c = text.charAt(pos);
    if (c === "'" || c === '"') return parseString(c);
    // Sticky (y) anchors at lastIndex — no `^`: that would also demand the
    // string's start and only ever match at position 0.
    const bare = /[A-Za-z_$][A-Za-z0-9_$]*/y;
    bare.lastIndex = pos;
    const match = bare.exec(text);
    if (match === null) fail('expected key');
    pos = bare.lastIndex;
    return match[0];
  }

  function parseString(quote: string): string {
    pos += 1; // opening quote
    let out = '';
    for (;;) {
      if (pos >= text.length) fail('unterminated string');
      const c = text.charAt(pos);
      if (c === quote) {
        pos += 1;
        return out;
      }
      if (c === '\\') {
        const next = text.charAt(pos + 1);
        switch (next) {
          case "'":
          case '"':
          case '\\':
          case '/':
            out += next;
            pos += 2;
            continue;
          case 'b':
            out += '\b';
            pos += 2;
            continue;
          case 'f':
            out += '\f';
            pos += 2;
            continue;
          case 'n':
            out += '\n';
            pos += 2;
            continue;
          case 'r':
            out += '\r';
            pos += 2;
            continue;
          case 't':
            out += '\t';
            pos += 2;
            continue;
          case 'u': {
            const hex = text.slice(pos + 2, pos + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad unicode escape');
            out += String.fromCharCode(parseInt(hex, 16));
            pos += 6;
            continue;
          }
          default:
            fail(`unknown escape \\${next}`);
        }
      }
      out += c;
      pos += 1;
    }
  }

  function parseNumber(): number {
    const pattern = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    pattern.lastIndex = pos;
    const match = pattern.exec(text);
    if (match === null) fail('bad number');
    pos = pattern.lastIndex;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail('non-finite number');
    return value;
  }

  const value = parseValue(0);
  skipWs();
  if (pos !== text.length) fail('trailing content');
  return value;
}

/**
 * A list key PHP emits for a list with holes: a canonical non-negative
 * integer (no sign, no leading zero), at most 15 digits so it converts to a
 * number exactly.
 */
const LIST_INDEX_KEY = /^(?:0|[1-9]\d{0,14})$/;

/**
 * A list field's entries in order. The plugin builds some lists with
 * `array_filter`, which keeps the surviving keys, and `wp_json_encode` then
 * writes a list with holes as an object (`{"0":"link","2":"iframe"}`): such
 * an object reads as its values in numeric key order. An object with any
 * other key, or over the list count cap, is no list.
 *
 * @param value The field's parsed value.
 * @returns The entries (still unchecked), or null when the value is no list.
 */
function listEntries(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value as unknown[];
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length > BEACON_CONFIG_LIMITS.lists.count) return null;
  if (!keys.every((key) => LIST_INDEX_KEY.test(key))) return null;
  return keys
    .map(Number)
    .sort((a, b) => a - b)
    .map((index) => value[String(index)]);
}

/**
 * An array of non-empty strings within the payload-list caps, rebuilt fresh
 * (a list with holes accepted, see {@link listEntries}).
 */
function parseBoundedStringList(value: unknown): string[] | null {
  const entries = listEntries(value);
  if (entries === null || entries.length > BEACON_CONFIG_LIMITS.lists.count) return null;
  const list: string[] = [];
  for (const item of entries) {
    if (
      typeof item !== 'string' ||
      item.length < 1 ||
      item.length > BEACON_CONFIG_LIMITS.lists.chars
    ) {
      return null;
    }
    list.push(item);
  }
  return list;
}

/**
 * The beacon row: the tag is the evidence (its marker attribute, or — for
 * builds whose tags were mutated by other optimizers, and SCRIPT_DEBUG
 * builds — the assets path in the URL, min-agnostic). Config fields ride
 * along only when the tag is present and the config parsed.
 *
 * @param page The parsed page.
 * @param config The config parsed once per pass (`parseBeaconConfig`).
 */
export function detectBeacon(
  page: ParsedPage,
  config: ParsedBeaconConfig | null
): PriorityElementsBeaconDetection {
  const tagPresent = page.scripts.some(
    (script) => script.getAttribute('data-name') === BEACON_DATA_NAME
  );
  // The URL fallback reads the served URL: a delayed beacon keeps it in
  // `data-rocket-src`.
  if (
    !tagPresent &&
    !page.scripts.some((script) => BEACON_SRC_PATTERN.test(servedScriptSrc(script)))
  ) {
    return { present: false, status: null, isMobile: null };
  }
  if (config === null) return { present: true, status: null, isMobile: null };
  return { present: true, ...config };
}

/**
 * Optimize critical images: the LCP-image preloads are the applied evidence
 * (`<link data-rocket-preload as="image" …>`, any of the plugin's variants —
 * href, srcset, picture sources, background layers), collected regardless of
 * the beacon so partial pages (applied markers + beacon for a sibling
 * feature) surface both signals truthfully.
 */
export function detectOptimizeCriticalImages(page: ParsedPage): OptimizeCriticalImagesDetection {
  const preloadedImages = page.links
    .filter(
      (link) => link.hasAttribute(WPR_PRELOAD_ATTRIBUTE) && link.getAttribute('as') === 'image'
    )
    .map((link) => link.href);
  return {
    present: preloadedImages.length > 0,
    lcpComment: page.comments.includes(OPTIMIZE_CRITICAL_IMAGES_COMMENT),
    ...(preloadedImages.length > 0 ? { preloadedImages } : {})
  };
}

/**
 * Automatic Lazy Rendering: converted elements are the applied evidence; the
 * render hashes are collecting-phase evidence (stamped on every render while
 * enabled, stripped on apply/bypass) — reported regardless, composition is
 * the view model's.
 */
export function detectAutomaticLazyRendering(page: ParsedPage): AutomaticLazyRenderingDetection {
  const lazyRenderElements = page.document.querySelectorAll(`[${LAZY_RENDER_ATTRIBUTE}]`).length;
  const locationHashes = page.document.querySelectorAll(`[${LOCATION_HASH_ATTRIBUTE}]`).length;
  // The inline style corroborates application (added iff ≥ 1 element was
  // converted); read independently — a page can carry it in any combination.
  const inlineCssPresent = page.document.getElementById(LAZY_RENDER_INLINE_CSS_ID) !== null;
  return { present: lazyRenderElements > 0, lazyRenderElements, inlineCssPresent, locationHashes };
}

/**
 * Preload fonts: only attributed font preloads assert (the attribution
 * separates the automatic feature from pre-3.19 manual font preloads and
 * third-party preloads, which emit the same markup without the attribute).
 */
export function detectAutoPreloadFonts(page: ParsedPage): AutoPreloadFontsDetection {
  const fonts = page.links
    .filter(
      (link) =>
        link.hasAttribute(WPR_PRELOAD_ATTRIBUTE) &&
        (link.getAttribute('rel') ?? '').toLowerCase() === 'preload' &&
        link.getAttribute('as') === 'font'
    )
    .map((link) => link.href)
    .filter((href) => href !== '');
  return { present: fonts.length > 0, fonts };
}

/**
 * Preconnect to external domains: the attribution attributes are the whole
 * claim (`data-rocket-prefetch` on the default dns-prefetch hints,
 * `data-rocket-preconnect` on the filter variant's crossorigin hints) — a
 * bare dns-prefetch hint (e.g. the RocketCDN one) asserts nothing here.
 */
export function detectPreconnectExternalDomains(
  page: ParsedPage
): PreconnectExternalDomainsDetection {
  const domains: string[] = [];
  let preconnectCount = 0;
  for (const link of page.links) {
    const prefetchVariant = link.hasAttribute(ROCKET_PREFETCH_ATTRIBUTE);
    const preconnectVariant = link.hasAttribute(ROCKET_PRECONNECT_ATTRIBUTE);
    if (!prefetchVariant && !preconnectVariant) continue;
    const href = link.href;
    // An empty href proves no domain (resolved '' when the attribute is
    // absent); the variant link still counts as the variant's evidence.
    if (href !== '' && !domains.includes(href)) domains.push(href);
    if (preconnectVariant) preconnectCount += 1;
  }
  return { present: domains.length > 0, domains, preconnectCount };
}
