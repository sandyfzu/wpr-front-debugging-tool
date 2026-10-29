/**
 * The page pass with the simulation marker: the verifier is asked only for
 * a page carrying a well-formed marker, and the honest-status table holds
 * end to end — through `processSerializedPage` (the content script's pass)
 * and `runDetection` (extension-free) — down to `wpr.present` and the
 * toolbar badge it feeds.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../../lib/detection/fixtures/corpus';
import { runDetection } from '../../lib/detection/run-detection';
import {
  SIMULATED_MARKER_ID,
  simulatedPage,
  withSimulationMarker
} from '../../lib/detection/simulated-pages.fixtures';
import { parseFdtData } from '../../lib/messaging/validate';
import { badgeFor } from '../background/badge';
import { composeFdtData, processSerializedPage, type LivePageFacts } from './data-hub';
import type { SimulationMarkerVerifier } from '../../lib/messaging/simulation-marker-verifier';

const DELAY_ON_NO_META = readFileSync(join(FIXTURE_DIR, 'delay-on-no-meta.html'), 'utf8');

const PLAIN =
  '<!doctype html><html><head><title>Plain</title><script src="https://site.test/a.js"></script></head><body><script src="https://site.test/b.js"></script></body></html>';

/** A verifier that records its asks and vouches for `features` when the id matches. */
function verifier(features: readonly 'delay_js'[] = ['delay_js']) {
  const asked: string[] = [];
  const verify: SimulationMarkerVerifier = (markerId) => {
    asked.push(markerId);
    return Promise.resolve(markerId === SIMULATED_MARKER_ID ? features : []);
  };
  return { asked, verify };
}

/** The badge the page's summary paints. */
function badgeOf(detections: { wpr: { present: boolean; cached: boolean } }) {
  return badgeFor({ wprPresent: detections.wpr.present, cached: detections.wpr.cached });
}

const LIVE: LivePageFacts = {
  allScriptsLoaded: false,
  headerCapture: null,
  undefinedReferences: [],
  cookies: null,
  bypassAttested: false
};

const NO_WP_ROCKET_BADGE = badgeFor({ wprPresent: false, cached: false });

describe('processSerializedPage — simulation marker', () => {
  it('never asks the verifier for a page without a well-formed marker', async () => {
    const { asked, verify } = verifier();
    await processSerializedPage(DELAY_ON_NO_META, verify);
    await processSerializedPage(
      withSimulationMarker(DELAY_ON_NO_META).replace('delay_js=simulated', 'delay_js=on'),
      verify
    );
    expect(asked).toEqual([]);
  });

  it('asks once with the marker id read off the page', async () => {
    const { asked, verify } = verifier();
    await processSerializedPage(simulatedPage(PLAIN), verify);
    expect(asked).toEqual([SIMULATED_MARKER_ID]);
  });

  it('verified · no WP Rocket: not served, no WP Rocket, the badge in its "no WP Rocket" state', async () => {
    const { verify } = verifier();
    const { detections } = await processSerializedPage(simulatedPage(PLAIN), verify);
    expect(detections.delay_js).toMatchObject({ present: false, simulation: 'simulated' });
    expect(detections.wpr.present).toBe(false);
    expect(badgeOf(detections)).toEqual(NO_WP_ROCKET_BADGE);
    // …never the cached or uncached "WP Rocket present" states.
    expect(NO_WP_ROCKET_BADGE).not.toEqual(badgeFor({ wprPresent: true, cached: false }));
    expect(NO_WP_ROCKET_BADGE).not.toEqual(badgeFor({ wprPresent: true, cached: true }));
  });

  it('verified · WP Rocket, no meta: Minify JS still served, WP Rocket present', async () => {
    const { verify } = verifier();
    const { detections } = await processSerializedPage(
      withSimulationMarker(DELAY_ON_NO_META),
      verify
    );
    expect(detections.delay_js).toMatchObject({ present: false, simulation: 'simulated' });
    expect(detections.minify_js.present).toBe(true);
    expect(detections.wpr.present).toBe(true);
  });

  it('forged marker, no session (verifier vouches for nothing): served verdicts unchanged + unverified', async () => {
    const forged = withSimulationMarker(DELAY_ON_NO_META);
    const served = await processSerializedPage(DELAY_ON_NO_META);
    for (const verify of [verifier([]).verify, undefined]) {
      const { detections } = await processSerializedPage(forged, verify);
      expect(detections).toEqual({
        ...served.detections,
        delay_js: { ...served.detections.delay_js, simulation: 'unverified' }
      });
      expect(badgeOf(detections)).toEqual(badgeOf(served.detections));
    }
  });

  it('another tab’s id reads as unverified', async () => {
    const { verify } = verifier();
    const other = withSimulationMarker(DELAY_ON_NO_META, 'a'.repeat(32));
    const { detections } = await processSerializedPage(other, verify);
    expect(detections.delay_js).toMatchObject({ present: true, simulation: 'unverified' });
  });

  it('a page re-injecting another marker beside its own is never asked about: unverified, served verdict', async () => {
    const { asked, verify } = verifier();
    const own = simulatedPage(PLAIN);
    const head = own.indexOf('</head>');
    const replayed = withSimulationMarker('<head></head>', 'a'.repeat(32)).slice(6, -7);
    const twoMarkers = own.slice(0, head) + replayed + own.slice(head);
    const { detections } = await processSerializedPage(twoMarkers, verify);
    expect(asked).toEqual([]);
    expect(detections.delay_js).toMatchObject({ present: true, simulation: 'unverified' });
  });

  it('agrees with runDetection on every unverified page (both runChecks callers)', async () => {
    for (const html of [simulatedPage(PLAIN), withSimulationMarker(DELAY_ON_NO_META)]) {
      const { detections } = await processSerializedPage(html);
      expect(detections).toEqual(runDetection(html).detections);
    }
  });

  it('the simulated rows cross the panel payload guard', async () => {
    const { verify } = verifier();
    for (const data of [
      await processSerializedPage(simulatedPage(PLAIN), verify),
      await processSerializedPage(simulatedPage(PLAIN))
    ]) {
      const parsed = parseFdtData(composeFdtData(data, LIVE));
      expect(parsed?.wprDetections.delay_js).toEqual(data.detections.delay_js);
      expect(parsed?.wprDetections.delay_js.simulation).toBeDefined();
    }
  });
});
