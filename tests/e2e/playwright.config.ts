/**
 * Playwright configuration for the local browser-test tier.
 *
 * Local-only by rule: this tier is never wired into CI (it needs this
 * machine's real Chrome build and the docker site). Runs are **headless by
 * default** so a gate can't seize the developer's foreground — real windows
 * open only with `E2E_HEADED=1` (the debugging opt-in). Extensions host in
 * the `chromium` channel's modern headless (the shell cannot); empirically
 * verified against the installed build.
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
  // One at a time: suites assert real browser state (menus-once, extension
  // reload) serially, and the shared fixture server assumes one browser.
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
