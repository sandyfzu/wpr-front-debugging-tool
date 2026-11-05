/**
 * The beacon runner — an unlisted script: never in the manifest, never loaded
 * with a page. The background injects it (`scripting.executeScript`, files)
 * into the tab's top frame on the first beacon test, so WP Rocket's beacon
 * code costs pages nothing until a test is asked for. It runs in the
 * extension's isolated world and only publishes the runner bridge there;
 * the executor drives each run through it.
 *
 * Unlisted rather than a runtime content script: the content-script context
 * machinery would cost ~3 KiB in a bundle whose size is budgeted, and the
 * runner needs only a liveness check — after an extension reload the
 * runtime id reads `undefined`, so a stale runner reports itself dead.
 */

import { readBeaconTestConfig, toPackageOptions } from '../../lib/beacon-test/config';
import {
  publishBeaconRunner,
  type BeaconRunHandle,
  type BeaconRunner,
  type IsolatedWorld
} from '../../lib/beacon-test/runner-bridge';
import { isValidSelector } from '../../utils/css-selector';
import { startBeaconRun } from './beacon-adapter';

/** The extension's isolated world (where the bridge lives). */
const ISOLATED_WORLD = globalThis as unknown as IsolatedWorld;

/**
 * A handle for a run refused before it started.
 *
 * @param message Why.
 * @returns A settled handle with no results.
 */
function refusedRun(message: string): BeaconRunHandle {
  return {
    done: Promise.resolve({ kind: 'failed', message }),
    partial: () => null,
    cancel: () => undefined
  };
}

/** What the runner needs from its surroundings (injected for tests). */
export interface RunnerHost {
  /** Whether this script's extension context is still valid. */
  alive(): boolean;
  /** The document whose selector parser judges the configuration. */
  readonly document: Document;
}

/**
 * Build the runner.
 *
 * @param host Liveness and the page document.
 * @param start Starts a run (the beacon adapter by default).
 * @returns The runner.
 */
export function createRunner(host: RunnerHost, start = startBeaconRun): BeaconRunner {
  return {
    alive: () => host.alive(),
    start: (config) => {
      const check = readBeaconTestConfig(config, (selector) =>
        isValidSelector(host.document, selector)
      );
      if (!check.ok) {
        const kinds = check.issues.map((issue) => issue.kind).join(', ');
        return refusedRun(`Invalid beacon test configuration (${kinds})`);
      }
      return start(toPackageOptions(check.config));
    }
  };
}

/**
 * Whether the extension context is still valid: an invalidated one has no
 * runtime id (and some engines throw on the read).
 *
 * @returns `false` after an extension reload or uninstall.
 */
export function extensionAlive(): boolean {
  try {
    // Typed as always present; an invalidated context leaves it undefined.
    const id: unknown = browser.runtime.id;
    return typeof id === 'string' && id !== '';
  } catch {
    // Reading through a torn-down runtime throws on some engines: dead either way.
    return false;
  }
}

export default defineUnlistedScript(() => {
  // The beacon measures the page's own viewport: top frame only.
  if (window.top !== window) return;
  publishBeaconRunner(ISOLATED_WORLD, createRunner({ alive: extensionAlive, document }));
});
