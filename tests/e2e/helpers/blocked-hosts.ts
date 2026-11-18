/**
 * The remote hosts every browser the e2e tier (and the panel screenshot
 * script, which loads this module through Vite) launches resolves to nothing,
 * so a run never reaches their real services and stays deterministic.
 *
 * Kept free of Playwright imports: a plain Node script loads it too.
 */

import { RUCSS_ENDPOINT } from '../../../lib/rucss-tester/endpoint';
import { LATEST_LIST_ENDPOINT } from '../../../lib/wp-rocket-simulation/latest-list';

/**
 * Remote hosts the browser resolves to nothing (`~NOTFOUND`, Chromium's
 * host-resolver rule):
 * - the latest exclusion list, fetched at every background start — its
 *   refresh misses with a network error, and the simulation runs the bundled
 *   list unless a suite keeps a copy (`helpers/simulation.ts`);
 * - the RUCSS service — a suite answers it with a context route (routes
 *   intercept before name resolution; an unrouted request fails as a
 *   network error, never a real one).
 */
export const BLOCKED_REMOTE_HOSTS: readonly string[] = [
  new URL(LATEST_LIST_ENDPOINT).hostname,
  new URL(RUCSS_ENDPOINT).hostname
];

/** Chromium's resolver-rule switch for {@link BLOCKED_REMOTE_HOSTS}: pass it on every launch. */
export const HOST_RESOLVER_RULES = `--host-resolver-rules=${BLOCKED_REMOTE_HOSTS.map((host) => `MAP ${host} ~NOTFOUND`).join(', ')}`;
