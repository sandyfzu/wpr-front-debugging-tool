/**
 * Fixture corpus runner: the port engine must equal the test-only reference
 * implementation on every fixture, both outputs must still equal the last
 * reviewed expectation snapshot, and each pass must finish fast. Snapshots
 * are committed next to the fixtures; regenerate them with
 * `WRITE_SNAPSHOTS=1 pnpm test -- lib/detection/fixtures/snapshots.test.ts`
 * after an intentional behavior change (diff review required — a snapshot
 * rewrite without explanation does not review anything).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDetection } from '../run-detection';
import { runReferenceDetection } from '../reference/engine';
import { FIXTURES, FIXTURE_DIR } from './corpus';

interface Snapshot {
  wprDetections: unknown;
  preloadedResources: unknown;
}

/** Generation mode: `WRITE_SNAPSHOTS=1` rewrites the expectations instead of asserting. */
const writing = process.env['WRITE_SNAPSHOTS'] === '1';

describe('fixture parity + expectations', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture}: port ≡ reference ≡ reviewed snapshot`, () => {
      const html = readFileSync(join(FIXTURE_DIR, fixture), 'utf8');
      // Time the SECOND pass: the first eats this worker's JIT warmup, which
      // is machine- and order-dependent — exactly what a smoke bound must not
      // measure.
      runDetection(html);
      const started = performance.now();
      const port = runDetection(html);
      const elapsed = performance.now() - started;
      const reference = runReferenceDetection(html);

      const expectedPath = join(FIXTURE_DIR, `${fixture}.expected.json`);
      // Parity is asserted BEFORE any write in generation mode: a divergent
      // port must never rewrite the reviewed expectations.
      expect(port.detections).toEqual(reference.wprDetections);
      expect(port.preloadedResources).toEqual(reference.preloadedResources);
      if (writing) {
        writeFileSync(
          expectedPath,
          `${JSON.stringify(
            { wprDetections: port.detections, preloadedResources: port.preloadedResources },
            null,
            2
          )}\n`
        );
        return;
      }

      const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as Snapshot;
      expect(port.detections).toEqual(expected.wprDetections);
      expect(port.preloadedResources).toEqual(expected.preloadedResources);
      // Durations here measure the whole pass in the same runner as CI.
      // This is a slowdown tripwire, not a speed gate (the checks-phase bench
      // owns the ratio): happy-dom's parser costs tens of milliseconds on the
      // multi-hundred-KB fixtures, so the ceiling is generous.
      expect(elapsed, `${fixture} took ${elapsed.toFixed(1)} ms`).toBeLessThan(120);
    });
  }
});
