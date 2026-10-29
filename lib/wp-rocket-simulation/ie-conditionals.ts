/**
 * WP Rocket's IE conditional-comment guard around its buffer passes: every
 * `<!--[if …]>…<![endif]-->` is swapped for a fixed placeholder before the
 * passes run (so they never see its content) and put back after them — a
 * conditional holding a script with attributes comes back with its content
 * trimmed and its unescaped `$`/`\` escaped, as WP Rocket writes it.
 */
import { nextOccurrenceFinder } from '../../utils/next-occurrence';
import { expandPhpReplacement } from './php-replacement';
import { asciiCaselessAt, isSpaceAt, skipSpaces, skipSpacesBack } from './pcre-text';

/** The placeholder a conditional is swapped for while the passes run. */
export const IE_CONDITIONAL_PLACEHOLDER = '<!--{{WP_ROCKET_CONDITIONAL}}-->';

/** A conditional's end (`<!\[endif\]-->`, caseless). */
const ENDING = /<!\[[Ee][Nn][Dd][Ii][Ff]\]-->/g;

/** The length of a conditional's end, `<![endif]-->`. */
const ENDING_LENGTH = '<![endif]-->'.length;

/** An unescaped `$` or `\` (`(?<!\\)(\$|\\)`). */
const UNESCAPED = /(?<!\\)([$\\])/g;

/** A page with its conditionals swapped out. */
export interface ExtractedConditionals {
  readonly html: string;
  /** The conditionals, in page order. */
  readonly conditionals: readonly string[];
}

/** The conditional regex's reading of a page. */
export interface ConditionalScan {
  /** `[start, end)` per conditional, left to right. */
  readonly spans: readonly (readonly [number, number])[];
  /**
   * Where the first opening with no end after it starts (`-1` when none):
   * the regex's attempt there reads to the end of the page.
   */
  readonly unclosed: number;
}

/**
 * Every conditional of a page, left to right (`/<!--\[if[^\]]*?\]>.*?<!\[endif\]-->/is`):
 * an opening is `<!--[if` (caseless) whose first `]` is followed by `>`
 * (the lazy condition cannot step over a `]`), its conditional runs to the
 * first end after it. Found by search, sharing one `]` finder between
 * openings: linear on any page.
 *
 * @param html The page.
 */
export function conditionalScan(html: string): ConditionalScan {
  const spans: [number, number][] = [];
  const bracketAfter = nextOccurrenceFinder(html, ']');
  for (let open = html.indexOf('<!--['); open !== -1;) {
    if (!asciiCaselessAt(html, open + 5, 'if')) {
      open = html.indexOf('<!--[', open + 1);
      continue;
    }
    const bracket = bracketAfter(open + 7);
    // No `]` after this opening: none after any later one either.
    if (bracket === -1) break;
    if (html.charCodeAt(bracket + 1) !== 62) {
      open = html.indexOf('<!--[', open + 1);
      continue;
    }
    ENDING.lastIndex = bracket + 2;
    const end = ENDING.exec(html);
    // No end after this opening: none after any later one either.
    if (end === null) return { spans, unclosed: open };
    const stop = end.index + end[0].length;
    spans.push([open, stop]);
    open = html.indexOf('<!--[', stop);
  }
  return { spans, unclosed: -1 };
}

/**
 * Swap every conditional for {@link IE_CONDITIONAL_PLACEHOLDER}
 * (`IEConditionalSubscriber::extract_ie_conditionals`).
 *
 * @param html The page.
 * @param scan The page's {@link conditionalScan} (when the caller has it).
 */
export function extractIeConditionals(
  html: string,
  scan: ConditionalScan = conditionalScan(html)
): ExtractedConditionals {
  const { spans } = scan;
  if (spans.length === 0) return { html, conditionals: [] };
  let out = '';
  let at = 0;
  const conditionals = spans.map(([start, end]) => {
    out += html.slice(at, start) + IE_CONDITIONAL_PLACEHOLDER;
    at = end;
    return html.slice(start, end);
  });
  return { html: out + html.slice(at), conditionals };
}

/** A conditional's parts when it holds a script with attributes. */
export interface ScriptConditionalParts {
  /** Its text up to the script opening's `>` (inclusive). */
  readonly openingEnd: number;
  /** The script content, between the whitespace trimmed around it. */
  readonly contentStart: number;
  readonly contentEnd: number;
  /** Where its closing `</script>` starts. */
  readonly closingStart: number;
}

/**
 * The opening part: `<!--\[if[^\]]*?\]>\s*?(?:<!-->)?\s*<script(?:\s[^>]*?>)`
 * from offset 0 (caseless). The condition ends at the first `]`; the
 * optional `<!-->` and the whitespace around it are each one run.
 *
 * @param conditional The conditional.
 * @returns The offset of the script opening's `>`, or `-1`.
 */
function scriptOpeningEnd(conditional: string): number {
  if (!conditional.startsWith('<!--[') || !asciiCaselessAt(conditional, 5, 'if')) return -1;
  const bracket = conditional.indexOf(']', 7);
  if (bracket === -1 || conditional.charCodeAt(bracket + 1) !== 62) return -1;
  let at = skipSpaces(conditional, bracket + 2);
  if (conditional.startsWith('<!-->', at)) at = skipSpaces(conditional, at + 5);
  const opensScript =
    conditional.charCodeAt(at) === 60 &&
    asciiCaselessAt(conditional, at + 1, 'script') &&
    isSpaceAt(conditional, at + 7);
  return opensScript ? conditional.indexOf('>', at + 8) : -1;
}

/**
 * The closing part, read from the end: `</script>\s*(?:<!--)?\s*?<!\[endif\]-->$`
 * (caseless) — every piece is fixed or one whitespace run, so it has one
 * possible start.
 *
 * @param conditional The conditional.
 * @returns Where its `</script>` starts, or `-1`.
 */
function scriptClosingStart(conditional: string): number {
  const ending = conditional.length - ENDING_LENGTH;
  if (ending < 0 || !asciiCaselessAt(conditional, ending, '<![endif]-->')) return -1;
  let at = skipSpacesBack(conditional, ending);
  if (conditional.startsWith('<!--', at - 4)) at = skipSpacesBack(conditional, at - 4);
  const closing = at - '</script>'.length;
  return asciiCaselessAt(conditional, closing, '</script>') ? closing : -1;
}

/**
 * How WP Rocket reads a conditional on re-injection
 * (`^(?<opening>…<script(?:\s[^>]*?>))\s*(?<content>.*?)\s*(?<closing></script>…)$`,
 * `is`): the parts of one holding a script with attributes, or `null`.
 * The lazy content takes everything between the whitespace after the
 * opening and the whitespace before the closing. Linear in the conditional.
 *
 * @param conditional The extracted conditional.
 */
export function scriptConditionalParts(conditional: string): ScriptConditionalParts | null {
  const gt = scriptOpeningEnd(conditional);
  if (gt === -1) return null;
  const closingStart = scriptClosingStart(conditional);
  if (closingStart <= gt) return null;
  const contentStart = skipSpaces(conditional, gt + 1);
  return {
    openingEnd: gt + 1,
    contentStart,
    contentEnd: Math.max(contentStart, skipSpacesBack(conditional, closingStart)),
    closingStart
  };
}

/**
 * A conditional as WP Rocket writes it back: one holding a script with
 * attributes loses the whitespace around its content and gets each
 * unescaped `$`/`\` there escaped (`preg_replace` with `\\$1`); any other
 * comes back as it was.
 *
 * @param conditional The extracted conditional.
 */
export function reinjectedConditional(conditional: string): string {
  const parts = scriptConditionalParts(conditional);
  if (parts === null) return conditional;
  const content = conditional.slice(parts.contentStart, parts.contentEnd);
  const escaped = content.replace(UNESCAPED, (char) => expandPhpReplacement('\\\\$1', ['', char]));
  return conditional.slice(0, parts.openingEnd) + escaped + conditional.slice(parts.closingStart);
}

/** One piece of the page being re-injected (a singly linked list, in page order). */
interface InjectionPiece {
  text: string;
  /** Searched: holds no placeholder. */
  clean: boolean;
  next: InjectionPiece | null;
}

/**
 * The page while conditionals are put back, as pieces. No placeholder ever
 * straddles two pieces: a written conditional starts with `<!--[` and ends
 * with `-->`, and the placeholder holds its only `<` first and its only
 * `>` last — so the first placeholder of the page is the first one inside
 * the unsearched pieces, which always follow every searched one up to the
 * next page-start overwrite.
 */
interface InjectionPage {
  head: InjectionPiece | null;
  /**
   * The first unsearched piece (`null` when every piece is searched): the
   * unsearched pieces run from it up to the first searched one.
   */
  cursor: InjectionPiece | null;
}

/**
 * Write `written` over the first placeholder left (`strpos` + `substr_replace`).
 *
 * @param page The page.
 * @param written The conditional's text.
 * @returns `false` when no placeholder is left (nothing written).
 */
function writeAtFirstPlaceholder(page: InjectionPage, written: string): boolean {
  // Unsearched pieces run from the cursor up to the first searched one (or the end).
  for (let piece = page.cursor; piece !== null && !piece.clean; piece = piece.next) {
    const at = piece.text.indexOf(IE_CONDITIONAL_PLACEHOLDER);
    if (at === -1) {
      piece.clean = true;
      continue;
    }
    const rest: InjectionPiece = {
      text: piece.text.slice(at + IE_CONDITIONAL_PLACEHOLDER.length),
      clean: false,
      next: piece.next
    };
    const inserted: InjectionPiece = { text: written, clean: false, next: rest };
    piece.text = piece.text.slice(0, at);
    piece.clean = true;
    piece.next = inserted;
    // The written text may spell the placeholder: it is searched next.
    page.cursor = inserted;
    return true;
  }
  page.cursor = null;
  return false;
}

/**
 * Write `written` over the page's first placeholder-length characters:
 * PHP's `strpos` `false` reads as offset 0 in `substr_replace`.
 *
 * @param page The page (every piece searched).
 * @param written The conditional's text.
 */
function writeOverPageStart(page: InjectionPage, written: string): void {
  let left = IE_CONDITIONAL_PLACEHOLDER.length;
  while (page.head !== null && left > 0) {
    if (page.head.text.length <= left) {
      left -= page.head.text.length;
      page.head = page.head.next;
    } else {
      page.head.text = page.head.text.slice(left);
      left = 0;
    }
  }
  page.head = { text: written, clean: false, next: page.head };
  page.cursor = page.head;
}

/**
 * The page's text.
 *
 * @param page The page.
 */
function pageText(page: InjectionPage): string {
  const parts: string[] = [];
  for (let piece = page.head; piece !== null; piece = piece.next) parts.push(piece.text);
  return parts.join('');
}

/**
 * Put the conditionals back (`inject_ie_conditionals`): each, in order,
 * replaces the first placeholder left in the page — a page or conditional
 * that spelled the placeholder itself gets the same treatment it gets from
 * WP Rocket — and with none left, PHP's `strpos` `false` reads as offset 0:
 * the conditional overwrites the page's first 32 characters. Linear: each
 * stretch of the page is searched once (see {@link InjectionPage}).
 *
 * @param html The page after the passes.
 * @param conditionals The conditionals {@link extractIeConditionals} took out.
 */
export function injectIeConditionals(html: string, conditionals: readonly string[]): string {
  if (!html.includes(IE_CONDITIONAL_PLACEHOLDER)) return html;
  const first: InjectionPiece = { text: html, clean: false, next: null };
  const page: InjectionPage = { head: first, cursor: first };
  for (const conditional of conditionals) {
    const written = reinjectedConditional(conditional);
    if (!writeAtFirstPlaceholder(page, written)) writeOverPageStart(page, written);
  }
  return pageText(page);
}
