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
 * changed the document. Linear: one tag scan plus one patch pass.
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

/**
 * Whether a token is a builder marker: a `meta` start tag whose (first)
 * `name` attribute is exactly the marker's name — the DOM's own reading
 * (duplicate attributes drop, `name` values compare case-sensitively).
 *
 * @param token One scanned token.
 */
function isMarkerTag(token: ScannedToken): token is ScannedTag {
  return (
    !isEndTag(token) &&
    token.name === 'meta' &&
    findAttribute(token, 'name')?.value === BUILDER_MARKER_META_NAME
  );
}

/**
 * Where the end of `<head>` is: the first `</head>`, or the `<body>` start
 * tag when the head is never closed explicitly (the parser closes it
 * there). Null when the document spells neither — no marker is written then
 * (no fact beats a misplaced one, which the reader would refuse anyway).
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
 * Idempotent for a given note. A marker spelled so the scan cannot see it
 * (an entity-encoded name) survives; the reader then finds two and states
 * no fact — degraded, never wrong.
 *
 * @param html The rewritten document (decoded text).
 * @param note What the feature steps changed.
 * @returns The document with exactly the note's marker (or none); the input
 *   itself when there is nothing to remove or add.
 */
export function writeBuilderMarker(html: string, note: BuilderNote): string {
  const tokens = scanTokens(html);
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
