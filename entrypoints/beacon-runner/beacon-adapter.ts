/**
 * The only module that touches WP Rocket's beacon (`wp-rocket-scripts`)
 * internals. A test run is a per-instance subclass — the package's
 * prototype is never patched — that keeps the beacon's own measurement and
 * replaces every side effect on the site:
 *
 * - "data already generated?" always answers no, so no request asks the site;
 * - saving resolves the run with the collected results instead of posting them;
 * - finalizing only stops the watchdog (the page's beacon script is never
 *   marked completed, and a page without one does not throw);
 * - the watchdog finalizes instead of saving;
 * - the logger is silent: nothing is written to the page's console.
 */

import BeaconManager, { type BeaconLogger } from 'wp-rocket-scripts/src/BeaconManager.js';
import type { BeaconPackageOptions } from '../../lib/beacon-test/config';
import { capText } from '../../utils/cap-text';
import type {
  BeaconFeatureKey,
  BeaconRunEnd,
  BeaconRunHandle
} from '../../lib/beacon-test/runner-bridge';

/** The beacon class shape the adapter extends (the package's, or a test double). */
export type BeaconManagerClass = typeof BeaconManager;

/** A logger that drops everything. */
const SILENT_LOGGER: BeaconLogger = Object.freeze({
  logMessage: () => undefined,
  logColoredMessage: () => undefined
});

/** Code points kept of a failure message (it may quote page content). */
const FAILURE_MESSAGE_MAX = 300;

/** Error code the feature beacons set when their scan threw. */
const SCRIPT_ERROR = 'script_error';

/** A test-run instance: the overrides plus what the adapter reads back. */
interface TestRun {
  /** Whether the beacon reached its save step (its features ran). */
  readonly saved: boolean;
  /** Whether the viewport check failed. */
  readonly screenRejected: boolean;
  /** The raw results collected so far. */
  results(): { lcp: unknown; lrc: unknown };
  /** Features whose scan threw. */
  scriptErrors(): BeaconFeatureKey[];
  init(): Promise<void>;
  _finalize(): void;
}

/**
 * Build the test-run class over a beacon base class.
 *
 * @param Base The package's class (a test double in unit tests).
 * @returns A constructor of test runs.
 */
export function testRunClass(
  Base: BeaconManagerClass
): new (options: BeaconPackageOptions) => TestRun {
  return class extends Base implements TestRun {
    /** Whether `init` reached the save step (the features ran). */
    saved = false;
    /** Whether the viewport check refused the run. */
    screenRejected = false;

    /**
     * A fresh run with a silent logger.
     *
     * @param options The run's beacon options.
     */
    constructor(options: BeaconPackageOptions) {
      super(options);
      // Replaced before `init` creates the feature beacons, which share it.
      this.logger = SILENT_LOGGER;
    }

    /**
     * The package's viewport check, remembering a refusal (it is the first of `init`'s two bails).
     *
     * @returns The package's verdict.
     */
    override async _isValidPreconditions(): Promise<boolean> {
      const valid = await super._isValidPreconditions();
      this.screenRejected = !valid;
      return valid;
    }

    /**
     * Never "already generated": a test always runs, and never asks the site.
     *
     * @returns `false`.
     */
    override _getGeneratedBefore(): Promise<false> {
      return Promise.resolve(false);
    }

    /** Mark the run saved and finalize — no request: a test never writes to the site. */
    override _saveFinalResultIntoDB(): void {
      this.saved = true;
      this._finalize();
    }

    /** The package's watchdog fired: finalize (the run's end is still decided by `init`). */
    override _handleInfiniteLoop(): void {
      this._finalize();
    }

    /** Clear the watchdog only — no page attribute, no throw without the page's gate. */
    override _finalize(): void {
      if (this.infiniteLoopId !== null) clearTimeout(this.infiniteLoopId);
      this.infiniteLoopId = null;
    }

    /**
     * The feature beacons' raw results.
     *
     * @returns Each feature's results, or null when it did not run.
     */
    results(): { lcp: unknown; lrc: unknown } {
      return {
        lcp: this.lcpBeacon === null ? null : this.lcpBeacon.getResults(),
        lrc: this.lrcBeacon === null ? null : this.lrcBeacon.getResults()
      };
    }

    /**
     * The features whose scan threw.
     *
     * @returns Their keys, above-the-fold first.
     */
    scriptErrors(): BeaconFeatureKey[] {
      const errors: BeaconFeatureKey[] = [];
      if (this.lcpBeacon?.errorCode === SCRIPT_ERROR) errors.push('aboveTheFold');
      if (this.lrcBeacon?.errorCode === SCRIPT_ERROR) errors.push('lazyRender');
      return errors;
    }
  };
}

/**
 * How an `init` that returned ended: saved (features ran) or bailed.
 *
 * @param run The finished run.
 * @returns The run's end.
 */
export function endOf(run: TestRun): BeaconRunEnd {
  if (run.saved) {
    return { kind: 'completed', results: run.results(), scriptErrors: run.scriptErrors() };
  }
  // With "generated before" always false and a feature always on, `init`
  // skips saving only on its two bails: the viewport check, then the scroll check.
  return { kind: 'bailed', reason: run.screenRejected ? 'screen-size' : 'page-scrolled' };
}

/**
 * Start one test run on the page.
 *
 * @param options Fresh beacon options (from a validated configuration).
 * @param Base The beacon class (the package's by default).
 * @returns The run's handle; `done` never rejects.
 */
export function startBeaconRun(
  options: BeaconPackageOptions,
  Base: BeaconManagerClass = BeaconManager
): BeaconRunHandle {
  const run = new (testRunClass(Base))(options);
  const done = run.init().then(
    () => endOf(run),
    (cause: unknown): BeaconRunEnd => {
      run._finalize();
      const message = cause instanceof Error ? cause.message : String(cause);
      return { kind: 'failed', message: capText(message, FAILURE_MESSAGE_MAX) };
    }
  );
  return {
    done,
    partial: () => run.results(),
    cancel: () => {
      run._finalize();
    }
  };
}
