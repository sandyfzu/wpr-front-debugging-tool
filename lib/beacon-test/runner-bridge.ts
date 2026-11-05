/**
 * The beacon runner bridge: the one seam between the always-loaded isolated
 * content script (where the test executor lives) and the beacon runner — an
 * unlisted script (never in the manifest) the background injects into the
 * top frame with `scripting.executeScript` on the first run, so pages carry
 * none of WP Rocket's beacon code until a test is asked for.
 *
 * Both run in the extension's isolated world of the page's top frame (an
 * injected file shares it with the extension's content scripts): the runner
 * publishes the bridge on that world's global, the executor reads it.
 * The page can neither read nor spoof it. Two bundles meet here, so the
 * reader checks the shape, and the runner re-validates the configuration
 * and the executor the results.
 */

/** The bridge's global name in the isolated world. */
export const BEACON_RUNNER_GLOBAL = '__wprFdtBeaconRunner';

/** Why a run ended without results. */
export type BeaconBailReason =
  /** The viewport does not fit the device's thresholds (desktop: at least; mobile: at most). */
  | 'screen-size'
  /** The page is scrolled: the beacon measures only from the top. */
  | 'page-scrolled';

/** Which beacon feature a script error came from. */
export type BeaconFeatureKey = 'aboveTheFold' | 'lazyRender';

/** How a run ended. `results` is the beacon's raw output — validate before use. */
export type BeaconRunEnd =
  | {
      readonly kind: 'completed';
      readonly results: unknown;
      /** Features whose scan threw (its list then holds what it had before the error). */
      readonly scriptErrors: readonly BeaconFeatureKey[];
    }
  | { readonly kind: 'bailed'; readonly reason: BeaconBailReason }
  | { readonly kind: 'failed'; readonly message: string };

/** One started run. */
export interface BeaconRunHandle {
  /** Settles once the run ends; never rejects. */
  readonly done: Promise<BeaconRunEnd>;
  /** The raw results collected so far (what a timed-out run reports). */
  partial(): unknown;
  /** Stop the beacon's own watchdog; the run's synchronous work cannot be interrupted. */
  cancel(): void;
}

/** What the runner offers the executor. */
export interface BeaconRunner {
  /** Whether the runner's script context is still valid. */
  alive(): boolean;
  /**
   * Start one run with a fresh beacon instance.
   *
   * @param config The run configuration (re-validated by the runner).
   */
  start(config: unknown): BeaconRunHandle;
}

/** The isolated world's global object, as the bridge reads and writes it. */
export type IsolatedWorld = Record<string, unknown>;

/**
 * Publish the runner (replacing an earlier one: the newest injection owns the page).
 *
 * @param world The isolated world's global.
 * @param runner The runner.
 */
export function publishBeaconRunner(world: IsolatedWorld, runner: BeaconRunner): void {
  world[BEACON_RUNNER_GLOBAL] = runner;
}

/**
 * Find the live runner.
 *
 * @param world The isolated world's global.
 * @returns The runner, or null when there is none, it is malformed, or its
 *   context is gone (a liveness check that throws counts as gone).
 */
export function readBeaconRunner(world: IsolatedWorld): BeaconRunner | null {
  const candidate = world[BEACON_RUNNER_GLOBAL];
  if (typeof candidate !== 'object' || candidate === null) return null;
  const record = candidate as Record<string, unknown>;
  if (typeof record.alive !== 'function' || typeof record.start !== 'function') return null;
  const runner = candidate as BeaconRunner;
  try {
    return runner.alive() ? runner : null;
  } catch {
    // A liveness check that throws belongs to an invalidated context.
    return null;
  }
}
