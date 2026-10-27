/**
 * The builder marker's content grammar — the one pure declaring site shared
 * by the rewrite that writes the marker and the detection that reads it.
 *
 * Content: `v1`, then one token per feature the rewrite changed, in the
 * registry's execution order (`EXCLUSION_FEATURES`), each feature at most
 * once, single spaces: `<feature>=off` (feature-wide disable),
 * `defer_all_js=page-off` (rows make WP Rocket defer nothing on the page),
 * `<feature>=excluded:<n>` (elements the rows restored, `n` = 1–9999).
 * Closed and bounded: anything else parses to nothing — never a partial
 * fact. Example: `v1 delay_js=off defer_all_js=page-off lazyload=excluded:3`.
 * The version prefix makes the format this extension's own and lets a later
 * version be an additive parser branch.
 */
import type { BuilderFact } from '../wp-rocket/types';
import { EXCLUSION_FEATURES, type ExclusionFeatureId } from './set';

/**
 * One document's builder note: the fact per feature the rewrite changed
 * (features it left alone are absent). Feature ids are the detection row
 * keys (`BuilderFactRow` — the two unions are pinned equal by the tests).
 */
export type BuilderNote = Readonly<Partial<Record<ExclusionFeatureId, BuilderFact>>>;

/** The grammar's bounds. */
export const BUILDER_MARKER_LIMITS = {
  /** Largest excluded count the marker states; larger counts clamp to it on write. */
  excludedMax: 9_999,
  /** Most space-separated tokens (the version + one per feature). */
  tokens: 5,
  /** Longest content the reader accepts. */
  chars: 128
} as const;

/** The content's version token. */
const VERSION_TOKEN = 'v1';

/** The `excluded:<n>` state's prefix. */
const EXCLUDED_PREFIX = 'excluded:';

/** A count as the grammar spells it: 1–9999, no sign, no leading zero. */
const COUNT_PATTERN = /^[1-9][0-9]{0,3}$/;

/**
 * Features whose rows can turn WP Rocket's run off for the whole page
 * (Defer JS joins its rows into one pre-checked pattern).
 */
const PAGE_OFF_FEATURES: ReadonlySet<ExclusionFeatureId> = new Set(['defer_all_js']);

/**
 * Whether a fact is one the feature can have: `off: 'feature'` needs a
 * feature-wide toggle (Image Lazyload has none), `off: 'page'` a set-read
 * feature, `excluded` a count in 1–9999.
 *
 * @param feature The feature.
 * @param fact The candidate fact.
 */
export function isBuilderFactAllowed(feature: ExclusionFeatureId, fact: BuilderFact): boolean {
  if ('excluded' in fact) {
    return (
      Number.isSafeInteger(fact.excluded) &&
      fact.excluded >= 1 &&
      fact.excluded <= BUILDER_MARKER_LIMITS.excludedMax
    );
  }
  if (fact.off === 'page') return PAGE_OFF_FEATURES.has(feature);
  const spec = EXCLUSION_FEATURES.find((candidate) => candidate.id === feature);
  return spec !== undefined && spec.toggleKey !== null;
}

/**
 * One feature's state as the grammar spells it.
 *
 * @param fact The fact (already allowed for its feature).
 */
function stateText(fact: BuilderFact): string {
  if ('excluded' in fact) return `${EXCLUDED_PREFIX}${String(fact.excluded)}`;
  return fact.off === 'feature' ? 'off' : 'page-off';
}

/**
 * Parse one state text, or null when it is not in the grammar.
 *
 * @param text The text after `=`.
 */
function parseState(text: string): BuilderFact | null {
  if (text === 'off') return { off: 'feature' };
  if (text === 'page-off') return { off: 'page' };
  if (!text.startsWith(EXCLUDED_PREFIX)) return null;
  const count = text.slice(EXCLUDED_PREFIX.length);
  return COUNT_PATTERN.test(count) ? { excluded: Number(count) } : null;
}

/**
 * Clamp an excluded count to what the marker states (a larger count is
 * still "many restored"; the exact number past 9999 tells nothing more).
 *
 * @param fact The fact.
 */
function clamped(fact: BuilderFact): BuilderFact {
  return 'excluded' in fact && fact.excluded > BUILDER_MARKER_LIMITS.excludedMax
    ? { excluded: BUILDER_MARKER_LIMITS.excludedMax }
    : fact;
}

/**
 * Serialize a note into the marker's content, features in registry order.
 *
 * @param note The facts per changed feature.
 * @returns The content, or null when the note states nothing (no marker is
 *   written then).
 * @throws {@link RangeError} naming the feature when a fact is not one it
 *   can have (a broken caller: the rewrite only derives allowed facts).
 */
export function serializeBuilderNote(note: BuilderNote): string | null {
  const tokens: string[] = [VERSION_TOKEN];
  for (const { id } of EXCLUSION_FEATURES) {
    const raw = note[id];
    if (raw === undefined) continue;
    const fact = clamped(raw);
    if (!isBuilderFactAllowed(id, fact)) {
      throw new RangeError(`Builder marker: ${JSON.stringify(raw)} is not a valid ${id} fact`);
    }
    tokens.push(`${id}=${stateText(fact)}`);
  }
  return tokens.length > 1 ? tokens.join(' ') : null;
}

/**
 * Parse a marker's content per the grammar. All or nothing: an unknown
 * feature or state, a repeat, an out-of-order feature, another casing,
 * extra/missing spaces, no feature token, or anything past the bounds
 * yields null — never a partial note.
 *
 * @param content The marker's `content` value (untrusted page data).
 * @returns The note, or null when the content is not in the grammar.
 */
export function parseBuilderNote(content: string): BuilderNote | null {
  if (content.length > BUILDER_MARKER_LIMITS.chars) return null;
  const tokens = content.split(' ');
  if (tokens.length < 2 || tokens.length > BUILDER_MARKER_LIMITS.tokens) return null;
  if (tokens[0] !== VERSION_TOKEN) return null;
  const note: Partial<Record<ExclusionFeatureId, BuilderFact>> = {};
  // Strictly increasing registry positions: order and uniqueness in one check.
  let lastPosition = -1;
  for (const token of tokens.slice(1)) {
    const equals = token.indexOf('=');
    if (equals < 1) return null;
    const id = token.slice(0, equals);
    const position = EXCLUSION_FEATURES.findIndex((spec) => spec.id === id);
    const feature = EXCLUSION_FEATURES[position]?.id;
    if (feature === undefined || position <= lastPosition) return null;
    lastPosition = position;
    const fact = parseState(token.slice(equals + 1));
    if (fact === null || !isBuilderFactAllowed(feature, fact)) return null;
    note[feature] = fact;
  }
  return note;
}
