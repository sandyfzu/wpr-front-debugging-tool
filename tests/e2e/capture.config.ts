/**
 * Playwright configuration of the release screenshot run
 * (`pnpm screenshots:release`): the browser-test tier's own config — build
 * gate, site baseline gate, both webServers, launch switches — pointed at
 * `./capture/*.capture.ts` instead of the suites, so the run reuses the
 * whole harness and `pnpm test:e2e` never picks it up.
 *
 * Local-only, like the tier: needs the docker site and this machine's Chromium.
 */
import { defineConfig } from '@playwright/test';

import base from './playwright.config';

export default defineConfig({
  ...base,
  testDir: './capture',
  testMatch: '**/*.capture.ts',
  // One browser: the stages share the extension's storage and the site's tabs.
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results/capture'
});
