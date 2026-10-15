/**
 * Token classes of highlighted code — shiki-free, shared by the worker (which
 * names classes) and the main thread (which installs their rules). A class
 * is named after its declarations, so any worker instance names the same
 * color pair identically and a rule is installed once per document.
 */

/** One token class: `[className, declarations]`. */
export type TokenStyle = readonly [className: string, declarations: string];

/** The class-name shape the worker emits. */
const CLASS_NAME = /^fdt-tk-[0-9a-z]+$/;

/** The properties a token class may set — what themes use for tokens. */
const TOKEN_PROPERTIES: ReadonlySet<string> = new Set([
  'color',
  'font-style',
  'font-weight',
  'text-decoration'
]);

/** A hex color: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. */
const HEX = '#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})';

/**
 * The values a token declaration may take: a hex color, a
 * `light-dark(<hex>, <hex>)` pair, or a bare keyword (`italic`, `bold`,
 * `underline`, `inherit`…) — nothing that can load or reference anything.
 */
const TOKEN_VALUE = new RegExp(
  `^(?:${HEX}|light-dark\\(\\s*${HEX}\\s*,\\s*${HEX}\\s*\\)|[a-z]+(?:-[a-z]+)*)$`
);

/**
 * Whether a declaration list is an allowed token style: `property:value`
 * pairs separated by `;`, each property on the allow-list and each value of
 * an allowed form. Checked before any rule is inserted.
 *
 * @param declarations The candidate declaration list.
 */
export function isTokenDeclarations(declarations: string): boolean {
  if (declarations === '') return false;
  return declarations.split(';').every((declaration) => {
    const colon = declaration.indexOf(':');
    if (colon <= 0) return false;
    const property = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    return TOKEN_PROPERTIES.has(property) && TOKEN_VALUE.test(value);
  });
}

/**
 * The class name for a declaration list (32-bit FNV-1a, base 36).
 *
 * @param declarations The token's rendering declarations.
 */
export function tokenClassName(declarations: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < declarations.length; index += 1) {
    hash ^= declarations.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fdt-tk-${hash.toString(36)}`;
}

/**
 * Whether a token style is well-formed (it crossed a thread boundary).
 *
 * @param style The candidate.
 */
export function isTokenStyle(style: unknown): style is TokenStyle {
  return (
    Array.isArray(style) &&
    style.length === 2 &&
    typeof style[0] === 'string' &&
    typeof style[1] === 'string' &&
    CLASS_NAME.test(style[0]) &&
    isTokenDeclarations(style[1])
  );
}

/**
 * Whether a node can adopt style sheets: a document or a shadow root (by
 * node type — a node from another realm fails an `instanceof` check).
 * Detached elements cannot, and are skipped.
 *
 * @param root The node `getRootNode()` returned.
 */
function isStyleRoot(root: Node): root is Document | ShadowRoot {
  const kind = root.nodeType;
  return (
    (kind === Node.DOCUMENT_NODE || kind === Node.DOCUMENT_FRAGMENT_NODE) &&
    'adoptedStyleSheets' in root
  );
}

/** The sheet per root (document or shadow root) and the classes it holds. */
const sheets = new WeakMap<Document | ShadowRoot, { sheet: CSSStyleSheet; classes: Set<string> }>();

/**
 * Install the rules for a block's token classes into the root that renders
 * it (one constructed sheet per document or shadow root, adopted once; each
 * class inserted once). Malformed entries are skipped.
 *
 * @param root The block's root node (`element.getRootNode()`).
 * @param styles The block's token classes.
 */
export function installTokenStyles(root: Node, styles: readonly TokenStyle[]): void {
  if (!isStyleRoot(root)) return;
  let entry = sheets.get(root);
  if (entry === undefined) {
    const sheet = new CSSStyleSheet();
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    entry = { sheet, classes: new Set() };
    sheets.set(root, entry);
  }
  for (const style of styles) {
    if (!isTokenStyle(style) || entry.classes.has(style[0])) continue;
    entry.sheet.insertRule(`.${style[0]}{${style[1]}}`, entry.sheet.cssRules.length);
    entry.classes.add(style[0]);
  }
}
