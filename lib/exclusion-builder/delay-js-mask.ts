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

/**
 * Every match of a region pattern, left to right, not overlapping.
 *
 * @param text The text.
 * @param pattern The pattern.
 * @returns `[start, end)` per match.
 */
function regionMatches(text: string, pattern: RegionPattern): [number, number][] {
  const found: [number, number][] = [];
  pattern.open.lastIndex = 0;
  for (let open = pattern.open.exec(text); open !== null; open = pattern.open.exec(text)) {
    const gt = text.indexOf('>', open.index + open[0].length);
    if (gt === -1) break;
    pattern.close.lastIndex = gt + 1;
    const close = pattern.close.exec(text);
    // No close after this opening's `>`: none after any later opening's either.
    if (close === null) break;
    const end = close.index + close[0].length;
    found.push([open.index, end]);
    pattern.open.lastIndex = end;
  }
  return found;
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
 * Ids standing in for the unknowable one: a row whose verdict changes
 * across them depends on it (the answer is undetermined).
 */
export const MASK_ID_SAMPLES: readonly string[] = [
  '0000000000000',
  'fffffffffffff',
  '6713e5a1b2c3d'
];

/** The id the xmp placeholders get while the svg regex reads the page (it reads past them). */
const XMP_ID_WHILE_MASKING = MASK_ID_SAMPLES[0] ?? '0000000000000';

/**
 * The regions Delay JS hides on a page, in page order, not overlapping:
 * the xmp regions, then the svg regions read on the page with the xmp ones
 * already hidden (an svg region may take in xmp ones; those are not listed
 * apart).
 *
 * @param html The page Delay JS read (the served page).
 */
export function delayMaskedRegions(html: string): readonly MaskedRegion[] {
  if (!/svg|xmp/i.test(html)) return [];
  const xmp = regionMatches(html, XMP).map(([start, end]): MaskedRegion => ({
    start,
    end,
    kind: 'xmp'
  }));
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
    let at = map[0] ?? { masked: 0, page: 0, placeholder: false };
    for (const entry of map) if (entry.masked <= offset) at = entry;
    // An svg region starts and ends outside placeholders (their `<` is a
    // `<!--`, their `>` a `-->`): only plain text maps by offset.
    return at.page + (at.placeholder ? 0 : offset - at.masked);
  };
  const svg = regionMatches(text, SVG).map(([start, end]): MaskedRegion => ({
    start: toPage(start),
    end: toPage(end - 1) + 1,
    kind: 'svg'
  }));
  const kept = xmp.filter(
    (region) => !svg.some((s) => s.start <= region.start && region.end <= s.end)
  );
  return [...kept, ...svg].sort((left, right) => left.start - right.start);
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
  for (const region of regions) {
    // Only regions wholly inside the slice (they never straddle a match's ends).
    if (region.start < from || region.end > to) continue;
    text += html.slice(at, region.start) + maskPlaceholder(region.kind, id);
    at = region.end;
  }
  return text + html.slice(at, to);
}
