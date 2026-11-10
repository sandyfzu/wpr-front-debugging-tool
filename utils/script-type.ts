/**
 * The HTML `<script type>` classic-script rule: which `type` values make the
 * browser run a script as a classic script, per the HTML "prepare the script
 * element" steps and the MIME Sniffing standard's essence list.
 */

/**
 * The JavaScript MIME type essences (MIME Sniffing §4.6), lowercase. A
 * `type` that matches one, ASCII case-insensitively, runs as classic.
 */
const JAVASCRIPT_MIME_ESSENCES: ReadonlySet<string> = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript'
]);

/** Leading/trailing ASCII whitespace (tab, LF, FF, CR, space) — never the Unicode spaces `trim()` strips. */
const ASCII_WHITESPACE_EDGES = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;

/**
 * Whether a `type` value is a JavaScript MIME type essence match once its
 * ASCII whitespace edges are stripped (the HTML rule). Parameters are no
 * match: `text/javascript; charset=utf-8` is not a classic type.
 *
 * @param type The raw `type` attribute value.
 * @returns True when the browser runs the script as classic for this value.
 */
export function isClassicScriptType(type: string): boolean {
  return JAVASCRIPT_MIME_ESSENCES.has(
    type.replace(ASCII_WHITESPACE_EDGES, '').replace(/[A-Z]/g, (c) => c.toLowerCase())
  );
}

/**
 * Whether a `type` value is ASCII whitespace only (or empty).
 *
 * @param type The raw `type` attribute value.
 * @returns True when nothing but ASCII whitespace remains to read.
 */
export function isBlankScriptType(type: string): boolean {
  return type.replace(ASCII_WHITESPACE_EDGES, '') === '';
}
