/**
 * The top bar's render tests over a controlled store world: boot
 * placeholders before data (nothing fabricated), the four answers once data
 * settles — with the absent state's neutral pill and the platform
 * precedence visible — the stale marker flipping as the display ages, the
 * soft refresh's own state, the bar staying whole with quiet slots on an
 * error, answer navigation and the freshness answer's non-interactivity,
 * the crash containment that keeps a hostile payload from blanking the
 * panel, live aging on the clock's cadence, the pause while the panel
 * document is hidden; then the width rule (full vs folded + its "⋯" menu),
 * the inspected address, the Refresh control and the palette trigger.
 *
 * The clock runs under fake timers with a pinned system time, so ages and
 * the staleness flip are deterministic; the store's stamps read the same
 * clock. Answers are located by role and text (the repo's locator style).
 */
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOP_BAR_FULL_MIN_WIDTH } from '../../../lib/panel/top-bar-layout';
import type { FdtData, WprDetections } from '../../../lib/wp-rocket/types';
import { DATA_STALE_AFTER_MS } from './selectors';
import { TopBar } from './top-bar';
import type { BuilderEntryDeps } from './builder-entry';
import type { TopBarFoldSeams } from './fold';
import type { TopBarFoldPart } from '../../../lib/panel/top-bar-fold';
import { STALE_REFRESH_TITLE } from './refresh';
import { createSearchStore } from '../state/search';
import { createFdtDataStore, FdtDataContext, type FdtDataStore } from '../state/use-fdt-data';
import type { PanelReceivers } from '../state/edges';
import { makeFdtData, makeHardReloadBudget } from '../state/fixtures';

/** The pinned system time (ms) — the store's settled stamps and the clock read it. */
const NOW_MS = 1_727_000_000_000;

/** The bar under test, with a controlled request world for one render. */
interface Harness {
  /** Submits the pending `request`'s payload (resolves the flight). */
  settle: (payload: unknown) => void;
  /** Rejects the pending request's flight. */
  fail: (cause: unknown) => void;
  /** Deliver the in-tab reload notification to the registered receivers. */
  deliverReload: () => void;
  /** Request invocations so far (each flight asks exactly once). */
  requests: () => number;
  data: FdtDataStore;
}

/**
 * Build the store the bar consumes: a never-resolving request by default
 * (tests settle or fail explicitly), a fixed inspected tab, and the wall
 * clock the bar's clock ages against — one time source for both layers.
 */
function makeHarness(): Harness {
  let settle!: (payload: unknown) => void;
  let failFlight!: (cause: unknown) => void;
  let receivers: PanelReceivers | null = null;
  let requests = 0;
  const data = createFdtDataStore({
    inspectedTabId: () => 7,
    request: () => {
      requests += 1;
      return new Promise<unknown>((resolve, reject) => {
        settle = resolve;
        failFlight = reject;
      });
    },
    receive: (registered: PanelReceivers) => {
      receivers = registered;
      return () => {
        receivers = null;
      };
    },
    search: createSearchStore(),
    reload: vi.fn(),
    canRequest: () => true,
    hardReloadBudget: makeHardReloadBudget(),
    now: () => Date.now()
  });
  return {
    settle: (payload) => {
      settle(payload);
    },
    fail: (cause) => {
      failFlight(cause);
    },
    deliverReload: () => {
      if (receivers === null) throw new Error('bar receivers are not registered');
      receivers.onPanelReload(7);
    },
    requests: () => requests,
    data
  };
}

/** A builder transport that answers "Off" and never pushes. */
function builderDeps(): BuilderEntryDeps {
  return {
    inspectedTabId: () => 7,
    askStatus: () => Promise.resolve({ kind: 'reply', reply: { state: 'inactive' } } as const),
    open: () => Promise.resolve({ kind: 'reply', reply: 'injected' } as const),
    listen: () => () => undefined
  };
}

/** The bar's injectable seams for one render. */
interface BarOptions {
  /** The shell width (default: a full-width 1100 px panel). */
  width?: () => number;
  /** The page-URL read (default: unknown). */
  readPageUrl?: () => Promise<string | null>;
  /** The palette toggle spy. */
  toggle?: () => void;
  /** The builder transport (default: answers "Off", never pushes). */
  builder?: BuilderEntryDeps;
  /** The fold's measuring seams (default: production; no layout here). */
  foldSeams?: TopBarFoldSeams;
}

/** Mount the bar with the harness store's context, then run its boot flow. */
function renderStrip(harness: Harness, options: BarOptions = {}): void {
  render(() => (
    <FdtDataContext.Provider value={harness.data}>
      <TopBar
        width={options.width ?? (() => 1100)}
        palette={{ open: () => false, toggle: options.toggle ?? vi.fn(), keyHint: () => '⌘K' }}
        builderEntry={options.builder ?? builderDeps()}
        readPageUrl={options.readPageUrl ?? (() => Promise.resolve(null))}
        foldSeams={options.foldSeams}
      />
    </FdtDataContext.Provider>
  ));
  // The shell owns `start()` in production; the harness reproduces it after
  // the mount (self-owned stores, one bar per test).
  harness.data.start();
}

/** Flush the settle's promise chain and the bar's render effects. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

/** Loaded data whose `wpr` row is replaced (the fixtures keep the rest empty). */
function withWpr(wpr: Partial<WprDetections['wpr']>): FdtData {
  return makeFdtData({
    wprDetections: {
      ...makeFdtData().wprDetections,
      wpr: {
        present: false,
        cacheMarkerFound: false,
        cached: false,
        version: null,
        timeStamp: null,
        ...wpr
      }
    }
  });
}

/** A served-from-cache page, cached three minutes before the pinned time. */
function cachedData(): FdtData {
  const cached = withWpr({
    present: true,
    cacheMarkerFound: true,
    cached: true,
    version: '3.20.0.2',
    timeStamp: (NOW_MS - 180_000) / 1000
  });
  return {
    ...cached,
    pageHeaders: [
      { name: 'Server', value: 'nginx' },
      { name: 'X-Powered-By', value: 'PHP/8.2' }
    ]
  };
}

/** The bar element of the current render. */
function theBar(): HTMLElement {
  const bar = document.querySelector('[data-fdt="panel-top-bar"]');
  expect(bar).not.toBeNull();
  return bar as HTMLElement;
}

/** The answers' own surface: the start-slot answers plus the freshness text. */
function answersText(): string {
  return [
    document.querySelector('[data-fdt="top-bar-answers"]')?.textContent ?? '',
    document.querySelector('[data-fdt="top-bar-freshness"]')?.textContent ?? ''
  ].join(' ');
}

/**
 * Whether an element is on screen as far as the bar decides: not inside a
 * folded box (laid out hidden for measuring — the hidden "⋯" trigger
 * included). Layout-less tests read the hook, not computed styles.
 */
function onScreen(element: Element): boolean {
  return element.closest('[data-fdt-fold="folded"]') === null;
}

/** The "⋯" trigger's box state ("inline" = shown). */
function menuBoxState(): string | null {
  return (
    document.querySelector('[data-fdt="top-bar-menu-box"]')?.getAttribute('data-fdt-fold') ?? null
  );
}

/** The "⋯" trigger's name (it lists what the menu holds). */
const MENU_NAME = /^More: /;

/** The trigger's name while the freshness it holds is stale. */
const MENU_STALE_NAME = /^More: .*freshness \(data is stale\)/;

/** The bar's own controls (palette, Exclusions, Refresh) — never an answer. */
const CONTROL_NAMES = [/Command palette$/, /^Exclusions/, /^Refresh page data$/];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // Restore the visibility seam the hidden-panel test bends.
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

describe('TopBar (answers)', () => {
  it('renders honest placeholders at boot — no fabricated answers, no answer controls', () => {
    renderStrip(makeHarness());

    const bar = theBar();
    expect(bar.querySelectorAll('[data-fdt="skeleton"]').length).toBe(4);
    expect(screen.queryByText('Not detected')).toBeNull();
    expect(screen.queryByText('Cached')).toBeNull();
    expect(screen.queryByText('unknown')).toBeNull();
    expect(screen.queryByText(/^Updated/)).toBeNull();
    // No answer is a link before data; the only buttons are the bar's own
    // controls (palette, Exclusions, Refresh), which exist at boot.
    expect(bar.querySelectorAll('a').length).toBe(0);
    // (The "⋯" trigger stays mounted, hidden, for the fold to measure.)
    const buttons = [...bar.querySelectorAll('button')].filter(onScreen);
    expect(buttons).toHaveLength(CONTROL_NAMES.length);
    expect(menuBoxState()).toBe('folded');
    for (const name of CONTROL_NAMES) expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('renders the absent state neutrally once real data says the plugin is gone', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle(makeFdtData());
    await flush();

    // Data says absent: the neutral lead with its owning page.
    expect(screen.getByRole('link', { name: 'Not detected' }).getAttribute('href')).toBe(
      '#/detections'
    );
    // Three valueless answers stay text: cache silence (no plugin at hand),
    // no captured headers, and the data age.
    const answers = document.querySelector('[data-fdt="top-bar-answers"]') as HTMLElement;
    expect(answers.querySelectorAll(':scope > span').length).toBe(2);
    expect(answers.querySelectorAll(':scope > a').length).toBe(1);
    const freshness = document.querySelector('[data-fdt="top-bar-freshness"]') as HTMLElement;
    expect(freshness.querySelector('a, button')).toBeNull();
    expect(screen.getByText('Updated just now')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Updated/ })).toBeNull();
  });

  it('answers presence+version, cache age, platform and freshness from real data', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle(cachedData());
    await flush();

    expect(screen.getByRole('link', { name: 'WP Rocket 3.20.0.2' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Cached/ })).toBeTruthy();
    expect(screen.getByText('3 min ago')).toBeTruthy();
    const server = screen.getByRole('link', { name: /nginx · PHP\/8\.2/ });
    // The server value's designed cap (18rem: a common "Apache/x (Debian) ·
    // PHP/x" pair stays whole); past it the value elides, the title keeps it.
    expect(server.querySelector('.truncate')?.classList).toContain('max-w-72');
    expect(server.getAttribute('title')).toMatch(/^nginx · PHP\/8\.2/);
    expect(screen.getByText('Updated just now')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Updated/ })).toBeNull();
    // The stamp's hover detail rides the real tooltip wiring — absolute UTC.
    const cacheLink = screen.getByRole('link', { name: /Cached/ });
    // One check mark only: the chip text owns it, the badge adds no icon.
    expect(cacheLink.textContent).toContain('✓ Cached');
    expect(cacheLink.textContent.match(/✓/g)).toHaveLength(1);
    expect(cacheLink.querySelector('svg')).toBeNull();
    expect(cacheLink.getAttribute('aria-describedby')).toBeNull();
    fireEvent.focus(cacheLink); // keyboard focus opens immediately
    expect(cacheLink.getAttribute('aria-describedby')).toBeTruthy();
    expect(
      document.querySelector('[role="tooltip"]')?.textContent.includes('2024-09-22 10:10:20 UTC')
    ).toBe(true);
  });

  it('elides a validator-legal long version inside its chip (never pushes neighbors out)', async () => {
    // The validator accepts versions up to 64 chars; the chip's text rides
    // the eliding span, so the widest page-declared version shrinks inside
    // its segment instead of pushing the row's other answers out of the
    // bar (long values elide inside their pill).
    const longVersion = `3.20.0.2${' x'.repeat(28)}`;
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle(
      withWpr({ present: true, cacheMarkerFound: false, cached: false, version: longVersion })
    );
    await flush();

    const chip = screen.getByRole('link', { name: `WP Rocket ${longVersion}` });
    const label = chip.querySelector('[data-fdt="status-badge"]')?.querySelector('span.truncate');
    expect(label).toBeTruthy(); // The elision carrier, pinned at the class level.
    expect(label?.textContent).toBe(`WP Rocket ${longVersion}`);
  });

  it('ages the displayed values on the clock and flags stale past the threshold', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle(cachedData());
    await flush();

    // One threshold-length advance drives the cadence and the wall clock:
    // the cache age moves its bucket, the data crosses the staleness line.
    await vi.advanceTimersByTimeAsync(DATA_STALE_AFTER_MS);
    expect(screen.getByText('13 min ago')).toBeTruthy();
    expect(screen.getByText('Stale')).toBeTruthy();
    expect(screen.getByText('Updated 10 min ago')).toBeTruthy();
    // The stale segment explains itself on hover (hidden until wanted), and
    // the explanation is not hover-only: the same facts ride sr-only text,
    // so keyboard and screen-reader users get the remedy without a focus
    // stop on this deliberately non-navigable segment.
    const staleText = screen.getByText('Stale');
    const segment = staleText.parentElement as HTMLElement;
    expect(segment.getAttribute('title')).toContain(`older than 10 min`);
    expect(segment.textContent).toContain('reload it to refresh');
    expect(segment.querySelector('.sr-only')).toBeTruthy();
  });

  it('flips the staleness copy at exactly the threshold, spelling the prose at both render sites', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle(cachedData());
    await flush();

    // One tick-landing before the crossing the answer still reads current:
    // the age bucket rounds 599_999 ms down to "9 min ago", no Stale badge,
    // and the hover title carries the stamp without the remedy.
    await vi.advanceTimersByTimeAsync(DATA_STALE_AFTER_MS - 1);
    expect(screen.getByText('Updated 9 min ago')).toBeTruthy();
    expect(screen.queryByText('Stale')).toBeNull();

    // The exact threshold flips both render sites to the same prose form —
    // the hover title's stale remedy and the sr-only fact line — each read
    // from the selectors' one derived figure (STALE_WINDOW_MINUTES).
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.getByText('Stale')).toBeTruthy();
    expect(screen.getByText('Updated 10 min ago')).toBeTruthy();
    const segment = screen.getByText('Updated 10 min ago').parentElement as HTMLElement;
    expect(segment.getAttribute('title')).toContain('older than 10 min');
    // `textContent` reads nodes only (never attribute values), so this hits
    // the sr-only fact line — the second render site the title cannot cover.
    expect(segment.textContent).toContain('Data is older than 10 min');
  });

  it('renders its own state while a soft refresh is in the air', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle(cachedData());
    await flush();
    harness.deliverReload();
    await flush();

    expect(screen.getByText('Refreshing…')).toBeTruthy();
    // The carried data stays on screen until the fresh batch lands.
    expect(screen.getByRole('link', { name: 'WP Rocket 3.20.0.2' })).toBeTruthy();
  });

  it('renders the truncated cache arm from the copy module', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle({
      ...withWpr({ present: true, cacheMarkerFound: false, cached: false, timeStamp: null }),
      pageHeaders: [{ name: 'server', value: 'nginx' }],
      pageHeadersTruncated: true
    });
    await flush();
    expect(screen.getByRole('link', { name: 'Cache not detected' })).toBeTruthy();
  });

  it('renders a captured host serve as "Possibly cached"', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle({
      ...withWpr({ present: true, cacheMarkerFound: false, cached: false, timeStamp: null }),
      pageHeaders: [{ name: 'sg-f-cache', value: 'HIT' }]
    });
    await flush();
    expect(screen.getByRole('link', { name: 'Possibly cached' })).toBeTruthy();
  });

  it('renders the bypass arm as "Bypass requested"', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle({
      ...withWpr({ present: true, cacheMarkerFound: false, cached: false, timeStamp: null }),
      bypassAttested: true
    });
    await flush();
    const link = screen.getByRole('link', { name: 'Bypass requested' });
    // Intent, not a fault: the neutral tone, never warn.
    expect(link.querySelector('[data-fdt="status-badge"]')?.className).toContain(
      'bg-status-neutral-soft'
    );
  });

  it('stays whole with quiet slots while the error view holds the cause', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.fail(new Error('Could not establish connection. Receiving end does not exist.'));
    await flush();

    // Four answers, one honest dash each, no answer links, no claims.
    expect(answersText().split('—').length).toBe(5);
    expect(screen.queryByText('Not detected')).toBeNull();
    expect(theBar().querySelectorAll('a').length).toBe(0);
  });

  it.each([1100, 420])('keeps a hostile render contained in the downtime line (%i px)', (width) => {
    // A store whose machine state skipped every validation: the selectors
    // must fail inside the containment, never the shell's root.
    const hostile: FdtDataStore = {
      state: () => ({ status: 'ready', data: {} as unknown as FdtData, fetchedAt: NOW_MS }),
      start: vi.fn(),
      stop: vi.fn(),
      retry: vi.fn(),
      reload: vi.fn()
    };
    render(() => (
      <FdtDataContext.Provider value={hostile}>
        <TopBar
          width={() => width}
          palette={{ open: () => false, toggle: vi.fn(), keyHint: () => '⌘K' }}
          builderEntry={builderDeps()}
          readPageUrl={() => Promise.resolve(null)}
        />
      </FdtDataContext.Provider>
    ));
    expect(screen.getByText('Status unavailable')).toBeTruthy();
    expect(theBar()).toBeTruthy();
    // The controls survive the contained failure. A compact bar keeps the
    // quiet builder entry in "⋯", which renders without answers (its
    // answer rows are the only part that reads them).
    if (width >= TOP_BAR_FULL_MIN_WIDTH) {
      for (const name of CONTROL_NAMES) expect(screen.getByRole('button', { name })).toBeTruthy();
      return;
    }
    expect(screen.getByRole('button', { name: /Command palette$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh page data' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More: Exclusions' })).toBeTruthy();
  });

  it('renders an unstamped cached page without inventing a time', async () => {
    // The boundary now enforces the cache display domain, so an out-of-range
    // stamp never reaches the store; the segment's job is the unstamped case:
    // "Cached" with no invented time and the rest of the bar intact.
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle(
      withWpr({ present: true, cacheMarkerFound: true, cached: true, timeStamp: null })
    );
    await flush();

    expect(screen.queryByText('Status unavailable')).toBeNull();
    expect(screen.getByRole('link', { name: '✓ Cached' })).toBeTruthy();
    expect(screen.queryByText(/^Cache generated at/)).toBeNull(); // No invented stamp either.
    // The rest of the row answers: platform/header silence stays a dash…
    expect(theBar().textContent).toContain('Updated');
  });

  it('pauses the cadence while the panel document is hidden and resumes on show', async () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle(cachedData());
    await flush();

    // Hidden: the wall clock may advance, the displayed ages may not.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(screen.getByText('3 min ago')).toBeTruthy();
    expect(screen.getByText('Updated just now')).toBeTruthy();

    // Show again: the reading re-fires immediately (no up-to-one-cadence lag).
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(screen.getByText('5 min ago')).toBeTruthy();
    expect(screen.getByText('Updated 2 min ago')).toBeTruthy();

    // …and the cadence resumed (the next bucket flip lands per tick).
    await vi.advanceTimersByTimeAsync(70_000);
    expect(screen.getByText('6 min ago')).toBeTruthy();
    expect(screen.getByText('Updated 3 min ago')).toBeTruthy();
  });
});

describe('TopBar (width rule)', () => {
  /** Open the "⋯" menu (Kobalte's trigger path: pointer down toggles). */
  async function openMenu(): Promise<HTMLElement> {
    fireEvent.pointerDown(screen.getByRole('button', { name: MENU_NAME }));
    return await screen.findByRole('menu');
  }

  it('shows everything inline from the threshold on, no "⋯" menu', async () => {
    const harness = makeHarness();
    renderStrip(harness, {
      width: () => TOP_BAR_FULL_MIN_WIDTH,
      readPageUrl: () => Promise.resolve('https://example.com/shop/?p=2#top')
    });
    harness.settle(cachedData());
    await flush();

    expect(screen.getByText('WPR FDT').className).not.toContain('sr-only');
    expect(screen.getByRole('link', { name: /nginx · PHP\/8\.2/ })).toBeTruthy();
    expect(screen.getByText('Updated just now')).toBeTruthy();
    expect(screen.getByText('Exclusions').className).not.toContain('sr-only');
    expect(screen.getByText('Jump to…')).toBeTruthy();
    // Nothing measured as short (no layout here): every part inline, no "⋯".
    expect(menuBoxState()).toBe('folded');
    for (const part of document.querySelectorAll('[data-fdt-fold-part]'))
      expect(part.getAttribute('data-fdt-fold')).toBe('inline');
    // The address: the short label, the full URL on hover.
    const address = document.querySelector('[data-fdt="top-bar-address"]') as HTMLElement;
    expect(address.textContent).toBe('example.com/shop/?p=2');
    expect(address.getAttribute('title')).toBe('Inspected page: https://example.com/shop/?p=2#top');
    // Last in the start row, a foldable part (whole or gone) whose label
    // elides only at its designed cap.
    const start = theBar().querySelector('[data-fdt="top-bar-start"]') as HTMLElement;
    const box = start.lastElementChild as HTMLElement;
    expect(box.getAttribute('data-fdt-fold-part')).toBe('address');
    expect(box.contains(address)).toBe(true);
    expect(box.classList).toContain('shrink-0');
    expect(address.lastElementChild?.classList).toContain('max-w-64');
    // The one divider belongs to the name, before the answers.
    const dividers = start.querySelectorAll('.bg-line-2');
    expect(dividers).toHaveLength(1);
    expect(dividers[0]?.nextElementSibling?.getAttribute('data-fdt')).toBe('top-bar-answers');
  });

  it('keeps its single divider with no address (nothing dangles)', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle(cachedData());
    await flush();
    const start = theBar().querySelector('[data-fdt="top-bar-start"]') as HTMLElement;
    expect(document.querySelector('[data-fdt="top-bar-address"]')).toBeNull();
    expect(start.querySelectorAll('.bg-line-2')).toHaveLength(1);
    expect(start.lastElementChild?.getAttribute('data-fdt')).toBe('top-bar-answers');
  });

  it('folds the name, address, server, freshness and the quiet Exclusions entry below it; pills stay', async () => {
    const harness = makeHarness();
    renderStrip(harness, {
      width: () => TOP_BAR_FULL_MIN_WIDTH - 1,
      readPageUrl: () => Promise.resolve('https://example.com/shop/')
    });
    harness.settle(cachedData());
    await flush();

    // The name stays in the accessible tree (sr-only); a quiet ("Off")
    // builder entry waits in the menu, out of the bar.
    expect(screen.getByText('WPR FDT').className).toContain('sr-only');
    expect(document.querySelector('[data-fdt="builder-entry"]')).toBeNull();
    expect(document.querySelector('[data-fdt="top-bar-address"]')).toBeNull();
    expect(screen.queryByRole('link', { name: /nginx/ })).toBeNull();
    expect(screen.queryByText('Updated just now')).toBeNull();
    expect(screen.queryByText('Jump to…')).toBeNull();
    // The two answers always in the bar, in their short forms: the link
    // names keep the full words.
    const wpr = screen.getByRole('link', { name: 'WP Rocket 3.20.0.2' });
    expect(wpr.getAttribute('title')).toBe('WP Rocket 3.20.0.2');
    expect(wpr.querySelector('.sr-only')?.textContent).toBe('WP Rocket ');
    const cache = screen.getByRole('link', { name: /Cached/ });
    expect(cache.textContent).toContain('3 min ago');
    expect(cache.querySelector('.sr-only')?.textContent).toBe('3 min ago');

    // The "⋯" menu holds what folded.
    const menu = await openMenu();
    expect(within(menu).getByText('WPR FDT')).toBeTruthy();
    expect(within(menu).getByText('example.com/shop/')).toBeTruthy();
    expect(within(menu).getByText('Updated just now')).toBeTruthy();
    const server = within(menu).getByRole('menuitem', { name: /nginx · PHP\/8\.2/ });
    expect(server.getAttribute('href')).toBe('#/detections');
    // Freshness stays text inside the plate, never an item.
    expect(within(menu).queryByRole('menuitem', { name: /Updated/ })).toBeNull();
    const exclusions = await within(menu).findByRole('menuitem', { name: /Exclusions/ });
    expect(exclusions.textContent).toContain('Off');
    // The stale dot is absent while the data is current.
    expect(document.querySelector('[data-fdt="top-bar-menu-stale"]')).toBeNull();
  });

  it('follows the width live (full ↔ folded) without a remount', async () => {
    const [width, setWidth] = createSignal(1100);
    const harness = makeHarness();
    renderStrip(harness, { width });
    harness.settle(cachedData());
    await flush();
    const bar = theBar();
    expect(screen.queryByRole('button', { name: MENU_NAME })).toBeNull();
    setWidth(420);
    expect(screen.getByRole('button', { name: MENU_NAME })).toBeTruthy();
    expect(screen.queryByText('Updated just now')).toBeNull();
    setWidth(760);
    expect(screen.queryByRole('button', { name: MENU_NAME })).toBeNull();
    expect(screen.getByText('Updated just now')).toBeTruthy();
    expect(theBar()).toBe(bar);
  });

  it('opens the builder from the menu row (the same entry state as the bar)', async () => {
    const open = vi.fn(() => Promise.resolve({ kind: 'reply', reply: 'injected' } as const));
    const harness = makeHarness();
    render(() => (
      <FdtDataContext.Provider value={harness.data}>
        <TopBar
          width={() => 420}
          palette={{ open: () => false, toggle: vi.fn(), keyHint: () => '⌘K' }}
          builderEntry={{ ...builderDeps(), open }}
          readPageUrl={() => Promise.resolve(null)}
        />
      </FdtDataContext.Provider>
    ));
    harness.data.start();
    harness.settle(cachedData());
    await flush();
    const menu = await openMenu();
    // Kobalte selects on a primary-button pointer up (or Enter/Space).
    fireEvent.pointerUp(await within(menu).findByRole('menuitem', { name: /Exclusions/ }), {
      button: 0
    });
    await flush();
    expect(open).toHaveBeenCalledWith(7);
  });

  it('keeps a news builder state in the folded bar: the icon entry with its dot', async () => {
    const harness = makeHarness();
    renderStrip(harness, {
      width: () => 420,
      builder: {
        ...builderDeps(),
        askStatus: () =>
          Promise.resolve({
            kind: 'reply',
            reply: { state: 'active', origin: 'https://example.com' }
          } as const)
      }
    });
    harness.settle(cachedData());
    await flush();
    const entry = screen.getByRole('button', { name: /^Exclusions On/ });
    expect(entry.closest('[data-fdt-app-bar-slot]')?.getAttribute('data-fdt-app-bar-slot')).toBe(
      'end'
    );
    expect(entry.classList).toContain('w-7');
    expect(entry.querySelector('[data-fdt="builder-entry-dot"]')?.classList).toContain(
      'text-status-ok'
    );
    // The menu row carries the same state, labeled.
    const menu = await openMenu();
    expect(
      (await within(menu).findByRole('menuitem', { name: /Exclusions/ })).textContent
    ).toContain('On');
  });

  it('marks stale data on the folded bar: a warn dot and a named "⋯", Refresh says why', async () => {
    const harness = makeHarness();
    renderStrip(harness, { width: () => 420 });
    harness.settle(cachedData());
    await flush();
    const refresh = screen.getByRole('button', { name: 'Refresh page data' });
    // Current data: no dot, the plain name and title.
    expect(document.querySelector('[data-fdt="top-bar-menu-stale"]')).toBeNull();
    expect(screen.getByRole('button', { name: MENU_NAME })).toBeTruthy();
    expect(refresh.getAttribute('title')).toBe('Refresh page data');

    await vi.advanceTimersByTimeAsync(DATA_STALE_AFTER_MS);
    const trigger = screen.getByRole('button', { name: MENU_STALE_NAME });
    const dot = trigger.querySelector('[data-fdt="top-bar-menu-stale"]');
    expect(dot?.classList).toContain('text-status-warn');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(refresh.getAttribute('title')).toBe(STALE_REFRESH_TITLE);
    // The marker itself is one click away, in the menu.
    fireEvent.pointerDown(trigger);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Stale')).toBeTruthy();

    // A refresh clears it: the data is current again.
    fireEvent.keyDown(menu, { key: 'Escape' });
    fireEvent.click(refresh);
    harness.settle(cachedData());
    await flush();
    expect(document.querySelector('[data-fdt="top-bar-menu-stale"]')).toBeNull();
    expect(screen.getByRole('button', { name: MENU_NAME })).toBeTruthy();
    expect(refresh.getAttribute('title')).toBe('Refresh page data');
  });

  it('keeps a failing builder state to the entry: the bar, answers and menu survive', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const [width, setWidth] = createSignal(1100);
    const harness = makeHarness();
    renderStrip(harness, {
      width,
      builder: {
        ...builderDeps(),
        listen: () => {
          throw new Error('messaging down');
        }
      }
    });
    harness.settle(cachedData());
    await flush();
    expect(document.querySelector('[data-fdt="builder-entry"]')).toBeNull();
    expect(answersText()).toContain('WP Rocket 3.20.0.2');
    expect(screen.getByRole('button', { name: 'Refresh page data' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Command palette$/ })).toBeTruthy();
    expect(
      error.mock.calls.some((call) => /Exclusion builder entry failed/.test(String(call[0])))
    ).toBe(true);
    // Folded: the menu opens without an Exclusions row.
    setWidth(420);
    const menu = await openMenu();
    expect(within(menu).getByText('Updated just now')).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: /Exclusions/ })).toBeNull();
    error.mockRestore();
  });

  it('keeps a folded server answer honest in the menu when it is not a value', async () => {
    const harness = makeHarness();
    renderStrip(harness, { width: () => 320 });
    harness.settle(withWpr({ present: true, version: '3.20.0.2' }));
    await flush();
    const menu = await openMenu();
    expect(within(menu).getByText('Server: no headers captured')).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: /Server/ })).toBeNull();
  });
});

describe('TopBar (measured fold)', () => {
  /** The "⋯" trigger's cost in the layout double. */
  const MENU_PX = 30;

  /** Each part's cost in the layout double (px, gap included). */
  const PART_PX: Record<TopBarFoldPart, number> = {
    address: 100,
    server: 80,
    cacheAge: 50,
    freshness: 60,
    brand: 30
  };

  /**
   * A layout double: the bar has `room()` px for the parts and "⋯"; the
   * read derives the free px from what the DOM lays out inline, exactly as
   * a real layout would. `relayout()` delivers a size change.
   */
  function layoutDouble(room: () => number): { seams: TopBarFoldSeams; relayout: () => void } {
    const delivery: { changed: (() => void) | null } = { changed: null };
    const seams: TopBarFoldSeams = {
      watch: (onChange) => {
        delivery.changed = onChange;
        return {
          observe: () => undefined,
          unobserve: () => undefined,
          disconnect: () => {
            delivery.changed = null;
          }
        };
      },
      read: (elements) => {
        if (elements.start === null || elements.menu === null) return null;
        const widths: Partial<Record<TopBarFoldPart, number>> = {};
        let inlineCost = 0;
        for (const [part, element] of elements.parts) {
          widths[part] = PART_PX[part];
          if (element.getAttribute('data-fdt-fold') === 'inline') inlineCost += PART_PX[part];
        }
        const menuShown = elements.menu.getAttribute('data-fdt-fold') === 'inline';
        const used = inlineCost + (menuShown ? MENU_PX : 0);
        return { free: room() - used, widths, inlineCost, menuWidth: MENU_PX, menuShown };
      }
    };
    return {
      seams,
      relayout: () => {
        delivery.changed?.();
      }
    };
  }

  /** Each mounted part's laid-out state. */
  function partStates(): Record<string, string | null> {
    const states: Record<string, string | null> = {};
    for (const part of document.querySelectorAll('[data-fdt-fold-part]'))
      states[part.getAttribute('data-fdt-fold-part') ?? ''] = part.getAttribute('data-fdt-fold');
    return states;
  }

  /** Render a full bar with a page address and cached data, on a layout double. */
  async function renderMeasured(room: () => number): Promise<{ relayout: () => void }> {
    const layout = layoutDouble(room);
    const harness = makeHarness();
    renderStrip(harness, {
      foldSeams: layout.seams,
      readPageUrl: () => Promise.resolve('https://example.com/shop/')
    });
    harness.settle(cachedData());
    await flush();
    layout.relayout();
    return layout;
  }

  it('shows every part inline, no "⋯", while the room holds them', async () => {
    await renderMeasured(() => 1000);
    expect(partStates()).toEqual({
      brand: 'inline',
      cacheAge: 'inline',
      server: 'inline',
      address: 'inline',
      freshness: 'inline'
    });
    expect(menuBoxState()).toBe('folded');
    // A folded box is laid out out of sight; an inline one carries no style.
    const address = document.querySelector('[data-fdt-fold-part="address"]') as HTMLElement;
    expect(address.getAttribute('style')).toBeNull();
  });

  it('folds whole parts in priority order, and "⋯" holds exactly them', async () => {
    // 50 + 60 + 30 (cache age, freshness, brand) + the 30 px "⋯".
    await renderMeasured(() => 170);
    expect(partStates()).toEqual({
      brand: 'inline',
      cacheAge: 'inline',
      server: 'folded',
      address: 'folded',
      freshness: 'inline'
    });
    const address = document.querySelector('[data-fdt-fold-part="address"]') as HTMLElement;
    expect(address.style.visibility).toBe('hidden');
    expect(address.style.position).toBe('absolute');
    expect(menuBoxState()).toBe('inline');
    const trigger = screen.getByRole('button', { name: 'More: address, server' });
    fireEvent.pointerDown(trigger);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('example.com/shop/')).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /nginx · PHP\/8\.2/ })).toBeTruthy();
    // Inline parts are not repeated; a full bar's labeled entry stays inline.
    expect(within(menu).queryByText('Updated just now')).toBeNull();
    expect(menu.querySelector('[data-fdt="top-bar-menu-cache-age"]')).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /Exclusions/ })).toBeNull();
  });

  it('folds the cache age and freshness next, the brand last', async () => {
    let roomPx = 80;
    const room = (): number => roomPx;
    const { relayout } = await renderMeasured(room);
    // 30 (brand) + 30 ("⋯") fits 80; freshness (60) more does not.
    expect(partStates()).toEqual({
      brand: 'inline',
      cacheAge: 'folded',
      server: 'folded',
      address: 'folded',
      freshness: 'folded'
    });
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'More: address, freshness, cache age, server' })
    );
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Cache generated 3 min ago')).toBeTruthy();
    expect(within(menu).getByText('Updated just now')).toBeTruthy();
    fireEvent.keyDown(menu, { key: 'Escape' });

    roomPx = 40;
    relayout();
    expect(partStates().brand).toBe('folded');
  });

  it('marks held stale data on "⋯", and not while the freshness shows inline', async () => {
    let roomPx = 1000;
    const room = (): number => roomPx;
    const { relayout } = await renderMeasured(room);
    await vi.advanceTimersByTimeAsync(DATA_STALE_AFTER_MS);
    // Inline: the "Stale" badge itself, no menu.
    const freshness = document.querySelector('[data-fdt="top-bar-freshness"]') as HTMLElement;
    expect(within(freshness).getByText('Stale')).toBeTruthy();
    expect(document.querySelector('[data-fdt="top-bar-menu-stale"]')).toBeNull();

    roomPx = 80;
    relayout();
    expect(partStates().freshness).toBe('folded');
    expect(screen.getByRole('button', { name: MENU_STALE_NAME })).toBeTruthy();
    expect(document.querySelector('[data-fdt="top-bar-menu-stale"]')).not.toBeNull();
  });

  it('hides "⋯" and closes its open menu once the room returns', async () => {
    let roomPx = 170;
    const room = (): number => roomPx;
    const { relayout } = await renderMeasured(room);
    const trigger = screen.getByRole('button', { name: MENU_NAME });
    fireEvent.pointerDown(trigger);
    await screen.findByRole('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    roomPx = 1000;
    relayout();
    await flush();
    expect(menuBoxState()).toBe('folded');
    // Closed (the content's exit waits on Kobalte's presence, layout-less here).
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(Object.values(partStates()).every((state) => state === 'inline')).toBe(true);
  });

  it('keeps a part folded until it fits with the margin (no flapping at the edge)', async () => {
    let roomPx = 170;
    const room = (): number => roomPx;
    const { relayout } = await renderMeasured(room);
    // Exactly enough for the server back (250 = 80 + 50 + 60 + 30 + 30)…
    roomPx = 250;
    relayout();
    expect(partStates().server).toBe('folded');
    // …and with the margin.
    roomPx = 252;
    relayout();
    expect(partStates().server).toBe('inline');
    expect(partStates().address).toBe('folded');
  });
});

describe('TopBar (address)', () => {
  it('reads the address once per settle and drops a previous page’s late answer', async () => {
    const answers: Array<(url: string | null) => void> = [];
    const read = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          answers.push(resolve);
        })
    );
    const harness = makeHarness();
    renderStrip(harness, { readPageUrl: read });
    expect(read).not.toHaveBeenCalled(); // no settle, no read
    harness.settle(cachedData());
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    // A push re-feeds the same settle: no second read.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).toHaveBeenCalledTimes(1);

    // A soft refresh lands a new settle before the first read answers.
    harness.deliverReload();
    await flush();
    harness.settle(cachedData());
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    answers[1]?.('https://new.example/');
    answers[0]?.('https://old.example/');
    await flush();
    expect(document.querySelector('[data-fdt="top-bar-address"]')?.textContent).toBe('new.example');
  });

  it('clears the address when the data goes away, and omits a non-http answer', async () => {
    const harness = makeHarness();
    let url: string | null = 'chrome://settings/';
    renderStrip(harness, { readPageUrl: () => Promise.resolve(url) });
    harness.settle(cachedData());
    await flush();
    expect(document.querySelector('[data-fdt="top-bar-address"]')).toBeNull();
    url = 'https://example.com/';
    harness.deliverReload();
    await flush();
    harness.settle(cachedData());
    await flush();
    expect(document.querySelector('[data-fdt="top-bar-address"]')?.textContent).toBe('example.com');
    harness.deliverReload();
    await flush();
    harness.fail(new Error('gone'));
    await flush();
    expect(document.querySelector('[data-fdt="top-bar-address"]')).toBeNull();
  });

  it('logs and omits the address when the reader rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = makeHarness();
    renderStrip(harness, { readPageUrl: () => Promise.reject(new Error('eval broke')) });
    harness.settle(cachedData());
    await flush();
    expect(document.querySelector('[data-fdt="top-bar-address"]')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('TopBar (controls)', () => {
  it('Refresh re-reads loaded data, is busy while the read is in the air', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    const refresh = screen.getByRole('button', { name: 'Refresh page data' });
    // Boot: the first read is in the air.
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    harness.settle(cachedData());
    await flush();
    expect(refresh.getAttribute('aria-busy')).toBeNull();
    expect(refresh.getAttribute('title')).toBe('Refresh page data');
    fireEvent.click(refresh);
    expect(harness.requests()).toBe(2);
    expect(screen.getByText('Refreshing…')).toBeTruthy();
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    // Busy: a second click does not start another flight.
    fireEvent.click(refresh);
    expect(harness.requests()).toBe(2);
    harness.settle(cachedData());
    await flush();
    expect(screen.getByText('Updated just now')).toBeTruthy();
  });

  it('Refresh retries a failed read', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.fail(new Error('Could not establish connection.'));
    await flush();
    const refresh = screen.getByRole('button', { name: 'Refresh page data' });
    expect(refresh.getAttribute('title')).toBe('Retry reading page data');
    fireEvent.click(refresh);
    expect(harness.requests()).toBe(2);
  });

  it('the palette trigger toggles the palette in both forms', () => {
    const toggle = vi.fn();
    const [width, setWidth] = createSignal(1100);
    renderStrip(makeHarness(), { width, toggle });
    // Wide: the visible words lead the name (label in name); the key hint
    // is generated content, outside the visible label.
    const trigger = screen.getByRole('button', { name: 'Jump to… — Command palette' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.textContent).toBe('Jump to…');
    expect(trigger.querySelector('kbd')?.getAttribute('data-key-hint')).toBe('⌘K');
    fireEvent.click(trigger);
    setWidth(420);
    expect(trigger.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    expect(toggle).toHaveBeenCalledTimes(2);
  });
});

describe('the width rule has one declaring site', () => {
  /** Every non-test source file under a folder, recursively. */
  function sourcesUnder(dir: string, skip: (path: string) => boolean = () => false): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (skip(path)) return [];
      if (entry.isDirectory()) return sourcesUnder(path, skip);
      const source = entry.name.endsWith('.ts') || entry.name.endsWith('.tsx');
      if (!source || entry.name.includes('.test.') || entry.name.endsWith('.d.ts')) return [];
      return [path];
    });
  }

  it('the bar carries no CSS width rule of its own (the JS rule is the only one)', () => {
    // A container or viewport variant here would be a second, drifting copy
    // of the threshold (container conditions cannot read the constant).
    const variant = /(?:^|\s)(?:@(?:min|max)-|@(?:regular|wide|split):|(?:sm|md|lg|xl|2xl):)/;
    const sources = sourcesUnder(import.meta.dirname);
    expect(sources.length).toBeGreaterThan(0);
    for (const path of sources) {
      const literals = readFileSync(path, 'utf8').match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [];
      expect(
        literals.filter((literal) => variant.test(literal.slice(1, -1))),
        path
      ).toEqual([]);
    }
  });

  it('no panel shell source re-types the threshold', () => {
    // `pages/` is out of scope: page bodies own their own layout tiers.
    const panelDir = `${import.meta.dirname}/..`;
    const pagesDir = `${panelDir}/pages`;
    expect(existsSync(pagesDir)).toBe(true);
    const strays = sourcesUnder(panelDir, (path) => path === pagesDir).filter((path) =>
      new RegExp(`\\b${String(TOP_BAR_FULL_MIN_WIDTH)}\\b`).test(readFileSync(path, 'utf8'))
    );
    expect(strays).toEqual([]);
  });
});
