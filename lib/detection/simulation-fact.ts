/**
 * The simulation marker, read off a parsed page, and its effect on the
 * detection rows. A simulated feature's footprints are the extension's
 * work, not WP Rocket's: once the background vouches for the marker, the
 * row is not applied (version unknown, inventory kept), so neither the row
 * nor presence propagation reads it as served. A marker the background did
 * not vouch for (forged, saved copy, another tab's, no answer) changes no
 * verdict: the row only says so (`unverified`) — page markup alone can never
 * hide a feature WP Rocket really served.
 *
 * Read rule (spoof resistance, as the builder marker's): a verifiable
 * marker is one marker meta (byte-identical copies count as one), carrying
 * only its `name` and `content`, whose content parses fully. Copies that
 * differ are never verified, yet never silent either: the features any
 * well-formed copy names read as unverified. Placement is not checked (the
 * page's own markup can legitimately move it; a forger can place it
 * anywhere too). WP Rocket's generator meta declaring the feature wins: the
 * feature was served, so the row gets no simulation field.
 */
import { SIMULATION_MARKER_META_NAME } from '../wp-rocket/constants';
import type { WprDetections } from '../wp-rocket/types';
import {
  parseSimulationMarker,
  type SimulationMarkerNote
} from '../wp-rocket-simulation/simulation-marker';
import { SIMULATED_FEATURES, type SimulatedFeatureId } from '../wp-rocket-simulation/spec';
import { FEATURE_META_TOKENS, featureMetaVerdict, type FeatureMetaEvidence } from './feature-meta';

/** Every marker meta, wherever it sits (the read rule counts them all). */
const SIMULATION_MARKER_SELECTOR = `meta[name="${SIMULATION_MARKER_META_NAME}"]`;

/** The attributes a marker carries: `name` and `content`, nothing else. */
const MARKER_ATTRIBUTE_COUNT = 2;

/**
 * The page's simulation marker as detection reads it: the features it names
 * and the id to verify — null when the page's marker copies disagree, so
 * nothing is verified and the features read as unverified.
 */
export interface PageSimulationMarker {
  /** The named features, in registry order (non-empty, each once). */
  readonly features: readonly SimulatedFeatureId[];
  /** The id to ask the background about; null ⇒ never verified. */
  readonly markerId: string | null;
}

/**
 * Read the simulation marker off a parsed document per the read rule.
 *
 * @param document The parsed page document.
 * @returns The marker, or null when no copy states a valid one.
 */
export function readSimulationMarker(document: Document): PageSimulationMarker | null {
  const markers = [...document.querySelectorAll(SIMULATION_MARKER_SELECTOR)];
  const first = markers[0];
  if (first === undefined) return null;
  const html = first.outerHTML;
  if (markers.every((marker) => marker.outerHTML === html)) return readOneMarker(first);
  return conflictingMarkers(markers);
}

/**
 * The single-marker rule: only `name` + `content`, content parsing fully.
 *
 * @param marker The one marker meta (or the first of identical copies).
 * @returns Its note, or null when it states no valid one.
 */
function readOneMarker(marker: Element): SimulationMarkerNote | null {
  if (marker.attributes.length !== MARKER_ATTRIBUTE_COUNT) return null;
  return markerContent(marker);
}

/**
 * Parse one marker meta's content, whatever its other attributes.
 *
 * @param marker A marker meta.
 * @returns Its note, or null when the content is missing or malformed.
 */
function markerContent(marker: Element): SimulationMarkerNote | null {
  const content = marker.getAttribute('content');
  return content === null ? null : parseSimulationMarker(content);
}

/**
 * Copies that differ: no id is trustworthy (which copy did the background
 * write?), so the union of the features the well-formed contents name reads
 * as unverified — a duplicated marker can never silently pass as served.
 *
 * @param markers Every marker meta on the page (≥ 2, not all identical).
 * @returns The unverifiable marker, or null when no copy names a feature.
 */
function conflictingMarkers(markers: readonly Element[]): PageSimulationMarker | null {
  const named = new Set(markers.flatMap((marker) => markerContent(marker)?.features ?? []));
  const features = SIMULATED_FEATURES.map(({ id }) => id).filter((id) => named.has(id));
  return features.length === 0 ? null : { features, markerId: null };
}

/**
 * Apply the page's simulation facts to a completed check pass — after the
 * checks, before the generator meta's authority (which then decides the
 * row's `source`) and before presence propagation (which then never counts
 * a simulated row). Per feature the marker names, unless the generator meta
 * declares it: vouched for ⇒ `present = false`, `version = null`,
 * inventory kept, `simulation: 'simulated'`; else ⇒ `simulation:
 * 'unverified'`, verdict untouched.
 *
 * @param detections The completed check pass (mutated in place).
 * @param marker The page's marker, or null when it states none.
 * @param verified The features the background vouched for this marker's id.
 * @param meta The page's generator meta declaration.
 */
export function applySimulationFacts(
  detections: WprDetections,
  marker: PageSimulationMarker | null,
  verified: readonly SimulatedFeatureId[],
  meta: FeatureMetaEvidence
): void {
  if (marker === null) return;
  for (const feature of marker.features) {
    if (featureMetaVerdict(meta, FEATURE_META_TOKENS[feature]) === 'declared') continue;
    const row = detections[feature];
    // An unverifiable marker (copies disagree) is never vouched for, whatever the caller passes.
    if (marker.markerId !== null && verified.includes(feature)) {
      row.present = false;
      if ('version' in row) row.version = null;
      row.simulation = 'simulated';
    } else {
      row.simulation = 'unverified';
    }
  }
}

/**
 * Whether a delay runtime holds scripts back on this page — WP Rocket's
 * served one or a verified simulation's injected one. A different question
 * from "did WP Rocket serve Delay JS" (`row.present`, false on a simulated
 * page): ask this one wherever the page's behavior matters (scripts waiting
 * for an interaction, the delayed-script count), `present` wherever the
 * served verdict does (cards, report, presence).
 *
 * @param row The page's Delay JS row.
 * @returns True when a delay runtime is on the page.
 */
export function delayRuntimeOnPage(
  row: Pick<WprDetections['delay_js'], 'present' | 'simulation'>
): boolean {
  return row.present || row.simulation === 'simulated';
}
