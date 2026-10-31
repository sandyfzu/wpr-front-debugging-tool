/**
 * An HTML attribute's value as the browser reads it from the raw markup,
 * for code that must never misread a security-relevant value: numeric
 * character references (`&#39;`, `&#x27;`, `;` optional) and every named
 * reference that expands to ASCII are decoded; a value holding any other
 * `&<alphanumeric>` run is unreadable (null) — decoding the full table is
 * out of scope, and guessing could change a token. Numeric references to
 * U+0000, a surrogate or past U+10FFFF read as U+FFFD, as the tokenizer
 * reads them (its windows-1252 remap of 0x80–0x9F is not applied: no
 * policy token or nonce holds those characters either way).
 */

/**
 * The named references that expand to ASCII, written with their `;`
 * (all 46 such names of the HTML standard's table,
 * https://html.spec.whatwg.org/entities.json, grouped by expansion).
 */
const ASCII_NAMED: ReadonlyMap<string, string> = new Map(
  (
    [
      ['\t', 'Tab'],
      ['\n', 'NewLine'],
      ['!', 'excl'],
      ['"', 'QUOT quot'],
      ['#', 'num'],
      ['$', 'dollar'],
      ['%', 'percnt'],
      ['&', 'AMP amp'],
      ["'", 'apos'],
      ['(', 'lpar'],
      [')', 'rpar'],
      ['*', 'ast midast'],
      ['+', 'plus'],
      [',', 'comma'],
      ['.', 'period'],
      ['/', 'sol'],
      [':', 'colon'],
      [';', 'semi'],
      ['<', 'LT lt'],
      ['=', 'equals'],
      ['>', 'GT gt'],
      ['?', 'quest'],
      ['@', 'commat'],
      ['[', 'lbrack lsqb'],
      ['\\', 'bsol'],
      [']', 'rbrack rsqb'],
      ['^', 'Hat'],
      ['_', 'UnderBar lowbar'],
      ['`', 'DiacriticalGrave grave'],
      ['{', 'lbrace lcub'],
      ['|', 'VerticalLine verbar vert'],
      ['}', 'rbrace rcub'],
      ['fj', 'fjlig']
    ] as const
  ).flatMap(([expansion, names]) => names.split(' ').map((name) => [name, expansion] as const))
);

/**
 * The legacy names the tokenizer also reads without their `;` (the table's
 * ASCII-expanding ones) — in an attribute only when the next character is
 * not `=` (an alphanumeric cannot follow: the run is read whole).
 */
const LEGACY_NAMES: ReadonlySet<string> = new Set([
  'AMP',
  'amp',
  'GT',
  'gt',
  'LT',
  'lt',
  'QUOT',
  'quot'
]);

/** A character reference candidate: decimal, hex (`;` optional), or an alphanumeric run and its `;`. */
const REFERENCE = /&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|([A-Za-z0-9]+)(;?))/g;

/**
 * The character a numeric reference stands for.
 *
 * @param codePoint The referenced code point (may be out of range).
 */
function numericCharacter(codePoint: number): string {
  const invalid =
    codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff);
  return invalid ? '�' : String.fromCodePoint(codePoint);
}

/**
 * What a named-reference candidate reads as, or null when this decoder
 * cannot tell (a non-ASCII or unknown name).
 *
 * @param name The alphanumeric run after `&`.
 * @param semicolon Whether a `;` follows it.
 * @param next The character after the candidate (`''` at the end).
 */
function namedText(name: string, semicolon: boolean, next: string): string | null {
  if (semicolon) return ASCII_NAMED.get(name) ?? null;
  if (!LEGACY_NAMES.has(name)) return null;
  // In an attribute, a legacy name before `=` stays literal text.
  return next === '=' ? `&${name}` : (ASCII_NAMED.get(name) ?? null);
}

/**
 * Decode an attribute value's character references.
 *
 * @param raw The value as written between its quotes.
 * @returns The value the browser reads, or null when it holds a named
 *   reference this decoder does not read (see the module note).
 */
export function decodeAttributeValue(raw: string): string | null {
  if (!raw.includes('&')) return raw;
  let decoded = '';
  let copied = 0;
  for (const match of raw.matchAll(REFERENCE)) {
    const [whole, decimal, hex, name, semicolon] = match;
    let text: string | null;
    if (name !== undefined) {
      text = namedText(name, semicolon === ';', raw.charAt(match.index + whole.length));
      if (text === null) return null;
    } else {
      // Digit runs past any code point stay finite: parseInt saturates to a huge number, read as invalid.
      text = numericCharacter(decimal !== undefined ? Number(decimal) : parseInt(hex ?? '', 16));
    }
    decoded += raw.slice(copied, match.index) + text;
    copied = match.index + whole.length;
  }
  return decoded + raw.slice(copied);
}
