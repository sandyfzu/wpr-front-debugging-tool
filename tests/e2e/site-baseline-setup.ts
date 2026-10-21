/**
 * Playwright global setup: refuses to run against a docker site left off its
 * bootstrap baseline. A settings-writing suite restores what it changed, but
 * a killed run cannot — and every later site suite would then assert pages
 * rendered under a test combination. One live `/fdt/` render (a fresh cache
 * key, so it always reflects the stored settings) is compared against the
 * baseline's declared features. Runs after the webServers, so the site is up.
 * The probe carries the no-store flag, so it never leaves a cache file behind.
 *
 * Gates EVERY run, site suites selected or not: one ~1 s request buys a hard
 * stop before any suite reads a drifted site, and keeps the guard in one place
 * instead of in each site suite's hooks.
 *
 * Local-only by rule, like the whole browser tier.
 */

import { baselineMetaDrift, LIVE_NONCE_FLAG, NO_STORE_QUERY } from './helpers/detection-matrix';
import { SITE_URL } from './helpers/site';

/** The fix every failure here points at. */
const UP_HINT = 'run docker/scripts/up.sh to (re)boot it onto its baseline';

/**
 * Global setup entry: probe the site, throw an actionable error on drift.
 *
 * @throws {Error} When the probe fails or the render is off the baseline.
 */
export default async function siteBaselineSetup(): Promise<void> {
  const url = `${SITE_URL}/fdt/?${LIVE_NONCE_FLAG}=baseline-probe-${String(Date.now())}&${NO_STORE_QUERY}`;
  let response: Response;
  let html: string;
  try {
    response = await fetch(url, { headers: { 'User-Agent': 'fdt-baseline-probe' } });
    html = await response.text();
  } catch (error) {
    // undici's bare "fetch failed" hides the reason (refused, reset…) in `cause`.
    const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
    throw new Error(`[e2e] site baseline probe ${url} failed (${String(cause)}) — ${UP_HINT}`, {
      cause: error
    });
  }
  if (response.status !== 200) {
    throw new Error(
      `[e2e] site baseline probe ${url} answered ${String(response.status)} — ${UP_HINT}`
    );
  }
  const drift = baselineMetaDrift(html);
  if (drift.length > 0) {
    throw new Error(
      `[e2e] the docker site is off its bootstrap baseline (${drift.join(', ')}) — a killed settings-writing run? ${UP_HINT}`
    );
  }
  console.log('[e2e] docker site is at its bootstrap baseline');
}
