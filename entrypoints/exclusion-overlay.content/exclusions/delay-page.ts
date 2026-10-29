/**
 * The live page's Delay JS evidence for the lane's mode: whether the root
 * declares AMP, whether delayed scripts are on the page, whether the
 * builder's marker says its rewrite turned Delay JS off, and the
 * simulation marker — asked of the background per id (once more after a
 * transient miss), because page markup alone (a saved or forged copy) must
 * never pass as a simulation.
 * Reads the DOM, never writes it; re-read whenever the page tools rescan.
 */
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import { parseBuilderMarker } from '../../../lib/detection/builder-fact';
import { readSimulationMarker } from '../../../lib/detection/simulation-fact';
import type { Logger } from '../../../lib/logger';
import type { SimulationMarkerCheck } from '../../../lib/messaging/simulation-marker-verifier';
import { AMP_HTML_ATTRIBUTES } from '../../../lib/wp-rocket-simulation/amp';
import { NO_DELAY_EVIDENCE, type DelayPageEvidence, type MarkerVerification } from './delay-mode';
import { DELAY_FOOTPRINT_SELECTOR } from './page-scan';

/** One read of the page. */
export interface DelayPageReading {
  /** The root `<html>` declares AMP (`amp` or `⚡`). */
  readonly amp: boolean;
  /** A delayed script is on the page. */
  readonly footprints: boolean;
  /** The builder's marker says its rewrite turned Delay JS off here (any scope). */
  readonly builderDelayOff: boolean;
  /** The builder's marker names any Delay JS change of its rewrite here. */
  readonly builderDelayTouched: boolean;
  /**
   * The simulation marker naming Delay JS: its id to verify (null: copies
   * disagree, so it can never be verified), or null when there is none.
   */
  readonly marker: { readonly id: string | null } | null;
}

/**
 * Read the page's Delay JS evidence.
 *
 * @param doc The page document.
 */
export function readDelayPage(doc: Document): DelayPageReading {
  const root = doc.documentElement;
  const fact = parseBuilderMarker(doc)?.delay_js;
  const marker = readSimulationMarker(doc);
  return {
    amp: AMP_HTML_ATTRIBUTES.some((name) => root.hasAttribute(name)),
    footprints: doc.querySelector(DELAY_FOOTPRINT_SELECTOR) !== null,
    builderDelayOff: fact !== undefined && 'off' in fact,
    builderDelayTouched: fact !== undefined,
    marker: marker?.features.includes('delay_js') === true ? { id: marker.markerId } : null
  };
}

/** What {@link createDelayEvidence} needs. */
export interface DelayEvidenceDeps {
  /** Reads the page (production: {@link readDelayPage} on the document). */
  readonly read: () => DelayPageReading;
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
 * The page's evidence, reactive: re-read on every page change; each marker
 * id verified once (`checking` until the answer lands). A transient miss
 * reads as unverified and is asked once more on the next page change; an
 * answer (even "vouches for nothing") is final.
 *
 * @param deps See {@link DelayEvidenceDeps}.
 * @returns The evidence accessor (owned by the caller's reactive root).
 */
export function createDelayEvidence(deps: DelayEvidenceDeps): Accessor<DelayPageEvidence> {
  const reading = createMemo((): DelayPageReading | null => {
    deps.changed();
    try {
      return deps.read();
    } catch (cause) {
      // A read that throws counts as a page with no evidence (the overlay goes on).
      deps.log.warn('Delay JS page evidence not read', cause);
      return null;
    }
  });
  const [verdicts, setVerdicts] = createSignal<ReadonlyMap<string, MarkerVerification>>(new Map());
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
      const verdict: MarkerVerification =
        outcome.kind === 'answered' && outcome.features.includes('delay_js')
          ? 'verified'
          : 'unverified';
      setVerdicts((current) => new Map(current).set(id, verdict));
    });
  });
  return createMemo((): DelayPageEvidence => {
    const current = reading();
    if (current === null) return NO_DELAY_EVIDENCE;
    const marker = current.marker;
    return {
      amp: current.amp,
      footprints: current.footprints,
      builderDelayOff: current.builderDelayOff,
      builderDelayTouched: current.builderDelayTouched,
      marker:
        marker === null
          ? 'none'
          : marker.id === null
            ? 'unverified'
            : (verdicts().get(marker.id) ?? 'checking')
    };
  });
}
