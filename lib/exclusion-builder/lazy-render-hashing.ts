/**
 * A mirror of WP Rocket's Automatic Lazy Rendering hash pass, rebuilt from
 * the served page: which elements a set of rows excludes, and which
 * lazy-rendered elements the exclusion re-keys.
 *
 * WP Rocket parses the page with libxml, walks `<body>`'s element children
 * three levels deep (`rocket_lrc_depth` 2), visiting only the processed tags
 * (`div main footer section article header` — traversal stops at any
 * other tag) and skipping any element with an SVG `<use>` descendant. Each
 * visited element's opening tag, as libxml re-serializes it, is tested
 * against the rows (ASCII-case-insensitive substrings): a hit skips the
 * element and its subtree; otherwise the element is hashed as
 * `md5(opening tag . count)` and `count` advances — up to 200 hashes
 * (`rocket_lrc_max_hashes`). Excluding an element therefore shifts `count`
 * for every later element: their hashes change and the stored
 * below-the-fold list stops matching them until it is regenerated.
 *
 * The served page tells which elements are lazy-rendered (they carry the
 * stamp); a stamped element's source text is its serialization (WP Rocket
 * found it in the page by that text). Others are re-serialized
 * (`./libxml-serialize`) — where that fails closed, the element matches no
 * row. The tree mirrors libxml's measured parse: its void elements, `/>`,
 * start tags auto-closing an open element (a `<div>` closes a `<p>`), end
 * tags closing only what their priority allows, `<html>`/`<head>`/`<body>`
 * ignored inside the body, nothing after `</body>` in it. A page without
 * `<body>` is walked from the document (for fragments; WP Rocket stamps no
 * such page).
 */
import { LAZY_RENDER_ATTRIBUTE } from '../wp-rocket/constants';
import { isEndTag, scanTokens, type ScannedTag, type ScannedToken } from './html-scan';
import { libxmlDocumentCharset, libxmlOpeningTag, type LibxmlCharset } from './libxml-serialize';
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

/** Elements libxml's HTML parser treats as empty (HTML 4; `source`, `wbr`… are not). */
const LIBXML_VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'basefont',
  'br',
  'col',
  'frame',
  'hr',
  'img',
  'input',
  'isindex',
  'link',
  'meta',
  'param'
]);

/** The start tags shared by the headings' closer lists. */
const HEADING_CLOSERS = 'fieldset form li p table';

/**
 * libxml's start-tag auto-close pairs (measured over every HTML tag pair):
 * `open:closers|…` — a start tag in `closers` closes an open `open` element
 * on top of the stack (repeatedly, while the new top is closable too).
 */
const AUTO_CLOSE_PAIRS = `a:a fieldset table td th|address:dd dl dt form li ul|b:center p td th|big:p|caption:col colgroup tbody tfoot thead tr|colgroup:colgroup tbody tfoot thead tr|dd:dt|dir:dd dl dt form ul|dl:form li|dt:dd dl|font:center td th|form:form|h1:${HEADING_CLOSERS}|h2:${HEADING_CLOSERS}|h3:${HEADING_CLOSERS}|h4:${HEADING_CLOSERS}|h5:${HEADING_CLOSERS}|h6:${HEADING_CLOSERS}|i:center p td th|legend:fieldset|li:li|listing:dd dl dt fieldset form li table ul|menu:dd dl dt form ul|ol:form ul|option:optgroup option|p:address blockquote caption center col colgroup dd dir div dl dt fieldset form frameset h1 h2 h3 h4 h5 h6 hr li listing menu ol p pre table tbody td tfoot th title tr ul xmp|pre:dd dl dt fieldset form li table ul|s:p|small:p|span:td th|strike:p|tbody:tbody tfoot|td:tbody td tfoot th tr|tfoot:tbody|th:tbody td tfoot th tr|thead:tbody tfoot|tr:tbody tfoot tr|tt:p|u:p td th|ul:address form menu ol pre`;

/** {@link AUTO_CLOSE_PAIRS} as open tag → closing start tags. */
const AUTO_CLOSE: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  AUTO_CLOSE_PAIRS.split('|').map((pair) => {
    const [open = '', closers = ''] = pair.split(':');
    return [open, new Set(closers.split(' '))];
  })
);

/** libxml's end-tag priorities: an end tag cannot close past a higher one. */
const END_PRIORITY: ReadonlyMap<string, number> = new Map([
  ['div', 150],
  ['td', 160],
  ['th', 160],
  ['tr', 170],
  ['thead', 180],
  ['tbody', 180],
  ['tfoot', 180],
  ['table', 190],
  ['head', 200],
  ['body', 200],
  ['html', 220]
]);

/** The priority of an element name without its own entry. */
const DEFAULT_END_PRIORITY = 100;

/** The stamp WP Rocket inserts right after the tag name of a lazy-rendered element. */
const STAMP_TEXT = ` ${LAZY_RENDER_ATTRIBUTE}="1"`;

/** One element of the rebuilt tree. */
interface TreeElement {
  readonly tag: ScannedTag;
  readonly parent: TreeElement | null;
  readonly children: TreeElement[];
  /** Whether a `<use>` element is among its descendants. */
  containsUse: boolean;
}

/** The rebuilt page: the walk's root children, and every element by tag offset. */
interface LazyRenderTree {
  /** The children of `<body>` (or of the document, without one). */
  readonly rootChildren: readonly TreeElement[];
  /** The element whose children are walked, or `null` for the document. */
  readonly root: TreeElement | null;
  readonly byStart: ReadonlyMap<number, TreeElement>;
}

/**
 * Close the element an end tag names, as libxml does: only when it is open
 * and no element above it has a higher end priority.
 *
 * @param stack The open elements, innermost last.
 * @param name The end tag's name.
 */
function closeElement(stack: TreeElement[], name: string): void {
  const priority = END_PRIORITY.get(name) ?? DEFAULT_END_PRIORITY;
  for (let index = stack.length - 1; index >= 0; index--) {
    const open = stack[index];
    if (open === undefined) return;
    if (open.tag.name === name) {
      stack.length = index;
      return;
    }
    if ((END_PRIORITY.get(open.tag.name) ?? DEFAULT_END_PRIORITY) > priority) return;
  }
}

/**
 * Rebuild the element tree libxml parses from a page's tokens.
 *
 * @param tokens The page's tokens ({@link scanTokens}).
 */
function buildTree(tokens: readonly ScannedToken[]): LazyRenderTree {
  const top: TreeElement[] = [];
  const stack: TreeElement[] = [];
  const created: TreeElement[] = [];
  const byStart = new Map<number, TreeElement>();
  let body: TreeElement | null = null;
  for (const token of tokens) {
    if (isEndTag(token)) {
      closeElement(stack, token.name);
      continue;
    }
    const name = token.name;
    if (name === 'html' || name === 'head' || name === 'body') {
      // Inside the body libxml ignores these; `<body>` closes `<head>`.
      if (body !== null) continue;
      if (name === 'body') {
        while (stack.length > 0 && stack[stack.length - 1]?.tag.name !== 'html') stack.pop();
      }
    } else {
      while (AUTO_CLOSE.get(stack[stack.length - 1]?.tag.name ?? '')?.has(name) === true) {
        stack.pop();
      }
    }
    const parent = stack[stack.length - 1] ?? null;
    const element: TreeElement = { tag: token, parent, children: [], containsUse: false };
    (parent === null ? top : parent.children).push(element);
    created.push(element);
    byStart.set(token.start, element);
    if (name === 'body') body = element;
    // Raw-text regions (script, style…) were consumed whole by the scanner.
    const empty =
      LIBXML_VOID_ELEMENTS.has(name) || token.selfClosing || token.end !== token.openingEnd;
    if (!empty) stack.push(element);
  }
  // Document order is pre-order, so a reverse pass sees children first.
  for (let index = created.length - 1; index >= 0; index--) {
    const element = created[index];
    if (element?.parent && (element.tag.name === 'use' || element.containsUse)) {
      element.parent.containsUse = true;
    }
  }
  return { rootChildren: body === null ? top : body.children, root: body, byStart };
}

/**
 * The served text of a stamped element as WP Rocket saw it: the stamp it
 * inserted after the tag name taken out. A stamp elsewhere (not WP Rocket's
 * own insertion) is removed as an attribute.
 *
 * @param tagText The stamped opening tag.
 * @param name Its tag name.
 */
function unstampedText(tagText: string, name: string): string {
  const at = 1 + name.length;
  if (tagText.startsWith(STAMP_TEXT, at)) {
    return tagText.slice(0, at) + tagText.slice(at + STAMP_TEXT.length);
  }
  return removeAttribute(tagText, LAZY_RENDER_ATTRIBUTE);
}

/**
 * Whether an opening tag carries the lazy-render stamp.
 *
 * @param tag The scanned opening tag.
 */
export function isLazyRenderStamped(tag: ScannedTag): boolean {
  return findAttribute(tag, LAZY_RENDER_ATTRIBUTE) !== null;
}

/** The analysis of one served page under one row set. */
export interface LazyRenderAnalysis {
  /**
   * The row (index) that excludes a stamped element — its own or an
   * ancestor's opening tag matched, outermost first, as WP Rocket's top-down
   * walk meets them — or `-1`.
   */
  readonly excludingRow: (tag: ScannedTag) => number;
  /**
   * The stamped elements excluding re-keys (lazy-rendered and still hashed,
   * under a different hash), or `null` when the rebuilt walk does not reach
   * every stamped element (the page was parsed or configured differently
   * than modelled, so the count order is unknown).
   */
  readonly rekeyed: () => readonly ScannedTag[] | null;
}

/**
 * Analyze a served page for a row set.
 *
 * @param servedHtml The served page (decoded text).
 * @param tokens Its tokens ({@link scanTokens}).
 * @param rows The Automatic Lazy Rendering rows (literals).
 */
export function analyzeLazyRender(
  servedHtml: string,
  tokens: readonly ScannedToken[],
  rows: readonly string[]
): LazyRenderAnalysis {
  const tree = buildTree(tokens);
  const tags = tokens.filter((token): token is ScannedTag => !isEndTag(token));
  let charset: LibxmlCharset | null = null;
  const loweredRows = lazyRenderRowsInert(rows) ? [] : rows.map(asciiLowerCase);
  const rowCache = new Map<TreeElement, number>();

  /** The first row matching an element's serialized opening tag, or -1. */
  const matchingRow = (element: TreeElement): number => {
    if (loweredRows.length === 0) return -1;
    const cached = rowCache.get(element);
    if (cached !== undefined) return cached;
    const tagText = servedHtml.slice(element.tag.start, element.tag.openingEnd);
    charset ??= libxmlDocumentCharset(servedHtml, tags);
    const subject = isLazyRenderStamped(element.tag)
      ? unstampedText(tagText, element.tag.name)
      : libxmlOpeningTag(tagText, charset);
    const lowered = subject === null ? null : asciiLowerCase(subject);
    const row = lowered === null ? -1 : loweredRows.findIndex((r) => lowered.includes(r));
    rowCache.set(element, row);
    return row;
  };

  /** Each hashed element's `count`, walking with or without the rows. */
  const hashOrder = (withRows: boolean): Map<TreeElement, number> => {
    const order = new Map<TreeElement, number>();
    let capped = false;
    const walk = (children: readonly TreeElement[], depth: number): void => {
      if (depth < 0) return;
      for (const child of children) {
        if (order.size >= MAX_HASHES) {
          capped = true;
          return;
        }
        if (child.containsUse || !PROCESSED_TAGS.has(child.tag.name)) continue;
        if (withRows && matchingRow(child) !== -1) continue;
        order.set(child, order.size);
        walk(child.children, depth - 1);
        if (capped) return;
      }
    };
    walk(tree.rootChildren, TRAVERSAL_DEPTH);
    return order;
  };

  return {
    excludingRow: (tag) => {
      const start = tree.byStart.get(tag.start);
      let row = -1;
      for (let element = start ?? null; element !== null && element !== tree.root;) {
        const tested = element === start || PROCESSED_TAGS.has(element.tag.name);
        const hit = tested ? matchingRow(element) : -1;
        if (hit !== -1) row = hit;
        element = element.parent;
      }
      return row;
    },
    rekeyed: () => {
      const stamped = [...tree.byStart.values()].filter((element) =>
        isLazyRenderStamped(element.tag)
      );
      const baseline = hashOrder(false);
      if (stamped.some((element) => !baseline.has(element))) return null;
      const after = hashOrder(true);
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
 * @returns The re-keyed elements' opening tags in document order, or `null`
 *   when the page's hash order cannot be rebuilt.
 */
export function lazyRenderRekeyed(
  servedHtml: string,
  rows: readonly string[]
): readonly ScannedTag[] | null {
  return analyzeLazyRender(servedHtml, scanTokens(servedHtml), rows).rekeyed();
}
