/**
 * The strip's render tests over a controlled store world: boot placeholders
 * before data (nothing fabricated), the four answers once data settles —
 * with the absent state's neutral chip and the platform precedence visible
 * — the stale marker flipping as the display ages, the soft refresh's own
 * state, the strip staying whole with quiet slots on an error, segment
 * navigation and the freshness segment's non-interactivity, the crash
 * containment that keeps a hostile payload from blanking the panel, live
 * aging on the clock's cadence, and the pause while the panel document is
 * hidden.
 *
 * The clock runs under fake timers with a pinned system time, so ages and
 * the staleness flip are deterministic; the store's stamps read the same
 * clock. Segments are located by role and text (the repo's locator style) —
 * the strip carries no test-only DOM hooks for them.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FdtData, WprDetections } from '../../../lib/wp-rocket/types';
import { DATA_STALE_AFTER_MS } from './selectors';
import { StatusBar, STATUS_BAR_GLANCEABLE_MIN_WIDTH, statusBarLayout } from './status-bar';
import { createSearchStore } from '../state/search';
import { createFdtDataStore, FdtDataContext, type FdtDataStore } from '../state/use-fdt-data';
import type { PanelReceivers } from '../state/edges';
import { makeFdtData, makeHardReloadBudget } from '../state/fixtures';

/** The pinned system time (ms) — the store's settled stamps and the clock read it. */
const NOW_MS = 1_727_000_000_000;

/** The strip under test, with a controlled request world for one render. */
interface Harness {
  /** Submits the pending `request`'s payload (resolves the flight). */
  settle: (payload: unknown) => void;
  /** Rejects the pending request's flight. */
  fail: (cause: unknown) => void;
  /** Deliver the in-tab reload notification to the registered receivers. */
  deliverReload: () => void;
  data: FdtDataStore;
}

/**
 * Build the store the strip consumes: a never-resolving request by default
 * (tests settle or fail explicitly), a fixed inspected tab, and the wall
 * clock the strip's clock ages against — one time source for both layers.
 */
function makeHarness(): Harness {
  let settle!: (payload: unknown) => void;
  let failFlight!: (cause: unknown) => void;
  let receivers: PanelReceivers | null = null;
  const data = createFdtDataStore({
    inspectedTabId: () => 7,
    request: () =>
      new Promise<unknown>((resolve, reject) => {
        settle = resolve;
        failFlight = reject;
      }),
    receive: (registered: PanelReceivers) => {
      receivers = registered;
      return () => {
        receivers = null;
      };
    },
    search: createSearchStore(),
    reload: vi.fn(),
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
      if (receivers === null) throw new Error('strip receivers are not registered');
      receivers.onPanelReload(7);
    },
    data
  };
}

/** Mount the strip with the harness store's context, then run its boot flow. */
function renderStrip(harness: Harness): void {
  render(() => (
    <FdtDataContext.Provider value={harness.data}>
      <StatusBar />
    </FdtDataContext.Provider>
  ));
  // The shell owns `start()` in production; the harness reproduces it after
  // the mount (self-owned stores, one strip per test).
  harness.data.start();
}

/** Flush the settle's promise chain and the strip's render effects. */
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

/** The strip element of the current render. */
function theBar(): HTMLElement {
  const bar = document.querySelector('[data-fdt="panel-status-bar"]');
  expect(bar).not.toBeNull();
  return bar as HTMLElement;
}

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

describe('StatusBar (strip)', () => {
  it('renders honest placeholders at boot — no fabricated answers, no controls', () => {
    renderStrip(makeHarness());

    const bar = theBar();
    expect(bar.querySelectorAll('[data-fdt="skeleton"]').length).toBe(4);
    expect(screen.queryByText('Not detected')).toBeNull();
    expect(screen.queryByText('Cached')).toBeNull();
    expect(screen.queryByText('unknown')).toBeNull();
    expect(screen.queryByText(/^Updated/)).toBeNull();
    expect(bar.querySelectorAll('a, button').length).toBe(0);
  });

  it('renders the absent state neutrally once real data says the plugin is gone', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle(makeFdtData());
    await flush();

    const bar = theBar();
    // Data says absent: the neutral lead with its owning page.
    expect(screen.getByRole('link', { name: 'Not detected' }).getAttribute('href')).toBe(
      '#/detections'
    );
    // Three valueless segments stay text: cache silence (no plugin at hand),
    // no captured headers, and the data age.
    expect(bar.querySelectorAll(':scope > div > span').length).toBe(3);
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
    expect(screen.getByRole('link', { name: /nginx · PHP\/8\.2/ })).toBeTruthy();
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
    // strip (the glance contract's 'long values elide inside their segment').
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

  it('renders the qualified bypass arm as "Not cached"', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.settle({
      ...withWpr({ present: true, cacheMarkerFound: false, cached: false, timeStamp: null }),
      bypassAttested: true
    });
    await flush();
    expect(screen.getByRole('link', { name: 'Not cached' })).toBeTruthy();
  });

  it('stays whole with quiet slots while the error view holds the cause', async () => {
    const harness = makeHarness();
    renderStrip(harness);
    harness.fail(new Error('Could not establish connection. Receiving end does not exist.'));
    await flush();

    // Four segments, one honest dash each, no controls, no claims.
    expect(theBar().textContent.split('—').length).toBe(5);
    expect(screen.queryByText('Not detected')).toBeNull();
    expect(theBar().querySelectorAll('a, button').length).toBe(0);
  });

  it('keeps a hostile render contained in the downtime line', () => {
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
        <StatusBar />
      </FdtDataContext.Provider>
    ));
    expect(screen.getByText('Status unavailable')).toBeTruthy();
    expect(theBar()).toBeTruthy();
  });

  it('renders an unstamped cached page without inventing a time', async () => {
    // The boundary now enforces the cache display domain, so an out-of-range
    // stamp never reaches the store; the segment's job is the unstamped case:
    // "Cached" with no invented time and the rest of the strip intact.
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

describe('the glance rule (pure width → layout)', () => {
  it('holds one line from the glance threshold on, wraps below it', () => {
    expect(STATUS_BAR_GLANCEABLE_MIN_WIDTH).toBe(480);
    expect(statusBarLayout(STATUS_BAR_GLANCEABLE_MIN_WIDTH - 1)).toBe('wrapped');
    expect(statusBarLayout(STATUS_BAR_GLANCEABLE_MIN_WIDTH)).toBe('single-line');
    expect(statusBarLayout(1280)).toBe('single-line');
  });

  it('carries the container rule in one form: the strip anchors it, the variants mirror the constant', () => {
    // The rule's CSS arm: every width token in the container variants is the
    // one constant (container conditions cannot read a JS value), and the
    // strip element declares itself the query anchor. The rehearsal scans
    // the panel shell — a second copy of the literal anywhere else would
    // render with this constant's meaning and evade the file-local parse.
    // The `pages/` subtree is out of scope: page bodies carry the UI/UX bar's
    // own layout tiers on their own `PageFrame` container — a different
    // concept that merely shares the number.
    const source = readFileSync(`${import.meta.dirname}/status-bar.tsx`, 'utf8');
    const tokens = [...source.matchAll(/@min-\[(\d+)px\]/g)].map((match) => Number(match[1]));
    expect(tokens.length).toBeGreaterThan(0);
    expect(new Set(tokens)).toEqual(new Set([STATUS_BAR_GLANCEABLE_MIN_WIDTH]));
    expect(source).toMatch(/@container /);

    const pagesDir = `${import.meta.dirname}/../pages`;
    // The exclusion must name a real folder, or it silently excludes nothing.
    expect(existsSync(pagesDir)).toBe(true);
    /** Every non-test source file under the panel shell, recursively (`pages/` excluded). */
    function sourcesUnder(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return path === pagesDir ? [] : sourcesUnder(path);
        // '.d.ts'/'.test.' files never render the class; tests legitimately
        // quote the literal to pin it.
        const source = entry.name.endsWith('.ts') || entry.name.endsWith('.tsx');
        if (!source || entry.name.includes('.test.') || entry.name.endsWith('.d.ts')) return [];
        return entry.name === 'status-bar.tsx' ? [] : [path];
      });
    }
    const strays = sourcesUnder(`${import.meta.dirname}/..`).filter((path) =>
      readFileSync(path, 'utf8').includes('@min-[480px]')
    );
    expect(strays).toEqual([]);
  });
});
