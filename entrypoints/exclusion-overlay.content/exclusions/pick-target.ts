/**
 * Picked element → candidate exclusion row, in the lane whose engine
 * transform would act on it. Pure over an element snapshot (tag + attribute
 * reads + a script's text), so every rule is unit-tested without a DOM.
 *
 * Lanes and what each row is matched against by the engine:
 * - Delay JS — a delayed script (delay type, or the delay runtime's
 *   attributes); regex over the script's whole markup: its URL path, or
 *   for an inline script its `id="…"`, else its first line.
 * - Defer JS — a script carrying WP Rocket's defer marker; regex over its
 *   effective URL (the path).
 * - Image Lazyload — an `<img>` with a lazy source; literal substring of
 *   the restored tag (the image URL's path).
 * - Automatic Lazy Rendering — an element stamped for lazy rendering;
 *   literal substring of its opening tag (`id="…"`, else a class token).
 *
 * Same-origin URLs are named by path (stable across hosts and cache
 * stamps — the query is never part of a row); other origins keep the host.
 * Minified per-file assets are named by their original path, so the row
 * also matches with Minify off.
 */
import {
  DATA_LAZY_SRC,
  DELAY_JS_SRC,
  DELAY_JS_TYPE_OLD,
  LAZY_RENDER_ATTRIBUTE,
  WPR_DEFER_ATTRIBUTE
} from '../../../lib/wp-rocket/constants';
import {
  DELAY_STATUS_ATTRIBUTE,
  DELAY_TYPE_ATTRIBUTE
} from '../../../lib/exclusion-builder/delay-js';
import { recoverOriginalScript } from '../../../lib/wp-rocket/minify-url-recovery';
import { parseUrl } from '../../../utils/urls';
import { escapeRegex } from '../../../utils/regex';
import type { LaneKey } from './draft';

/** What the classifier reads from one element. */
export interface ElementSnapshot {
  /** Lowercase tag name. */
  readonly tag: string;
  /** An attribute's value, `null` when absent. */
  attribute(name: string): string | null;
  /** A script's source text (inline scripts), `null` otherwise. */
  readonly text: string | null;
}

/** One candidate exclusion for a picked element. */
export interface PickCandidate {
  readonly lane: LaneKey;
  /** The row to add, in the lane's row kind (regex or literal). */
  readonly row: string;
  /** What the row names, for people (a file name, an id, a script's first line). */
  readonly subject: string;
}

/** Longest inline-script excerpt used as a row. */
const INLINE_EXCERPT_CHARS = 48;

/** How a URL is named in a row. */
interface UrlName {
  /** Path (same origin) or host + path (other origins), as served (percent-encoding kept). */
  readonly text: string;
  /** The URL's last path segment, for people. */
  readonly file: string;
}

/**
 * Name a script or image URL for a row.
 *
 * @param raw The attribute value (absolute or relative).
 * @param pageUrl The page's URL (resolves relative values, decides same-origin).
 * @returns The name, or null when the value is not an http(s) URL.
 */
export function nameUrl(raw: string, pageUrl: string): UrlName | null {
  const base = parseUrl(pageUrl);
  let url: URL;
  try {
    url = new URL(raw.trim(), base ?? undefined);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const recovered = recoverOriginalScript(url.href);
  // A minified asset's mirrored original path names the source file on
  // whichever host served it — the cache URL's own host is not its origin.
  const path =
    recovered.kind === 'original' ? recovered.originalPath : url.pathname.replace(/^\/+/, '');
  const sameOrigin = recovered.kind === 'original' || (base !== null && base.origin === url.origin);
  const text = sameOrigin && path !== '' ? path : `${url.host}${path === '' ? '' : `/${path}`}`;
  const file =
    path
      .split('/')
      .filter((part) => part !== '')
      .at(-1) ?? url.host;
  return { text, file };
}

/** Whether a script is delayed by WP Rocket (type vocabulary or the delay runtime's attributes). */
function isDelayedScript(el: ElementSnapshot): boolean {
  // Substring match, like the engine's candidacy: `;charset=…` suffixes count.
  if ((el.attribute('type') ?? '').includes(DELAY_JS_TYPE_OLD)) return true;
  return [DELAY_STATUS_ATTRIBUTE, DELAY_TYPE_ATTRIBUTE, DELAY_JS_SRC].some(
    (name) => el.attribute(name) !== null
  );
}

/** The script's effective URL: the delay-parked original, else `src`. */
function effectiveScriptUrl(el: ElementSnapshot): string | null {
  const url = el.attribute(DELAY_JS_SRC) ?? el.attribute('src');
  return url === null || url.trim() === '' ? null : url;
}

/** The first non-blank line of a script, cut to the excerpt length. */
function firstLine(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part !== '');
  return line === undefined ? null : line.slice(0, INLINE_EXCERPT_CHARS);
}

/** The Delay JS candidate of a delayed script. */
function delayCandidate(el: ElementSnapshot, pageUrl: string): PickCandidate | null {
  const raw = effectiveScriptUrl(el);
  if (raw !== null) {
    const name = nameUrl(raw, pageUrl);
    return name === null
      ? null
      : { lane: 'delayJs', row: escapeRegex(name.text), subject: name.file };
  }
  const id = el.attribute('id');
  if (id !== null && id !== '') {
    return { lane: 'delayJs', row: escapeRegex(`id="${id}"`), subject: `#${id}` };
  }
  const line = el.text === null ? null : firstLine(el.text);
  return line === null ? null : { lane: 'delayJs', row: escapeRegex(line), subject: line };
}

/** The Defer JS candidate of a WP Rocket-deferred script. */
function deferCandidate(el: ElementSnapshot, pageUrl: string): PickCandidate | null {
  if (el.attribute(WPR_DEFER_ATTRIBUTE) === null) return null;
  const raw = effectiveScriptUrl(el);
  const name = raw === null ? null : nameUrl(raw, pageUrl);
  return name === null
    ? null
    : { lane: 'deferJs', row: escapeRegex(name.text), subject: name.file };
}

/**
 * The most specific class token: one carrying a digit (builders stamp
 * per-element ids into classes), else the longest.
 */
function distinctClass(classes: string): string | null {
  const tokens = classes.split(/\s+/).filter((token) => token !== '');
  const ranked = [...tokens].sort(
    (a, b) => Number(/\d/.test(b)) - Number(/\d/.test(a)) || b.length - a.length
  );
  return ranked[0] ?? null;
}

/** The Automatic Lazy Rendering candidate of a stamped element. */
function lazyRenderCandidate(el: ElementSnapshot): PickCandidate | null {
  if (el.attribute(LAZY_RENDER_ATTRIBUTE) === null) return null;
  const id = el.attribute('id');
  if (id !== null && id !== '') return { lane: 'lazyRender', row: `id="${id}"`, subject: `#${id}` };
  const token = distinctClass(el.attribute('class') ?? '');
  if (token !== null) return { lane: 'lazyRender', row: token, subject: `${el.tag}.${token}` };
  return { lane: 'lazyRender', row: `<${el.tag}`, subject: `<${el.tag}>` };
}

/** The Image Lazyload candidate of a lazy image. */
function lazyloadCandidate(el: ElementSnapshot, pageUrl: string): PickCandidate | null {
  if (el.tag !== 'img') return null;
  const raw = el.attribute(DATA_LAZY_SRC);
  if (raw === null || raw.trim() === '') return null;
  const name = nameUrl(raw, pageUrl);
  return name === null ? null : { lane: 'lazyload', row: name.text, subject: name.file };
}

/**
 * Every candidate exclusion for one element, most relevant first (a
 * delayed script that is also deferred offers Delay JS first — the delay
 * runs before the defer and is the one that keeps it from loading).
 *
 * @param el The element.
 * @param pageUrl The page's URL.
 */
export function candidatesFor(el: ElementSnapshot, pageUrl: string): readonly PickCandidate[] {
  const found: (PickCandidate | null)[] =
    el.tag === 'script'
      ? [isDelayedScript(el) ? delayCandidate(el, pageUrl) : null, deferCandidate(el, pageUrl)]
      : [lazyloadCandidate(el, pageUrl), lazyRenderCandidate(el)];
  return found.filter((candidate): candidate is PickCandidate => candidate !== null);
}

/** A pointer pick's resolution. */
export interface ResolvedPick {
  readonly candidate: PickCandidate;
  /** How many ancestors up from the pointed element the target is (0 = itself). */
  readonly depth: number;
}

/**
 * Resolve what a pointer pick targets: the nearest element — the pointed
 * one first, then its ancestors — that has a candidate. Scripts render
 * nothing, so pointing reaches images and lazily rendered sections only;
 * scripts are picked from the page's candidate list.
 *
 * @param chain The pointed element followed by its ancestors (outermost last).
 * @param pageUrl The page's URL.
 */
export function resolvePointerPick(
  chain: readonly ElementSnapshot[],
  pageUrl: string
): ResolvedPick | null {
  for (const [depth, el] of chain.entries()) {
    const candidate = candidatesFor(el, pageUrl)[0];
    if (candidate !== undefined) return { candidate, depth };
  }
  return null;
}
