/**
 * The mode of a lane whose feature the extension can simulate — As served,
 * Simulated or Disabled — and what the page allows. Pure. The mode is not a
 * field of its own on the wire: it maps one to one onto the set's
 * feature-wide disable and the simulate spec (As served: neither;
 * Simulated: the feature simulated; Disabled: the disable), so no surface
 * ever produces the contradictory pair (a disabled feature also
 * simulated). Which modes make sense depends on the page's real state of
 * the feature, read from the strongest evidence first: what the session's
 * rewrite of this document reports, then the extension's own markers on the
 * page (the simulation marker only once the background vouches for it),
 * then the live page itself — because a simulated page carries the
 * feature's footprints and a disabled one carries none, the live page
 * alone would misread both.
 */
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import { EXCLUSION_FEATURES, type ExclusionSetToggles } from '../../../lib/exclusion-builder/set';
import type { DocumentSimulationReport } from '../../../lib/messaging/exclusion-simulation';
import {
  SIMULATED_FEATURES,
  type SimulateSpec,
  type SimulatedFeatureId
} from '../../../lib/wp-rocket-simulation/spec';

/** The modes, in display order. */
export const SIMULATION_MODES = ['served', 'simulated', 'disabled'] as const;

/** One mode (see {@link SIMULATION_MODES}). */
export type SimulationMode = (typeof SIMULATION_MODES)[number];

/**
 * The lanes whose feature-wide switch is the mode control, each with the
 * feature it simulates (its disable shares the lane's key), in lane order.
 */
export const SIMULATION_LANES = {
  delayJs: 'delay_js',
  deferJs: 'defer_all_js'
} as const satisfies Partial<Record<keyof ExclusionSetToggles, SimulatedFeatureId>>;

/** A lane with a mode control (see {@link SIMULATION_LANES}). */
export type SimulationLane = keyof typeof SIMULATION_LANES;

/**
 * Whether a lane carries the mode control.
 *
 * @param lane Any lane key.
 */
export function isSimulationLane(lane: string): lane is SimulationLane {
  return Object.hasOwn(SIMULATION_LANES, lane);
}

/**
 * The first mode lane in registry (on-screen) order.
 *
 * @throws {@link Error} when no registry lane carries the mode control (a broken registry).
 */
function firstSimulationLane(): SimulationLane {
  const lane = EXCLUSION_FEATURES.map((feature) => feature.rowsKey).find(isSimulationLane);
  if (lane === undefined) throw new Error('No exclusion lane carries the simulation mode control');
  return lane;
}

/**
 * The lane whose notes carry the admin-screen warning: it concerns the page,
 * not one feature, so it is said once — under the first mode control.
 */
export const ADMIN_WARNING_LANE: SimulationLane = firstSimulationLane();

/** The wire fields one mode stands for. */
export interface ModeFields {
  /** The set's feature-wide disable of the lane. */
  readonly disable: boolean;
  /** The simulate spec (absent: nothing simulated). */
  readonly simulate: SimulateSpec | undefined;
}

/**
 * The mode a lane's disable and the simulate spec stand for. The
 * contradictory pair (disabled and simulated) reads as Disabled, as a
 * stored set carrying it does (its simulation is dropped).
 *
 * @param lane The lane.
 * @param disable The set's disable of the lane.
 * @param simulate The simulate spec beside the set.
 */
export function laneModeOf(
  lane: SimulationLane,
  disable: boolean,
  simulate: SimulateSpec | undefined
): SimulationMode {
  if (disable) return 'disabled';
  return simulate?.features.includes(SIMULATION_LANES[lane]) === true ? 'simulated' : 'served';
}

/**
 * The wire fields of a lane's mode, keeping every other simulated feature
 * of the current spec (registry order, each once).
 *
 * @param lane The lane.
 * @param mode The mode.
 * @param simulate The current spec (its other features are kept).
 */
export function laneModeFields(
  lane: SimulationLane,
  mode: SimulationMode,
  simulate: SimulateSpec | undefined
): ModeFields {
  const feature = SIMULATION_LANES[lane];
  const wanted = new Set(simulate?.features ?? []);
  if (mode === 'simulated') wanted.add(feature);
  else wanted.delete(feature);
  const features = SIMULATED_FEATURES.map(({ id }) => id).filter((id) => wanted.has(id));
  return {
    disable: mode === 'disabled',
    simulate: features.length === 0 ? undefined : { features }
  };
}

/**
 * Whether two simulate specs ask for the same features (order-free).
 *
 * @param a One spec (absent: nothing).
 * @param b The other.
 */
export function sameSimulate(a: SimulateSpec | undefined, b: SimulateSpec | undefined): boolean {
  const left = new Set(a?.features ?? []);
  const right = new Set(b?.features ?? []);
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/**
 * Whether the page on screen runs a simulation of the feature: `none`;
 * `session` — the session simulated this document; `kept` — the page
 * carries a marker the background wrote for this tab, without the
 * session's word on this document (e.g. after Stop: the stopped page keeps
 * running it).
 */
export type PageSimulation = 'none' | 'session' | 'kept';

/**
 * The page's real state of a feature.
 *
 * - `checking` — the evidence is still being read (a marker is being verified).
 * - `served` — WP Rocket applies the feature on this page.
 * - `not-served` — it does not (a simulation may be what applies it);
 *   `unproven`: only as far as the live page shows — a session's rewrite
 *   touched the feature here and nothing vouches for it any more (e.g.
 *   after Stop), so the missing footprints prove nothing.
 * - `amp` — an AMP page: WP Rocket never applies the feature there.
 */
export type RealFeatureState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'served' }
  | {
      readonly kind: 'not-served';
      readonly simulation: PageSimulation;
      readonly unproven?: true;
    }
  | { readonly kind: 'amp' };

/** What the session's rewrite of the page on screen says of a feature (only when it is this page's). */
export interface LaneSessionFacts {
  /** The feature's simulation report (absent: the session simulated nothing of it). */
  readonly simulation: DocumentSimulationReport | undefined;
  /** The applied set disables the feature. */
  readonly disabled: boolean;
  /** The feature's transform report on this document. */
  readonly report: TransformReport | undefined;
}

/** The verification of the page's simulation marker naming the feature. */
export type MarkerVerification = 'none' | 'checking' | 'verified' | 'unverified';

/** What the live page shows of a feature. */
export interface LanePageEvidence {
  /** The root `<html>` declares AMP. */
  readonly amp: boolean;
  /** WP Rocket's footprints of the feature are on the page. */
  readonly footprints: boolean;
  /**
   * The builder's marker says its rewrite turned the feature off on this
   * page (page markup: evidence only while a session is on in this tab).
   */
  readonly builderOff: boolean;
  /**
   * The builder's marker names a change of its rewrite to the feature (any
   * fact): the live page may not be what WP Rocket served.
   */
  readonly builderTouched: boolean;
  /** The simulation marker naming the feature, as the background verified it. */
  readonly marker: MarkerVerification;
}

/** Evidence of a page nobody has read yet: nothing on it. */
export const NO_PAGE_EVIDENCE: LanePageEvidence = {
  amp: false,
  footprints: false,
  builderOff: false,
  builderTouched: false,
  marker: 'none'
};

/** The live page's evidence per mode lane. */
export type SimulationPageEvidence = Readonly<Record<SimulationLane, LanePageEvidence>>;

/** Evidence of a page nobody has read yet, every lane. */
export const NO_SIMULATION_EVIDENCE: SimulationPageEvidence = {
  delayJs: NO_PAGE_EVIDENCE,
  deferJs: NO_PAGE_EVIDENCE
};

/**
 * The real state from the session's report of this document, or null when
 * it does not decide (no rewrite here, or nothing feature-specific in it).
 *
 * @param session The session's facts for the page on screen.
 */
function stateFromSession(session: LaneSessionFacts): RealFeatureState | null {
  const simulation = session.simulation;
  if (simulation !== undefined) {
    switch (simulation.state) {
      case 'simulated':
        return { kind: 'not-served', simulation: 'session' };
      case 'csp-blocked':
        return { kind: 'not-served', simulation: 'none' };
      case 'already-served':
        return { kind: 'served' };
      case 'not-applicable':
        // Any other reason (an unreproducible page, its encoding, Delay JS
        // served before Defer JS could run) is a page WP Rocket did not
        // apply the feature to: the simulation could not run there.
        return simulation.reason === 'amp'
          ? { kind: 'amp' }
          : { kind: 'not-served', simulation: 'none' };
    }
  }
  const report = session.report;
  // Rows (or the disable) may have undone every script WP Rocket rewrote,
  // or removed its scripts: the report still counts them.
  if ((report?.candidates ?? 0) > 0 || (report?.regionRemovals ?? 0) > 0) {
    return { kind: 'served' };
  }
  return null;
}

/**
 * Whether Disabled was applied and its rewrite of this document found
 * nothing of WP Rocket's feature. Weaker than the live page: a page WP
 * Rocket serves the feature on may hold nothing the rewrite counts (Defer
 * JS with every script excluded still declares it in the generator meta).
 *
 * @param session The session's facts for the page on screen.
 */
function disabledFoundNothing(session: LaneSessionFacts): boolean {
  return session.disabled && session.report !== undefined;
}

/**
 * The page's real state of a feature, strongest evidence first: the
 * session's report of this document, then the builder's feature-off marker
 * (only while a session is on in this tab: page markup alone — a saved or
 * forged copy — proves nothing) and the verified simulation marker, then
 * the live page (AMP root, footprints). A Disabled whose rewrite found
 * nothing of the feature decides right after the session, unless the live
 * page shows the feature served. An unverified marker is no evidence: the
 * page decides. A page without footprints the builder's
 * rewrite touched reads as not served, unproven.
 *
 * @param session The session's facts when its rewrite is the page on screen, else null.
 * @param page The live page's evidence.
 * @param sessionOn Whether an exclusion session is on in this tab.
 */
export function realFeatureState(
  session: LaneSessionFacts | null,
  page: LanePageEvidence,
  sessionOn: boolean
): RealFeatureState {
  const fromSession = session === null ? null : stateFromSession(session);
  if (fromSession !== null) return fromSession;
  const servedLive = page.footprints || (page.builderOff && sessionOn);
  // A zero-count Disabled decides only when the live page shows no positive
  // evidence of WP Rocket serving the feature.
  if (session !== null && disabledFoundNothing(session) && !servedLive) {
    return { kind: 'not-served', simulation: 'none' };
  }
  if (page.builderOff && sessionOn) return { kind: 'served' };
  if (page.marker === 'verified') return { kind: 'not-served', simulation: 'kept' };
  if (page.marker === 'checking') return { kind: 'checking' };
  if (page.amp) return { kind: 'amp' };
  if (page.footprints) return { kind: 'served' };
  return page.builderTouched
    ? { kind: 'not-served', simulation: 'none', unproven: true }
    : { kind: 'not-served', simulation: 'none' };
}

/**
 * Why a mode is unavailable on this page: `already-served` (Simulated:
 * WP Rocket applies the feature here), `delay-served` (Simulated, Defer JS:
 * WP Rocket delays scripts here — it defers before it delays, so the
 * served page no longer holds what Defer JS reads), `amp` (Simulated and
 * Disabled), `checking` (Simulated: not known yet).
 */
export type ModeBlock = 'already-served' | 'delay-served' | 'amp' | 'checking';

/**
 * Why each mode of a lane is unavailable on a page (null: available). As
 * served is always available; Disabled is too outside AMP pages —
 * disabling what the page does not serve changes nothing, so a saved
 * Disabled is never refused.
 *
 * @param lane The lane.
 * @param state The page's real state of the lane's feature.
 * @param delayState The page's real Delay JS state (null: not read) — it
 *   decides whether Defer JS can be simulated at all.
 */
export function laneModeBlocks(
  lane: SimulationLane,
  state: RealFeatureState,
  delayState: RealFeatureState | null
): Readonly<Record<SimulationMode, ModeBlock | null>> {
  switch (state.kind) {
    case 'checking':
      return { served: null, simulated: 'checking', disabled: null };
    case 'served':
      return { served: null, simulated: 'already-served', disabled: null };
    case 'not-served':
      return {
        served: null,
        simulated: lane === 'deferJs' && delayState?.kind === 'served' ? 'delay-served' : null,
        disabled: null
      };
    case 'amp':
      return { served: null, simulated: 'amp', disabled: 'amp' };
  }
}

/**
 * The mode the lane shows checked for the draft's mode: its own when the
 * page allows it, else none — the page runs as served, said by the lane, and
 * every allowed option (As served included) stays a real choice. Display
 * only — the draft keeps its mode, so a page that does not allow it never
 * changes what the session applies elsewhere. Never decided while the
 * state is still read.
 *
 * @param lane The lane.
 * @param mode The draft's mode.
 * @param state The page's real state of the feature.
 * @param delayState The page's real Delay JS state (see {@link laneModeBlocks}).
 * @returns The mode to show checked (null: none), and the draft's one the
 *   page does not allow (null: none).
 */
export function shownLaneMode(
  lane: SimulationLane,
  mode: SimulationMode,
  state: RealFeatureState,
  delayState: RealFeatureState | null
): { readonly mode: SimulationMode | null; readonly replaced: SimulationMode | null } {
  if (state.kind === 'checking' || laneModeBlocks(lane, state, delayState)[mode] === null) {
    return { mode, replaced: null };
  }
  return { mode: null, replaced: mode };
}

/**
 * Whether a shown Disabled changes nothing here — said only on positive
 * evidence (never while checking, never unproven): WP Rocket does not apply
 * the feature on this page and no simulation of it runs (said, never blocked).
 *
 * @param mode The shown mode (null: none).
 * @param state The page's real state of the feature (null: not read).
 */
export function disabledChangesNothing(
  mode: SimulationMode | null,
  state: RealFeatureState | null
): boolean {
  return (
    mode === 'disabled' &&
    state?.kind === 'not-served' &&
    state.simulation === 'none' &&
    state.unproven !== true
  );
}

/**
 * Whether the page on screen runs a simulation of the feature (the
 * session's on this document, or one kept from an earlier apply).
 *
 * @param state The page's real state of the feature (null: not read).
 */
export function runsSimulation(state: RealFeatureState | null): boolean {
  return state?.kind === 'not-served' && state.simulation !== 'none';
}
