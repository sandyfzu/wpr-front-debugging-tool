/**
 * The JavaScript page's script states — the one declaring site of what each
 * state means, read by both the row chips and the facet values (a value
 * selects exactly the rows that show its chip).
 *
 * Two kinds of input: tag facts carried by each delayed-script record
 * (delayed, `defer`, WP Rocket's defer stamp, its minify stamp, the served
 * URL, the local exclusion marker) and page facts the detection pass
 * decided once (the Minify JS and Combine JS verdicts, WP Rocket proven).
 * For the minify states a tag fact alone never attributes a script to WP
 * Rocket: the minify stamp counts only on a page whose Minify JS verdict
 * holds and where WP Rocket is proven, and a combined bundle's digest file
 * name only where the generator meta declares Combine JS — any build tool can
 * write either. The Deferred state's WP Rocket attribution still reads the
 * defer stamp alone, as the row badge always has. A third input, the page's
 * simulation facts, decides only who produced a Delayed or stamped Deferred
 * state (WP Rocket or a verified FDT simulation), never whether it holds.
 */

import { minifyFootprint } from '../detection/minify-footprint';
import { MINIFY_ATTRIBUTE_VALUE } from '../wp-rocket/constants';
import { isCombinedBundle } from '../wp-rocket/minify-url-recovery';
import type { DelayedScriptRecord, SimulationFact, WprDetections } from '../wp-rocket/types';
import type { JsScriptResource } from './resources-view-model';
import { PLACEHOLDER_BASE_URL } from '../../utils/urls';

/** The page-level verdicts a script's minify states depend on. */
export interface ScriptPageFacts {
  /** WP Rocket's Minify JS ran on the page (meta or footprint verdict). */
  readonly minifyJs: boolean;
  /** WP Rocket is proven on the page by its own evidence. */
  readonly wprProven: boolean;
  /** The generator meta declares Combine JS (never a footprint: the bundle name proves nothing). */
  readonly combineDeclared: boolean;
}

/** No page verdict holds: no script can read Minified or Combined. */
export const NO_SCRIPT_PAGE_FACTS: ScriptPageFacts = {
  minifyJs: false,
  wprProven: false,
  combineDeclared: false
};

/**
 * Read the page facts off the detection record.
 *
 * @param detections The page's detection record.
 * @returns The three verdicts the script states read.
 */
export function scriptPageFacts(detections: WprDetections): ScriptPageFacts {
  const combine = detections.minify_concatenate_js;
  return {
    minifyJs: detections.minify_js.present,
    wprProven: detections.wpr.present,
    combineDeclared: combine.present && combine.source === 'meta'
  };
}

/**
 * Whether two fact sets agree (the page memoizes on it: an unchanged verdict
 * set never re-classifies the rows).
 *
 * @param a One fact set.
 * @param b The other.
 * @returns True when all three verdicts are equal.
 */
export function sameScriptPageFacts(a: ScriptPageFacts, b: ScriptPageFacts): boolean {
  return (
    a.minifyJs === b.minifyJs &&
    a.wprProven === b.wprProven &&
    a.combineDeclared === b.combineDeclared
  );
}

/**
 * The page's simulation facts for the two script features whose states a
 * simulation can produce, as the detection rows read them: `simulated` — the
 * feature's footprints are the extension's work (the background vouched for
 * the marker and the generator meta does not declare the feature);
 * `unverified` — a marker nobody vouched for, so the footprints stay WP
 * Rocket's as the detection verdict reads them, only flagged; `null` — no
 * marker names the feature.
 */
export interface ScriptSimulation {
  /** Delay JS: decides who produced every Delayed state. */
  readonly delay: SimulationFact | null;
  /** Defer JS: decides who produced every defer stamp. */
  readonly defer: SimulationFact | null;
}

/** No marker: every WP Rocket footprint is WP Rocket's. */
export const NO_SCRIPT_SIMULATION: ScriptSimulation = { delay: null, defer: null };

/**
 * Read the simulation facts off the detection record.
 *
 * @param detections The page's detection record.
 * @returns Each feature's simulation fact, `null` when none.
 */
export function scriptSimulation(detections: WprDetections): ScriptSimulation {
  return {
    delay: detections.delay_js.simulation ?? null,
    defer: detections.defer_all_js.simulation ?? null
  };
}

/**
 * Whether two simulation fact sets agree (an unchanged set keeps every row view).
 *
 * @param a One fact set.
 * @param b The other.
 */
export function sameScriptSimulation(a: ScriptSimulation, b: ScriptSimulation): boolean {
  return a.delay === b.delay && a.defer === b.defer;
}

/**
 * A record's raw served URL resolved the way the detection pass resolves it
 * (URL parsing also normalizes `\`, dot segments and stripped tabs/newlines).
 * The record carries no document base, so it resolves against the
 * placeholder: the minify states read only the path's shape, which any
 * http(s) base answers exactly for absolute, root-relative (`/…`) and
 * protocol-relative (`//…`) URLs — the forms WP Rocket writes; a
 * path-relative URL is judged on its own segments.
 *
 * @param src The raw `src` / `data-rocket-src` value (non-empty).
 * @returns The absolute URL, or the raw value when it does not parse.
 */
export function resolvedScriptUrl(src: string): string {
  return URL.parse(src, PLACEHOLDER_BASE_URL)?.href ?? src;
}

/** A script's minify states (mutually exclusive: a bundle is never also "minified"). */
export interface ScriptMinifyState {
  readonly minified: boolean;
  readonly combined: boolean;
}

/**
 * Classify one record's minify states.
 *
 * Combined: Combine JS declared and the served URL has the bundle shape.
 * Minified: otherwise, Minify JS ran and the tag carries a minify footprint —
 * the cache URL on its own, or the stamp only where WP Rocket is proven (the
 * detection guard's rule, read from its verdict, never re-derived). On a page
 * without the meta a bundle therefore reads Minified: its URL sits under the
 * minify cache, and nothing declares Combine JS. Inline scripts have neither
 * (no served URL; the detection never counts an inline stamp either).
 *
 * @param script The delayed-script record.
 * @param facts The page facts.
 * @returns The two flags.
 */
export function scriptMinifyState(
  script: DelayedScriptRecord,
  facts: ScriptPageFacts
): ScriptMinifyState {
  const raw = script.inline ? undefined : script.src;
  if (raw === undefined || raw === '') return { minified: false, combined: false };
  const src = resolvedScriptUrl(raw);
  if (facts.combineDeclared && isCombinedBundle(src)) return { minified: false, combined: true };
  const footprint = facts.minifyJs
    ? minifyFootprint(src, script.minifyAttribute ? MINIFY_ATTRIBUTE_VALUE : null, 'js')
    : null;
  const minified = footprint === 'url' || (footprint === 'attribute' && facts.wprProven);
  return { minified, combined: false };
}

/** The two features the local exclusion marker can keep a script out of. */
export type ExcludableFeature = Extract<keyof WprDetections, 'delay_js' | 'defer_all_js'>;

/**
 * Whether the row reads Deferred: an external script with a native `defer`
 * or WP Rocket's defer stamp (an inline script cannot be deferred — the
 * browser ignores `defer` on it).
 *
 * @param row The classified script.
 * @returns True when the row shows the Deferred chip.
 */
export function isScriptDeferred(row: JsScriptResource): boolean {
  return row.type === 'external' && (row.deferred || row.deferredByWPR);
}

/**
 * The features the local exclusion marker kept this script out of, in
 * reading order. A feature counts only while it did not apply: a delayed
 * script whose marker names Delay JS was not kept out of it. The marker is a
 * free-form attribute value, so it matches by substring (several ids may
 * share one value); Defer JS applies to external scripts only.
 *
 * @param row The classified script.
 * @returns The excluded features (`[]` when none).
 */
export function fdtExclusions(row: JsScriptResource): ExcludableFeature[] {
  const marker = row.fdtExcluded;
  if (marker === null) return [];
  const features: ExcludableFeature[] = [];
  if (!row.delayed && marker.includes('delay_js')) features.push('delay_js');
  if (row.type === 'external' && !isScriptDeferred(row) && marker.includes('defer_all_js')) {
    features.push('defer_all_js');
  }
  return features;
}

/** The positive script states, most important first (the chips' order). */
export type JsStateId = 'excluded' | 'delayed' | 'deferred' | 'combined' | 'minified';

/** One script state: its id, its one-word label and the rows it holds on. */
export interface JsScriptState {
  readonly id: JsStateId;
  readonly label: string;
  readonly holds: (row: JsScriptResource) => boolean;
}

/**
 * Every positive state, most important first: the deliberate local
 * exclusion leads (worth noticing before anything else), then what Delay JS
 * and Defer JS did, then the file states.
 */
export const JS_SCRIPT_STATES: readonly JsScriptState[] = [
  { id: 'excluded', label: 'Excluded', holds: (row) => fdtExclusions(row).length > 0 },
  { id: 'delayed', label: 'Delayed', holds: (row) => row.delayed },
  { id: 'deferred', label: 'Deferred', holds: isScriptDeferred },
  { id: 'combined', label: 'Combined', holds: (row) => row.combined },
  { id: 'minified', label: 'Minified', holds: (row) => row.minified }
];

/**
 * One state's row.
 *
 * @param id The state id.
 * @returns The state's table row.
 * @throws {@link Error} When the table has no such id — a wiring bug.
 */
export function jsScriptState(id: JsStateId): JsScriptState {
  const state = JS_SCRIPT_STATES.find((row) => row.id === id);
  if (state === undefined) throw new Error(`Unknown script state id: "${id}".`);
  return state;
}
