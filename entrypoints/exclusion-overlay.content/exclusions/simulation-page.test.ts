import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARKER_ID } from '../../../lib/messaging/exclusion-simulation.fixtures';
import type {
  SimulationMarkerCheck,
  SimulationMarkerCheckOutcome
} from '../../../lib/messaging/simulation-marker-verifier';
import type { SimulatedFeatureId } from '../../../lib/wp-rocket-simulation/spec';
import { alreadyServesLazyload } from '../../../lib/wp-rocket-simulation/already-served';
import { NO_PAGE_EVIDENCE, NO_SIMULATION_EVIDENCE } from './simulation-mode';
import {
  createSimulationEvidence,
  readSimulationPage,
  requestedPageUrl,
  type LanePageReading,
  type SimulationPageReading
} from './simulation-page';

/** A generator meta declaring WP Rocket features. */
const GENERATOR = (features: string): string =>
  `<meta name="generator" content="WP Rocket 3.24" data-wpr-features="${features}">`;
const LAZY_RUNTIME =
  '<script async src="https://e.org/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"></script>';
const LAZY_OPTIONS =
  '<script>window.lazyLoadOptions=[{elements_selector:"img[data-lazy-src],.rocket-lazyload"}];</script>';
const LAZY_NOJS = '<noscript><style id="rocket-lazyload-nojs-css">x</style></noscript>';
const LAZY_IMAGE = `<img src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2010%2010'%3E%3C/svg%3E" data-lazy-src="/a.png">`;

const MARKER = `<meta name="wpr-fdt-simulation" content="v1 delay_js=simulated id=${MARKER_ID}">`;

/** A parsed document from markup. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** The Delay JS lane's reading of markup. */
function delayLane(html: string): LanePageReading {
  return readSimulationPage(parse(html)).lanes.delayJs;
}

/** The Defer JS lane's reading of markup. */
function deferLane(html: string): LanePageReading {
  return readSimulationPage(parse(html)).lanes.deferJs;
}

const NOTHING: LanePageReading = {
  footprints: false,
  builderOff: false,
  builderTouched: false,
  skip: null
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readSimulationPage', () => {
  it('reads a plain page as nothing', () => {
    expect(
      readSimulationPage(parse('<html><head></head><body><script src="a.js"></script>'))
    ).toEqual({
      amp: false,
      lanes: { delayJs: NOTHING, deferJs: NOTHING, lazyload: NOTHING },
      marker: null
    });
  });

  it('reads an AMP root (<html amp>, <html ⚡>)', () => {
    expect(readSimulationPage(parse('<html amp><body>')).amp).toBe(true);
    // The test DOM's parser drops the non-ASCII name (browsers keep it): set it directly.
    const bolt = parse('<html><body>');
    bolt.documentElement.setAttribute('⚡', '');
    expect(readSimulationPage(bolt).amp).toBe(true);
    expect(readSimulationPage(parse('<html lang="en"><body amp>')).amp).toBe(false);
  });

  it('reads delayed scripts as Delay JS footprints only', () => {
    expect(
      delayLane('<script type="rocketlazyloadscript" data-rocket-src="a.js"></script>').footprints
    ).toBe(true);
    expect(delayLane('<script data-rocket-src="a.js"></script>').footprints).toBe(true);
    expect(deferLane('<script data-rocket-src="a.js"></script>').footprints).toBe(false);
  });

  it('reads stamped deferred scripts as Defer JS footprints only', () => {
    const html = '<script src="a.js" data-rocket-defer defer></script>';
    expect(deferLane(html).footprints).toBe(true);
    expect(delayLane(html).footprints).toBe(false);
    // A native defer is the page's own, not WP Rocket's.
    expect(deferLane('<script src="a.js" defer></script>').footprints).toBe(false);
  });

  it('reads the generator meta declaring Defer JS as its footprint (every script excluded)', () => {
    const meta = (features: string): string =>
      `<head><meta name="generator" content="WP Rocket 3.24" data-wpr-features="${features}">`;
    expect(deferLane(meta('wpr_defer_js wpr_cdn')).footprints).toBe(true);
    expect(deferLane(meta('wpr_delay_js')).footprints).toBe(false);
    // The Delay JS lane reads only its scripts.
    expect(delayLane(meta('wpr_delay_js')).footprints).toBe(false);
  });

  it('reads WP Rocket’s LazyLoad footprints: its generator tokens, runtime tag and options', () => {
    const lazy = (html: string): boolean =>
      readSimulationPage(parse(html)).lanes.lazyload.footprints;
    const meta = (features: string): string =>
      `<head><meta name="generator" content="WP Rocket 3.24" data-wpr-features="${features}">`;
    expect(lazy(meta('wpr_lazyload_images'))).toBe(true);
    // An iframes-only page counts: its options script would be rewritten.
    expect(lazy(meta('wpr_lazyload_iframes'))).toBe(true);
    expect(lazy(meta('wpr_defer_js'))).toBe(false);
    expect(
      lazy(
        '<script async src="https://e.org/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"></script>'
      )
    ).toBe(true);
    expect(
      lazy('<script>window.lazyLoadOptions=[{elements_selector:"img[data-lazy-src]"}];</script>')
    ).toBe(true);
    // Each footprint belongs to LazyLoad alone.
    expect(
      delayLane(
        '<script>window.lazyLoadOptions=[{elements_selector:"img[data-lazy-src]"}];</script>'
      ).footprints
    ).toBe(false);
  });

  it('never reads another plugin’s lazy markup as WP Rocket’s LazyLoad', () => {
    const lazy = (html: string): boolean =>
      readSimulationPage(parse(html)).lanes.lazyload.footprints;
    // Generic vanilla-lazyload setups spell the global their own way.
    expect(lazy('<script>window.lazyLoadOptions = {elements_selector: ".lazy"};</script>')).toBe(
      false
    );
    expect(lazy('<script src="/wp-content/plugins/other/lazyload.min.js"></script>')).toBe(false);
    // Another plugin's lazy images carry no WP Rocket placeholder.
    expect(lazy('<img src="/ph.gif" data-lazy-src="a.png" class="lazy">')).toBe(false);
    expect(lazy('<img src="data:image/svg+xml,x" data-lazy-src="a.png" class="lazyloaded">')).toBe(
      false
    );
    // SVG's own <script> is no footprint (the stage masks <svg>).
    expect(
      lazy(
        '<svg><script>window.lazyLoadOptions=[{elements_selector:"img[data-lazy-src]"}]</script></svg>'
      )
    ).toBe(false);
  });

  it.each([
    ['generator images token', `<head>${GENERATOR('wpr_lazyload_images')}</head>`],
    ['another generator token', `<head>${GENERATOR('wpr_delay_js')}</head>`],
    ['runtime tag', `<body>${LAZY_RUNTIME}</body>`],
    ['inline options', `<body>${LAZY_OPTIONS}</body>`],
    ['no-JS style', `<head>${LAZY_NOJS}</head>`],
    ['placeholder image', `<body>${LAZY_IMAGE}</body>`],
    ['foreign lazy image', '<body><img data-lazy-src="/a.png" src="/ph.gif" class="lazy"></body>'],
    ['theme setup', '<body><script src="/wp-content/themes/x/lazyload.min.js"></script></body>'],
    ['prose', '<body><p>window.lazyLoadOptions rocket-lazyload-nojs-css</p></body>']
  ])('reads %s exactly as the stage’s already-served rule', (_name, body) => {
    const html = `<!doctype html><html>${body}</html>`;
    expect(readSimulationPage(parse(html)).lanes.lazyload.footprints).toBe(
      alreadyServesLazyload(html)
    );
  });

  it('reads a WP Rocket page with its generator meta removed by its other footprints', () => {
    const lazy = (html: string): boolean =>
      readSimulationPage(parse(html)).lanes.lazyload.footprints;
    expect(lazy(`<head>${LAZY_NOJS}</head><body>${LAZY_IMAGE}</body>`)).toBe(true);
    expect(lazy(`<body>${LAZY_IMAGE}</body>`)).toBe(true);
    expect(lazy(`<head>${LAZY_NOJS}</head>`)).toBe(true);
  });

  it('reads the no-JS style inside a scripted page’s <noscript>, where it is text', () => {
    const doc = parse('<!doctype html><html><head></head><body></body></html>');
    const noscript = doc.createElement('noscript');
    // A scripted page parses <noscript> content as text, never elements.
    noscript.textContent = '<style id="rocket-lazyload-nojs-css">img{}</style>';
    doc.head.append(noscript);
    expect(noscript.children).toHaveLength(0);
    expect(readSimulationPage(doc).lanes.lazyload.footprints).toBe(true);
    noscript.textContent = '<style id="other">img{}</style>';
    expect(readSimulationPage(doc).lanes.lazyload.footprints).toBe(false);
  });

  it('reads the URLs WP Rocket never lazy loads, for the LazyLoad lane only', () => {
    const doc = parse('<html><body>');
    const lanes = (url: string) => readSimulationPage(doc, url).lanes;
    expect(lanes('https://e.org/?s=shoes').lazyload.skip).toBe('search');
    expect(lanes('https://e.org/?p=2&preview=true').lazyload.skip).toBe('preview');
    expect(lanes('https://e.org/page/?fl_builder').lazyload.skip).toBe('page-builder-editor');
    expect(lanes('https://e.org/post/').lazyload.skip).toBeNull();
    expect(lanes('https://e.org/?s=shoes').delayJs.skip).toBeNull();
    expect(lanes('https://e.org/?s=shoes').deferJs.skip).toBeNull();
  });

  it('reads the URL skip off the requested URL, never an address the page moved to', () => {
    const doc = parse('<html><body>');
    const requested = 'https://e.org/post/';
    window.history.replaceState(null, '', '/?s=shoes');
    try {
      const facts = { href: window.location.href, documentUrl: requested };
      expect(facts.href).toContain('?s=shoes');
      expect(readSimulationPage(doc, requestedPageUrl(facts)).lanes.lazyload.skip).toBeNull();
      // The document URL unknown: the current address is all there is.
      expect(requestedPageUrl({ href: facts.href, documentUrl: null })).toBe(facts.href);
      expect(
        readSimulationPage(doc, requestedPageUrl({ ...facts, documentUrl: null })).lanes.lazyload
          .skip
      ).toBe('search');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('reads the builder’s Delay-off fact', () => {
    const lane = delayLane(
      '<head><meta name="wpr-fdt-exclusion-builder" content="v1 delay_js=off">'
    );
    expect(lane.builderOff).toBe(true);
    expect(lane.builderTouched).toBe(true);
  });

  it('reads any builder Delay JS fact as touched, the Delay-off one only as off', () => {
    const lane = delayLane(
      '<head><meta name="wpr-fdt-exclusion-builder" content="v1 delay_js=excluded:3">'
    );
    expect(lane.builderTouched).toBe(true);
    expect(lane.builderOff).toBe(false);
  });

  it('reads each lane’s builder facts apart', () => {
    const html = '<head><meta name="wpr-fdt-exclusion-builder" content="v1 defer_all_js=page-off">';
    expect(deferLane(html)).toEqual({
      footprints: false,
      builderOff: true,
      builderTouched: true,
      skip: null
    });
    expect(delayLane(html)).toEqual(NOTHING);
    expect(
      deferLane('<head><meta name="wpr-fdt-exclusion-builder" content="v1 defer_all_js=off">')
        .builderOff
    ).toBe(true);
    expect(
      deferLane(
        '<head><meta name="wpr-fdt-exclusion-builder" content="v1 defer_all_js=excluded:2">'
      )
    ).toEqual({ footprints: false, builderOff: false, builderTouched: true, skip: null });
  });

  it('reads the simulation marker’s id and features, and an unverifiable conflict as a null id', () => {
    expect(readSimulationPage(parse(`<head>${MARKER}`)).marker).toEqual({
      id: MARKER_ID,
      features: ['delay_js']
    });
    const other = MARKER.replace(MARKER_ID, 'f'.repeat(32));
    expect(readSimulationPage(parse(`<head>${MARKER}${other}`)).marker).toEqual({
      id: null,
      features: ['delay_js']
    });
  });
});

/**
 * A reading: the Delay JS lane's footprints and the marker (the features
 * default to Delay JS's), the Defer JS lane as given.
 */
function reading(
  over: {
    readonly footprints?: boolean;
    readonly marker?: {
      readonly id: string | null;
      readonly features?: SimulatedFeatureId[];
    } | null;
    readonly defer?: Partial<LanePageReading>;
  } = {}
): SimulationPageReading {
  const marker = over.marker ?? null;
  return {
    amp: false,
    lanes: {
      delayJs: { ...NOTHING, footprints: over.footprints ?? true },
      deferJs: { ...NOTHING, ...over.defer },
      lazyload: NOTHING
    },
    marker: marker === null ? null : { id: marker.id, features: marker.features ?? ['delay_js'] }
  };
}

/** Build the evidence in a root over a settable reading. */
function evidenceRig(first: SimulationPageReading, verify: SimulationMarkerCheck) {
  const [reading, setReading] = createSignal(first);
  const log = { warn: vi.fn() };
  let failing = false;
  return createRoot((dispose) => {
    const evidence = createSimulationEvidence({
      read: () => {
        if (failing) throw new Error('boom');
        return reading();
      },
      changed: reading,
      verify,
      log
    });
    return {
      evidence,
      setReading,
      dispose,
      log,
      failReads: () => {
        failing = true;
      }
    };
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The background's answer naming `features`. */
const answered = (features: readonly SimulatedFeatureId[]): Promise<SimulationMarkerCheckOutcome> =>
  Promise.resolve({ kind: 'answered', features });

/** A miss (`transient`: asking again may answer). */
const missed = (transient: boolean): Promise<SimulationMarkerCheckOutcome> =>
  Promise.resolve({ kind: 'missed', transient });

describe('createSimulationEvidence', () => {
  it('passes a marker-free reading through', () => {
    const rig = evidenceRig(reading(), vi.fn());
    expect(rig.evidence()).toEqual({
      delayJs: { ...NO_PAGE_EVIDENCE, footprints: true },
      deferJs: NO_PAGE_EVIDENCE,
      lazyload: NO_PAGE_EVIDENCE
    });
    rig.dispose();
  });

  it('verifies a marker once: checking, then verified', async () => {
    const verify = vi.fn(() => answered(['delay_js']));
    const rig = evidenceRig(reading({ marker: { id: MARKER_ID } }), verify);
    expect(rig.evidence().delayJs.marker).toBe('checking');
    await settle();
    expect(rig.evidence().delayJs.marker).toBe('verified');
    rig.setReading(reading({ footprints: false, marker: { id: MARKER_ID } }));
    await settle();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(rig.evidence().delayJs).toMatchObject({ footprints: false, marker: 'verified' });
    rig.dispose();
  });

  it('reads an id the background does not vouch for as unverified', async () => {
    const verify = vi.fn(() => answered([]));
    const rig = evidenceRig(reading({ marker: { id: MARKER_ID } }), verify);
    await settle();
    expect(rig.evidence().delayJs.marker).toBe('unverified');
    // An answer is final: a rescan never asks again.
    rig.setReading(reading({ marker: { id: MARKER_ID } }));
    await settle();
    expect(verify).toHaveBeenCalledTimes(1);
    rig.dispose();
  });

  it('asks once more after a transient miss, on the next rescan only', async () => {
    const verify = vi.fn<SimulationMarkerCheck>(() => missed(true));
    const rig = evidenceRig(reading({ marker: { id: MARKER_ID } }), verify);
    await settle();
    expect(rig.evidence().delayJs.marker).toBe('unverified');
    expect(verify).toHaveBeenCalledTimes(1);
    verify.mockImplementation(() => answered(['delay_js']));
    rig.setReading(reading({ marker: { id: MARKER_ID } }));
    await settle();
    expect(verify).toHaveBeenCalledTimes(2);
    expect(rig.evidence().delayJs.marker).toBe('verified');
    rig.dispose();
  });

  it('bounds the retry: two transient misses, then no more asks', async () => {
    const verify = vi.fn<SimulationMarkerCheck>(() => missed(true));
    const rig = evidenceRig(reading({ marker: { id: MARKER_ID } }), verify);
    for (let scan = 0; scan < 4; scan++) {
      await settle();
      rig.setReading(reading({ marker: { id: MARKER_ID } }));
    }
    await settle();
    expect(verify).toHaveBeenCalledTimes(2);
    expect(rig.evidence().delayJs.marker).toBe('unverified');
    rig.dispose();
  });

  it('never re-asks after a definite miss (a malformed answer)', async () => {
    const verify = vi.fn<SimulationMarkerCheck>(() => missed(false));
    const rig = evidenceRig(reading({ marker: { id: MARKER_ID } }), verify);
    await settle();
    rig.setReading(reading({ marker: { id: MARKER_ID } }));
    await settle();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(rig.evidence().delayJs.marker).toBe('unverified');
    rig.dispose();
  });

  it('never asks twice while an ask is out (rescans meanwhile)', async () => {
    let answer!: (outcome: SimulationMarkerCheckOutcome) => void;
    const verify = vi.fn<SimulationMarkerCheck>(() => new Promise((resolve) => (answer = resolve)));
    const rig = evidenceRig(reading({ marker: { id: MARKER_ID } }), verify);
    rig.setReading(reading({ marker: { id: MARKER_ID } }));
    rig.setReading(reading({ footprints: false, marker: { id: MARKER_ID } }));
    expect(verify).toHaveBeenCalledTimes(1);
    expect(rig.evidence().delayJs.marker).toBe('checking');
    answer({ kind: 'answered', features: ['delay_js'] });
    await settle();
    expect(rig.evidence().delayJs.marker).toBe('verified');
    rig.dispose();
  });

  it('never asks about conflicting copies (unverified at once)', () => {
    const verify = vi.fn();
    const rig = evidenceRig(reading({ marker: { id: null } }), verify);
    expect(rig.evidence().delayJs.marker).toBe('unverified');
    expect(verify).not.toHaveBeenCalled();
    rig.dispose();
  });

  it('drops an answer that lands after disposal', async () => {
    let answer!: (outcome: SimulationMarkerCheckOutcome) => void;
    const rig = evidenceRig(
      reading({ marker: { id: MARKER_ID } }),
      () => new Promise((resolve) => (answer = resolve))
    );
    const evidence = rig.evidence;
    rig.dispose();
    answer({ kind: 'answered', features: ['delay_js'] });
    await settle();
    expect(evidence().delayJs.marker).toBe('checking');
  });

  it('degrades a throwing read to no evidence, logged', () => {
    const rig = evidenceRig(reading(), vi.fn());
    rig.failReads();
    rig.setReading(reading());
    expect(rig.evidence()).toEqual(NO_SIMULATION_EVIDENCE);
    expect(rig.log.warn).toHaveBeenCalledWith(
      'Simulation page evidence not read',
      expect.any(Error)
    );
    rig.dispose();
  });

  it('answers every lane with one ask: each lane verified only for the features vouched for', async () => {
    const verify = vi.fn(() => answered(['defer_all_js', 'delay_js']));
    const rig = evidenceRig(
      reading({ marker: { id: MARKER_ID, features: ['defer_all_js', 'delay_js'] } }),
      verify
    );
    expect(rig.evidence().deferJs.marker).toBe('checking');
    await settle();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(rig.evidence().delayJs.marker).toBe('verified');
    expect(rig.evidence().deferJs.marker).toBe('verified');
    rig.dispose();
  });

  it('reads a lane the marker does not name as none, and one the background left out as unverified', async () => {
    const rig = evidenceRig(
      reading({ marker: { id: MARKER_ID, features: ['defer_all_js', 'delay_js'] } }),
      () => answered(['delay_js'])
    );
    await settle();
    expect(rig.evidence().delayJs.marker).toBe('verified');
    expect(rig.evidence().deferJs.marker).toBe('unverified');
    rig.setReading(reading({ marker: { id: MARKER_ID, features: ['defer_all_js'] } }));
    await settle();
    expect(rig.evidence().delayJs.marker).toBe('none');
    rig.dispose();
  });

  it('carries the AMP root and each lane’s own reading', () => {
    const rig = evidenceRig(
      { ...reading({ defer: { footprints: true, builderTouched: true } }), amp: true },
      vi.fn()
    );
    expect(rig.evidence().deferJs).toEqual({
      amp: true,
      footprints: true,
      builderOff: false,
      builderTouched: true,
      marker: 'none',
      skip: null
    });
    expect(rig.evidence().delayJs.amp).toBe(true);
    rig.dispose();
  });
});
