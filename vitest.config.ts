import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { HAPPY_DOM_SETTINGS, filterDisabledLoadNoise } from './vitest.shared';

/**
 * Test runner configuration.
 *
 * - `vitePluginSolid` compiles Solid JSX (`components/**` and future `.tsx`
 *   surfaces) — WXT's `@wxt-dev/module-solid` adds it to build pipelines but
 *   `WxtVitest` never merges module vite config, so the test runner needs it
 *   declared here or component render tests cannot even parse.
 * - `WxtVitest` wires the WXT storage/testing runtime (fake browser, module
 *   aliases, import auto-types) so `lib/` code that touches `wxt/utils/storage`
 *   runs without a real extension context.
 * - `happy-dom` so DOM-touching logic (detection, Solid components from the
 *   panel phases onward, theme application) is testable without a browser;
 *   its resource loading is fully disabled — parsed URLs are data, not
 *   network requests (the fixture corpus is offline).
 * - Globals stay off: every test imports from `vitest` explicitly.
 * - Coverage is restricted to the port's logic layers (`lib`, `utils`) with a
 *   hard floor (aggregate across those layers) so untested logic fails the
 *   standard gate, not just the coverage script. Colocated `*.test.ts(x)`
 *   files, the test-only reference engine, detection benches and throwaway
 *   `spike-*.ts` files never count.
 */
export default defineConfig({
  plugins: [solid(), WxtVitest()],
  test: {
    environment: 'happy-dom',
    // The machine-relative speed bench runs only via `pnpm bench:detection`;
    // it must never flake CI on shared runners.
    // tests/e2e is the Playwright (browser) tier — `*.spec.ts` there belongs
    // to that runner (`pnpm test:e2e`), never to this one; keeping the two
    // runners disjoint is a deliberate contract guard, not organizational.
    exclude: ['**/node_modules/**', '**/.git/**', 'lib/detection/bench/**', 'tests/e2e/**'],
    // happy-dom reports disabled iframe/CSS/JS loads on its own console —
    // expected offline noise, filtered from the gate signal (shared module).
    onConsoleLog: filterDisabledLoadNoise,
    environmentOptions: {
      happyDOM: {
        settings: HAPPY_DOM_SETTINGS
      }
    },
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.{ts,tsx}', 'utils/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/reference/**', '**/bench/**', '**/spike-*.ts'],
      thresholds: { lines: 90, functions: 90, branches: 90 }
    }
  }
});
