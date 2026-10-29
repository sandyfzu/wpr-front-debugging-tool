/**
 * The data hub's simulation marker verifier: asks the background whether
 * the page's marker id is one it wrote for this tab and origin, bounded so
 * the page pass never waits past the ask's deadline. Every miss (nothing
 * listening, timeout, a malformed answer, a refusal, a reloaded extension)
 * reads as "vouches for nothing" — the marker then only annotates, never
 * hides a served verdict.
 */
import { boundedAsk, type ScheduleTimer } from '../../lib/messaging/bounded-ask';
import { EXCLUSION_SESSION_DEADLINES_MS } from '../../lib/messaging/exclusion-session';
import { parseSimulationMarkerVerdict } from '../../lib/messaging/exclusion-simulation';
import type { Logger } from '../../lib/logger';
import type { SimulatedFeatureId } from '../../lib/wp-rocket-simulation/spec';

/**
 * Verifies a page's simulation marker id.
 *
 * @param markerId The well-formed id read off the page.
 * @returns The features the background vouches for (empty: unverified). Never rejects.
 */
export type SimulationMarkerVerifier = (markerId: string) => Promise<readonly SimulatedFeatureId[]>;

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
 * Create the verifier.
 *
 * @param deps The send, the context check, the log, the timer seam.
 */
export function createSimulationMarkerVerifier(
  deps: SimulationMarkerVerifierDeps
): SimulationMarkerVerifier {
  return async (markerId) => {
    const outcome = await boundedAsk({
      send: () => deps.send(markerId),
      parse: parseSimulationMarkerVerdict,
      timeoutMs: EXCLUSION_SESSION_DEADLINES_MS.verifyMarker,
      ...(deps.schedule === undefined ? {} : { schedule: deps.schedule })
    });
    if (outcome.kind === 'reply') return outcome.reply.features;
    if (deps.isInvalid()) return [];
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
    return [];
  };
}
