/**
 * The nav registry's shape tests: row order, groups, the reserved row and
 * its copy, uniqueness — plus the route-body table matching the registry
 * (the shell cannot run out of bodies), and every live-state selector's
 * resolutions against the fixture-grade `FdtData` values each state is
 * about.
 */
import { describe, expect, it } from 'vitest';
import type { NavLiveState } from './routes';
import { DEFAULT_ROUTE, NAV_GROUPS, NAV_ROUTES, ROUTE_IDS, navRoute } from './routes';
import { PAGES } from './pages';
import { makeDelayScript, makeFdtData, makeLazyImage } from './state/fixtures';

/** Resolve one row's selector for a loaded-data fixture (guards the row set below). */
function liveStateOf(
  id: (typeof ROUTE_IDS)[number],
  data: ReturnType<typeof makeFdtData>
): NavLiveState | null {
  const selector = navRoute(id)?.liveState;
  expect(selector, `${id} carries its selector`).toBeDefined();
  return selector ? selector(data) : null;
}

describe('NAV_ROUTES', () => {
  it('lists the eight rows in the journey order', () => {
    expect(NAV_ROUTES.map((row) => row.id)).toEqual([
      'detections',
      'javascript',
      'lazyload',
      'preloaded-resources',
      'headers-cookies',
      'undefined-references',
      'diagnoser',
      'rucss-tester'
    ]);
    expect(NAV_ROUTES.map((row) => row.group)).toEqual([
      'Overview',
      'Inspect',
      'Inspect',
      'Inspect',
      'Inspect',
      'Diagnose',
      'Diagnose',
      'Tools'
    ]);
  });

  it('declares the RUCSS Tester as a state-free Tools row', () => {
    const row = navRoute('rucss-tester');
    expect(row?.label).toBe('RUCSS Tester');
    expect(row?.group).toBe('Tools');
    expect(row?.reserved).toBeUndefined();
    expect(row?.liveState).toBeUndefined();
  });

  it('declares Headers & Cookies as a state-free Inspect row', () => {
    const row = navRoute('headers-cookies');
    expect(row?.label).toBe('Headers & Cookies');
    expect(row?.group).toBe('Inspect');
    expect(row?.reserved).toBeUndefined();
    // Its cache answers are the status bar's: the nav says nothing.
    expect(row?.liveState).toBeUndefined();
  });

  it('uses only known groups in known order', () => {
    for (const row of NAV_ROUTES) {
      expect((NAV_GROUPS as readonly string[]).includes(row.group)).toBe(true);
    }
  });

  it('gives every row a non-empty label and a distinct id', () => {
    const ids = NAV_ROUTES.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of NAV_ROUTES) {
      expect(row.label.length).toBeGreaterThan(0);
      expect((ROUTE_IDS as readonly string[]).includes(row.id)).toBe(true);
    }
  });

  it('renders the Diagnoser row reserved, with its explanatory note', () => {
    const diagnoser = navRoute('diagnoser');
    expect(diagnoser?.reserved).toBe(true);
    expect(diagnoser?.reservedNote).toBe('Returns with the Diagnoser plugin v2');
  });

  it('names the plural explicitly where the singular menu name was wrong', () => {
    // The registry carries the corrected label the nav actually renders.
    expect(navRoute('undefined-references')?.label).toBe('Undefined References');
  });

  it('bounds every group value without leaving the vocabulary', () => {
    expect([...NAV_GROUPS]).toEqual(['Overview', 'Inspect', 'Diagnose', 'Tools']);
  });
});

describe('nav live-state selectors', () => {
  it('groups uncapped totals consistently across every counted route', () => {
    const base = makeFdtData();
    const loaded = makeFdtData({
      wprDetections: {
        ...base.wprDetections,
        delay_js: {
          present: true,
          scripts: Array.from({ length: 1000 }, () => makeDelayScript()),
          delayedScripts: 1000,
          version: null
        },
        lazyload: {
          present: true,
          images: Array.from({ length: 1000 }, () => makeLazyImage())
        }
      },
      preloadedResources: {
        present: true,
        resources: Array.from({ length: 1000 }, () => ({ href: '/x', type: 'script' }))
      },
      undefinedReferencesOnPage: Array.from({ length: 1000 }, (_, i) => `missing${String(i)}`)
    });
    expect(liveStateOf('javascript', loaded)?.text).toBe('delayed 1,000/1,000');
    expect(liveStateOf('lazyload', loaded)?.text).toBe('1,000 images');
    expect(liveStateOf('preloaded-resources', loaded)?.text).toBe('1,000 links');
    expect(liveStateOf('undefined-references', loaded)?.text).toBe('1,000 found');
  });

  it('answers null before any data is loaded — silence, not stale counts', () => {
    for (const row of NAV_ROUTES) {
      expect(row.liveState?.(null) ?? null, `${row.id} with null data`).toBeNull();
    }
  });

  it('counts the delay inventory as delayed X/Y', () => {
    const loaded = makeFdtData({
      wprDetections: {
        ...makeFdtData().wprDetections,
        delay_js: {
          present: true,
          scripts: [makeDelayScript(), makeDelayScript(), makeDelayScript({ delayed: false })],
          version: '2.0.4',
          delayedScripts: 2
        }
      }
    });
    expect(liveStateOf('javascript', loaded)).toEqual({ text: 'delayed 2/3', tone: 'info' });
    // Feature off (or the whole payload unloaded) = nothing to say.
    expect(
      liveStateOf('javascript', makeFdtData()) // present: false in the empty baseline
    ).toBeNull();
  });

  it("counts a verified simulation's delay inventory (not served, runtime on page)", () => {
    const delay_js = {
      present: false,
      scripts: [makeDelayScript(), makeDelayScript({ delayed: false })],
      version: null,
      delayedScripts: 1
    };
    const rows = (simulation?: 'simulated' | 'unverified') =>
      makeFdtData({
        wprDetections: {
          ...makeFdtData().wprDetections,
          delay_js: simulation === undefined ? delay_js : { ...delay_js, simulation }
        }
      });
    expect(liveStateOf('javascript', rows('simulated'))).toEqual({
      text: 'delayed 1/2',
      tone: 'info'
    });
    expect(liveStateOf('javascript', rows('unverified'))).toBeNull();
    expect(liveStateOf('javascript', rows())).toBeNull();
  });

  it('marks cut lists as a floor ("5,000+") and never shows delayed > shown unmarked', () => {
    const base = makeFdtData().wprDetections;
    const many = (n: number) => Array.from({ length: n }, () => makeDelayScript());
    const delay = (scripts: number, delayedScripts: number, truncated?: true) =>
      makeFdtData({
        wprDetections: {
          ...base,
          delay_js: {
            present: true,
            scripts: many(scripts),
            version: null,
            delayedScripts,
            ...(truncated ? { truncated } : {})
          }
        }
      });
    expect(liveStateOf('javascript', delay(5000, 6000, true))?.text).toBe('delayed 6,000/5,000+');
    // No mark but a count over the shown list: still marked, never "6/5".
    expect(liveStateOf('javascript', delay(5, 6))?.text).toBe('delayed 6/5+');
    expect(liveStateOf('javascript', delay(5, 5))?.text).toBe('delayed 5/5');

    const lazy = makeFdtData({
      wprDetections: {
        ...base,
        lazyload: {
          present: true,
          images: Array.from({ length: 5000 }, () => makeLazyImage()),
          truncated: true
        }
      }
    });
    expect(liveStateOf('lazyload', lazy)?.text).toBe('5,000+ images');

    const links = makeFdtData({
      preloadedResources: {
        present: true,
        resources: Array.from({ length: 5000 }, () => ({ href: '/x', type: 'script' })),
        truncated: true
      }
    });
    expect(liveStateOf('preloaded-resources', links)?.text).toBe('5,000+ links');
  });

  it('keeps plain counts when the mark only means clipped strings (list under its cap)', () => {
    const base = makeFdtData().wprDetections;
    const clippedImages = makeFdtData({
      wprDetections: {
        ...base,
        lazyload: { present: true, images: [makeLazyImage(), makeLazyImage()], truncated: true }
      }
    });
    expect(liveStateOf('lazyload', clippedImages)?.text).toBe('2 images');
    const oneLink = makeFdtData({
      preloadedResources: {
        present: true,
        resources: [{ href: '/x', type: 'image' }],
        truncated: true
      }
    });
    expect(liveStateOf('preloaded-resources', oneLink)?.text).toBe('1 link');
    const clippedDelay = makeFdtData({
      wprDetections: {
        ...base,
        delay_js: {
          present: true,
          scripts: [makeDelayScript()],
          version: null,
          delayedScripts: 1,
          truncated: true
        }
      }
    });
    expect(liveStateOf('javascript', clippedDelay)?.text).toBe('delayed 1/1');
  });

  it('distinguishes monitoring from found on the references row', () => {
    // Nothing found while the page still loads = the finder is watching.
    expect(liveStateOf('undefined-references', makeFdtData({ allScriptsLoaded: false }))).toEqual({
      text: 'Monitoring',
      tone: 'neutral'
    });
    // A settled-clean page is silence.
    expect(liveStateOf('undefined-references', makeFdtData({ allScriptsLoaded: true }))).toBeNull();
    // A finding is amber attention with its count.
    expect(
      liveStateOf(
        'undefined-references',
        makeFdtData({ allScriptsLoaded: true, undefinedReferencesOnPage: ['jQuery'] })
      )
    ).toEqual({ text: '1 found', tone: 'warn' });
  });

  it('counts image counts only while lazyload is active', () => {
    const loaded = makeFdtData({
      wprDetections: {
        ...makeFdtData().wprDetections,
        lazyload: { present: true, images: [makeLazyImage(), makeLazyImage()] }
      }
    });
    expect(liveStateOf('lazyload', loaded)).toEqual({ text: '2 images', tone: 'info' });
    expect(
      liveStateOf('lazyload', {
        ...loaded,
        wprDetections: {
          ...loaded.wprDetections,
          lazyload: { present: true, images: [] }
        }
      })
    ).toEqual({ text: 'No images', tone: 'neutral' });
    // Feature absent = the nav does not speculate about counts.
    expect(liveStateOf('lazyload', makeFdtData())).toBeNull();
  });

  it('counts preloaded links only when an inventory was collected', () => {
    const collected = makeFdtData({
      preloadedResources: {
        present: true,
        resources: [
          { href: '/x.css', type: 'style' },
          { href: '/y.js', type: 'script' }
        ]
      }
    });
    expect(liveStateOf('preloaded-resources', collected)).toEqual({
      text: '2 links',
      tone: 'info'
    });
    expect(
      liveStateOf('preloaded-resources', {
        ...collected,
        preloadedResources: { present: true, resources: [] }
      })
    ).toEqual({ text: 'None', tone: 'neutral' });
    // Present without a collected list (unknown) and absent both stay silent.
    expect(liveStateOf('preloaded-resources', makeFdtData())).toBeNull();
    expect(
      liveStateOf('preloaded-resources', { ...collected, preloadedResources: { present: true } })
    ).toBeNull();
  });

  it('leaves the overview and reserved rows stateless', () => {
    // The Overview row never duplicates the first-paint status-bar answers;
    // reserved rows say nothing until the pages return.
    expect(navRoute('detections')?.liveState).toBeUndefined();
    expect(navRoute('diagnoser')?.liveState).toBeUndefined();
  });
});

describe('PAGES', () => {
  it('has one body per registry row — no route without a page', () => {
    expect(Object.keys(PAGES).sort()).toEqual([...ROUTE_IDS].sort());
  });

  it('defaults to the first registry route', () => {
    expect(DEFAULT_ROUTE).toBe('detections');
  });
});
