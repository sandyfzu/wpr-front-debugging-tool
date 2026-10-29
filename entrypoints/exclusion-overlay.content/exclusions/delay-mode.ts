/**
 * The Delay JS lane's mode — As served, Simulated or Disabled — and what
 * the page allows. Pure. The mode is not a field of its own on the wire: it
 * maps one to one onto the set's Delay JS disable and the simulate spec
 * (As served: neither; Simulated: `delay_js` simulated; Disabled: the
 * disable), so no surface ever produces the contradictory pair (a disabled
 * feature also simulated). Which modes make sense depends on the page's
 * real Delay JS state, read from the strongest evidence first: what the
 * session's rewrite of this document reports, then the extension's own
 * markers on the page (the simulation marker only once the background
 * vouches for it), then the live page itself — because a simulated page
 * carries Delay JS footprints and a Delay-disabled one carries none, the
 * live page alone would misread both.
 */
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import type { DocumentSimulationReport } from '../../../lib/messaging/exclusion-simulation';
import {
  SIMULATED_FEATURES,
  type SimulateSpec,
  type SimulatedFeatureId
} from '../../../lib/wp-rocket-simulation/spec';

/** The lane's modes, in display order. */
export const DELAY_MODES = ['served', 'simulated', 'disabled'] as const;

/** One Delay JS mode (see {@link DELAY_MODES}). */
export type DelayMode = (typeof DELAY_MODES)[number];

/** The simulated feature this lane's mode drives. */
const DELAY_FEATURE: SimulatedFeatureId = 'delay_js';

/** The wire fields one mode stands for. */
export interface DelayModeFields {
  /** The set's Delay JS feature-wide disable. */
  readonly disableDelayJs: boolean;
  /** The simulate spec (absent: nothing simulated). */
  readonly simulate: SimulateSpec | undefined;
}

/**
 * The mode a set's Delay JS disable and simulate spec stand for. The
 * contradictory pair (disabled and simulated) reads as Disabled, as a
 * stored set carrying it does (its simulation is dropped).
 *
 * @param disableDelayJs The set's Delay JS disable.
 * @param simulate The simulate spec beside the set.
 */
export function delayModeOf(
  disableDelayJs: boolean,
  simulate: SimulateSpec | undefined
): DelayMode {
  if (disableDelayJs) return 'disabled';
  return simulate?.features.includes(DELAY_FEATURE) === true ? 'simulated' : 'served';
}

/**
 * The wire fields of a mode, keeping any other simulated feature of the
 * current spec (registry order, each once).
 *
 * @param mode The mode.
 * @param simulate The current spec (its non-Delay features are kept).
 */
export function delayModeFields(
  mode: DelayMode,
  simulate: SimulateSpec | undefined
): DelayModeFields {
  const wanted = new Set(simulate?.features ?? []);
  if (mode === 'simulated') wanted.add(DELAY_FEATURE);
  else wanted.delete(DELAY_FEATURE);
  const features = SIMULATED_FEATURES.map(({ id }) => id).filter((id) => wanted.has(id));
  return {
    disableDelayJs: mode === 'disabled',
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
 * Whether the page on screen runs a simulation: `none`; `session` — the
 * session simulated this document; `kept` — the page carries a marker the
 * background wrote for this tab, without the session's word on this
 * document (e.g. after Stop: the stopped page keeps running it).
 */
export type PageSimulation = 'none' | 'session' | 'kept';

/**
 * The page's real Delay JS state.
 *
 * - `checking` — the evidence is still being read (a marker is being verified).
 * - `delayed` — WP Rocket delays scripts on this page.
 * - `not-delayed` — it does not (a simulation may be what delays them);
 *   `unproven`: only as far as the live page shows — a session's rewrite
 *   touched Delay JS here and nothing vouches for it any more (e.g. after
 *   Stop), so the missing footprints prove nothing.
 * - `amp` — an AMP page: WP Rocket never delays scripts there.
 */
export type RealDelayState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'delayed' }
  | {
      readonly kind: 'not-delayed';
      readonly simulation: PageSimulation;
      readonly unproven?: true;
    }
  | { readonly kind: 'amp' };

/** What the session's rewrite of the page on screen says (only when it is this page's). */
export interface DelaySessionFacts {
  /** The simulation step's report (absent: the session simulated nothing). */
  readonly simulation: DocumentSimulationReport | undefined;
  /** The applied set disables Delay JS. */
  readonly disableDelayJs: boolean;
  /** The Delay JS transform's report on this document. */
  readonly delayReport: TransformReport | undefined;
}

/** The verification of the page's simulation marker naming Delay JS. */
export type MarkerVerification = 'none' | 'checking' | 'verified' | 'unverified';

/** What the live page shows. */
export interface DelayPageEvidence {
  /** The root `<html>` declares AMP. */
  readonly amp: boolean;
  /** Delay JS footprints (delayed scripts) are on the page. */
  readonly footprints: boolean;
  /**
   * The builder's marker says its rewrite turned Delay JS off on this page
   * (page markup: evidence only while a session is on in this tab).
   */
  readonly builderDelayOff: boolean;
  /**
   * The builder's marker names a Delay JS change of its rewrite (any fact):
   * the live page may not be what WP Rocket served.
   */
  readonly builderDelayTouched: boolean;
  /** The simulation marker naming Delay JS, as the background verified it. */
  readonly marker: MarkerVerification;
}

/** Evidence of a page nobody has read yet: nothing on it. */
export const NO_DELAY_EVIDENCE: DelayPageEvidence = {
  amp: false,
  footprints: false,
  builderDelayOff: false,
  builderDelayTouched: false,
  marker: 'none'
};

/**
 * The real state from the session's report of this document, or null when
 * it does not decide (no rewrite here, or nothing Delay JS-specific in it).
 *
 * @param session The session's facts for the page on screen.
 */
function stateFromSession(session: DelaySessionFacts): RealDelayState | null {
  const simulation = session.simulation;
  if (simulation !== undefined) {
    switch (simulation.state) {
      case 'simulated':
        return { kind: 'not-delayed', simulation: 'session' };
      case 'csp-blocked':
        return { kind: 'not-delayed', simulation: 'none' };
      case 'already-served':
        return { kind: 'delayed' };
      case 'not-applicable':
        // Any other reason (an unreproducible page, its encoding) is a page
        // WP Rocket did not delay: the simulation could not run there.
        return simulation.reason === 'amp'
          ? { kind: 'amp' }
          : { kind: 'not-delayed', simulation: 'none' };
    }
  }
  const report = session.delayReport;
  // Rows (or the disable) may have restored every delayed script, or removed
  // WP Rocket's Delay JS scripts: the report still counts them.
  if ((report?.candidates ?? 0) > 0 || (report?.regionRemovals ?? 0) > 0) {
    return { kind: 'delayed' };
  }
  // Disabled applied, and the rewrite found nothing of WP Rocket's delay.
  if (session.disableDelayJs && report !== undefined) {
    return { kind: 'not-delayed', simulation: 'none' };
  }
  return null;
}

/**
 * The page's real Delay JS state, strongest evidence first: the session's
 * report of this document, then the builder's Delay-off marker (only while
 * a session is on in this tab: page markup alone — a saved or forged copy —
 * proves nothing) and the verified simulation marker, then the live page
 * (AMP root, footprints). An unverified marker is no evidence: the page
 * decides. A page without footprints the builder's rewrite touched reads as
 * not delayed, unproven.
 *
 * @param session The session's facts when its rewrite is the page on screen, else null.
 * @param page The live page's evidence.
 * @param sessionOn Whether an exclusion session is on in this tab.
 */
export function realDelayState(
  session: DelaySessionFacts | null,
  page: DelayPageEvidence,
  sessionOn: boolean
): RealDelayState {
  const fromSession = session === null ? null : stateFromSession(session);
  if (fromSession !== null) return fromSession;
  if (page.builderDelayOff && sessionOn) return { kind: 'delayed' };
  if (page.marker === 'verified') return { kind: 'not-delayed', simulation: 'kept' };
  if (page.marker === 'checking') return { kind: 'checking' };
  if (page.amp) return { kind: 'amp' };
  if (page.footprints) return { kind: 'delayed' };
  return page.builderDelayTouched
    ? { kind: 'not-delayed', simulation: 'none', unproven: true }
    : { kind: 'not-delayed', simulation: 'none' };
}

/**
 * Why a mode is unavailable on this page: `already-delayed` (Simulated:
 * WP Rocket delays scripts here), `amp` (Simulated and Disabled), `checking`
 * (Simulated: not known yet).
 */
export type DelayModeBlock = 'already-delayed' | 'amp' | 'checking';

/**
 * Why each mode is unavailable on a page (null: available). As served is
 * always available; Disabled is too outside AMP pages — disabling what the
 * page does not serve changes nothing, so a saved Disabled is never refused.
 *
 * @param state The page's real Delay JS state.
 */
export function delayModeBlocks(
  state: RealDelayState
): Readonly<Record<DelayMode, DelayModeBlock | null>> {
  switch (state.kind) {
    case 'checking':
      return { served: null, simulated: 'checking', disabled: null };
    case 'delayed':
      return { served: null, simulated: 'already-delayed', disabled: null };
    case 'not-delayed':
      return { served: null, simulated: null, disabled: null };
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
 * @param mode The draft's mode.
 * @param state The page's real Delay JS state.
 * @returns The mode to show checked (null: none), and the draft's one the
 *   page does not allow (null: none).
 */
export function shownDelayMode(
  mode: DelayMode,
  state: RealDelayState
): { readonly mode: DelayMode | null; readonly replaced: DelayMode | null } {
  if (state.kind === 'checking' || delayModeBlocks(state)[mode] === null) {
    return { mode, replaced: null };
  }
  return { mode: null, replaced: mode };
}

/**
 * Whether a shown Disabled changes nothing here — said only on positive
 * evidence (never while checking, never unproven): WP Rocket does not delay
 * scripts on this page and no simulation runs on it (said, never blocked).
 *
 * @param mode The shown mode (null: none).
 * @param state The page's real Delay JS state (null: not read).
 */
export function disabledChangesNothing(
  mode: DelayMode | null,
  state: RealDelayState | null
): boolean {
  return (
    mode === 'disabled' &&
    state?.kind === 'not-delayed' &&
    state.simulation === 'none' &&
    state.unproven !== true
  );
}

/**
 * Whether the page on screen runs a simulation (the session's on this
 * document, or one kept from an earlier apply).
 *
 * @param state The page's real Delay JS state (null: not read).
 */
export function runsSimulation(state: RealDelayState | null): boolean {
  return state?.kind === 'not-delayed' && state.simulation !== 'none';
}
