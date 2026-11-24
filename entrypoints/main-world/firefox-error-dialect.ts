/**
 * Firefox (SpiderMonkey) dialect of the undefined-reference capture, built
 * into the Firefox bundle only.
 *
 * SpiderMonkey reports thrown values differently from V8 in two ways the
 * capture depends on:
 * - `Error.prototype.stack` is frames only (`fn@url:line:col` per line), with
 *   no `Name: message` header — the message lives in `name` + `message`;
 * - a property read on `undefined` is phrased `can't access property "key",
 *   expr is undefined` (or `… "key" of undefined` when there is no
 *   expression to name), the key in source form: a string key double-quoted
 *   with every non-printable-ASCII character escaped (`\xNN`, `\uNNNN`, a
 *   non-BMP character as a surrogate pair, plus `\"`, `\\` and the control
 *   escapes), an index bare.
 * The dialect rebuilds V8's header from `name` + `message`, then scans the
 * same shapes as Chromium plus SpiderMonkey's property-read phrasing, with the
 * key unescaped, so one page error yields the same word on both engines.
 *
 * Known engine difference, kept on purpose: SpiderMonkey phrases a property
 * write on undefined (`o.a.k = 1`) exactly like a read, so the two cannot be
 * told apart and the write yields `k` on Firefox, while V8's `Cannot set
 * properties of undefined (setting 'k')` matches no shape on Chromium. It is a
 * real access to a property of undefined, so the extra word is reported.
 */

import {
  NOT_A_FUNCTION_SHAPE,
  READING_UNDEFINED_SHAPE,
  REFERENCE_ERROR_SHAPE,
  readStack,
  type ErrorTextDialect,
  type UndefinedReferenceShape
} from './capture-undefined-references';

/**
 * SpiderMonkey's property read (or write) on undefined: group 1 = a string
 * key's quoted body, escapes still in (each `\\` takes the next character
 * with it, so an escaped quote never ends the key and the scan stays linear),
 * group 2 = an index key. `null` reads are not undefined references (V8's
 * shape skips them too).
 */
const CANT_ACCESS_PROPERTY_PATTERN =
  /TypeError: can't access property (?:"((?:[^"\\]|\\.)*)"|(\d+))(?:, .* is undefined| of undefined)/;

/**
 * A quoted key body made only of plain characters and the escapes
 * SpiderMonkey's string quoting emits; anything else (a stray `\\`, a short
 * `\x4`, an unknown `\q`) is malformed.
 */
const WELL_FORMED_KEY_BODY = /^(?:[^\\]|\\(?:x[\dA-Fa-f]{2}|u[\dA-Fa-f]{4}|["'\\bfnrtv]))*$/;

/** One escape of a well-formed key body: hex unit (`\xNN`/`\uNNNN`) or single character. */
const KEY_ESCAPE = /\\(?:x([\dA-Fa-f]{2})|u([\dA-Fa-f]{4})|(["'\\bfnrtv]))/g;

/** The character each single-character escape stands for. */
const SINGLE_CHARACTER_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "'": "'",
  '\\': '\\',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v'
};

/**
 * Line terminators: V8's shapes are line-local, so a key holding one names
 * nothing on Chromium — the decoded Firefox key is refused for the same word.
 */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/**
 * Undo SpiderMonkey's string quoting of a key, so a non-ASCII key (`café`,
 * CJK, emoji) yields the raw word V8 reports. Each `\uNNNN` is one UTF-16
 * unit, so a surrogate pair rejoins by concatenation; a lone surrogate or a
 * control character survives decoding and is refused by word admission.
 *
 * @param body The quoted key's body, escapes included.
 * @returns The key, or null when the body is malformed or the key holds a
 *   line terminator.
 */
export function unescapeQuotedKey(body: string): string | null {
  if (!WELL_FORMED_KEY_BODY.test(body)) return null;
  const key = body.replace(KEY_ESCAPE, (_escape, hex2?: string, hex4?: string, single?: string) => {
    const hex = hex2 ?? hex4;
    if (hex !== undefined) return String.fromCharCode(Number.parseInt(hex, 16));
    // The well-formed check guarantees one of the three groups matched.
    return SINGLE_CHARACTER_ESCAPES[single ?? ''] ?? '';
  });
  return LINE_TERMINATOR.test(key) ? null : key;
}

/** SpiderMonkey's property access on undefined — the key, unescaped. */
export const CANT_ACCESS_PROPERTY_SHAPE: UndefinedReferenceShape = (errorText) => {
  const match = errorText.match(CANT_ACCESS_PROPERTY_PATTERN);
  if (match === null) return null;
  const [, quotedBody, indexKey] = match;
  if (quotedBody !== undefined) return unescapeQuotedKey(quotedBody) || null;
  return indexKey || null;
};

/**
 * Read a string-valued property of a thrown value.
 *
 * @param thrown The thrown value (its getters may throw; callers guard).
 * @param key The property to read.
 * @returns The value when it is a string, else null.
 */
const readString = (thrown: object, key: 'name' | 'message'): string | null => {
  const value: unknown = (thrown as Partial<Record<typeof key, unknown>>)[key];
  return typeof value === 'string' ? value : null;
};

/**
 * The V8-shaped text of a SpiderMonkey thrown value: the `Name: message`
 * header (rebuilt when both are strings) above the stack's frames. A value
 * without a string stack is read as nothing, as on Chromium: engine errors
 * always carry one, so this keeps stack-less look-alikes (`{ name, message }`)
 * out on both engines. A stack that already carries a header (a page-built
 * one) only repeats that line, which yields the same word.
 *
 * @param thrown The object-shaped thrown value.
 * @returns Header and stack joined by a newline (the stack alone without a
 *   header), or null when there is no string stack.
 */
export function readFirefoxErrorText(thrown: object): string | null {
  const stack = readStack(thrown);
  if (stack === null) return null;
  const name = readString(thrown, 'name');
  const message = readString(thrown, 'message');
  return name !== null && message !== null ? `${name}: ${message}\n${stack}` : stack;
}

/** Firefox: rebuilt header + frames, V8 shapes plus SpiderMonkey's property read. */
export const FIREFOX_ERROR_DIALECT: ErrorTextDialect = {
  readText: readFirefoxErrorText,
  shapes: [
    REFERENCE_ERROR_SHAPE,
    READING_UNDEFINED_SHAPE,
    CANT_ACCESS_PROPERTY_SHAPE,
    NOT_A_FUNCTION_SHAPE
  ]
};
