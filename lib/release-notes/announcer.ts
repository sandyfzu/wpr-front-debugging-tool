/**
 * The What's new announcer: runs the pure decision (`./decision`) for each
 * trigger with its effects injected — the stored marker, the opt-out, the
 * tab open — so the background's glue stays a few lines.
 *
 * Checks run one at a time (the start check and `onInstalled` both arrive at
 * a worker's first start), and the marker is stored before the page opens:
 * a failed write opens nothing, so a crash or a failing store can never
 * reopen the page on every wake.
 */
import type { Logger } from '../logger';
import { createWriteQueue } from '../storage/write-queue';
import { decideWhatsNew, type WhatsNewOpening, type WhatsNewTrigger } from './decision';
import type { ReleaseEntry } from './releases';

/** The announcer's effects (the background wires the real ones). */
export interface WhatsNewAnnouncerDeps {
  /** The running manifest version. */
  readonly currentVersion: string;
  readonly releases: readonly ReleaseEntry[];
  /** Raw stored marker (null/undefined when absent); rejects as storage does. */
  readMarker(): Promise<unknown>;
  /** Store the marker; rejects as storage does. */
  writeMarker(version: string): Promise<void>;
  /** The "Show what's new after updates" setting; rejects as storage does. */
  readEnabled(): Promise<boolean>;
  /** Open the page on the releases it presents; rejects when the browser refuses. */
  openPage(opening: WhatsNewOpening): Promise<void>;
  readonly log: Logger;
}

/** What one check ended with (logged by the glue's tests, asserted by unit tests). */
export type WhatsNewOutcome =
  'opened' | 'nothing' | 'read-failed' | 'marker-write-failed' | 'open-failed';

/** One announcer (one per background lifetime). */
export interface WhatsNewAnnouncer {
  /**
   * Run one check, after any check still running. Never rejects.
   *
   * @param trigger What asked.
   */
  check(trigger: WhatsNewTrigger): Promise<WhatsNewOutcome>;
}

/**
 * Create the announcer.
 *
 * @param deps The effects.
 */
export function createWhatsNewAnnouncer(deps: WhatsNewAnnouncerDeps): WhatsNewAnnouncer {
  const enqueue = createWriteQueue();
  return {
    check: (trigger) => enqueue(() => runCheck(deps, trigger))
  };
}

/**
 * One check: read, decide, store the marker, then open.
 *
 * @param deps The effects.
 * @param trigger What asked.
 */
async function runCheck(
  deps: WhatsNewAnnouncerDeps,
  trigger: WhatsNewTrigger
): Promise<WhatsNewOutcome> {
  let marker: unknown;
  let enabled: boolean;
  try {
    [marker, enabled] = await Promise.all([deps.readMarker(), deps.readEnabled()]);
  } catch (cause) {
    deps.log.warn('What’s new check skipped — its stored state could not be read', cause);
    return 'read-failed';
  }
  const decision = decideWhatsNew({
    trigger,
    current: deps.currentVersion,
    marker,
    enabled,
    releases: deps.releases
  });
  if (decision.warning !== null) deps.log.warn(decision.warning);
  if (decision.writeMarker !== null) {
    try {
      await deps.writeMarker(decision.writeMarker);
    } catch (cause) {
      // Opening without the marker stored could reopen the page on every wake.
      deps.log.warn('What’s new marker could not be stored — the page stays closed', cause);
      return 'marker-write-failed';
    }
  }
  const opening = decision.open;
  if (opening === null) return 'nothing';
  try {
    await deps.openPage(opening);
    return 'opened';
  } catch (cause) {
    // The marker already says "seen": the page is not retried, by design (once).
    deps.log.warn(`What’s new page for ${opening.version} could not be opened`, cause);
    return 'open-failed';
  }
}
