import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { HAPPY_DOM_SETTINGS, filterDisabledLoadNoise } from '../../../vitest.shared';

/**
 * Standalone config for `pnpm bench:detection`. The root config excludes this
 * directory from test discovery so the machine-relative speed gate never runs
 * inside `pnpm test` (or CI); the bench script points here explicitly. Runtime
 * pieces (environment, console filtering) are shared with the root config.
 */
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    include: ['lib/detection/bench/**/*.bench.test.ts'],
    onConsoleLog: filterDisabledLoadNoise,
    environmentOptions: {
      happyDOM: {
        settings: HAPPY_DOM_SETTINGS
      }
    }
  }
});
