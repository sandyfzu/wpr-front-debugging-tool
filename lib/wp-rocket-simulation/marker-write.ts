/**
 * The simulation marker step: run last, after the builder marker, it
 * writes the one `<meta name="wpr-fdt-simulation">` naming a simulated
 * document's features and the id the background drew for it (grammar:
 * `./simulation-marker`), so detection can tell simulated work from served
 * work once the background vouches for the id.
 *
 * Write rule: every existing meta of that name (served by the site, stale
 * or spoofed) is removed; exactly one is appended — at the end of `<head>`
 * (never earlier, so it can never push a `<meta charset>` out of the
 * browser's 1024-byte encoding prescan), or at the end of a document that
 * spells neither `</head>` nor `<body>` (the parser then places it in the
 * body; detection reads it wherever it sits) — only when a step simulated
 * and an id was drawn. The scan reads the markup as the browser will, so the
 * marker never lands inside raw text. Linear: one tag scan plus one patch
 * pass. A report names a marker id only when this step wrote it.
 */
import { scanTokens } from '../exclusion-builder/html-scan';
import { headEnd, isOwnMetaTag } from '../exclusion-builder/own-meta';
import { applyPatches, type TextPatch } from '../exclusion-builder/tag-edit';
import { SIMULATION_MARKER_META_NAME } from '../wp-rocket/constants';
import { serializeSimulationMarker } from './simulation-marker';
import type { SimulatedFeatureId } from './spec';

/** The step's result: the document, and whether the marker was written into it. */
export interface SimulationMarkerWrite {
  readonly html: string;
  readonly written: boolean;
}

/**
 * Writes the simulation marker.
 *
 * @param html The finished document (builder marker included).
 * @param markerId The id to write (absent: none drawn — nothing to write).
 * @param simulated The features a step simulated on this document (empty: none).
 * @returns The document and whether the marker is in it.
 */
export type SimulationMarkerWriter = (
  html: string,
  markerId: string | undefined,
  simulated: readonly SimulatedFeatureId[]
) => SimulationMarkerWrite;

/**
 * The marker element for a content.
 *
 * @param content The serialized note (grammar characters only: no quote can occur).
 */
function markerTag(content: string): string {
  return `<meta name="${SIMULATION_MARKER_META_NAME}" content="${content}">`;
}

/**
 * Apply the write rule (see the module): drop every existing marker, then
 * append this document's when a step simulated and an id was drawn.
 */
export const writeSimulationMarker: SimulationMarkerWriter = (html, markerId, simulated) => {
  const tokens = scanTokens(html, 'browser');
  const patches: TextPatch[] = tokens
    .filter((token) => isOwnMetaTag(token, SIMULATION_MARKER_META_NAME))
    .map((tag) => ({ start: tag.start, end: tag.openingEnd, text: '' }));
  const content =
    markerId === undefined || simulated.length === 0
      ? null
      : serializeSimulationMarker({ features: simulated, markerId });
  if (content !== null) {
    const at = headEnd(tokens) ?? html.length;
    patches.push({ start: at, end: at, text: markerTag(content) });
  }
  return { html: applyPatches(html, patches), written: content !== null };
};
