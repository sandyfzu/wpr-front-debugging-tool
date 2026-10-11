/**
 * Playwright configuration for the local browser-test tier.
 *
 * Local-only by rule: this tier is never wired into CI (headless runners
 * cannot host extensions, owner policy). Runs are headed — real Chromium
 * windows open on the caller's machine for the duration of the suites and
 * close again (that is the tier's environment contract).
 *
 * Layout:
 * - `global-setup.ts` refuses stale extension builds (rebuild or fail with
 *   the changed-file diff) before any browser launches.
 * - two webServers: `server.mjs` (the fixture origins, `no-store`) and the
 *   P4.2 dockerized WordPress site (`docker/scripts/up.sh`, ready on /fdt/).
 * - suites live in `./suites/*.spec.ts`; helpers in `./helpers/`.
 *
 * Run with `pnpm test:e2e` (reads this config through the package script).
 */

import path from 'node:path';

import { defineConfig } from '@playwright/test';

import { SITE_URL } from './helpers/site';

/**
 * The unpacked extension bundle and the dockerized site's boot script,
 * resolved from this config's directory (Playwright runs webServer commands
 * with their cwd here; the script itself is cwd-independent).
 */
const repoRoot = path.resolve(import.meta.dirname, '..', '..');

export default defineConfig({
  globalSetup: './global-setup.ts',
  testDir: './suites',
  testMatch: '**/*.spec.ts',
  // One at a time: headed windows share the developer's screen, and suites
  // assert real browser state (menus-once, extension reload) serially.
  workers: Number(process.env.E2E_WORKERS ?? 1),
  fullyParallel: false,
  timeout: 90_000,
  retries: 0,
  reporter: [
    ['list'],
    // Cwd-independent: the report lands inside the tier's directory (which is
    // gitignored), whatever the caller's cwd was.
    ['html', { outputFolder: './playwright-report', open: 'never' }]
  ],
  outputDir: './test-results',
  use: {
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
    navigationTimeout: 20_000
  },
  webServer: [
    {
      // Path relative to this config's directory (Playwright webServer cwd).
      command: 'node ./server.mjs',
      url: 'http://127.0.0.1:8891/__e2e/health',
      reuseExistingServer: true,
      timeout: 30_000
    },
    {
      // The P4.2 dockerized WordPress site: booted for the site suites, its
      // URL read from docker/.env (docker stays the site's single declaring
      // site). Readiness on /fdt/ — the fixture pages exist only after the
      // bootstrap ran, unlike the bare WordPress answers. First boot takes
      // minutes (62 conflict plugins); a converged stack takes ~25 s and an
      // already-up stack is skipped by the reuse check.
      command: path.join(repoRoot, 'docker', 'scripts', 'up.sh'),
      url: `${SITE_URL}/fdt/`,
      reuseExistingServer: true,
      timeout: 420_000
    }
  ]
});
