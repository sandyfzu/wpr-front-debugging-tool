/**
 * Types for the one module of `wp-rocket-scripts` (shipped as untyped
 * JavaScript) the beacon adapter extends — only the members the adapter
 * overrides or reads, as the installed version defines them.
 */
declare module 'wp-rocket-scripts/src/BeaconManager.js' {
  /** The beacon's console logger. */
  export interface BeaconLogger {
    logMessage(label: unknown, msg?: unknown): void;
    logColoredMessage(msg: string, color?: string): void;
  }

  /** One feature beacon (above-the-fold, lazy render, …). */
  export interface FeatureBeacon {
    getResults(): unknown;
    /** Set to `script_error` when the feature's scan threw. */
    errorCode?: string;
  }

  /** WP Rocket's beacon orchestrator. */
  export default class BeaconManager {
    constructor(config: object);
    config: object;
    lcpBeacon: FeatureBeacon | null;
    lrcBeacon: FeatureBeacon | null;
    infiniteLoopId: ReturnType<typeof setTimeout> | null;
    logger: BeaconLogger;
    /** Runs the enabled features, then saves (or finalizes on a bail). */
    init(): Promise<void>;
    /** Viewport-fits-thresholds check; finalizes and bails when false. */
    _isValidPreconditions(): Promise<boolean>;
    /** Asks the site which features already have data. */
    _getGeneratedBefore(): Promise<unknown>;
    /** Posts the results to the site, then finalizes. */
    _saveFinalResultIntoDB(): void;
    /** The 10 s watchdog's action. */
    _handleInfiniteLoop(): void;
    /** Marks the page's beacon script completed and stops the watchdog. */
    _finalize(): void;
  }
}
