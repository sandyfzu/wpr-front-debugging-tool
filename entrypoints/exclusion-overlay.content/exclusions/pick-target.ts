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
  MINIFY_CACHE_DIR_SOURCE,
  WPR_DEFER_ATTRIBUTE
} from '../../../lib/wp-rocket/constants';
import { EXCLUSION_SET_LIMITS, isWireRowText } from '../../../lib/messaging/exclusion-session';
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

/** Longest inline-script excerpt used as a row, in code points. */
const INLINE_EXCERPT_CODE_POINTS = 48;

/**
 * What the classifier knows about the page beyond one element: its URL and
 * the match texts of every lazily rendered element (see
 * {@link lazyRenderPeerText}) — a row naming one of them must not be a
 * substring of another's.
 */
export interface PickContext {
  readonly pageUrl: string;
  readonly lazyRenderPeers: readonly string[];
}

/**
 * The attributes a lazily rendered element's row may name, as they read in
 * its opening tag (`␠id="…"␠class="…"`).
 *
 * @param el A lazily rendered element.
 */
export function lazyRenderPeerText(el: ElementSnapshot): string {
  const id = el.attribute('id');
  const classes = el.attribute('class');
  return `${id === null ? '' : ` id="${id}"`}${classes === null ? '' : ` class="${classes}"`}`;
}

/** The leading part of a served URL up to its path: scheme + host, or `//host`. */
const URL_AUTHORITY = /^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]*/i;

/** The minify-cache prefix of a served path (everything up to the mirrored original). */
const MINIFY_PREFIX = new RegExp(`^.*?${MINIFY_CACHE_DIR_SOURCE}`);

/**
 * The URL's path exactly as the served attribute writes it — raw UTF-8 or
 * percent-encoded, whichever the page used (a parsed URL would always
 * percent-encode, and the engine matches the served text). A relative
 * value (`../x.js`) has no such text: its resolved path is used.
 *
 * @param raw The attribute value.
 * @param resolved The value resolved against the page.
 */
function servedPath(raw: string, resolved: URL): string {
  const text = raw.trim().split(/[?#]/)[0] ?? '';
  const authority = URL_AUTHORITY.exec(text);
  if (authority !== null) return text.slice(authority[0].length);
  return text.startsWith('/') ? text : resolved.pathname;
}

/** How a URL is named in a row. */
interface UrlName {
  /** Path (same origin) or host + path (other origins), as the served attribute writes it. */
  readonly text: string;
  /** The URL's last path segment, for people. */
  readonly file: string;
}

/**
 * A URL's name for people: its last path segment — with the one before it
 * when the last carries no extension (`gtag/js`) — prefixed by the host for
 * another origin's URL.
 *
 * @param path The URL path (no leading slash).
 * @param host The host to show, or null for a same-origin URL.
 */
function fileName(path: string, host: string | null): string {
  const parts = path.split('/').filter((part) => part !== '');
  const last = parts.at(-1);
  if (last === undefined) return host ?? '/';
  const tail = last.includes('.') || parts.length < 2 ? last : parts.slice(-2).join('/');
  return host === null ? tail : `${host} › ${tail}`;
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
  const served = servedPath(raw, url).replace(/^\/+/, '');
  // A minified asset's mirrored original path names the source file on
  // whichever host served it — the cache URL's own host is not its origin.
  const minified = recoverOriginalScript(url.href).kind === 'original';
  const path = minified ? served.replace(MINIFY_PREFIX, '') : served;
  const sameOrigin = minified || (base !== null && base.origin === url.origin);
  const text = sameOrigin && path !== '' ? path : `${url.host}${path === '' ? '' : `/${path}`}`;
  if (text.length > EXCLUSION_SET_LIMITS.rowChars) return null;
  return { text, file: fileName(path, sameOrigin ? null : url.host) };
}

/**
 * A candidate only when its row can be stored and sent (within the row cap,
 * printable) — a picked element never produces a row the session refuses.
 */
function storable(candidate: PickCandidate): PickCandidate | null {
  return isWireRowText(candidate.row) ? candidate : null;
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
  // Cut on code points: a cut inside a surrogate pair leaves a lone half,
  // which no row may carry.
  return line === undefined ? null : Array.from(line).slice(0, INLINE_EXCERPT_CODE_POINTS).join('');
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
    // `\s` bounds the attribute name: `id="x"` alone also matches `data-id="x"`.
    return { lane: 'delayJs', row: `\\sid="${escapeRegex(id)}"`, subject: `#${id}` };
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
 * Class tokens, most specific first: those carrying a digit (builders stamp
 * per-element ids into classes), then longer ones.
 */
function rankedClasses(classes: string): string[] {
  return classes
    .split(/\s+/)
    .filter((token) => token !== '')
    .sort((a, b) => Number(/\d/.test(b)) - Number(/\d/.test(a)) || b.length - a.length);
}

/** Whether a literal names at most one lazily rendered element (itself). */
function unique(literal: string, peers: readonly string[]): boolean {
  return peers.filter((peer) => peer.includes(literal)).length <= 1;
}

/**
 * The Automatic Lazy Rendering candidate of a stamped element: its id
 * (bounded by the preceding space), else the most specific class token no
 * other stamped element's attributes contain, else its whole quoted class
 * value; none when no literal names only it.
 */
function lazyRenderCandidate(el: ElementSnapshot, peers: readonly string[]): PickCandidate | null {
  if (el.attribute(LAZY_RENDER_ATTRIBUTE) === null) return null;
  const id = el.attribute('id');
  if (id !== null && id !== '' && unique(` id="${id}"`, peers)) {
    return { lane: 'lazyRender', row: ` id="${id}"`, subject: `#${id}` };
  }
  const classes = el.attribute('class') ?? '';
  const token = rankedClasses(classes).find((candidate) => unique(candidate, peers));
  if (token !== undefined) return { lane: 'lazyRender', row: token, subject: `${el.tag}.${token}` };
  const whole = `class="${classes}"`;
  return classes.trim() !== '' && unique(whole, peers)
    ? { lane: 'lazyRender', row: whole, subject: `${el.tag}.${rankedClasses(classes)[0] ?? ''}` }
    : null;
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
 * @param context The page's URL and lazily rendered peers.
 */
export function candidatesFor(el: ElementSnapshot, context: PickContext): readonly PickCandidate[] {
  const { pageUrl } = context;
  const found: (PickCandidate | null)[] =
    el.tag === 'script'
      ? [isDelayedScript(el) ? delayCandidate(el, pageUrl) : null, deferCandidate(el, pageUrl)]
      : [lazyloadCandidate(el, pageUrl), lazyRenderCandidate(el, context.lazyRenderPeers)];
  return found
    .map((candidate) => (candidate === null ? null : storable(candidate)))
    .filter((candidate): candidate is PickCandidate => candidate !== null);
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
 * @param context The page's URL and lazily rendered peers.
 */
export function resolvePointerPick(
  chain: readonly ElementSnapshot[],
  context: PickContext
): ResolvedPick | null {
  for (const [depth, el] of chain.entries()) {
    const candidate = candidatesFor(el, context)[0];
    if (candidate !== undefined) return { candidate, depth };
  }
  return null;
}
