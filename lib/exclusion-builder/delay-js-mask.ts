/**
 * The regions WP Rocket's Delay JS hides before it matches scripts
 * (`RegexTrait::replace_xmp_tags`, then `replace_svg_tags`): each
 * `<xmp…>…</xmp>`, then each `<svg…>…</svg>` of the result, becomes an
 * HTML comment placeholder holding a unique id, put back once the scripts
 * are rewritten. The regexes are textual — a `'<svg>'` in a script's code
 * counts — so a masked region can hide script end tags, or whole scripts:
 * Delay JS's matches read past them, and a row is tested against a match
 * holding the placeholder instead of the region. The served page holds
 * every region as it was (only Delay JS's own rewrites differ).
 */
import { PCRE_SPACE_CHARS } from './pcre/byte-set';

/** PCRE's `\s` (no UTF) as a JS class. */
const SPACE = `[${PCRE_SPACE_CHARS}]`;

/**
 * A region regex of WP Rocket's (`#<open.*>.*<close>#Uis` — lazy, ASCII-
 * caseless, dot-all) as its two ends: the leftmost lazy match from an
 * opening is the text up to the first close after the opening's first `>`
 * (and there is none when no close follows that `>`). Found by search, not
 * by a backtracking regex: linear on any page.
 */
interface RegionPattern {
  readonly open: RegExp;
  readonly close: RegExp;
}

/** `#<xmp.*>.*</xmp>#Uis`. */
const XMP: RegionPattern = { open: /<[Xx][Mm][Pp]/g, close: /<\/[Xx][Mm][Pp]>/g };

/** `#<\s*svg.*>.*<\s*\\?/\s*svg\s*>#Uis` (an optional `\` before the `/`). */
const SVG: RegionPattern = {
  open: new RegExp(`<${SPACE}*[Ss][Vv][Gg]`, 'g'),
  close: new RegExp(`<${SPACE}*\\\\?\\/${SPACE}*[Ss][Vv][Gg]${SPACE}*>`, 'g')
};

/** A region pattern's matches over a text. */
interface RegionScan {
  /** `[start, end)` per match, left to right, not overlapping. */
  readonly found: [number, number][];
  /**
   * Where the regex's first failing attempt that reads to the end of the
   * text starts — an opening with a `>` after it but no close after that —
   * or `-1`: the attempt PCRE spends the most on after the last match.
   */
  readonly unclosed: number;
}

/**
 * Every match of a region pattern, left to right, not overlapping.
 *
 * @param text The text.
 * @param pattern The pattern.
 */
function regionMatches(text: string, pattern: RegionPattern): RegionScan {
  const found: [number, number][] = [];
  pattern.open.lastIndex = 0;
  for (let open = pattern.open.exec(text); open !== null; open = pattern.open.exec(text)) {
    const gt = text.indexOf('>', open.index + open[0].length);
    if (gt === -1) break;
    pattern.close.lastIndex = gt + 1;
    const close = pattern.close.exec(text);
    // No close after this opening's `>`: none after any later opening's either.
    if (close === null) return { found, unclosed: open.index };
    const end = close.index + close[0].length;
    found.push([open.index, end]);
    pattern.open.lastIndex = end;
  }
  return { found, unclosed: -1 };
}

/** A region Delay JS hides, as offsets into the served page. */
export interface MaskedRegion {
  readonly start: number;
  readonly end: number;
  readonly kind: 'svg' | 'xmp';
}

/**
 * The placeholder WP Rocket puts in a region's place: `<!-- WPR_SVG_<id> -->`
 * (or `WPR_XMP_`), `<id>` a PHP `uniqid()` — 13 hex digits, unknowable here.
 *
 * @param kind The region's kind.
 * @param id The id to write.
 */
export function maskPlaceholder(kind: MaskedRegion['kind'], id: string): string {
  return `<!-- WPR_${kind.toUpperCase()}_${id} -->`;
}

/**
 * The id written into placeholders for matching: 13 NULs, which the Delay
 * JS matcher reads as "every hex digit" (see `./pcre/id-probe`) — the real
 * id is clock-derived and unknowable, so no sample of ids can stand in.
 */
export const MASK_ID_SENTINEL = '\0'.repeat(13);

/**
 * Every xmp region of a page (`replace_xmp_tags`' matches), in page order —
 * those inside svg regions included, which {@link delayMaskedRegions} lists
 * with their svg region.
 *
 * @param html The page Delay JS read.
 */
export function delayXmpRegions(html: string): readonly MaskedRegion[] {
  return xmpScan(html).regions;
}

/**
 * The xmp regex over a page.
 *
 * @param html The page.
 */
function xmpScan(html: string): {
  readonly regions: readonly MaskedRegion[];
  readonly unclosed: number;
} {
  if (!/xmp/i.test(html)) return { regions: [], unclosed: -1 };
  const scan = regionMatches(html, XMP);
  const regions = scan.found.map(([start, end]): MaskedRegion => ({ start, end, kind: 'xmp' }));
  return { regions, unclosed: scan.unclosed };
}

/** The id the xmp placeholders get while the svg regex reads the page (it reads past them). */
const XMP_ID_WHILE_MASKING = '0000000000000';

/**
 * The regions Delay JS hides on a page, in page order, not overlapping:
 * the xmp regions, then the svg regions read on the page with the xmp ones
 * already hidden (an svg region may take in xmp ones; those are not listed
 * apart).
 *
 * @param html The page Delay JS read (the served page).
 */
export function delayMaskedRegions(html: string): readonly MaskedRegion[] {
  return delayMaskScan(html).regions;
}

/** The masking regexes' reading of a page. */
export interface DelayMaskScan {
  /** As {@link delayMaskedRegions}. */
  readonly regions: readonly MaskedRegion[];
  /**
   * Each regex's first failing attempt that reads to the end of its text
   * (see `RegionScan.unclosed`), as a page offset, or `-1`.
   */
  readonly unclosed: { readonly xmp: number; readonly svg: number };
}

/**
 * {@link delayMaskedRegions}, plus where each regex gives up after its last
 * match — what PCRE's backtracking spends the most on.
 *
 * @param html The page Delay JS read (the served page).
 */
export function delayMaskScan(html: string): DelayMaskScan {
  if (!/svg|xmp/i.test(html)) return { regions: [], unclosed: { xmp: -1, svg: -1 } };
  const xmpRead = xmpScan(html);
  const xmp = xmpRead.regions;
  // The svg regex reads the page with each xmp region already a placeholder.
  const pieces: string[] = [];
  /** Masked-text offset → page offset, at each piece start. */
  const map: { readonly masked: number; readonly page: number; readonly placeholder: boolean }[] =
    [];
  let page = 0;
  let masked = 0;
  for (const region of xmp) {
    pieces.push(html.slice(page, region.start));
    map.push({ masked, page, placeholder: false });
    masked += region.start - page;
    const placeholder = maskPlaceholder('xmp', XMP_ID_WHILE_MASKING);
    pieces.push(placeholder);
    map.push({ masked, page: region.start, placeholder: true });
    masked += placeholder.length;
    page = region.end;
  }
  pieces.push(html.slice(page));
  map.push({ masked, page, placeholder: false });
  const text = pieces.join('');
  const toPage = (offset: number): number => {
    // The last piece starting at or before `offset` (binary search: pieces are in order).
    const at = map[lastAtOrBefore(map.length, (index) => map[index]?.masked ?? 0, offset)];
    if (at === undefined) return offset;
    // An svg region starts and ends outside placeholders (their `<` is a
    // `<!--`, their `>` a `-->`): only plain text maps by offset.
    return at.page + (at.placeholder ? 0 : offset - at.masked);
  };
  const svgRead = regionMatches(text, SVG);
  const svg = svgRead.found.map(([start, end]): MaskedRegion => ({
    start: toPage(start),
    end: toPage(end - 1) + 1,
    kind: 'svg'
  }));
  // An xmp region inside an svg one is listed with it (both lists in page order).
  const kept: MaskedRegion[] = [];
  let cover = 0;
  for (const region of xmp) {
    while ((svg[cover]?.end ?? Infinity) < region.end) cover++;
    const outer = svg[cover];
    if (outer === undefined || outer.start > region.start) kept.push(region);
  }
  return {
    regions: [...kept, ...svg].sort((left, right) => left.start - right.start),
    // An svg opening is never inside a placeholder: it maps by offset.
    unclosed: {
      xmp: xmpRead.unclosed,
      svg: svgRead.unclosed === -1 ? -1 : toPage(svgRead.unclosed)
    }
  };
}

/**
 * The index of the last item whose key is at or before `offset` (-1 when
 * none): a binary search over keys in ascending order.
 *
 * @param length How many items.
 * @param key An item's key, by index.
 * @param offset The offset.
 */
function lastAtOrBefore(length: number, key: (index: number) => number, offset: number): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (key(middle) <= offset) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/**
 * The index of the first region starting at or after `offset` (`length`
 * when none), regions being in page order.
 *
 * @param regions The page's regions, in page order, not overlapping.
 * @param offset A page offset.
 */
export function firstRegionFrom(regions: readonly MaskedRegion[], offset: number): number {
  return (
    lastAtOrBefore(regions.length, (index) => regions[index]?.start ?? Infinity, offset - 1) + 1
  );
}

/**
 * A slice of the page as Delay JS read it: each region inside written as
 * its placeholder with `id`.
 *
 * @param html The page.
 * @param from Slice start.
 * @param to Slice end (regions are wholly inside or outside the slice).
 * @param regions The page's regions, in page order.
 * @param id The placeholder id to write.
 */
export function maskedSlice(
  html: string,
  from: number,
  to: number,
  regions: readonly MaskedRegion[],
  id: string
): string {
  let text = '';
  let at = from;
  // Only regions wholly inside the slice (they never straddle a match's ends).
  for (let index = firstRegionFrom(regions, from); index < regions.length; index++) {
    const region = regions[index];
    if (region === undefined || region.end > to) break;
    text += html.slice(at, region.start) + maskPlaceholder(region.kind, id);
    at = region.end;
  }
  return text + html.slice(at, to);
}

/** Where a placeholder's id starts within it (`<!-- WPR_SVG_`). */
const ID_OFFSET = maskPlaceholder('svg', '').indexOf(' -->');

/**
 * A match's text as Delay JS read it, for matching: each region a
 * placeholder whose id is the sentinel, and where those ids are — known
 * from writing them, never found by searching (the page may spell one).
 *
 * @param text The match's text (from its `<script`).
 * @returns The masked text and its ids' start offsets, in order.
 */
export function maskedForMatching(text: string): {
  readonly text: string;
  readonly ids: readonly number[];
} {
  let masked = '';
  let at = 0;
  const ids: number[] = [];
  for (const region of delayMaskedRegions(text)) {
    masked += text.slice(at, region.start);
    ids.push(masked.length + ID_OFFSET);
    masked += maskPlaceholder(region.kind, MASK_ID_SENTINEL);
    at = region.end;
  }
  return { text: masked + text.slice(at), ids };
}
