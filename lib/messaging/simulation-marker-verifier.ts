/**
 * The simulation marker verifier of the page's top-frame surfaces (the
 * data hub, the exclusion overlay): asks the background whether the page's
 * marker id is one it wrote for this tab and origin, bounded so the page
 * never waits past the ask's deadline. Every miss (nothing
 * listening, timeout, a malformed answer, a refusal, a reloaded extension)
 * reads as "vouches for nothing" — the marker then only annotates, never
 * hides a served verdict. The check under it tells a transient miss apart,
 * for a caller that may ask once more.
 */
import { boundedAsk, type ScheduleTimer } from './bounded-ask';
import { EXCLUSION_SESSION_DEADLINES_MS } from './exclusion-session';
import { parseSimulationMarkerVerdict } from './exclusion-simulation';
import type { Logger } from '../logger';
import type { SimulatedFeatureId } from '../wp-rocket-simulation/spec';

/**
 * Verifies a page's simulation marker id.
 *
 * @param markerId The well-formed id read off the page.
 * @returns The features the background vouches for (empty: unverified). Never rejects.
 */
export type SimulationMarkerVerifier = (markerId: string) => Promise<readonly SimulatedFeatureId[]>;

/**
 * One ask's outcome: the background's answer (empty features: it vouches
 * for nothing), or a miss — `transient` when asking again may answer
 * (nothing listening yet, past the deadline, the send failed), else a
 * malformed answer that asking again would repeat.
 */
export type SimulationMarkerCheckOutcome =
  | { readonly kind: 'answered'; readonly features: readonly SimulatedFeatureId[] }
  | { readonly kind: 'missed'; readonly transient: boolean };

/**
 * Asks about a page's simulation marker id, telling an answer from a miss.
 *
 * @param markerId The well-formed id read off the page.
 * @returns The outcome. Never rejects.
 */
export type SimulationMarkerCheck = (markerId: string) => Promise<SimulationMarkerCheckOutcome>;

/** The verifier of an extension-free pass: vouches for nothing. */
export const UNVERIFIED_MARKERS: SimulationMarkerVerifier = () => Promise.resolve([]);

/** What the verifier needs. */
export interface SimulationMarkerVerifierDeps {
  /** Sends the ask to the background. */
  readonly send: (markerId: string) => Promise<unknown>;
  /** Whether the extension context is gone (an expected miss then — not logged). */
  readonly isInvalid: () => boolean;
  readonly log: Pick<Logger, 'debug' | 'warn'>;
  /** Timer seam for tests. */
  readonly schedule?: ScheduleTimer;
}

/**
 * Create the check (each miss logged: warned when unexpected, debug when
 * nothing listens or the deadline passed, silent once the context is gone).
 *
 * @param deps The send, the context check, the log, the timer seam.
 */
export function createSimulationMarkerCheck(
  deps: SimulationMarkerVerifierDeps
): SimulationMarkerCheck {
  return async (markerId) => {
    const outcome = await boundedAsk({
      send: () => deps.send(markerId),
      parse: parseSimulationMarkerVerdict,
      timeoutMs: EXCLUSION_SESSION_DEADLINES_MS.verifyMarker,
      ...(deps.schedule === undefined ? {} : { schedule: deps.schedule })
    });
    if (outcome.kind === 'reply') return { kind: 'answered', features: outcome.reply.features };
    const miss: SimulationMarkerCheckOutcome = {
      kind: 'missed',
      transient: outcome.kind !== 'invalid-reply'
    };
    if (deps.isInvalid()) return miss;
    if (outcome.kind === 'failed' || outcome.kind === 'invalid-reply') {
      deps.log.warn('Simulation marker not verified — read as unverified', {
        outcome: outcome.kind,
        ...(outcome.kind === 'failed' ? { cause: String(outcome.cause) } : {})
      });
    } else {
      deps.log.debug('Simulation marker not verified — read as unverified', {
        outcome: outcome.kind
      });
    }
    return miss;
  };
}

/**
 * Create the verifier: every miss reads as "vouches for nothing".
 *
 * @param deps The send, the context check, the log, the timer seam.
 */
export function createSimulationMarkerVerifier(
  deps: SimulationMarkerVerifierDeps
): SimulationMarkerVerifier {
  const check = createSimulationMarkerCheck(deps);
  return async (markerId) => {
    const outcome = await check(markerId);
    return outcome.kind === 'answered' ? outcome.features : [];
  };
}
