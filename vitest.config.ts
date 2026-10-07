import { defineConfig } from 'vitest/config';

/**
 * Test runner configuration.
 *
 * - `happy-dom` so DOM-touching logic (`applyTheme`, Solid components from the panel
 *   phases onward) is testable without a browser; pure utils run under it too.
 * - Globals stay off: every test imports from `vitest` explicitly.
 * - Coverage is restricted to the port's logic layers (`lib`, `utils`) with a hard
 *   floor (aggregate across those layers) so untested logic fails the standard gate,
 *   not just the coverage script. Colocated `*.test.ts(x)` files, any test-only
 *   reference-implementation directory and throwaway `spike-*.ts` files never count.
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.{ts,tsx}', 'utils/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/reference/**', '**/spike-*.ts'],
      thresholds: { lines: 90, functions: 90 }
    }
  }
});
