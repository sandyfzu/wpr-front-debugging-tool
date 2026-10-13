/**
 * The nav's render tests: the registry's full row set (one element per
 * row), the icon rail's class anatomy (no container variants — the rail is
 * the form at every width), real anchor links with `aria-current`, the
 * reserved row explained by its tooltip, and live state resolving from the
 * row's own selector into that tooltip — including the throw-containment
 * that keeps a registry bug from taking the nav down.
 *
 * Idiom note: unlike the tooltip's own tests (which import fresh per test
 * to pin exact open delays), these imports stay static — the lucide-heavy
 * module graph hangs under `vi.resetModules()` re-imports, and the asserted
 * open paths need no exact delay pinning: focus opens immediately, and the
 * hover test advances 350ms, which holds for both a normal open and the
 * earlier one a warm-up skip window produces.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteId } from '../routes';
import type { FdtData, WprDetections } from '../../../lib/wp-rocket/types';
import { makeFdtData } from '../state/fixtures';
import { createSignal } from 'solid-js';
import Rocket from 'lucide-solid/icons/rocket';
import { AdaptiveNav, groupedRoutes, resolveLiveState } from './adaptive-nav';
import type { NavLiveStateSelector, NavRoute } from '../routes';

afterEach(() => {
  cleanup();
});

/** A minimal contract-shaped record for one delayed script. */
const DELAYED_RECORD: WprDetections['delay_js']['scripts'][number] = {
  inline: false,
  src: '/delayed.js',
  delayed: true,
  deferred: false,
  deferredByWPR: false,
  fdtExcluded: null
};

/** A minimal contract-shaped record for one lazyloaded image. */
const IMAGE_RECORD: WprDetections['lazyload']['images'][number] = {
  src: '/a.jpg',
  lazyloadDetected: true,
  excludedReasonsFound: []
};

/** Render the nav over signal accessors, returning the data side for updates. */
function renderNav(options?: { route?: RouteId; data?: FdtData | null }) {
  const [route, setRoute] = createSignal<RouteId>(options?.route ?? 'detections');
  const [data, setData] = createSignal<FdtData | null>(options?.data ?? null);
  render(() => <AdaptiveNav route={route} data={data} />);
  return { setRoute, setData };
}

describe('AdaptiveNav structure', () => {
  it('renders the registry as one nav: four named group lists, every row once', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'WPR FDT pages' });
    expect(document.querySelectorAll('nav')).toHaveLength(1); // never two trees
    expect(screen.getAllByRole('list')).toHaveLength(3); // Overview · Inspect · Diagnose (Tools is empty — no rows yet)
    expect(screen.getByRole('list', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Inspect' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Diagnose' })).toBeTruthy();
    for (const id of [
      'detections',
      'javascript',
      'lazyload',
      'preloaded-resources',
      'undefined-references'
    ]) {
      expect(nav.querySelector(`a[href="#/${id}"]`)).not.toBeNull();
    }
    // State-free rows (null data keeps the live states silent) carry their
    // bare labels as accessible names.
    expect(screen.getByRole('link', { name: 'Detections' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'JavaScript' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Diagnoser' })).toBeTruthy();
  });

  it('is the icon rail at every width (the classes carry no container variants)', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'WPR FDT pages' });
    // The rail anatomy, the only form: a column of square rows.
    expect(nav.className).toContain('flex-col');
    // The rail is not width-adaptive — no container-query variants survive
    // in any rendered class (the top-bar form is retired).
    expect(nav.className).not.toContain('@min-');
    // Group separation: hairlines under every group except the first.
    const groups = [...nav.querySelectorAll('[data-fdt-nav-group]')];
    // Empty groups (Tools, today) stay out of the DOM: a stranded separator
    // over nothing would be noise, not scent.
    expect(groups).toHaveLength(3);
    expect(nav.textContent).not.toContain('Tools');
    expect(groups[0]?.className).toContain('first:border-t-0');
    expect(groups[1]?.className).toContain('border-t');
    const firstList = screen.getByRole('list', { name: 'Overview' });
    expect(firstList.className).toContain('flex-col');
    expect(firstList.className).not.toContain('@min-');
  });

  it('rows stay real hash links with aria-current riding the route', async () => {
    const { setRoute } = renderNav({ route: 'detections' });
    const detections = screen.getByRole('link', { name: 'Detections' });
    expect(detections.getAttribute('href')).toBe('#/detections');
    expect(detections.getAttribute('type')).toBeNull(); // Kobalte's button `type` never leaks onto anchors
    expect(detections.getAttribute('aria-current')).toBe('page');
    const javascript = screen.getByRole('link', { name: 'JavaScript' });
    expect(javascript.getAttribute('aria-current')).toBeNull();

    setRoute('javascript');
    await Promise.resolve(); // one flush for the tracked attribute effects
    expect(detections.getAttribute('aria-current')).toBeNull();
    expect(javascript.getAttribute('aria-current')).toBe('page');
  });

  it('groups the registry rows in the declared journey order', () => {
    // The explicit grouping table keeps the registry and the DOM in step as
    // future rows land (each group's render order = the registry's).
    expect(groupedRoutes().map((entry) => entry.group)).toEqual([
      'Overview',
      'Inspect',
      'Diagnose',
      'Tools'
    ]);
    expect(groupedRoutes().flatMap((entry) => entry.rows.map((row) => row.id))).toEqual([
      'detections',
      'javascript',
      'lazyload',
      'preloaded-resources',
      'undefined-references',
      'diagnoser'
    ]);
  });
});

describe('AdaptiveNav reserved row', () => {
  it('renders disabled and explains itself on hover', () => {
    vi.useFakeTimers();
    try {
      renderNav();
      const reserved = screen.getByRole('button', { name: 'Diagnoser' });
      expect(reserved.getAttribute('disabled')).not.toBeNull();
      // No anchor form for a reserved row — it must not open a page that
      // does not exist.
      expect(reserved.closest('a')).toBeNull();
      expect(screen.queryByRole('tooltip')).toBeNull();
      fireEvent.pointerEnter(reserved);
      vi.advanceTimersByTime(350);
      const content = screen.getByRole('tooltip');
      expect(content.textContent).toContain('Returns with the Diagnoser plugin v2');
      expect(reserved.getAttribute('aria-describedby')).toBe(content.id);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AdaptiveNav live state', () => {
  /** A synthetic registry row for the containment probes. */
  const probeRow = (liveState?: NavLiveStateSelector): NavRoute => ({
    id: 'detections',
    label: 'Detections',
    icon: Rocket,
    group: 'Overview',
    liveState
  });

  it('declines silently with no selector at all (the without-state rows)', () => {
    // A row without a selector resolves to null without calling anything,
    // and null data stays inside the selector's own call contract.
    expect(resolveLiveState(probeRow(), makeFdtData())).toBeNull();
    expect(
      resolveLiveState(
        probeRow(() => null),
        null
      )
    ).toBeNull();
  });

  it('contains a throwing selector to its own row and names it in the log', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const probe = probeRow(() => {
        throw new Error('bad registry selector');
      });
      expect(resolveLiveState(probe, makeFdtData())).toBeNull();
      expect(
        error.mock.calls.some((call) => call.join(' ').includes('Nav live-state selector failed'))
      ).toBe(true);
      expect(error.mock.calls[0]?.[1]).toEqual({
        row: 'detections',
        cause: { message: 'bad registry selector' }
      });
      // The containment is per-call, never poisoned: the same row resolves
      // normally once healthy again.
      expect(
        resolveLiveState(
          probeRow(() => ({ text: 'ok', tone: 'neutral' })),
          makeFdtData()
        )
      ).toEqual({ text: 'ok', tone: 'neutral' });
    } finally {
      error.mockRestore();
    }
  });
  it('carries the loaded page’s counts as badges inside the rows’ tooltips', () => {
    const wpr = makeFdtData().wprDetections;
    renderNav({
      data: makeFdtData({
        allScriptsLoaded: true,
        wprDetections: {
          ...wpr,
          delay_js: {
            present: true,
            scripts: [DELAYED_RECORD, DELAYED_RECORD, { ...DELAYED_RECORD, delayed: false }],
            version: '2.0.4',
            delayedScripts: 2
          },
          lazyload: { present: true, images: [IMAGE_RECORD, IMAGE_RECORD] }
        }
      })
    });
    // The live state's only surface is the row's tooltip (icon rail):
    const js = screen.getByRole('link', { name: 'JavaScript' });
    fireEvent.focus(js);
    const jsTooltip = screen.getByRole('tooltip');
    expect(jsTooltip.textContent).toContain('delayed 2/3');
    // The badge speaks the shared status vocabulary.
    expect(
      jsTooltip
        .querySelector('[data-fdt="status-badge"]')
        ?.classList.contains('bg-status-info-soft')
    ).toBe(true);

    // A second row's state, its own render (a closed tooltip lingers for its
    // close delay — one opened tooltip per render keeps the query singular).
    cleanup();
    renderNav({
      data: makeFdtData({
        allScriptsLoaded: true,
        wprDetections: {
          ...wpr,
          lazyload: { present: true, images: [IMAGE_RECORD, IMAGE_RECORD] }
        }
      })
    });
    fireEvent.focus(screen.getByRole('link', { name: 'Lazyload' }));
    const lazyTooltip = screen.getByRole('tooltip');
    expect(lazyTooltip.textContent).toContain('2 images');

    // A third render for the silence case: a row whose selector declines —
    // the preloaded feature present without a collected inventory is the
    // selector's own "never a number that is not known" branch — answers
    // silence at the render level too: its tooltip carries the label and no
    // badge.
    cleanup();
    renderNav({
      data: makeFdtData({
        allScriptsLoaded: true,
        preloadedResources: { present: true }
      })
    });
    fireEvent.focus(screen.getByRole('link', { name: 'Preloaded Resources' }));
    const silentTooltip = screen.getByRole('tooltip');
    expect(silentTooltip.textContent).toContain('Preloaded Resources');
    expect(silentTooltip.querySelector('[data-fdt="status-badge"]')).toBeNull();
  });

  it('distinguishes monitoring from found on the references row', () => {
    renderNav({ data: makeFdtData({ allScriptsLoaded: false }) });
    // Nothing found while the page still loads = the finder is watching.
    fireEvent.focus(screen.getByRole('link', { name: 'Undefined References' }));
    expect(
      screen
        .getByRole('tooltip')
        .querySelector('[data-fdt="status-badge"]')
        ?.classList.contains('bg-status-neutral-soft')
    ).toBe(true);

    cleanup();
    renderNav({
      data: makeFdtData({ allScriptsLoaded: true, undefinedReferencesOnPage: ['jQuery'] })
    });
    fireEvent.focus(screen.getByRole('link', { name: 'Undefined References' }));
    expect(
      screen
        .getByRole('tooltip')
        .querySelector('[data-fdt="status-badge"]')
        ?.classList.contains('bg-status-warn-soft')
    ).toBe(true);
  });

  it('opens a row tooltip carrying the full label and the live state (the rail’s naming surface)', () => {
    const wpr = makeFdtData().wprDetections;
    renderNav({
      data: makeFdtData({
        allScriptsLoaded: true,
        wprDetections: {
          ...wpr,
          delay_js: {
            present: true,
            scripts: [DELAYED_RECORD],
            version: '2.0.4',
            delayedScripts: 1
          }
        }
      })
    });
    const trigger = screen.getByRole('link', { name: /JavaScript/ });
    fireEvent.focus(trigger);
    const content = screen.getByRole('tooltip');
    expect(content.textContent).toContain('JavaScript');
    expect(content.textContent).toContain('delayed 1/1');
    expect(trigger.getAttribute('aria-describedby')).toBe(content.id);
  });
});
