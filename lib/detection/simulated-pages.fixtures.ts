/**
 * Test pages for the simulation's detection rules: a page as the session
 * serves it after simulating Delay JS — WP Rocket 3.24's packaged runtime,
 * IE fallback and bundled exclusion list run through the forward transform —
 * plus the marker the session writes. Test-only (reads the committed data
 * file from disk).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packagedVersion } from '../exclusion-session/packaged-simulation-data';
import { simulateDelayJs } from '../wp-rocket-simulation/delay-js-forward';
import { writeSimulationMarker } from '../wp-rocket-simulation/marker-write';
import { readSimulationData, SIMULATION_DATA_PATH } from '../wp-rocket-simulation/simulation-data';

/** A marker id as the background draws them. */
export const SIMULATED_MARKER_ID = '5f0c1e2d3a4b5c6d7e8f90a1b2c3d4e5';

/** The packaged WP Rocket 3.24 inputs, read once. */
const PACKAGE = (() => {
  const text = readFileSync(join(process.cwd(), 'public', SIMULATION_DATA_PATH), 'utf8');
  const read = readSimulationData(JSON.parse(text));
  if (!read.ok) throw new Error(`simulation data unreadable: ${read.problem}`);
  const version = packagedVersion(read.data, '3.24');
  if (!version.ok) throw new Error(`no packaged 3.24: ${version.cause}`);
  return version.package;
})();

/**
 * Add the session's marker for `markerId` to a document (every other copy removed).
 *
 * @param html The document.
 * @param markerId The id to state.
 */
export function withSimulationMarker(html: string, markerId = SIMULATED_MARKER_ID): string {
  return writeSimulationMarker(html, markerId, ['delay_js']).html;
}

/**
 * Simulate Delay JS on a page served without it, as a session does.
 *
 * @param served The page as served.
 * @param markerId The marker id to write (null: no marker).
 * @returns The simulated page.
 * @throws {@link Error} when the transform does not simulate the page (a bad fixture).
 */
export function simulatedPage(
  served: string,
  markerId: string | null = SIMULATED_MARKER_ID
): string {
  const result = simulateDelayJs({
    html: served,
    runtime: PACKAGE.runtime,
    ieFallback: PACKAGE.fallback,
    listRows: PACKAGE.bundledListRows,
    rows: []
  });
  if (result.report.state !== 'simulated') {
    throw new Error(`fixture not simulated: ${result.report.state}`);
  }
  return markerId === null ? result.html : withSimulationMarker(result.html, markerId);
}
