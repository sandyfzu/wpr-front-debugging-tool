/**
 * The live page's evidence for the mode lanes: whether the root declares
 * AMP, per lane whether WP Rocket's footprints of the feature are on the
 * page, whether the page's URL is one WP Rocket never applies it to
 * (LazyLoad), and whether the builder's marker says its rewrite turned it off,
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
import {
  alreadyServesLazyload,
  isLazyloadFootprint,
  type FootprintElement
} from '../../../lib/wp-rocket-simulation/already-served';
import {
  lazyloadUrlSkip,
  type LazyloadUrlSkip
} from '../../../lib/wp-rocket-simulation/lazyload-url-skip';
import type { SimulatedFeatureId } from '../../../lib/wp-rocket-simulation/spec';
import {
  NO_SIMULATION_EVIDENCE,
  SIMULATION_LANES,
  SIMULATION_LANE_KEYS,
  type LanePageEvidence,
  type MarkerVerification,
  type SimulationLane,
  type SimulationPageEvidence
} from './simulation-mode';
import type { PageFacts } from '../session/page-match';
import { DEFER_FOOTPRINT_SELECTOR, DELAY_FOOTPRINT_SELECTOR } from './page-scan';

/** One lane's read of the page. */
export interface LanePageReading {
  /** WP Rocket's footprints of the feature are on the page. */
  readonly footprints: boolean;
  /** The builder's marker says its rewrite turned the feature off here (any scope). */
  readonly builderOff: boolean;
  /** The builder's marker names any change of its rewrite to the feature here. */
  readonly builderTouched: boolean;
  /** Why WP Rocket never applies the feature to the page's URL (null: it may). */
  readonly skip: LazyloadUrlSkip | null;
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

/** The elements that may be a LazyLoad footprint (see `isLazyloadFootprint`). */
const LAZYLOAD_FOOTPRINT_CANDIDATES = 'meta[name], style[id], img[data-lazy-src], script';

/** The HTML namespace: SVG's `<script>`/`<style>` are no footprints (as the stage masks `<svg>`). */
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/**
 * A live element as a footprint test reads it.
 *
 * @param element A live element.
 */
function liveElement(element: Element): FootprintElement {
  return {
    name: element.localName,
    attr: (name) => element.getAttribute(name),
    has: (name) => element.hasAttribute(name),
    body: () => element.textContent
  };
}

/**
 * Whether an element tree holds a LazyLoad footprint (see `isLazyloadFootprint`).
 *
 * @param root The tree (a document, or a parsed fragment).
 */
function holdsLazyloadFootprint(root: ParentNode): boolean {
  for (const element of root.querySelectorAll(LAZYLOAD_FOOTPRINT_CANDIDATES)) {
    if (element.namespaceURI === HTML_NAMESPACE && isLazyloadFootprint(liveElement(element))) {
      return true;
    }
  }
  return false;
}

/**
 * Whether WP Rocket's LazyLoad footprints are on the page — the stage's own
 * already-served rule (`isLazyloadFootprint`) over the live elements, then
 * over the markup of each `<noscript>` (on a scripted page its content,
 * where WP Rocket prints its no-JS style, is text, never elements), read
 * by the stage's own text reader (`alreadyServesLazyload`: no HTML is
 * parsed into the page). An `<xmp>` holds text too, as the stage masks it.
 *
 * @param doc The page document.
 */
function lazyloadFootprints(doc: Document): boolean {
  if (holdsLazyloadFootprint(doc)) return true;
  for (const noscript of doc.querySelectorAll('noscript')) {
    // Element children: a document parsed without scripting, already read above.
    if (noscript.childElementCount > 0) continue;
    const markup = noscript.textContent;
    if (markup.includes('<') && alreadyServesLazyload(markup)) return true;
  }
  return false;
}

/**
 * Whether WP Rocket's footprints of a lane's feature are on the page:
 * Delay JS — a delayed script; Defer JS — a script it stamped deferred, or
 * the generator meta declaring the feature (a page whose every script is
 * excluded carries no stamp); LazyLoad — the stage's already-served rule
 * (see {@link lazyloadFootprints}).
 */
const FOOTPRINTS: Readonly<
  Record<SimulationLane, (doc: Document, meta: () => FeatureMetaEvidence) => boolean>
> = {
  delayJs: (doc) => doc.querySelector(DELAY_FOOTPRINT_SELECTOR) !== null,
  deferJs: (doc, meta) =>
    doc.querySelector(DEFER_FOOTPRINT_SELECTOR) !== null ||
    featureMetaVerdict(meta(), FEATURE_META_TOKENS.defer_all_js) === 'declared',
  lazyload: lazyloadFootprints
};

/**
 * Why WP Rocket never applies a lane's feature to the page's URL (only
 * LazyLoad skips requests by URL).
 */
const URL_SKIPS: Readonly<Record<SimulationLane, (url: string) => LazyloadUrlSkip | null>> = {
  delayJs: () => null,
  deferJs: () => null,
  lazyload: lazyloadUrlSkip
};

/**
 * The URL the session's rewrite read this document's verdicts from: the
 * document's own URL as requested (the navigation entry's, which
 * `history.pushState`/`replaceState` never move; a matching session record
 * is this very URL's), else the current address.
 *
 * @param facts The page facts (see `PageFacts`).
 */
export function requestedPageUrl(facts: Pick<PageFacts, 'href' | 'documentUrl'>): string {
  return facts.documentUrl ?? facts.href;
}

/**
 * Read the page's evidence for every mode lane.
 *
 * @param doc The page document.
 * @param url The URL WP Rocket answered for the page (production: {@link requestedPageUrl}; default: the document's).
 */
export function readSimulationPage(doc: Document, url: string = doc.URL): SimulationPageReading {
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
      builderTouched: fact !== undefined,
      skip: URL_SKIPS[key](url)
    };
  };
  return {
    amp: AMP_HTML_ATTRIBUTES.some((name) => root.hasAttribute(name)),
    lanes: perLane(lane),
    marker: marker === null ? null : { id: marker.markerId, features: marker.features }
  };
}

/**
 * One value per mode lane.
 *
 * @param value The lane's value.
 */
function perLane<T>(value: (lane: SimulationLane) => T): Record<SimulationLane, T> {
  return Object.fromEntries(SIMULATION_LANE_KEYS.map((lane) => [lane, value(lane)])) as Record<
    SimulationLane,
    T
  >;
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
    return perLane((lane) => laneEvidence(current, lane, known));
  });
}
