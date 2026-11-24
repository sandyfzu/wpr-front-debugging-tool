/**
 * The nav's render tests: the registry's full row set (one element per
 * row), the icon rail's class anatomy (no container variants — the rail is
 * the form at every width), real anchor links with `aria-current`, and live
 * state resolving from the row's own selector into the row's tooltip — including the throw-containment
 * that keeps a registry bug from taking the nav down.
 *
 * The overflow affordance tests drive the measure seam with synthetic rail
 * geometries (real-rect geometry is the browser tier's `panel-nav` suite):
 * the slice must hide exactly the rows past the fit line, hold them in the
 * "More pages" menu as full citizens, keep the rail DOM scroll-free, and
 * contain an untruthful measurement instead of re-deciding from it.
 *
 * Idiom note: unlike the tooltip's own tests (which import fresh per test
 * to pin exact open delays), these imports stay static — the lucide-heavy
 * module graph hangs under `vi.resetModules()` re-imports, and the asserted
 * open paths need no exact delay pinning: focus opens immediately, and the
 * hover test advances 350ms, which holds for both a normal open and the
 * earlier one a warm-up skip window produces.
 */
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteId } from '../routes';
import type { FdtData, WprDetections } from '../../../lib/wp-rocket/types';
import { makeFdtData } from '../state/fixtures';
import { createSignal } from 'solid-js';
import Rocket from 'lucide-solid/icons/rocket';
import { AdaptiveNav, groupedRoutes } from './adaptive-nav';
import { OVERFLOW_TRIGGER_LABEL } from './overflow-nav';
import { resolveLiveState } from './row-note';
import { NAV_MIRROR_ROW_ATTR, type RailMeasureFn, type RailWatchFn } from './rail-metrics';
import type { RailRowBox } from './visible-rows';
import type { NavLiveStateSelector, NavRoute } from '../routes';
import type { NavForm } from '../../../lib/panel/nav-mode';

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
  fdtExcluded: null,
  minifyAttribute: false
};

/** A minimal contract-shaped record for one lazyloaded image. */
const IMAGE_RECORD: WprDetections['lazyload']['images'][number] = {
  src: '/a.jpg',
  lazyloadDetected: true,
  excludedReasonsFound: []
};

/** Render the nav over signal accessors, returning the setters for updates. */
function renderNav(options?: {
  route?: RouteId;
  data?: FdtData | null;
  form?: NavForm;
  measure?: RailMeasureFn;
  watch?: RailWatchFn;
}) {
  const [route, setRoute] = createSignal<RouteId>(options?.route ?? 'detections');
  const [data, setData] = createSignal<FdtData | null>(options?.data ?? null);
  const [form, setForm] = createSignal<NavForm>(options?.form ?? 'rail');
  render(() => (
    <AdaptiveNav
      route={route}
      data={data}
      form={form}
      measure={options?.measure}
      watch={options?.watch}
    />
  ));
  return { setRoute, setData, setForm };
}

/** The never-resizing watch: the tests drive resizes through their own seam when needed. */
function staticWatch(): RailWatchFn {
  return () => () => undefined;
}

/**
 * The synthetic rail's layout: the shipped anatomy (32px rows, 4px list
 * gaps, 13px group leads; Overview 0 / Inspect + 13 / Diagnose + 13 / Tools + 13,
 * browser-measured) over every registry row — the same numbers the pure
 * tests pin, so both tiers describe one geometry.
 */
function layoutRows(): readonly RailRowBox[] {
  return [
    { route: 'detections', top: 0, height: 32 },
    { route: 'javascript', top: 45, height: 32 },
    { route: 'stylesheets', top: 81, height: 32 },
    { route: 'lazyload', top: 117, height: 32 },
    { route: 'preloaded-resources', top: 153, height: 32 },
    { route: 'headers-cookies', top: 189, height: 32 },
    { route: 'undefined-references', top: 234, height: 32 },
    { route: 'rucss-tester', top: 279, height: 32 },
    { route: 'beacon-tester', top: 315, height: 32 },
    { route: 'lcp-vitals', top: 351, height: 32 }
  ] as const;
}

interface SyntheticRail {
  /**
   * The measure seam measuring the real registry layout with the current
   * height.
   */
  measure: RailMeasureFn;
  /** The never-firing watch (tests resize through {@link resize} instead). */
  watch: RailWatchFn;
  /**
   * The nav's own re-decide callback, recorded by the watch at mount —
   * mutable-height "resizes" land through it, exactly the production order.
   */
  refire: { current: (() => void) | null };
  /** The current available height (the test mutates this per "resize"). */
  height: { value: number };
  /** Mutate the height then re-fire the nav's measurement, in DOM order. */
  resize: (next: number) => void;
  /** A failed measurement: whenever set, the answer is untruthful. */
  broken: { value: boolean };
}

/**
 * Build the synthetic measure/watch pair over the shipped layout. The
 * height starts wherever the test puts it and mutates through
 * {@link SyntheticRail.resize}; a `broken.value` answer mimics the seam's
 * "not measurable" report.
 *
 * @param initialHeight The height the first boot measurement reports.
 */
function syntheticRail(initialHeight: number): SyntheticRail {
  const layout = layoutRows();
  const state = {
    height: { value: initialHeight },
    broken: { value: false },
    refire: { current: null as (() => void) | null }
  };
  const rail: SyntheticRail = {
    measure: () => {
      if (state.broken.value) return null;
      return { rows: layout, availableHeight: state.height.value };
    },
    watch: (_rail, decide) => {
      state.refire.current = decide;
      return () => undefined;
    },
    refire: state.refire,
    height: state.height,
    broken: state.broken,
    resize: (next: number) => {
      state.height.value = next;
      // The resize path: the watcher's callback runs the nav's re-decide —
      // exactly the production order.
      state.refire.current?.();
    }
  };
  return rail;
}

describe('AdaptiveNav structure', () => {
  it('renders the registry as one nav: four named group lists, every row a link once', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'WPR FDT pages' });
    expect(document.querySelectorAll('nav')).toHaveLength(1); // never two trees
    expect(screen.getAllByRole('list')).toHaveLength(4); // Overview · Inspect · Diagnose · Tools
    expect(screen.getByRole('list', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Inspect' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Diagnose' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Tools' })).toBeTruthy();
    for (const id of [
      'detections',
      'javascript',
      'stylesheets',
      'lazyload',
      'preloaded-resources',
      'headers-cookies',
      'undefined-references',
      'rucss-tester',
      'beacon-tester',
      'lcp-vitals'
    ]) {
      expect(nav.querySelector(`a[href="#/${id}"]`)).not.toBeNull();
    }
    // State-free rows (null data keeps the live states silent) carry their
    // bare labels as accessible names.
    expect(screen.getByRole('link', { name: 'Detections' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'JavaScript' })).toBeTruthy();
    // Every registry row is navigable: no disabled control sits in the rail.
    expect(nav.querySelectorAll('button[disabled]')).toHaveLength(0);
  });

  it('is the icon rail at every width (the classes carry no container variants)', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'WPR FDT pages' });
    // The rail anatomy, the only form: a column of square rows.
    expect(nav.className).toContain('flex-col');
    // The rail is not width-adaptive — no container-query variants survive
    // in any rendered class (the top-bar form is retired).
    expect(nav.className).not.toContain('@min-');
    // Group separation: hairlines under every group except the first, each
    // with symmetric breathing space (mt-1.5 above = pt-1.5 below; never
    // flush under the previous row's hover box — the owner-report decision).
    const groups = [...nav.querySelectorAll('[data-fdt-nav-group]')];
    // One separated block per group with rows (an empty group stays out of
    // the DOM: a stranded separator over nothing would be noise, not scent).
    expect(groups).toHaveLength(4);
    expect(groups[0]?.className).toContain('first:border-t-0');
    expect(groups[0]?.className).toContain('first:mt-0');
    expect(groups[1]?.className).toContain('border-t');
    expect(groups[1]?.className).toContain('mt-1.5');
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
      'stylesheets',
      'lazyload',
      'preloaded-resources',
      'headers-cookies',
      'undefined-references',
      'rucss-tester',
      'beacon-tester',
      'lcp-vitals'
    ]);
  });
});

describe('AdaptiveNav row tooltip', () => {
  it('opens on hover with the row’s label, described by the anchor', () => {
    vi.useFakeTimers();
    try {
      renderNav();
      const row = screen.getByRole('link', { name: 'Stylesheets' });
      expect(screen.queryByRole('tooltip')).toBeNull();
      fireEvent.pointerEnter(row);
      vi.advanceTimersByTime(350);
      const content = screen.getByRole('tooltip');
      expect(content.textContent).toBe('Stylesheets');
      expect(row.getAttribute('aria-describedby')).toBe(content.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries the shared hover treatment on every non-active row', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'WPR FDT pages' });
    const hover = (element: Element): string[] =>
      element.className.split(/\s+/).filter((token) => token.startsWith('hover:'));
    const rows = [...nav.querySelectorAll('a[href^="#/"]:not([aria-current])')];
    expect(rows).toHaveLength(9); // every row but the active Detections
    for (const row of rows) {
      expect(hover(row)).toEqual(['hover:bg-surface-3', 'hover:text-fg-primary']);
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
    fireEvent.focus(screen.getByRole('link', { name: 'LazyLoad' }));
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

describe('AdaptiveNav overflow — the geometry stub', () => {
  it('renders the full-layout stub exactly once per registry row, aria-hidden and inert', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'WPR FDT pages' });
    const stubRows = [...nav.querySelectorAll(`[${NAV_MIRROR_ROW_ATTR}]`)] as HTMLElement[];
    expect(stubRows).toHaveLength(10); // every registry row, in order
    expect(stubRows.map((row) => row.getAttribute(NAV_MIRROR_ROW_ATTR))).toEqual([
      'detections',
      'javascript',
      'stylesheets',
      'lazyload',
      'preloaded-resources',
      'headers-cookies',
      'undefined-references',
      'rucss-tester',
      'beacon-tester',
      'lcp-vitals'
    ]);
    const mirror = nav.querySelector('[data-fdt="panel-nav-mirror"]');
    expect(mirror?.getAttribute('aria-hidden')).toBe('true');
    // No semantic element inside the stub: pointers and focus never land on
    // invented geometry (plain divs only).
    expect(mirror?.querySelectorAll('a, button, [tabindex]')).toHaveLength(0);
  });

  it('the rail stays scroll-free (overflow-hidden; the stub rides clipped)', () => {
    renderNav({ measure: syntheticRail(230).measure, watch: staticWatch() });
    const nav = screen.getByRole('navigation', { name: 'WPR FDT pages' });
    // The rail never becomes a scroll container: overflow hidden on both axes.
    expect(nav.className).toContain('overflow-hidden');
    expect(nav.className).not.toContain('overflow-y-auto');
    expect(nav.className).toContain('relative'); // the stub's positioning anchor
  });
});

describe('AdaptiveNav overflow — the slice', () => {
  it('boots full-visibility: an unmeasured rail never hides its rows', () => {
    // Layout-less (untruthful) geometry: the rail keeps its unmeasured
    // full-visibility state — no rows vanish, no trigger appears.
    renderNav({ measure: () => null, watch: staticWatch() });
    expect(screen.getByRole('link', { name: 'Detections' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Preloaded Resources' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'LCP & Vitals' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: OVERFLOW_TRIGGER_LABEL })).toBeNull();
  });

  it('slices at the fit line: the rail keeps the prefix, the trigger appears for the suffix', () => {
    // 90px available: Detections (0..32) and JavaScript (45..77) fit; Lazyload
    // (81..113) is the first row past the line.
    renderNav({ measure: syntheticRail(90).measure, watch: staticWatch() });
    const nav = screen.getByRole('navigation', { name: 'WPR FDT pages' });
    expect(nav.querySelector('a[href="#/detections"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#/javascript"]')).not.toBeNull();
    // The suffix is not in the rail’s DOM at all (the rail never renders
    // invisible rows — its content is exactly its visible content).
    expect(nav.querySelector('a[href="#/lazyload"]')).toBeNull();
    expect(nav.querySelector('a[href="#/lcp-vitals"]')).toBeNull();
    // The trigger: the “More pages” affordance.
    expect(screen.getByRole('button', { name: OVERFLOW_TRIGGER_LABEL })).toBeTruthy();
  });

  it('re-slices monotonically as the height steps: rows return and the trigger retires', () => {
    const rail = syntheticRail(40);
    renderNav({ measure: rail.measure, watch: rail.watch });
    /** The real rail's row controls (the menu is closed, so the suffix is away). */
    const railControls = (): number =>
      screen
        .getByRole('navigation', { name: 'WPR FDT pages' })
        .querySelectorAll(
          'a[href="#/detections"], a[href="#/javascript"], a[href="#/stylesheets"], a[href="#/lazyload"], a[href="#/preloaded-resources"], a[href="#/headers-cookies"], a[href="#/undefined-references"], a[href="#/rucss-tester"], a[href="#/beacon-tester"], a[href="#/lcp-vitals"]'
        ).length;
    expect(railControls()).toBe(1); // Detections only
    expect(screen.getByRole('button', { name: OVERFLOW_TRIGGER_LABEL })).toBeTruthy();

    rail.resize(90);
    expect(railControls()).toBe(2); // + JavaScript
    expect(screen.getByRole('button', { name: OVERFLOW_TRIGGER_LABEL })).toBeTruthy();

    rail.resize(9999);
    expect(railControls()).toBe(10); // the full rail back
    expect(screen.queryByRole('button', { name: OVERFLOW_TRIGGER_LABEL })).toBeNull();
  });

  it('cutting past a group’s lead leaves no stranded separator (the group drops out)', () => {
    // 38px ends between Overview's row and the Inspect lead: no later row
    // fits, so the Inspect and Diagnose groups render nothing — the leads
    // and separators included (lead spans 32..45).
    renderNav({
      measure: () => ({ rows: layoutRows(), availableHeight: 38 }),
      watch: staticWatch()
    });
    const nav = screen.getByRole('navigation', { name: 'WPR FDT pages' });
    expect(nav.querySelectorAll('[data-fdt-nav-group]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: OVERFLOW_TRIGGER_LABEL })).toBeTruthy();
  });

  it('a mid-group cut keeps the group (with its lead) for the rows that still fit', () => {
    renderNav({ measure: syntheticRail(90).measure, watch: staticWatch() });
    const nav = screen.getByRole('navigation', { name: 'WPR FDT pages' });
    const inspect = [...nav.querySelectorAll('[data-fdt-nav-group]')][1];
    expect(inspect?.querySelector('a[href="#/javascript"]')).not.toBeNull();
    expect(inspect?.querySelector('a[href="#/lazyload"]')).toBeNull();
  });

  it('an untruthful re-measurement after a slice keeps the previous slice (contained)', () => {
    const rail = syntheticRail(90);
    renderNav({ measure: rail.measure, watch: rail.watch });
    expect(screen.getByRole('button', { name: OVERFLOW_TRIGGER_LABEL })).toBeTruthy();

    rail.broken.value = true; // the seam reports “not measurable”
    rail.resize(5000); // the watch refires into the failure
    // The rail keeps its slice (two visible rows + the trigger); nothing
    // crashes, nothing silently jumps back to full visibility.
    expect(screen.getByRole('button', { name: OVERFLOW_TRIGGER_LABEL })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'JavaScript' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'LazyLoad' })).toBeNull();
  });

  it('fits exactly at the boundary: every row stays (the trigger never appears)', () => {
    renderNav({ measure: syntheticRail(383).measure, watch: staticWatch() });
    expect(screen.queryByRole('button', { name: OVERFLOW_TRIGGER_LABEL })).toBeNull();
    expect(screen.getByRole('link', { name: 'LCP & Vitals' })).toBeTruthy();
  });

  it('one pixel short of the boundary, the last row leaves for the trigger', () => {
    renderNav({ measure: syntheticRail(382).measure, watch: staticWatch() });
    expect(screen.getByRole('button', { name: OVERFLOW_TRIGGER_LABEL })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'LCP & Vitals' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Beacon Tester' })).toBeTruthy();
  });
});

describe('AdaptiveNav overflow — the “More pages” menu', () => {
  /** Click the trigger open (Kobalte's trigger path: pointer down toggles). */
  function openMenu(): void {
    fireEvent.pointerDown(screen.getByRole('button', { name: OVERFLOW_TRIGGER_LABEL }));
  }

  it('lists the hidden rows as full anchor menu items with hrefs', async () => {
    renderNav({ measure: syntheticRail(90).measure, watch: staticWatch() });
    openMenu();
    const menu = await screen.findByRole('menu');
    for (const [label, href] of [
      ['Stylesheets', '#/stylesheets'],
      ['LazyLoad', '#/lazyload'],
      ['Preloaded Resources', '#/preloaded-resources'],
      ['Headers & Cookies', '#/headers-cookies'],
      ['Undefined References', '#/undefined-references'],
      ['RUCSS Tester', '#/rucss-tester'],
      ['Beacon Tester', '#/beacon-tester'],
      ['LCP & Vitals', '#/lcp-vitals']
    ] as const) {
      const item = within(menu).getByRole('menuitem', { name: label });
      expect(item.getAttribute('href')).toBe(href);
    }
    // Exactly the hidden suffix: every item is an enabled link.
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(8);
    expect(items.every((item) => item.getAttribute('aria-disabled') !== 'true')).toBe(true);
  });

  it('puts a separator exactly where the hidden rows change group', async () => {
    renderNav({ measure: syntheticRail(90).measure, watch: staticWatch() });
    openMenu();
    const menu = await screen.findByRole('menu');
    // Hidden rows span Inspect (4) + Diagnose (1) + Tools (3): two
    // separators, and no group captions (the rail shows none either).
    expect(within(menu).getAllByRole('separator')).toHaveLength(2);
  });

  it('carries the hidden active row’s `aria-current` on its menu item', async () => {
    renderNav({ route: 'lazyload', measure: syntheticRail(90).measure, watch: staticWatch() });
    openMenu();
    const menu = await screen.findByRole('menu');
    expect(
      within(menu).getByRole('menuitem', { name: 'LazyLoad' }).getAttribute('aria-current')
    ).toBe('page');
    // The non-active hidden rows carry none.
    expect(
      within(menu)
        .getByRole('menuitem', { name: 'Preloaded Resources' })
        .getAttribute('aria-current')
    ).toBeNull();
  });

  it('carries the hidden rows’ live-state chips inline (the same data the rail resolves)', async () => {
    renderNav({
      data: makeFdtData({ allScriptsLoaded: true, undefinedReferencesOnPage: ['jQuery'] }),
      measure: syntheticRail(38).measure,
      watch: staticWatch()
    });
    openMenu();
    const menu = await screen.findByRole('menu');
    const item = within(menu).getByRole('menuitem', { name: /Undefined References/ });
    expect(
      item.querySelector('[data-fdt="status-badge"]')?.classList.contains('bg-status-warn-soft')
    ).toBe(true);
  });

  it('the trigger carries the APG menu trigger state (haspopup + live-expanded)', async () => {
    renderNav({ measure: syntheticRail(90).measure, watch: staticWatch() });
    const trigger = screen.getByRole('button', { name: OVERFLOW_TRIGGER_LABEL });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    openMenu();
    await screen.findByRole('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('the closed affordance renders no tooltip surface of its own', () => {
    renderNav({ measure: syntheticRail(90).measure, watch: staticWatch() });
    // The rail’s tooltips are the only hover surface while the menu is
    // closed; the menu rows carry their own labeling inline.
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('AdaptiveNav labeled form', () => {
  /** Loaded data with delay JS on the page, two lazy images and three headers. */
  function richData(): FdtData {
    const wpr = makeFdtData().wprDetections;
    return makeFdtData({
      allScriptsLoaded: false,
      pageHeaders: [
        { name: 'server', value: 'Apache' },
        { name: 'x-cache', value: 'HIT' },
        { name: 'age', value: '3' }
      ],
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
    });
  }

  /** The labeled anchor of a route. */
  function labeledRow(label: string): HTMLAnchorElement {
    return screen.getByRole<HTMLAnchorElement>('link', { name: label });
  }

  it('shows each group caption and every label, named by the label alone', () => {
    renderNav({ form: 'labeled' });
    const nav = screen.getByRole('navigation', { name: 'WPR FDT pages' });
    expect(nav.getAttribute('data-fdt-nav-form')).toBe('labeled');
    const captions = [
      ...nav.querySelectorAll('[data-fdt-nav-group] [data-fdt="panel-nav-caption"]')
    ];
    expect(captions.map((caption) => caption.textContent)).toEqual([
      'Overview',
      'Inspect',
      'Diagnose',
      'Tools'
    ]);
    // Captions are visual: the lists keep their own names.
    expect(captions.every((caption) => caption.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(screen.getByRole('list', { name: 'Inspect' })).toBeTruthy();
    const js = labeledRow('JavaScript');
    expect(js.textContent).toBe('JavaScript');
    expect(js.getAttribute('href')).toBe('#/javascript');
    // No tooltip machinery on labeled rows (the label is visible).
    expect(js.getAttribute('data-fdt')).not.toBe('tooltip-trigger');
    fireEvent.focus(js);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('puts each note in the right column: short figure, full phrase as description', () => {
    renderNav({ form: 'labeled', data: richData() });
    const cases = [
      ['JavaScript', '2/3', 'delayed 2/3'],
      ['LazyLoad', '2', '2 images'],
      ['Headers & Cookies', '3', '3 headers']
    ] as const;
    for (const [label, short, phrase] of cases) {
      const row = labeledRow(label);
      const note = row.querySelector('[data-fdt="panel-nav-note"]');
      expect(note?.textContent, label).toBe(short);
      expect(note?.getAttribute('aria-hidden')).toBe('true');
      const described = document.getElementById(row.getAttribute('aria-describedby') ?? '');
      expect(described?.textContent, label).toBe(phrase);
      expect(described?.hidden).toBe(true);
      expect(row.title).toBe(`${label} · ${phrase}`);
    }
    // A row with nothing to say has no note and no description.
    const stylesheets = labeledRow('Stylesheets');
    expect(stylesheets.querySelector('[data-fdt="panel-nav-note"]')).toBeNull();
    expect(stylesheets.hasAttribute('aria-describedby')).toBe(false);
    expect(stylesheets.title).toBe('Stylesheets');
  });

  it('shows a tone dot for a state without a figure (Monitoring), quiet colors for counts', () => {
    renderNav({ form: 'labeled', data: richData() });
    const references = labeledRow('Undefined References');
    expect(references.querySelector('[data-fdt="panel-nav-note"]')).toBeNull();
    const dot = references.querySelector('span[aria-hidden="true"].rounded-full');
    expect(dot?.classList.contains('text-status-neutral')).toBe(true);
    expect(
      document.getElementById(references.getAttribute('aria-describedby') ?? '')?.textContent
    ).toBe('Monitoring');
    expect(
      labeledRow('Headers & Cookies')
        .querySelector('[data-fdt="panel-nav-note"]')
        ?.classList.contains('text-fg-muted')
    ).toBe(true);
  });

  it('paints a warning count in its status color', () => {
    renderNav({
      form: 'labeled',
      data: makeFdtData({ allScriptsLoaded: true, undefinedReferencesOnPage: ['jQuery', 'wp'] })
    });
    const note = labeledRow('Undefined References').querySelector('[data-fdt="panel-nav-note"]');
    expect(note?.textContent).toBe('2');
    expect(note?.classList.contains('text-status-warn')).toBe(true);
  });

  it('marks the active row with the tint, the accent icon and aria-current', () => {
    const { setRoute } = renderNav({ form: 'labeled', route: 'javascript' });
    const js = labeledRow('JavaScript');
    expect(js.getAttribute('aria-current')).toBe('page');
    expect(js.className).toContain('bg-accent-soft');
    expect(js.querySelector('svg')?.getAttribute('class')).toContain('text-accent');
    setRoute('lazyload');
    expect(js.getAttribute('aria-current')).toBeNull();
    expect(js.className).not.toContain('bg-accent-soft');
    expect(js.querySelector('svg')?.getAttribute('class')).not.toContain('text-accent');
  });

  it('lays the geometry stub out in the labeled form (captions included)', () => {
    renderNav({ form: 'labeled' });
    const mirror = document.querySelector('[data-fdt="panel-nav-mirror"]') as HTMLElement;
    expect(mirror.textContent).toBe('OverviewInspectDiagnoseTools');
    const stubRow = mirror.querySelector(`[${NAV_MIRROR_ROW_ATTR}]`) as HTMLElement;
    expect(stubRow.className).toContain('h-8');
    expect(stubRow.className).toContain('w-full');
  });

  it('switches forms in place and re-measures at once (no stale slice)', () => {
    const rail = syntheticRail(1000);
    const measure = vi.fn(rail.measure);
    const { setForm } = renderNav({ measure, watch: rail.watch });
    const calls = measure.mock.calls.length;
    const before = screen.getByRole('link', { name: 'Detections' });
    setForm('labeled');
    expect(measure.mock.calls.length).toBe(calls + 1);
    const nav = screen.getByRole('navigation', { name: 'WPR FDT pages' });
    expect(nav.getAttribute('data-fdt-nav-form')).toBe('labeled');
    expect(labeledRow('Detections').textContent).toBe('Detections');
    expect(labeledRow('Detections')).not.toBe(before);
    setForm('rail');
    expect(measure.mock.calls.length).toBe(calls + 2);
    expect(nav.querySelector('[data-fdt="panel-nav-caption"]')).toBeNull();
  });

  it('keeps focus on the same route’s row across a form switch, both ways', () => {
    const { setForm } = renderNav({ form: 'labeled' });
    labeledRow('JavaScript').focus();
    setForm('rail');
    const railRow = screen.getByRole('link', { name: 'JavaScript' });
    expect(railRow.getAttribute('data-fdt')).toBe('tooltip-trigger');
    expect(document.activeElement).toBe(railRow);
    setForm('labeled');
    expect(document.activeElement).toBe(labeledRow('JavaScript'));
    // An unfocused nav takes no focus on a switch.
    (document.activeElement as HTMLElement).blur();
    setForm('rail');
    expect(document.activeElement).toBe(document.body);
  });

  it('offers the overflow as a labeled row with the hidden count', async () => {
    renderNav({ form: 'labeled', measure: syntheticRail(90).measure, watch: staticWatch() });
    const trigger = screen.getByRole('button', { name: OVERFLOW_TRIGGER_LABEL });
    // Visible label + count; the name is the visible label alone (the count
    // is aria-hidden; its words ride the tooltip) — no aria-label to drift.
    expect(trigger.textContent).toBe('More pages8');
    expect(trigger.hasAttribute('aria-label')).toBe(false);
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.pointerDown(trigger);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(8);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('carries the count note into the rail tooltip and the menu (full phrase)', async () => {
    renderNav({
      data: richData(),
      measure: syntheticRail(200).measure,
      watch: staticWatch()
    });
    fireEvent.pointerDown(screen.getByRole('button', { name: OVERFLOW_TRIGGER_LABEL }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Headers & Cookies/ }).textContent).toContain(
      '3 headers'
    );
  });
});
