/**
 * WP Rocket's assets URL (`WP_ROCKET_ASSETS_URL`) as a served page shows it:
 * LazyLoad's runtime tag loads from under it, but the URL is server state
 * (content folder, plugin folder name, scheme), so a page where LazyLoad is
 * off can only evidence it. Evidence, strongest first: WP Rocket's own beacon
 * tag (built from the same constant — exact), another plugin's asset on the
 * page's origin (plugins URL; folder name assumed), a theme's asset there
 * (content URL; plugins folder and folder name assumed), else WordPress's
 * defaults on the page's origin. The source is reported so the assumption
 * can be named. Every URL returned is normalized (the form the browser
 * requests). A CDN rewrite of the runtime tag is not evidenced by any of
 * these (WP Rocket rewrites before it adds the beacon).
 */
import { decodeAttributeValue } from '../../utils/html-attribute-value';
import { scanTags, type ScannedTag } from '../exclusion-builder/html-scan';
import { attributeValue } from './generator-meta';
import { pageBeaconBlock } from './lazyload-hook-texts';

/** Where the assets URL came from (see the module doc), strongest first. */
export const LAZYLOAD_ASSETS_URL_SOURCES = [
  'beacon',
  'plugin-asset',
  'theme-asset',
  'default'
] as const;

/** Where the assets URL came from. */
export type LazyloadAssetsUrlSource = (typeof LAZYLOAD_ASSETS_URL_SOURCES)[number];

/** The assets URL used for a page and its source. */
export interface LazyloadAssetsUrl {
  /** Absolute, normalized, ending in `/` (WP Rocket's `WP_ROCKET_ASSETS_URL`). */
  readonly url: string;
  readonly source: LazyloadAssetsUrlSource;
}

/** The beacon URL's path: the assets JS folder (`js/` under the assets path) + the beacon file. */
const BEACON_PATH = /^(\/(?:.*\/)?)js\/wpr-beacon(?:\.min)?\.js$/;

/**
 * Characters an asset URL's path is never trusted with as written: a
 * backslash (read as `/`), whitespace or controls (stripped or encoded by
 * the parser).
 */
const UNTRUSTED_CHARACTERS = /[\\\s\p{Cc}]/u;

/** A dot segment (`.`/`..`, percent-encoded too), resolved away by the parser. */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/** WP Rocket's plugin folder and its assets folder, under the plugins URL. */
const WP_ROCKET_ASSETS_PATH = 'wp-rocket/assets/';

/** The plugins folder under the content URL. */
const PLUGINS_DIR = 'plugins/';

/** WordPress's default content folder name: a path under it needs no other proof. */
const DEFAULT_CONTENT_DIR = '/wp-content/';

/** `<link rel>` tokens that make the browser fetch the `href` as an asset. */
const ASSET_LINK_RELS: ReadonlySet<string> = new Set(['stylesheet', 'preload', 'modulepreload']);

/**
 * A CSS `url(…)` value: optional quote, then the URL up to a quote, `)` or
 * space. The close is not checked: every match ends where its run stops, so
 * the scan stays linear (a checked close would re-read the run per start).
 */
const CSS_URL = /url\(\s*["']?([^"')\s]*)/gi;

/**
 * WP Rocket's assets URL for a served page (see the module doc).
 *
 * @param html The served page (decoded).
 * @param pageUrl The page's URL (http or https).
 * @returns The URL and its source.
 * @throws {@link Error} when `pageUrl` is not an absolute http(s) URL.
 */
export function lazyloadAssetsUrl(html: string, pageUrl: string): LazyloadAssetsUrl {
  const origin = httpOrigin(pageUrl);
  const beacon = beaconAssetsUrl(html);
  if (beacon !== null) return { url: beacon, source: 'beacon' };
  const found = siteAssetEvidence(html, origin);
  if (found.plugins !== null) {
    return { url: `${found.plugins}${WP_ROCKET_ASSETS_PATH}`, source: 'plugin-asset' };
  }
  if (found.content !== null) {
    return {
      url: `${found.content}${PLUGINS_DIR}${WP_ROCKET_ASSETS_PATH}`,
      source: 'theme-asset'
    };
  }
  return {
    url: `${origin}${DEFAULT_CONTENT_DIR}${PLUGINS_DIR}${WP_ROCKET_ASSETS_PATH}`,
    source: 'default'
  };
}

/**
 * A page URL's origin.
 *
 * @param pageUrl The page's URL.
 * @throws {@link Error} when it is not an absolute http(s) URL.
 */
function httpOrigin(pageUrl: string): string {
  const parsed = URL.parse(pageUrl);
  if (parsed === null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error(`LazyLoad assets URL: not an http(s) page URL: ${pageUrl.slice(0, 200)}`);
  }
  return parsed.origin;
}

/**
 * The assets URL WP Rocket's beacon tag names — the tag of the block
 * abutting the page's last `</body>`, where the buffer writes it — or `null`
 * without one or when its URL is not exact (see {@link exactAssetUrl}). Any
 * host is kept: the content URL may live on another host.
 *
 * @param html The served page.
 */
export function beaconAssetsUrl(html: string): string | null {
  const block = pageBeaconBlock(html);
  const src = block === null ? null : decodeAttributeValue(block.src);
  const url = src === null ? null : exactAssetUrl(src);
  if (url === null) return null;
  const dir = BEACON_PATH.exec(url.pathname)?.[1];
  return dir === undefined ? null : `${url.origin}${dir}`;
}

/**
 * An absolute http(s) URL written exactly as the browser requests it: an
 * {@link assetUrl} with no query or fragment.
 *
 * @param text The URL (entities decoded).
 */
export function exactAssetUrl(text: string): URL | null {
  return text.includes('?') || text.includes('#') ? null : assetUrl(text);
}

/**
 * An absolute http(s) asset URL whose path reads as written — no userinfo,
 * backslash, whitespace, control or dot segment before any query or
 * fragment — parsed, else `null`.
 *
 * @param text The URL (entities decoded).
 */
export function assetUrl(text: string): URL | null {
  const cut = text.search(/[?#]/);
  const beforeQuery = cut < 0 ? text : text.slice(0, cut);
  if (UNTRUSTED_CHARACTERS.test(beforeQuery)) return null;
  const url = URL.parse(text);
  if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
  if (url.username !== '' || url.password !== '') return null;
  return beforeQuery.split('/').some((segment) => DOT_SEGMENT.test(segment)) ? null : url;
}

/** The plugins URL and content URL a page's same-origin asset references show. */
export interface SiteAssetEvidence {
  /** `<content URL>plugins/` of the first accepted plugin asset, or `null`. */
  readonly plugins: string | null;
  /** The content URL (ending in `/`) of the first accepted theme asset, or `null`. */
  readonly content: string | null;
}

/** An asset path's content folder (`/…/` before `plugins/`/`themes/`) and kind. */
interface ContentFolder {
  readonly base: string;
  readonly kind: 'plugins' | 'themes';
}

/**
 * The plugins and content URLs a page's asset references on `origin` show.
 * Only URLs the browser fetches as assets count (see
 * {@link assetReferences}) — never links, canonical/meta URLs or text.
 * A path's first `plugins`/`themes` segment followed by a folder and a file
 * names its content folder, accepted when it is `…/wp-content/` or proven by
 * an asset of the other kind under the same folder; the first accepted one
 * of each kind wins.
 *
 * @param html The served page.
 * @param origin The page's origin (`scheme://host[:port]`).
 */
export function siteAssetEvidence(html: string, origin: string): SiteAssetEvidence {
  const folders: ContentFolder[] = [];
  const seen = { plugins: new Set<string>(), themes: new Set<string>() };
  for (const reference of assetReferences(html)) {
    const url = assetUrl(reference);
    if (url?.origin !== origin) continue;
    const folder = contentFolder(url.pathname);
    if (folder === null) continue;
    folders.push(folder);
    seen[folder.kind].add(folder.base);
  }
  const accepted = (folder: ContentFolder): boolean =>
    folder.base.endsWith(DEFAULT_CONTENT_DIR) ||
    seen[folder.kind === 'plugins' ? 'themes' : 'plugins'].has(folder.base);
  const plugin = folders.find((folder) => folder.kind === 'plugins' && accepted(folder));
  const theme = folders.find((folder) => folder.kind === 'themes' && accepted(folder));
  return {
    plugins: plugin === undefined ? null : `${origin}${plugin.base}${PLUGINS_DIR}`,
    content: theme === undefined ? null : `${origin}${theme.base}`
  };
}

/**
 * A path's content folder: through the `/` before its first `plugins` or
 * `themes` segment that a non-empty folder segment and more path follow.
 *
 * @param path A URL path (normalized, from its leading `/`).
 * @returns The folder and kind, or `null`.
 */
function contentFolder(path: string): ContentFolder | null {
  const segments = path.split('/');
  // segments[0] is '' (the leading `/`); a folder and a file must follow the kind.
  for (let at = 1; at + 2 < segments.length; at++) {
    const kind = segments[at];
    if (kind !== 'plugins' && kind !== 'themes') continue;
    if (segments[at + 1] === '') return null;
    return { base: `${segments.slice(0, at).join('/')}/`, kind };
  }
  return null;
}

/**
 * The URLs a page makes the browser fetch as assets, in document order:
 * `<script src>`, `<img src>`, `<link href>` with an asset `rel`
 * (stylesheet, preload, modulepreload), and `url(…)` in `<style>` elements
 * (attributes entity-decoded; undecodable ones skipped).
 *
 * @param html The served page.
 */
export function assetReferences(html: string): string[] {
  const references: string[] = [];
  for (const tag of scanTags(html)) {
    if (tag.name === 'style') {
      for (const found of html.slice(tag.openingEnd, tag.contentEnd).matchAll(CSS_URL)) {
        references.push(found[1] ?? '');
      }
      continue;
    }
    const raw = assetAttribute(tag);
    const decoded = raw === null ? null : decodeAttributeValue(raw);
    if (decoded !== null) references.push(decoded);
  }
  return references;
}

/**
 * A tag's raw asset URL attribute, or `null` when the tag fetches no asset.
 *
 * @param tag An opening tag.
 */
function assetAttribute(tag: ScannedTag): string | null {
  if (tag.name === 'script' || tag.name === 'img') return attributeValue(tag, 'src');
  if (tag.name !== 'link') return null;
  const rel = attributeValue(tag, 'rel');
  const tokens = rel === null ? [] : rel.toLowerCase().split(/[ \t\n\f\r]+/);
  return tokens.some((token) => ASSET_LINK_RELS.has(token)) ? attributeValue(tag, 'href') : null;
}
