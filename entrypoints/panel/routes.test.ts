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
  it('lists the six rows in the journey order', () => {
    expect(NAV_ROUTES.map((row) => row.id)).toEqual([
      'detections',
      'javascript',
      'lazyload',
      'preloaded-resources',
      'undefined-references',
      'diagnoser'
    ]);
    expect(NAV_ROUTES.map((row) => row.group)).toEqual([
      'Overview',
      'Inspect',
      'Inspect',
      'Inspect',
      'Diagnose',
      'Diagnose'
    ]);
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
