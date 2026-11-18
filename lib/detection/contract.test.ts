import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDetection } from './run-detection';
import { parseFdtData, parseWprDetections } from '../messaging/validate';
import { FIXTURES, FIXTURE_DIR } from './fixtures/corpus';

/**
 * The engine → boundary seam, proven over the whole corpus: a real page's
 * `runDetection` output is exactly what a real session delivers through
 * messaging, so it must survive both parsers (the detections parser and the
 * full panel-payload parser). An engine change that stops parsing is a
 * release blocker, not a panel error state discovered by hand.
 */
describe('engine output satisfies the boundary contract', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture}: detections ≡ valid WprDetections and FdtData payloads`, () => {
      const html = readFileSync(join(FIXTURE_DIR, fixture), 'utf8');
      const { detections, preloadedResources } = runDetection(html);
      expect(parseWprDetections(detections)).toEqual(detections);
      expect(
        parseFdtData({
          allScriptsLoaded: true,
          pageHeaders: null,
          undefinedReferencesOnPage: [],
          wprDetections: detections,
          preloadedResources
        })
      ).toEqual({
        allScriptsLoaded: true,
        pageHeaders: null,
        undefinedReferencesOnPage: [],
        wprDetections: detections,
        preloadedResources
      });
    });
  }
});
