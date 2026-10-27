/**
 * The element tree libxml 2.9's HTML parser builds from a page, rebuilt from
 * the scanner's tokens — measured on libxml 2.9.13: its HTML 4 void elements
 * (`source`, `wbr`, `embed`… nest), `/>` honoured, start tags auto-closing an
 * open element on top of the stack (a `<div>` closes a `<p>`), end tags
 * closing only what their priority allows (`</a>` cannot close past a
 * `<div>`), `<html>`/`<head>`/`<body>` ignored inside the body, nothing after
 * `</body>` in it. Linear in the token count, whatever the markup.
 */
import { isEndTag, type ScannedTag, type ScannedToken } from '../html-scan';

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

/** The distinct raised priorities — the only ones that can block an end tag. */
const RAISED_PRIORITIES: readonly number[] = [...new Set(END_PRIORITY.values())];

/** One element of the rebuilt tree. */
export interface TreeElement {
  readonly tag: ScannedTag;
  readonly parent: TreeElement | null;
  readonly children: TreeElement[];
  /** Whether a `<use>` element is among its descendants. */
  containsUse: boolean;
}

/** The rebuilt page. */
export interface LibxmlTree {
  /** The children of `<body>` (or of the document, without one). */
  readonly rootChildren: readonly TreeElement[];
  /** `<body>`, or `null` when the page has none (the document is the root). */
  readonly root: TreeElement | null;
  /** Every element by its tag's offset. */
  readonly byStart: ReadonlyMap<number, TreeElement>;
}

/**
 * The open-element stack with per-name and per-priority indexes, so an end
 * tag resolves in constant time (no scan of the stack — a page of unclosed
 * elements must stay linear).
 */
interface OpenElements {
  readonly top: () => TreeElement | null;
  readonly push: (element: TreeElement) => void;
  readonly pop: () => void;
  /** Close the element an end tag names, if libxml would. */
  readonly close: (name: string) => void;
}

/**
 * The end priority of an element name.
 *
 * @param name A lowercased tag name.
 */
function endPriority(name: string): number {
  return END_PRIORITY.get(name) ?? DEFAULT_END_PRIORITY;
}

/** A new, empty {@link OpenElements}. */
function openElements(): OpenElements {
  const stack: TreeElement[] = [];
  const byName = new Map<string, number[]>();
  const byPriority = new Map<number, number[]>();
  const indexes = <K>(map: Map<K, number[]>, key: K): number[] => {
    let list = map.get(key);
    if (list === undefined) {
      list = [];
      map.set(key, list);
    }
    return list;
  };
  const pop = (): void => {
    const element = stack.pop();
    if (element === undefined) return;
    byName.get(element.tag.name)?.pop();
    const priority = endPriority(element.tag.name);
    if (priority !== DEFAULT_END_PRIORITY) byPriority.get(priority)?.pop();
  };
  return {
    top: () => stack[stack.length - 1] ?? null,
    push: (element) => {
      indexes(byName, element.tag.name).push(stack.length);
      const priority = endPriority(element.tag.name);
      if (priority !== DEFAULT_END_PRIORITY) indexes(byPriority, priority).push(stack.length);
      stack.push(element);
    },
    pop,
    close: (name) => {
      const at = byName.get(name)?.at(-1);
      if (at === undefined) return;
      // An open element above it with a higher priority makes libxml ignore the end tag.
      const priority = endPriority(name);
      for (const raised of RAISED_PRIORITIES) {
        if (raised > priority && (byPriority.get(raised)?.at(-1) ?? -1) > at) return;
      }
      while (stack.length > at) pop();
    }
  };
}

/**
 * Rebuild the element tree libxml parses from a page's tokens.
 *
 * @param tokens The page's tokens (`scanTokens`).
 */
export function buildLibxmlTree(tokens: readonly ScannedToken[]): LibxmlTree {
  const top: TreeElement[] = [];
  const open = openElements();
  const created: TreeElement[] = [];
  const byStart = new Map<number, TreeElement>();
  let body: TreeElement | null = null;
  for (const token of tokens) {
    if (isEndTag(token)) {
      open.close(token.name);
      continue;
    }
    const name = token.name;
    if (name === 'html' || name === 'head' || name === 'body') {
      // Inside the body libxml ignores these; `<body>` closes `<head>`.
      if (body !== null) continue;
      if (name === 'body') {
        while (open.top() !== null && open.top()?.tag.name !== 'html') open.pop();
      }
    } else {
      while (AUTO_CLOSE.get(open.top()?.tag.name ?? '')?.has(name) === true) open.pop();
    }
    const parent = open.top();
    const element: TreeElement = { tag: token, parent, children: [], containsUse: false };
    (parent === null ? top : parent.children).push(element);
    created.push(element);
    byStart.set(token.start, element);
    if (name === 'body') body = element;
    // Raw-text regions (script, style…) were consumed whole by the scanner.
    const empty =
      LIBXML_VOID_ELEMENTS.has(name) || token.selfClosing || token.end !== token.openingEnd;
    if (!empty) open.push(element);
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
