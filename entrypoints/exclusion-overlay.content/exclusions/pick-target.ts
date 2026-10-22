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
import { HTML_VOID_ELEMENTS } from '../../../lib/exclusion-builder/html-scan';
import type { LaneKey } from './draft';

/** What the classifier reads from one element. */
export interface ElementSnapshot {
  /** Lowercase tag name. */
  readonly tag: string;
  /** An attribute's value, `null` when absent. */
  attribute(name: string): string | null;
  /** A script's source text (inline scripts), `null` otherwise. */
  readonly text: string | null;
  /** The element's opening tag as the DOM serializes it (lazily rendered elements' rows test it). */
  readonly openingTag: string;
  /** Every attribute name, in order. */
  attributeNames(): readonly string[];
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
 * the match texts of its lazily rendered elements (see
 * {@link lazyRenderPeerText}) and lazy images (their opening tags) — a row
 * naming one of them by a shortened name must be a substring of no other's.
 */
export interface PickContext {
  readonly pageUrl: string;
  readonly lazyRenderPeers: readonly string[];
  /** Read on demand (only a path with an `&` needs them). */
  readonly lazyImagePeers: () => readonly LazyImagePeer[];
}

/** A lazy image as a shortened row name is checked against. */
export interface LazyImagePeer {
  /** Its `data-lazy-src` value (copies of one image share it). */
  readonly lazySrc: string;
  /** Its opening tag. */
  readonly tag: string;
}

/**
 * What the engine tests a lazily rendered element's rows against: its
 * child-cleared markup — the opening tag plus its end tag (none for void
 * elements).
 *
 * @param el A lazily rendered element.
 */
export function lazyRenderPeerText(el: ElementSnapshot): string {
  return HTML_VOID_ELEMENTS.has(el.tag) ? el.openingTag : `${el.openingTag}</${el.tag}>`;
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
  // Root-relative and relative paths are written as served (a relative
  // `uploads/x.jpg` resolves elsewhere, but its served text is this).
  return text === '' ? resolved.pathname : text.replace(/^\.\//, '');
}

/**
 * Characters a regex row cannot hold literally: WP Rocket's settings save
 * rewrites `<` (escaped, or stripped as markup), `%` (`%xx` octets removed),
 * `*` (every one becomes `(.*)`) and tab/CR/LF (collapsed to a space); Delay
 * JS's runtime turns `+` into `\+` and `?ver` into `\?ver`, so an escaped
 * `\+`/`\?` stops matching. A hex escape survives all of them and means the
 * same to PCRE and JS. Matches one such character (captured) or a run of
 * other characters.
 */
const HEX_ESCAPED = /([+?*<%\t\n\r])|[^+?*<%\t\n\r]+/g;

/**
 * Spaces the save would change: a leading or trailing one (trimmed) and
 * each one followed by another (a run collapses to one space).
 */
const HEX_ESCAPED_SPACES = /^ | (?= )| $/g;

/**
 * A character as a two-digit hex escape (`+` → `\x2B`).
 *
 * @param char One character below U+0100.
 */
function hexEscape(char: string): string {
  return `\\x${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
}

/**
 * The regex row matching `text` literally once WP Rocket has saved it and
 * its Delay/Defer JS runtime has read it: metacharacters escaped, and every
 * character either would change hex-escaped (`a+b.js` → `a\x2Bb\.js`,
 * never `a\+b\.js`). `#` stays raw: the runtime escapes it itself, while a
 * typed `\#` breaks the row.
 *
 * @param text The literal text.
 */
function literalPattern(text: string): string {
  // The save drops a row that is just `0` (PHP reads it as empty).
  if (text === '0') return hexEscape(text);
  return text
    .replace(HEX_ESCAPED, (chunk, hex?: string) =>
      hex === undefined ? escapeRegex(chunk) : hexEscape(hex)
    )
    .replace(HEX_ESCAPED_SPACES, hexEscape);
}

/**
 * A pattern matching `text` as served: `&` may be written `&amp;` in the
 * markup (the DOM decodes it).
 *
 * @param text The literal text.
 */
function servedPattern(text: string): string {
  return literalPattern(text).replaceAll('&', '(?:&|&amp;)');
}

/** Shortest stretch worth naming a file by. */
const MIN_STRETCH_CHARS = 4;

/**
 * Where a literal row must not reach across: `&` (the markup may write it
 * `&amp;`), and what WP Rocket's save rewrites in a literal — `<`, `%`
 * (`%xx` octets removed), tab/CR/LF and space runs (collapsed).
 */
const LITERAL_BREAKS = /[&<%\t\n\r]| {2,}/;

/**
 * A literal that is in the served form of `text` whatever the markup's `&`
 * encoding, and that WP Rocket stores as written: the text itself, or its
 * longest stretch between {@link LITERAL_BREAKS} (trimmed, as the save
 * trims) that is long enough to name a file and in no other image's tag (a
 * part of a name may well be in another's: `a&b.jpg` → `b.jpg`, in
 * `thumb.jpg`). Copies of the same image (same `data-lazy-src`) are not
 * others: the row names them all.
 *
 * @param text The decoded text.
 * @param lazySrc The picked image's `data-lazy-src` value.
 * @param peers Every lazy image of the page, on demand.
 * @returns The literal, or null when no stretch names only this image.
 */
function servedLiteral(
  text: string,
  lazySrc: string,
  peers: () => readonly LazyImagePeer[]
): string | null {
  // A lone `0` is a row WP Rocket ignores; it is too short to be a stretch.
  if (!LITERAL_BREAKS.test(text) && text.trim() === text && text !== '0') return text;
  const others = peers().filter((peer) => peer.lazySrc !== lazySrc);
  const stretches = text
    .split(LITERAL_BREAKS)
    .map((part) => part.trim())
    .filter((part) => part.length >= MIN_STRETCH_CHARS)
    .sort((a, b) => b.length - a.length);
  return stretches.find((part) => !others.some((peer) => peer.tag.includes(part))) ?? null;
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
  // A host-less value with no path (`/?q=1`) holds no text a row could name.
  if (path === '' && URL_AUTHORITY.exec(raw.trim()) === null) return null;
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
      : { lane: 'delayJs', row: servedPattern(name.text), subject: name.file };
  }
  const id = el.attribute('id');
  if (id !== null && id !== '') {
    // `\s` bounds the attribute name (`data-id` must not match); either
    // quote, or none, and the value bounded on both sides. A value starting
    // `ver` gets its `v` hex-escaped: Delay JS's runtime would read the
    // optional quote's `?ver` as its literal `\?ver`.
    const value = servedPattern(id).replace(/^ver/, '\\x76er');
    return {
      lane: 'delayJs',
      row: `\\sid=["']?${value}(?=["'\\s/>])`,
      subject: `#${id}`
    };
  }
  const line = el.text === null ? null : firstLine(el.text);
  return line === null ? null : { lane: 'delayJs', row: literalPattern(line), subject: line };
}

/** The Defer JS candidate of a WP Rocket-deferred script. */
function deferCandidate(el: ElementSnapshot, pageUrl: string): PickCandidate | null {
  if (el.attribute(WPR_DEFER_ATTRIBUTE) === null) return null;
  const raw = effectiveScriptUrl(el);
  const name = raw === null ? null : nameUrl(raw, pageUrl);
  return name === null
    ? null
    : { lane: 'deferJs', row: servedPattern(name.text), subject: name.file };
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

/** Whether a literal is in at most one peer's match text (its own). */
function unique(literal: string, peers: readonly string[]): boolean {
  return peers.filter((peer) => peer.includes(literal)).length <= 1;
}

/** Attributes whose values never name an element (shared by design, or styling). */
const UNNAMING_ATTRIBUTES = new Set(['id', 'class', 'style', LAZY_RENDER_ATTRIBUTE]);

/** Shortest value worth naming an element by. */
const MIN_NAME_CHARS = 2;

/**
 * The Automatic Lazy Rendering candidate of a stamped element: the first
 * of its id, its class tokens (most specific first), then its other
 * attribute values, that is in its own match text and in no other stamped
 * element's — checked against whole opening and end tags, so a value
 * inside another element's attribute or tag name is never offered. Bare
 * values hold whatever the served quoting or attribute separators are.
 * None when nothing names only this element.
 */
function lazyRenderCandidate(el: ElementSnapshot, peers: readonly string[]): PickCandidate | null {
  if (el.attribute(LAZY_RENDER_ATTRIBUTE) === null) return null;
  const own = el.openingTag;
  const named = (value: string | null): boolean =>
    value !== null && value.length >= MIN_NAME_CHARS && own.includes(value) && unique(value, peers);
  const id = el.attribute('id');
  if (id !== null && named(id)) return { lane: 'lazyRender', row: id, subject: `#${id}` };
  const token = rankedClasses(el.attribute('class') ?? '').find(named);
  if (token !== undefined) return { lane: 'lazyRender', row: token, subject: `${el.tag}.${token}` };
  const names = el.attributeNames().filter((name) => !UNNAMING_ATTRIBUTES.has(name));
  for (const name of names) {
    const value = el.attribute(name);
    if (value !== null && named(value))
      return { lane: 'lazyRender', row: value, subject: `${el.tag}[${name}]` };
  }
  // Bare values are shared: fall back to the attribute as the DOM writes it
  // (` name="value"`), which holds for markup written the same way.
  for (const name of id === null ? names : ['id', ...names]) {
    const bounded = ` ${name}="${el.attribute(name) ?? ''}"`;
    if (named(bounded)) return { lane: 'lazyRender', row: bounded, subject: `${el.tag}[${name}]` };
  }
  return null;
}

/** The Image Lazyload candidate of a lazy image. */
function lazyloadCandidate(el: ElementSnapshot, context: PickContext): PickCandidate | null {
  if (el.tag !== 'img') return null;
  const raw = el.attribute(DATA_LAZY_SRC);
  if (raw === null || raw.trim() === '') return null;
  const name = nameUrl(raw, context.pageUrl);
  const literal = name === null ? null : servedLiteral(name.text, raw, context.lazyImagePeers);
  return name === null || literal === null
    ? null
    : { lane: 'lazyload', row: literal, subject: name.file };
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
      : [lazyloadCandidate(el, context), lazyRenderCandidate(el, context.lazyRenderPeers)];
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
