/**
 * A mirror of WP Rocket's Automatic Lazy Rendering hash pass, rebuilt from
 * the served page: which elements a set of rows excludes, and which
 * lazy-rendered elements the exclusion re-keys.
 *
 * WP Rocket parses the page with libxml, walks `<body>`'s element children
 * three levels deep (`rocket_lrc_depth` 2), visiting only the processed tags
 * (`div main footer section article header` — traversal stops at any
 * other tag) and skipping any element with an SVG `<use>` descendant. Each
 * visited element's opening tag, as libxml re-serializes it and cut at its
 * first `>`, is tested against the rows (ASCII-case-insensitive
 * substrings): a hit skips the element and its subtree; otherwise the
 * element is hashed as `md5(opening tag . count)` and `count` advances — up
 * to 200 hashes (`rocket_lrc_max_hashes`). Excluding an element therefore
 * shifts `count` for every later element: their hashes change and the
 * stored below-the-fold list stops matching them until it is regenerated.
 *
 * The served page tells which elements are lazy-rendered (they carry the
 * stamp); a stamped element's source text is its serialization (WP Rocket
 * found it in the page by that text). Others are re-serialized
 * (`./libxml/serialize`); where that fails closed, whether a row matches is
 * unknown, and so is every outcome that depends on it — never a guess.
 */
import { LAZY_RENDER_ATTRIBUTE } from '../wp-rocket/constants';
import { isEndTag, scanTokens, type ScannedTag, type ScannedToken } from './html-scan';
import {
  libxmlTextModeAt,
  libxmlTextModes,
  type DocumentBytes,
  type LibxmlTextModes
} from './libxml/charset';
import { libxmlOpeningTag } from './libxml/serialize';
import { buildLibxmlTree, type LibxmlTree, type TreeElement } from './libxml/tree';
import { asciiLowerCase, lazyRenderRowsInert } from './literal-rows';
import { findAttribute, removeAttribute } from './tag-edit';

/** The tags WP Rocket hashes (`rocket_lrc_processed_tags` default). */
const PROCESSED_TAGS: ReadonlySet<string> = new Set([
  'div',
  'main',
  'footer',
  'section',
  'article',
  'header'
]);

/** `rocket_lrc_depth` default: levels below `<body>` past the first. */
const TRAVERSAL_DEPTH = 2;

/** `rocket_lrc_max_hashes` default. */
const MAX_HASHES = 200;

/** The stamp WP Rocket inserts right after the tag name of a lazy-rendered element. */
const STAMP_TEXT = ` ${LAZY_RENDER_ATTRIBUTE}="1"`;

/** Whether a row matches an element: its index, `-1` for none, or `unknown`. */
type RowMatch = number | 'unknown';

/** What WP Rocket does with one stamped element under the rows. */
export type LazyRenderVerdict =
  | { readonly kind: 'excluded'; readonly row: number }
  | { readonly kind: 'kept' }
  | { readonly kind: 'unknown' };

/**
 * Cut an opening tag at its first `>`, as WP Rocket's
 * `strstr($html, '>', true) . '>'` does (a raw `<!--…-->` value ends it early).
 *
 * @param tagText Opening-tag text.
 */
function cutAtFirstGt(tagText: string): string {
  const gt = tagText.indexOf('>');
  return gt === -1 ? tagText : tagText.slice(0, gt + 1);
}

/**
 * The text WP Rocket matched for a stamped element: the served tag with the
 * stamp it inserted after the tag name taken out (a stamp elsewhere is
 * removed as an attribute), cut at the first `>`.
 *
 * @param tagText The stamped opening tag.
 * @param name Its tag name.
 */
function stampedSubject(tagText: string, name: string): string {
  const at = 1 + name.length;
  const unstamped = tagText.startsWith(STAMP_TEXT, at)
    ? tagText.slice(0, at) + tagText.slice(at + STAMP_TEXT.length)
    : removeAttribute(tagText, LAZY_RENDER_ATTRIBUTE);
  return cutAtFirstGt(unstamped);
}

/**
 * Whether an opening tag carries the lazy-render stamp.
 *
 * @param tag The scanned opening tag.
 */
export function isLazyRenderStamped(tag: ScannedTag): boolean {
  return findAttribute(tag, LAZY_RENDER_ATTRIBUTE) !== null;
}

/**
 * Each hashed element's `count` in WP Rocket's walk, or `null` when an
 * element's match is unknown (the walk cannot be rebuilt past it).
 *
 * @param tree The rebuilt page.
 * @param matchingRow The row matching an element (`-1` for none).
 */
export function hashOrder(
  tree: LibxmlTree,
  matchingRow: (element: TreeElement) => RowMatch
): Map<TreeElement, number> | null {
  const order = new Map<TreeElement, number>();
  /** Walk one level: `go` on, `stop` at the cap, or `unknown` past a match it cannot tell. */
  const walk = (children: readonly TreeElement[], depth: number): 'go' | 'stop' | 'unknown' => {
    if (depth < 0) return 'go';
    for (const child of children) {
      if (order.size >= MAX_HASHES) return 'stop';
      if (child.containsUse || !PROCESSED_TAGS.has(child.tag.name)) continue;
      const row = matchingRow(child);
      if (row === 'unknown') return 'unknown';
      if (row !== -1) continue;
      order.set(child, order.size);
      const below = walk(child.children, depth - 1);
      if (below !== 'go') return below;
    }
    return 'go';
  };
  return walk(tree.rootChildren, TRAVERSAL_DEPTH) === 'unknown' ? null : order;
}

/**
 * The verdict for one element: WP Rocket meets its processed ancestors
 * top-down, and the first match skips the subtree — so the element is
 * excluded when it or a processed ancestor matches (the outermost match's
 * row), and unknown when none matches but one is unknown.
 *
 * @param element The stamped element.
 * @param root The walk's root (`<body>`), or `null` for the document.
 * @param matchingRow The row matching an element.
 */
export function chainVerdict(
  element: TreeElement,
  root: TreeElement | null,
  matchingRow: (element: TreeElement) => RowMatch
): LazyRenderVerdict {
  let row = -1;
  let unknown = false;
  for (let node: TreeElement | null = element; node !== null && node !== root;) {
    if (node === element || PROCESSED_TAGS.has(node.tag.name)) {
      const hit = matchingRow(node);
      if (hit === 'unknown') unknown = true;
      else if (hit !== -1) row = hit;
    }
    node = node.parent;
  }
  if (row !== -1) return { kind: 'excluded', row };
  return unknown ? { kind: 'unknown' } : { kind: 'kept' };
}

/** The analysis of one served page under one row set. */
export interface LazyRenderAnalysis {
  /** What WP Rocket does with a stamped element (by its tag). */
  readonly verdict: (tag: ScannedTag) => LazyRenderVerdict;
  /**
   * The stamped elements excluding re-keys (lazy-rendered and still hashed,
   * under a different hash), or `null` when unknown: a walked element's
   * match is unknown, or the rebuilt walk does not reach every stamped
   * element (the page was parsed or configured differently than modelled).
   */
  readonly rekeyed: () => readonly ScannedTag[] | null;
}

/**
 * Analyze a served page for a row set.
 *
 * @param servedHtml The served page (decoded text).
 * @param tokens Its tokens (`scanTokens`).
 * @param rows The Automatic Lazy Rendering rows (literals).
 * @param bytes How the session decoded the page (UTF-8 without a BOM when omitted).
 */
export function analyzeLazyRender(
  servedHtml: string,
  tokens: readonly ScannedToken[],
  rows: readonly string[],
  bytes?: DocumentBytes
): LazyRenderAnalysis {
  const tree = buildLibxmlTree(tokens);
  let modes: LibxmlTextModes | null = null;
  const loweredRows = lazyRenderRowsInert(rows) ? [] : rows.map(asciiLowerCase);
  const rowCache = new Map<TreeElement, RowMatch>();

  const matchingRow = (element: TreeElement): RowMatch => {
    if (loweredRows.length === 0) return -1;
    const cached = rowCache.get(element);
    if (cached !== undefined) return cached;
    const tagText = servedHtml.slice(element.tag.start, element.tag.openingEnd);
    modes ??= libxmlTextModes(
      servedHtml,
      tokens.filter((token): token is ScannedTag => !isEndTag(token)),
      bytes
    );
    const subject = isLazyRenderStamped(element.tag)
      ? stampedSubject(tagText, element.tag.name)
      : libxmlOpeningTag(tagText, libxmlTextModeAt(modes, element.tag.start));
    const lowered = subject === null ? null : asciiLowerCase(subject);
    const row: RowMatch =
      lowered === null ? 'unknown' : loweredRows.findIndex((r) => lowered.includes(r));
    rowCache.set(element, row);
    return row;
  };

  return {
    verdict: (tag) => {
      const element = tree.byStart.get(tag.start);
      return element === undefined
        ? { kind: 'kept' }
        : chainVerdict(element, tree.root, matchingRow);
    },
    rekeyed: () => {
      const stamped = [...tree.byStart.values()].filter((element) =>
        isLazyRenderStamped(element.tag)
      );
      const baseline = hashOrder(tree, () => -1);
      if (baseline === null || stamped.some((element) => !baseline.has(element))) return null;
      const after = hashOrder(tree, matchingRow);
      if (after === null) return null;
      return stamped
        .filter((element) => {
          const count = after.get(element);
          return count !== undefined && count !== baseline.get(element);
        })
        .map((element) => element.tag);
    }
  };
}

/**
 * The lazy-rendered elements WP Rocket re-keys once `rows` are excluded:
 * still hashed, under a new hash, so the stored below-the-fold data no
 * longer matches them and they render eagerly until it is regenerated.
 *
 * @param servedHtml The served page (decoded text).
 * @param rows The Automatic Lazy Rendering rows (literals).
 * @param bytes How the session decoded the page (UTF-8 without a BOM when omitted).
 * @returns The re-keyed elements' opening tags in document order, or `null`
 *   when the page's hash order cannot be rebuilt.
 */
export function lazyRenderRekeyed(
  servedHtml: string,
  rows: readonly string[],
  bytes?: DocumentBytes
): readonly ScannedTag[] | null {
  return analyzeLazyRender(servedHtml, scanTokens(servedHtml), rows, bytes).rekeyed();
}
