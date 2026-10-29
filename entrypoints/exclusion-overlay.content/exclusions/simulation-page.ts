/**
 * The live page's evidence for the mode lanes: whether the root declares
 * AMP, per lane whether WP Rocket's footprints of the feature are on the
 * page and whether the builder's marker says its rewrite turned it off,
 * and the simulation marker — asked of the background per id (once more
 * after a transient miss), because page markup alone (a saved or forged
 * copy) must never pass as a simulation. One marker names every simulated
 * feature, so one verification answers every lane.
 * Reads the DOM, never writes it; re-read whenever the page tools rescan.
 */
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import { parseBuilderMarker } from '../../../lib/detection/builder-fact';
import {
  FEATURE_META_TOKENS,
  featureMetaVerdict,
  parseFeatureMeta,
  type FeatureMetaEvidence
} from '../../../lib/detection/feature-meta';
import { readSimulationMarker } from '../../../lib/detection/simulation-fact';
import type { Logger } from '../../../lib/logger';
import type { SimulationMarkerCheck } from '../../../lib/messaging/simulation-marker-verifier';
import { AMP_HTML_ATTRIBUTES } from '../../../lib/wp-rocket-simulation/amp';
import type { SimulatedFeatureId } from '../../../lib/wp-rocket-simulation/spec';
import {
  NO_SIMULATION_EVIDENCE,
  SIMULATION_LANES,
  type LanePageEvidence,
  type MarkerVerification,
  type SimulationLane,
  type SimulationPageEvidence
} from './simulation-mode';
import { DEFER_FOOTPRINT_SELECTOR, DELAY_FOOTPRINT_SELECTOR } from './page-scan';

/** One lane's read of the page. */
export interface LanePageReading {
  /** WP Rocket's footprints of the feature are on the page. */
  readonly footprints: boolean;
  /** The builder's marker says its rewrite turned the feature off here (any scope). */
  readonly builderOff: boolean;
  /** The builder's marker names any change of its rewrite to the feature here. */
  readonly builderTouched: boolean;
}

/** One read of the page. */
export interface SimulationPageReading {
  /** The root `<html>` declares AMP (`amp` or `⚡`). */
  readonly amp: boolean;
  /** Per mode lane. */
  readonly lanes: Readonly<Record<SimulationLane, LanePageReading>>;
  /**
   * The simulation marker: its id to verify (null: copies disagree, so it
   * can never be verified) and the features it names, or null when there
   * is none.
   */
  readonly marker: {
    readonly id: string | null;
    readonly features: readonly SimulatedFeatureId[];
  } | null;
}

/**
 * Whether WP Rocket's footprints of a lane's feature are on the page:
 * Delay JS — a delayed script; Defer JS — a script it stamped deferred, or
 * the generator meta declaring the feature (a page whose every script is
 * excluded carries no stamp).
 */
const FOOTPRINTS: Readonly<
  Record<SimulationLane, (doc: Document, meta: () => FeatureMetaEvidence) => boolean>
> = {
  delayJs: (doc) => doc.querySelector(DELAY_FOOTPRINT_SELECTOR) !== null,
  deferJs: (doc, meta) =>
    doc.querySelector(DEFER_FOOTPRINT_SELECTOR) !== null ||
    featureMetaVerdict(meta(), FEATURE_META_TOKENS.defer_all_js) === 'declared'
};

/**
 * Read the page's evidence for every mode lane.
 *
 * @param doc The page document.
 */
export function readSimulationPage(doc: Document): SimulationPageReading {
  const root = doc.documentElement;
  const note = parseBuilderMarker(doc);
  const marker = readSimulationMarker(doc);
  let meta: FeatureMetaEvidence | null = null;
  // Parsed only when a lane asks (the Delay JS footprints never need it).
  const metaOnce = (): FeatureMetaEvidence => (meta ??= parseFeatureMeta(doc));
  const lane = (key: SimulationLane): LanePageReading => {
    const fact = note?.[SIMULATION_LANES[key]];
    return {
      footprints: FOOTPRINTS[key](doc, metaOnce),
      builderOff: fact !== undefined && 'off' in fact,
      builderTouched: fact !== undefined
    };
  };
  return {
    amp: AMP_HTML_ATTRIBUTES.some((name) => root.hasAttribute(name)),
    lanes: { delayJs: lane('delayJs'), deferJs: lane('deferJs') },
    marker: marker === null ? null : { id: marker.markerId, features: marker.features }
  };
}

/** What {@link createSimulationEvidence} needs. */
export interface SimulationEvidenceDeps {
  /** Reads the page (production: {@link readSimulationPage} on the document). */
  readonly read: () => SimulationPageReading;
  /** Tracked before each read: the page changed (the page tools' rescans). */
  readonly changed: Accessor<unknown>;
  /** Asks the background about a marker id (never rejects). */
  readonly verify: SimulationMarkerCheck;
  /** Where a read that throws is reported. */
  readonly log: Pick<Logger, 'warn'>;
}

/** Asks per marker id: the first, and one more after a transient miss. */
const MARKER_ASKS = 2;

/**
 * The background's answer for one marker id: the features it vouches for,
 * or null (a miss, or nothing vouched for).
 */
type MarkerAnswer = readonly SimulatedFeatureId[] | null;

/**
 * One lane's marker verification from the page's marker and the answers.
 *
 * @param marker The page's marker (null: none).
 * @param feature The lane's feature.
 * @param answers The answers per marker id so far.
 */
function laneMarker(
  marker: SimulationPageReading['marker'],
  feature: SimulatedFeatureId,
  answers: ReadonlyMap<string, MarkerAnswer>
): MarkerVerification {
  if (marker === null || !marker.features.includes(feature)) return 'none';
  if (marker.id === null) return 'unverified';
  if (!answers.has(marker.id)) return 'checking';
  return answers.get(marker.id)?.includes(feature) === true ? 'verified' : 'unverified';
}

/**
 * One lane's evidence from a reading and the answers so far.
 *
 * @param reading The page's reading.
 * @param lane The mode lane.
 * @param answers The answers per marker id so far.
 */
function laneEvidence(
  reading: SimulationPageReading,
  lane: SimulationLane,
  answers: ReadonlyMap<string, MarkerAnswer>
): LanePageEvidence {
  return {
    amp: reading.amp,
    ...reading.lanes[lane],
    marker: laneMarker(reading.marker, SIMULATION_LANES[lane], answers)
  };
}

/**
 * The page's evidence, reactive: re-read on every page change; each marker
 * id verified once (`checking` until the answer lands), for every lane at
 * once. A transient miss reads as unverified and is asked once more on the
 * next page change; an answer (even "vouches for nothing") is final.
 *
 * @param deps See {@link SimulationEvidenceDeps}.
 * @returns The evidence accessor (owned by the caller's reactive root).
 */
export function createSimulationEvidence(
  deps: SimulationEvidenceDeps
): Accessor<SimulationPageEvidence> {
  const reading = createMemo((): SimulationPageReading | null => {
    deps.changed();
    try {
      return deps.read();
    } catch (cause) {
      // A read that throws counts as a page with no evidence (the overlay goes on).
      deps.log.warn('Simulation page evidence not read', cause);
      return null;
    }
  });
  const [answers, setAnswers] = createSignal<ReadonlyMap<string, MarkerAnswer>>(new Map());
  // Per id: asks made, and whether its answer is final (or an ask is out).
  const asks = new Map<string, number>();
  const settled = new Set<string>();
  let alive = true;
  onCleanup(() => {
    alive = false;
  });
  createEffect(() => {
    const id = reading()?.marker?.id ?? null;
    if (id === null || settled.has(id)) return;
    const made = asks.get(id) ?? 0;
    if (made >= MARKER_ASKS) return;
    asks.set(id, made + 1);
    // Held until the outcome lands: a rescan meanwhile never asks twice.
    settled.add(id);
    void deps.verify(id).then((outcome) => {
      if (!alive) return;
      if (outcome.kind === 'missed' && outcome.transient) settled.delete(id);
      const answer: MarkerAnswer = outcome.kind === 'answered' ? outcome.features : null;
      setAnswers((current) => new Map(current).set(id, answer));
    });
  });
  return createMemo((): SimulationPageEvidence => {
    const current = reading();
    if (current === null) return NO_SIMULATION_EVIDENCE;
    const known = answers();
    return {
      delayJs: laneEvidence(current, 'delayJs', known),
      deferJs: laneEvidence(current, 'deferJs', known)
    };
  });
}
