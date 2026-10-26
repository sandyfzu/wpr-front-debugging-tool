/**
 * The Exclusion Builder's marker, read off a parsed page: the per-feature
 * fact of what the builder's rewrite did to the displayed document (grammar:
 * `lib/exclusion-builder/builder-marker`). It annotates the four builder
 * rows with an additive `builder` field and never touches their served
 * verdict — WP Rocket still served the feature; the fact is the in-tab
 * modifier on top.
 *
 * Read rule (spoof resistance): a fact exists only when the document holds
 * exactly one marker meta, as a direct child of `<head>`, carrying only its
 * `name` and `content`, whose content parses fully. Zero or several
 * markers, a misplaced one, extra attributes or malformed content ⇒ no fact
 * — never a partial or invented one. Trust: a page can still forge a
 * well-formed marker the builder did not write; it mis-describes only that
 * page, the same page-content trust as every footprint.
 */
import { BUILDER_MARKER_META_NAME } from '../wp-rocket/constants';
import type { WprDetections } from '../wp-rocket/types';
import { parseBuilderNote, type BuilderNote } from '../exclusion-builder/builder-marker';
import { EXCLUSION_FEATURES } from '../exclusion-builder/set';

/** Every marker meta, wherever it sits (the read rule counts them all). */
const BUILDER_MARKER_SELECTOR = `meta[name="${BUILDER_MARKER_META_NAME}"]`;

/** The attributes a marker carries: `name` and `content`, nothing else. */
const MARKER_ATTRIBUTE_COUNT = 2;

/**
 * Read the builder note off a parsed document per the read rule.
 *
 * @param document The parsed page document.
 * @returns The note, or null when the document states no valid one.
 */
export function parseBuilderMarker(document: Document): BuilderNote | null {
  const markers = document.querySelectorAll(BUILDER_MARKER_SELECTOR);
  const marker = markers.length === 1 ? markers[0] : undefined;
  if (marker === undefined || marker.parentElement !== document.head) return null;
  if (marker.attributes.length !== MARKER_ATTRIBUTE_COUNT) return null;
  const content = marker.getAttribute('content');
  return content === null ? null : parseBuilderNote(content);
}

/**
 * Annotate the builder rows with the note's facts (each row the note names
 * gains `builder`; the rest, and every verdict, stay as the checks left
 * them).
 *
 * @param detections The completed detection pass (mutated in place).
 * @param note The page's builder note, or null when it states none.
 */
export function applyBuilderFacts(detections: WprDetections, note: BuilderNote | null): void {
  if (note === null) return;
  for (const { id } of EXCLUSION_FEATURES) {
    const fact = note[id];
    if (fact !== undefined) detections[id].builder = fact;
  }
}
