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
 *   the changed-file diff) before any browser launches; `site-baseline-setup.ts`
 *   refuses a docker site left off its bootstrap settings baseline.
 * - two webServers: `server.mjs` (the fixture origins, `no-store`) and the
 *   P4.2 dockerized WordPress site (`docker/scripts/up.sh`, ready on its bootstrap marker).
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
  // Build first (no browser yet), then the site-baseline probe (the
  // webServers are up by the time global setups run).
  globalSetup: ['./global-setup.ts', './site-baseline-setup.ts'],
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
      // `E2E_FIXTURE_PORT` reaches the spawned server through Playwright's
      // default process.env pass-through, so the spawned server's port is
      // the same one this gate and the suite origins read.
      command: 'node ./server.mjs',
      url: `http://127.0.0.1:${String(process.env.E2E_FIXTURE_PORT ?? 8891)}/__e2e/health`,
      reuseExistingServer: true,
      timeout: 30_000
    },
    {
      // The P4.2 dockerized WordPress site: booted for the site suites, its
      // URL read from docker/.env (docker stays the site's single declaring
      // site). Readiness on the bootstrap's marker file — up.sh deletes it
      // before the boot and the bootstrap writes it last, so a warm volume's
      // pages (served as soon as Apache starts) can never pass the gate
      // mid-bootstrap. up.sh exits right after writing it — sooner than the
      // URL poll may look — so the bootstrap's own done line (printed after
      // the marker, ~1 s before up.sh exits) also counts as ready. First
      // boot takes minutes (62 conflict plugins); a converged stack takes
      // ~25 s and an already-up, converged stack is skipped by the reuse check.
      command: path.join(repoRoot, 'docker', 'scripts', 'up.sh'),
      url: `${SITE_URL}/fdt-state/bootstrap-ready.txt`,
      wait: { stdout: /^bootstrap: done$/m },
      reuseExistingServer: true,
      timeout: 420_000
    }
  ]
});
