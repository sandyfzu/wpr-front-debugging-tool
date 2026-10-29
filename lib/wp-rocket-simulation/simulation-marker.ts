/**
 * The simulation marker's content grammar — the one pure declaring site
 * shared by the step that writes the marker and the detection that reads it.
 *
 * Content: `v1`, then one `<feature>=simulated` token per simulated feature
 * in the registry's order (`SIMULATED_FEATURES`, each at most once, at least
 * one), then `id=<32 lowercase hex>` — the id the background drew for this
 * document. Single spaces. Example: `v1 delay_js=simulated id=0123…cdef`.
 * Closed and bounded: anything else parses to nothing, never a partial
 * note. The version prefix makes the format this extension's own and lets
 * a later version be an additive parser branch.
 */
import { SIMULATED_FEATURES, SIMULATION_MARKER_ID_PATTERN, type SimulatedFeatureId } from './spec';

/** What one marker states: the simulated features and the document's id. */
export interface SimulationMarkerNote {
  /** The simulated features, in registry order (non-empty, each once). */
  readonly features: readonly SimulatedFeatureId[];
  /** The id the background drew for the document (32 lowercase hex). */
  readonly markerId: string;
}

/** The content's version token. */
const VERSION_TOKEN = 'v1';

/** A feature token's state (the only one a simulation states). */
const SIMULATED_STATE = '=simulated';

/** The id token's prefix. */
const ID_PREFIX = 'id=';

/** The grammar's bounds: the version, one token per registry feature, the id. */
export const SIMULATION_MARKER_LIMITS = {
  tokens: 2 + SIMULATED_FEATURES.length,
  /** Longest content the reader accepts (every registry feature + the id fit well within). */
  chars: 128
} as const;

/** The registry's feature ids, in order. */
const FEATURE_ORDER: readonly SimulatedFeatureId[] = SIMULATED_FEATURES.map(({ id }) => id);

/**
 * Serialize a note.
 *
 * @param note The simulated features and the id.
 * @returns The content, or null when the note is not one the grammar can
 *   state (no feature, an unknown or repeated one, a malformed id).
 */
export function serializeSimulationMarker(note: SimulationMarkerNote): string | null {
  const ordered = FEATURE_ORDER.filter((id) => note.features.includes(id));
  const known = note.features.every((id) => FEATURE_ORDER.includes(id));
  if (ordered.length === 0 || ordered.length !== note.features.length || !known) return null;
  if (!SIMULATION_MARKER_ID_PATTERN.test(note.markerId)) return null;
  const features = ordered.map((id) => `${id}${SIMULATED_STATE}`);
  return [VERSION_TOKEN, ...features, `${ID_PREFIX}${note.markerId}`].join(' ');
}

/**
 * Parse a marker's content per the grammar.
 *
 * @param content The raw `content` attribute value (untrusted page markup).
 * @returns The note, or null on any deviation.
 */
export function parseSimulationMarker(content: string): SimulationMarkerNote | null {
  if (content.length > SIMULATION_MARKER_LIMITS.chars) return null;
  const tokens = content.split(' ');
  if (tokens.length < 3 || tokens.length > SIMULATION_MARKER_LIMITS.tokens) return null;
  if (tokens[0] !== VERSION_TOKEN) return null;
  const idToken = tokens[tokens.length - 1] ?? '';
  const markerId = idToken.startsWith(ID_PREFIX) ? idToken.slice(ID_PREFIX.length) : '';
  if (!SIMULATION_MARKER_ID_PATTERN.test(markerId)) return null;
  const features: SimulatedFeatureId[] = [];
  // Strictly increasing registry positions: order, uniqueness and closedness at once.
  let last = -1;
  for (const token of tokens.slice(1, -1)) {
    const id = token.endsWith(SIMULATED_STATE)
      ? token.slice(0, -SIMULATED_STATE.length)
      : undefined;
    const position = FEATURE_ORDER.findIndex((feature) => feature === id);
    if (position <= last) return null;
    last = position;
    features.push(FEATURE_ORDER[position] as SimulatedFeatureId);
  }
  return { features, markerId };
}
