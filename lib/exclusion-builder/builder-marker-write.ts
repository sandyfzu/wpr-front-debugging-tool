/**
 * The pipeline's final step: the builder marker. Once every feature step
 * ran, the document gets one `<meta name="wpr-fdt-exclusion-builder">`
 * stating what the steps changed (grammar: `./builder-marker`), so every
 * surface reading the displayed document — even after the session stopped,
 * while the rewritten page is still shown — can tell WP Rocket's served
 * verdict from the builder's in-tab effect.
 *
 * Write rule: every existing meta of that name (served by the site, stale
 * or spoofed) is removed, and exactly one is appended at the end of
 * `<head>` — never earlier, so it can never push a `<meta charset>` out of
 * the browser's 1024-byte encoding prescan — only when at least one feature
 * changed the document. The scan reads the markup as the browser will
 * (scripting on: `noscript`, `iframe`, … are text), so the marker never lands
 * inside raw text. Linear: one tag scan plus one patch pass.
 */
import { BUILDER_MARKER_META_NAME } from '../wp-rocket/constants';
import type { BuilderFact } from '../wp-rocket/types';
import { serializeBuilderNote, type BuilderNote } from './builder-marker';
import { isEndTag, scanTokens, type ScannedTag, type ScannedToken } from './html-scan';
import type { TransformReport } from './report';
import type { ExclusionFeatureId } from './set';
import { applyPatches, findAttribute, type TextPatch } from './tag-edit';

/**
 * What one feature step did, as a builder fact: nothing when it changed no
 * element and removed no region; else `off: 'feature'` for a feature-wide
 * disable, `off: 'page'` when its rows turned WP Rocket's run off for the
 * page, else the elements its rows restored (`rewritten`; the marker clamps
 * past 9999).
 *
 * @param report One feature step's report.
 * @returns The fact, or null when the step left the document as it was.
 */
export function builderFactOf(report: TransformReport): BuilderFact | null {
  if (report.featureWide) {
    return report.rewritten > 0 || report.regionRemovals > 0 ? { off: 'feature' } : null;
  }
  if (report.rewritten === 0) return null;
  return report.pageState === 'off' ? { off: 'page' } : { excluded: report.rewritten };
}

/**
 * The note for a run: one fact per feature step that changed the document.
 *
 * @param reports The feature steps' reports (one per feature).
 */
export function builderNoteOf(reports: readonly TransformReport[]): BuilderNote {
  const note: Partial<Record<ExclusionFeatureId, BuilderFact>> = {};
  for (const report of reports) {
    const fact = builderFactOf(report);
    if (fact !== null) note[report.feature] = fact;
  }
  return note;
}

/** A numeric character reference: decimal or hex, `;` optional (the tokenizer decodes both). */
const NUMERIC_REFERENCE = /&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?/g;

/** A named character reference's spelling (`;` optional in attribute values). */
const NAMED_REFERENCE = /&[A-Za-z][A-Za-z0-9]*;?/;

/**
 * Decode a raw attribute value's numeric character references, as far as
 * matching an ASCII name needs: an ASCII code point becomes its character;
 * any other (non-ASCII, NUL, out of range — the tokenizer maps those to
 * non-ASCII text too) becomes U+FFFD, which no ASCII name contains.
 *
 * @param raw The raw value text.
 */
function decodeNumericReferences(raw: string): string {
  return raw.replace(NUMERIC_REFERENCE, (_whole, hex?: string, decimal?: string) => {
    const codePoint =
      hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(decimal ?? '', 10);
    return codePoint > 0 && codePoint < 0x80 ? String.fromCharCode(codePoint) : '\uFFFD';
  });
}

/**
 * Whether a raw `name` value can read as the marker's name once the DOM
 * decodes it. Plain values compare exactly (case-sensitive, as the DOM's
 * `name` matching). With character references: numeric ones are decoded,
 * and each named one is treated as standing for any text — a superset of
 * what the DOM can decode it to, so no served copy the reader would count
 * escapes removal (over-matching only removes a meta deliberately spelled to
 * look like the marker).
 *
 * @param raw The raw `name` value, as served.
 */
export function namesBuilderMarker(raw: string): boolean {
  if (!raw.includes('&')) return raw === BUILDER_MARKER_META_NAME;
  const pieces = decodeNumericReferences(raw).split(NAMED_REFERENCE);
  return wildcardMatches(pieces, BUILDER_MARKER_META_NAME);
}

/**
 * Whether `text` is the literal `pieces` in order with any text between
 * consecutive ones (a glob with `*` between pieces). Greedy, linear: no
 * regex, so a value spelling thousands of references cannot backtrack.
 *
 * @param pieces The literal pieces (at least one; split output).
 * @param text The text to match.
 */
function wildcardMatches(pieces: readonly string[], text: string): boolean {
  const first = pieces[0] ?? '';
  if (pieces.length === 1) return first === text;
  const last = pieces[pieces.length - 1] ?? '';
  if (first.length + last.length > text.length) return false;
  if (!text.startsWith(first) || !text.endsWith(last)) return false;
  let at = first.length;
  const limit = text.length - last.length;
  for (const piece of pieces.slice(1, -1)) {
    const found = text.indexOf(piece, at);
    if (found === -1 || found + piece.length > limit) return false;
    at = found + piece.length;
  }
  return true;
}

/**
 * Whether a token is a builder marker: a `meta` start tag whose (first)
 * `name` attribute can read as the marker's name — the DOM's own reading
 * (duplicate attributes drop, character references decode).
 *
 * @param token One scanned token.
 */
function isMarkerTag(token: ScannedToken): token is ScannedTag {
  if (isEndTag(token) || token.name !== 'meta') return false;
  const name = findAttribute(token, 'name')?.value;
  return name !== undefined && name !== null && namesBuilderMarker(name);
}

/**
 * Where the end of `<head>` is: the first `</head>`, or the `<body>` start
 * tag when the head is never closed explicitly (the parser closes it
 * there). Null when the document spells neither — no marker is written
 * then.
 *
 * @param tokens The document's tokens, in order.
 */
function headEnd(tokens: readonly ScannedToken[]): number | null {
  const end = tokens.find(
    (token) =>
      (isEndTag(token) && token.name === 'head') || (!isEndTag(token) && token.name === 'body')
  );
  return end === undefined ? null : end.start;
}

/**
 * The marker element for a content.
 *
 * @param content The serialized note (grammar characters only: no quote can occur).
 */
function markerTag(content: string): string {
  return `<meta name="${BUILDER_MARKER_META_NAME}" content="${content}">`;
}

/**
 * Apply the write rule to a document: drop every existing marker, then
 * append the note's marker at the end of `<head>` when it states anything.
 * Idempotent for a given note.
 *
 * @param html The rewritten document (decoded text).
 * @param note What the feature steps changed.
 * @returns The document with exactly the note's marker (or none); the input
 *   itself when there is nothing to remove or add.
 */
export function writeBuilderMarker(html: string, note: BuilderNote): string {
  const tokens = scanTokens(html, 'browser');
  const patches: TextPatch[] = tokens
    .filter(isMarkerTag)
    .map((tag) => ({ start: tag.start, end: tag.openingEnd, text: '' }));
  const content = serializeBuilderNote(note);
  const at = content === null ? null : headEnd(tokens);
  if (content !== null && at !== null)
    patches.push({ start: at, end: at, text: markerTag(content) });
  return applyPatches(html, patches);
}

/**
 * The final step over a run's output: the marker for what the feature
 * steps' reports say they changed.
 *
 * @param html The document after every feature step.
 * @param reports The feature steps' reports.
 */
export function markBuilderEffects(html: string, reports: readonly TransformReport[]): string {
  return writeBuilderMarker(html, builderNoteOf(reports));
}
