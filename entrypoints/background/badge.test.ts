/**
 * The badge state machine's guarantees, end to end as effects (the glue's
 * browser action calls stay thin): every reported page gets its state dot —
 * green cached, blue present-uncached, gray no WP Rocket (owner decision,
 * 2026-10-08) — navigation clears before any new page answers, a closed tab
 * leaves no state, and the option gate can never render a badge the user
 * didn't ask for — including the stranded ones a restart left behind. The
 * tooltip travels with the dot: each state's words on a set, the manifest's
 * default tooltip on every clear.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBadgeEffect,
  badgeFor,
  createBadgeApplier,
  badgeTitleFor,
  clearBadgeEffect,
  createBadgeState,
  initBadge,
  watchBadgeGate,
  type BadgeEffect,
  type BadgeRuntime
} from './badge';
import { optionsStore } from '../../lib/storage/options';
import type { DetectionSummary } from '../../lib/messaging/validate';
import type { ToolbarDisplayApi, ToolbarTitles } from './toolbar-action';

const CACHED_WPR = { wprPresent: true, cached: true } satisfies DetectionSummary;
const UNCACHED_WPR = { wprPresent: true, cached: false } satisfies DetectionSummary;
const NO_WPR = { wprPresent: false, cached: false } satisfies DetectionSummary;

/** Tooltip texts as the glue reads them from the manifest (any values: passed through). */
const TITLES: ToolbarTitles = { name: 'Tool', defaultTitle: 'Tool tip' };

/** The tooltip any summary's set effect carries, unwrapped for effects. */
function titleOf(summary: DetectionSummary): string {
  const title = badgeTitleFor(summary, TITLES.name);
  if (title === null) throw new RangeError('expected a badge title for this summary');
  return title;
}

/** The dot any displayed-producing summary turns into, unwrapped for effects. */
function dotFor(summary: DetectionSummary): NonNullable<ReturnType<typeof badgeFor>> {
  const dot = badgeFor(summary);
  if (dot === null) throw new RangeError('expected a badge dot for this summary');
  return dot;
}

describe('badgeFor', () => {
  it('gives the cached, present-uncached and absent states three distinct dots', () => {
    const cached = badgeFor(CACHED_WPR);
    const uncached = badgeFor(UNCACHED_WPR);
    const absent = badgeFor(NO_WPR);
    // The exact colors are pinned: green reads as cached, blue as present,
    // gray as no WP Rocket, and the three states must always stay
    // distinguishable at a glance (every reported page carries one — owner
    // decision, 2026-10-08).
    expect(cached).toEqual({ text: '●', color: '#1a7f37' });
    expect(uncached).toEqual({ text: '●', color: '#0969da' });
    expect(absent).toEqual({ text: '●', color: '#6e7781' });
    expect(new Set([cached?.color, uncached?.color, absent?.color]).size).toBe(3);
  });

  it('gives null inputs nothing', () => {
    expect(badgeFor(null)).toBeNull();
  });
});

describe('badgeTitleFor', () => {
  it('names each state in words after the extension name', () => {
    // Pinned words: the tooltip is the only place the dot's color is explained.
    expect(badgeTitleFor(CACHED_WPR, 'Tool')).toBe(
      'Tool · WP Rocket active, page served from cache'
    );
    expect(badgeTitleFor(UNCACHED_WPR, 'Tool')).toBe(
      'Tool · WP Rocket active, page not served from cache'
    );
    expect(badgeTitleFor(NO_WPR, 'Tool')).toBe('Tool · WP Rocket not detected');
  });

  it('reads absence before the cache verdict (a page without WP Rocket is never "cached")', () => {
    expect(badgeTitleFor({ wprPresent: false, cached: true }, 'Tool')).toBe(
      'Tool · WP Rocket not detected'
    );
    expect(badgeFor({ wprPresent: false, cached: true })).toEqual(dotFor(NO_WPR));
  });

  it('gives null inputs nothing', () => {
    expect(badgeTitleFor(null, 'Tool')).toBeNull();
  });
});

describe('clearBadgeEffect', () => {
  it("returns the tab to the manifest's default tooltip", () => {
    expect(clearBadgeEffect(6, TITLES)).toEqual<BadgeEffect>({
      kind: 'clear',
      tabId: 6,
      title: 'Tool tip'
    });
  });
});

describe('feature gate', () => {
  it('renders nothing while the gate is unresolved, then re-applies from records', () => {
    const state = createBadgeState(TITLES);
    // First moments of a session: a summary arrives before options resolved.
    expect(state.processSummary(1, CACHED_WPR)).toBeNull();
    // The gate resolves on — the kept summary is all that's needed.
    expect(state.setFeatureEnabled(true)).toEqual<BadgeEffect[]>([
      { kind: 'set', tabId: 1, display: dotFor(CACHED_WPR), title: titleOf(CACHED_WPR) }
    ]);
  });

  it('never renders while off, and switching off clears every applied badge', () => {
    const state = createBadgeState(TITLES);
    state.setFeatureEnabled(true);
    state.processSummary(1, CACHED_WPR);
    state.processSummary(2, UNCACHED_WPR);
    const clears = state.setFeatureEnabled(false);
    expect(clears.map((effect) => effect.kind)).toEqual(['clear', 'clear']);
    expect(clears.map((effect) => (effect.kind === 'clear' ? effect.tabId : null)).sort()).toEqual([
      1, 2
    ]);
    // Reports keep arriving while off: recorded only, no browser writes.
    expect(state.processSummary(3, CACHED_WPR)).toBeNull();
  });

  it('re-enabling without a page reprocess restores the kept badges', () => {
    const state = createBadgeState(TITLES);
    state.setFeatureEnabled(true);
    state.processSummary(5, UNCACHED_WPR);
    state.setFeatureEnabled(false);
    expect(state.setFeatureEnabled(true)).toEqual<BadgeEffect[]>([
      { kind: 'set', tabId: 5, display: dotFor(UNCACHED_WPR), title: titleOf(UNCACHED_WPR) }
    ]);
  });

  it('absence reports render the neutral dot, replacing whatever the tab showed', () => {
    const state = createBadgeState(TITLES);
    state.setFeatureEnabled(true);
    state.processSummary(9, CACHED_WPR);
    // A non-WP-Rocket page is a visible state of its own (owner decision,
    // 2026-10-08): the gray dot replaces the old page's dot, applied or not,
    // and repeating the report repeats the honest write.
    expect(state.processSummary(9, NO_WPR)).toEqual<BadgeEffect | null>({
      kind: 'set',
      tabId: 9,
      display: dotFor(NO_WPR),
      title: titleOf(NO_WPR)
    });
    expect(state.processSummary(9, NO_WPR)).toEqual<BadgeEffect | null>({
      kind: 'set',
      tabId: 9,
      display: dotFor(NO_WPR),
      title: titleOf(NO_WPR)
    });
    expect(state.processSummary(12, NO_WPR)).toEqual<BadgeEffect | null>({
      kind: 'set',
      tabId: 12,
      display: dotFor(NO_WPR),
      title: titleOf(NO_WPR)
    });
  });

  it('an off-gate report is recorded but silent', () => {
    const state = createBadgeState(TITLES);
    state.setFeatureEnabled(false);
    state.processSummary(2, CACHED_WPR);
    expect(state.processSummary(2, CACHED_WPR)).toBeNull();
  });
});

describe('navigation and cleanup', () => {
  it('navigation clears unconditionally; unknown tabs clear too, never a no-op', () => {
    const state = createBadgeState(TITLES);
    // Fresh memory cannot know whether Chrome still renders a stranded badge
    // (a restart emptied it): every navigation answers with the clear.
    expect(state.navigationStarted(3)).toEqual<BadgeEffect | null>({
      kind: 'clear',
      tabId: 3,
      title: TITLES.defaultTitle
    });
    state.setFeatureEnabled(true);
    state.processSummary(3, CACHED_WPR);
    state.navigationStarted(3);
    // Idempotent by write: yet another navigation answers the same way — the
    // browser write is free, a stale badge is not.
    expect(state.navigationStarted(3)).toEqual<BadgeEffect | null>({
      kind: 'clear',
      tabId: 3,
      title: TITLES.defaultTitle
    });
  });

  it('a closed tab leaves no state behind for a later gate change', () => {
    const state = createBadgeState(TITLES);
    state.setFeatureEnabled(false); // off — reports are recorded by design
    state.processSummary(8, CACHED_WPR);
    state.tabRemoved(8);
    // The recorded badge has nowhere to apply anymore — across re-enables too.
    expect(state.setFeatureEnabled(true)).toEqual<BadgeEffect[]>([]);
  });

  it('navigation drops the known summary along with the badge', () => {
    const state = createBadgeState(TITLES);
    state.setFeatureEnabled(true);
    state.processSummary(4, CACHED_WPR);
    state.navigationStarted(4);
    // Re-arming keeps no stale badge for the navigated-away page.
    expect(state.setFeatureEnabled(true)).toEqual<BadgeEffect[]>([]);
  });
});

describe('the applier (the browser seam behind the effects)', () => {
  it('renders the dot as a colored glyph over a transparent tile; clear leaves nothing', async () => {
    fakeBrowser.reset();
    await fakeBrowser.tabs.create({ url: 'https://site.test/badge' });
    const tabId = (await fakeBrowser.tabs.query({}))[0]?.id;
    if (tabId === undefined) throw new RangeError('expected a seeded tab');
    await applyBadgeEffect({
      kind: 'set',
      tabId,
      display: dotFor(CACHED_WPR),
      title: titleOf(CACHED_WPR)
    });
    // The fake answers the callback-shaped values (bare string for the text,
    // the raw color values) — exactly what a debug pane would see.
    expect(await fakeBrowser.action.getBadgeText({ tabId })).toBe('●');
    expect(await fakeBrowser.action.getBadgeTextColor({ tabId })).toBe('#1a7f37');
    expect(await fakeBrowser.action.getBadgeBackgroundColor({ tabId })).toEqual([0, 0, 0, 0]);
    expect(await fakeBrowser.action.getTitle({ tabId })).toBe(
      'Tool · WP Rocket active, page served from cache'
    );
    await applyBadgeEffect(clearBadgeEffect(tabId, TITLES));
    expect(await fakeBrowser.action.getBadgeText({ tabId })).toBe('');
    expect(await fakeBrowser.action.getTitle({ tabId })).toBe('Tool tip');
  });
});

describe('the applier on an injected toolbar API (the Manifest V2 namespace shape)', () => {
  /** A toolbar API recording each write as `[method, details]`, in call order. */
  /**
   * A toolbar API recording each write as `[method, details]`, in call order;
   * the method named by `failing` rejects (after being recorded).
   */
  function recordingApi(failing?: string): {
    api: ToolbarDisplayApi;
    calls: Array<[string, unknown]>;
  } {
    const calls: Array<[string, unknown]> = [];
    const record =
      (method: string) =>
      (details: unknown): Promise<void> => {
        calls.push([method, details]);
        return method === failing
          ? Promise.reject(new Error(`${method} refused`))
          : Promise.resolve();
      };
    const api = {
      setBadgeText: record('setBadgeText'),
      setBadgeBackgroundColor: record('setBadgeBackgroundColor'),
      setBadgeTextColor: record('setBadgeTextColor'),
      setTitle: record('setTitle')
    } as unknown as ToolbarDisplayApi;
    return { api, calls };
  }

  const UNCACHED_SET: BadgeEffect = {
    kind: 'set',
    tabId: 4,
    display: dotFor(UNCACHED_WPR),
    title: titleOf(UNCACHED_WPR)
  };

  it('set: title, tile, text color, text (last); clear: empty text, then the default title', async () => {
    const { api, calls } = recordingApi();
    await applyBadgeEffect(UNCACHED_SET, api);
    await applyBadgeEffect(clearBadgeEffect(4, TITLES), api);
    expect(calls).toEqual([
      ['setTitle', { tabId: 4, title: 'Tool · WP Rocket active, page not served from cache' }],
      ['setBadgeBackgroundColor', { tabId: 4, color: [0, 0, 0, 0] }],
      ['setBadgeTextColor', { tabId: 4, color: '#0969da' }],
      ['setBadgeText', { tabId: 4, text: '●' }],
      ['setBadgeText', { tabId: 4, text: '' }],
      ['setTitle', { tabId: 4, title: 'Tool tip' }]
    ]);
  });

  it('a refused title write renders no dot (logged, resolves): a dot always has its words', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { api, calls } = recordingApi('setTitle');
      await expect(applyBadgeEffect(UNCACHED_SET, api)).resolves.toBeUndefined();
      expect(calls.map(([method]) => method)).toEqual(['setTitle']);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toBe('[WPR FDT] [badge] Badge update ignored');
    } finally {
      warn.mockRestore();
    }
  });

  it('a refused title reset after a clear still removed the dot first (logged, resolves)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { api, calls } = recordingApi('setTitle');
      await expect(applyBadgeEffect(clearBadgeEffect(4, TITLES), api)).resolves.toBeUndefined();
      expect(calls).toEqual([
        ['setBadgeText', { tabId: 4, text: '' }],
        ['setTitle', { tabId: 4, title: 'Tool tip' }]
      ]);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it('logs and resolves when the browser has no toolbar API (never throws per update)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(applyBadgeEffect(clearBadgeEffect(9, TITLES), null)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toBe(
        '[WPR FDT] [badge] Badge update ignored: no toolbar button API'
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('refuses to boot without a toolbar API, naming the namespace this build expects', () => {
    expect(() => initBadge(null)).toThrow('No toolbar button API (browser.action) in this browser');
  });

  it('refuses to boot when the tooltip texts cannot be read', () => {
    const { api } = recordingApi();
    expect(() =>
      initBadge(api, () => {
        throw new Error('The extension manifest carries no usable name');
      })
    ).toThrow('The extension manifest carries no usable name');
  });
});

describe('the per-tab serial applier (every toolbar write goes through it)', () => {
  /** What the browser shows for one tab: the badge text and the tooltip. */
  interface Shown {
    text: string;
    title: string;
  }

  /**
   * A browser-like toolbar API: each write lands on call (as the browser
   * applies it) and its promise settles after `delayOf(method)` ms, so two
   * unserialized effects interleave exactly like a busy worker's awaits.
   */
  function slowBrowser(delayOf: (method: string) => number): {
    api: ToolbarDisplayApi;
    shown: Map<number, Shown>;
  } {
    const shown = new Map<number, Shown>();
    const at = (tabId: number): Shown => {
      const tab = shown.get(tabId) ?? { text: '', title: 'unset' };
      shown.set(tabId, tab);
      return tab;
    };
    const write =
      (method: string, land: (tab: Shown, details: Record<string, unknown>) => void) =>
      (details: Record<string, unknown> & { tabId: number }): Promise<void> => {
        land(at(details.tabId), details);
        return new Promise((resolve) => setTimeout(resolve, delayOf(method)));
      };
    const api = {
      setBadgeText: write('setBadgeText', (tab, details) => {
        tab.text = String(details.text);
      }),
      setTitle: write('setTitle', (tab, details) => {
        tab.title = String(details.title);
      }),
      setBadgeBackgroundColor: write('setBadgeBackgroundColor', () => undefined),
      setBadgeTextColor: write('setBadgeTextColor', () => undefined)
    } as unknown as ToolbarDisplayApi;
    return { api, shown };
  }

  const SET: BadgeEffect = {
    kind: 'set',
    tabId: 3,
    display: dotFor(NO_WPR),
    title: titleOf(NO_WPR)
  };
  const CLEAR = clearBadgeEffect(3, TITLES);
  /** Delays that make an unserialized clear→set end with the dot under the default title. */
  const slowClear = (method: string): number => (method === 'setBadgeText' ? 10 : 1);
  /** Delays that make an unserialized set→clear end with a dot after the clear. */
  const slowSet = (method: string): number => (method === 'setBadgeTextColor' ? 10 : 1);

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('the race is real: unserialized clear→set ends with the dot under the default title', async () => {
    vi.useFakeTimers();
    const { api, shown } = slowBrowser(slowClear);
    const both = Promise.all([applyBadgeEffect(CLEAR, api), applyBadgeEffect(SET, api)]);
    await vi.runAllTimersAsync();
    await both;
    expect(shown.get(3)).toEqual({ text: '●', title: TITLES.defaultTitle });
  });

  it('overlapping clear→set ends in the set (dot with its words)', async () => {
    vi.useFakeTimers();
    const { api, shown } = slowBrowser(slowClear);
    const applier = createBadgeApplier(api);
    const both = Promise.all([applier.apply(CLEAR), applier.apply(SET)]);
    await vi.runAllTimersAsync();
    await both;
    expect(shown.get(3)).toEqual({ text: '●', title: titleOf(NO_WPR) });
  });

  it('overlapping set→clear ends in the clear (no dot, default title)', async () => {
    vi.useFakeTimers();
    // Control: the same delays unserialized leave a dot behind the clear.
    const raw = slowBrowser(slowSet);
    const unserialized = Promise.all([
      applyBadgeEffect(SET, raw.api),
      applyBadgeEffect(CLEAR, raw.api)
    ]);
    await vi.runAllTimersAsync();
    await unserialized;
    expect(raw.shown.get(3)).toEqual({ text: '●', title: TITLES.defaultTitle });

    const { api, shown } = slowBrowser(slowSet);
    const applier = createBadgeApplier(api);
    const both = Promise.all([applier.apply(SET), applier.apply(CLEAR)]);
    await vi.runAllTimersAsync();
    await both;
    expect(shown.get(3)).toEqual({ text: '', title: TITLES.defaultTitle });
  });

  it('tabs stay independent: a slow tab never delays another', async () => {
    vi.useFakeTimers();
    const order: number[] = [];
    const applier = createBadgeApplier(null, (effect) => {
      const ms = effect.tabId === 1 ? 50 : 1;
      return new Promise((resolve) =>
        setTimeout(() => {
          order.push(effect.tabId);
          resolve();
        }, ms)
      );
    });
    const all = Promise.all([
      applier.apply(clearBadgeEffect(1, TITLES)),
      applier.apply(clearBadgeEffect(2, TITLES))
    ]);
    expect(applier.pendingTabs()).toBe(2);
    await vi.runAllTimersAsync();
    await all;
    expect(order).toEqual([2, 1]);
  });

  it('a rejecting or throwing write never stalls the tab: the next effect still lands (logged)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ran: string[] = [];
    let call = 0;
    const applier = createBadgeApplier(null, (effect) => {
      call += 1;
      if (call === 1) return Promise.reject(new Error('refused'));
      if (call === 2) throw new Error('thrown');
      ran.push(effect.kind);
      return Promise.resolve();
    });
    await expect(
      Promise.all([applier.apply(SET), applier.apply(SET), applier.apply(CLEAR)])
    ).resolves.toEqual([undefined, undefined, undefined]);
    expect(ran).toEqual(['clear']);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toBe('[WPR FDT] [badge] Badge update ignored');
  });

  it('keeps no entry once a tab settles (closed tabs leak nothing); null queues nothing', async () => {
    const applier = createBadgeApplier(null, () => Promise.resolve());
    await expect(applier.apply(null)).resolves.toBeUndefined();
    expect(applier.pendingTabs()).toBe(0);
    const first = applier.apply(SET);
    const second = applier.apply(CLEAR);
    expect(applier.pendingTabs()).toBe(1);
    await first;
    // The newer effect still owns the entry while it runs.
    expect(applier.pendingTabs()).toBe(1);
    await second;
    expect(applier.pendingTabs()).toBe(0);
  });

  it('the runtime and its summary listener share one queue (a navigation clear, then a push)', async () => {
    vi.useFakeTimers();
    fakeBrowser.reset();
    const { api, shown } = slowBrowser(slowClear);
    // One listener per channel per context: the only successful init in this file.
    const runtime = initBadge(api, () => TITLES);
    expect(runtime.setFeatureEnabled(true)).toEqual([]);
    // The header capture's navigation clear, then the new page's push —
    // the very pair that raced before.
    const cleared = runtime.apply(runtime.navigationStarted(3));
    const pushed = fakeBrowser.runtime.onMessage.trigger(
      { id: 1, type: 'reportDetectionSummary', data: NO_WPR, timestamp: Date.now() },
      { tab: { id: 3 }, frameId: 0 } as unknown as Parameters<
        typeof fakeBrowser.runtime.onMessage.trigger
      >[1],
      () => undefined
    );
    await vi.runAllTimersAsync();
    await Promise.all([cleared, pushed]);
    expect(shown.get(3)).toEqual({ text: '●', title: titleOf(NO_WPR) });
    // And the runtime's own apply joins the same queue after the push.
    const later = runtime.apply(CLEAR);
    await vi.runAllTimersAsync();
    await later;
    expect(shown.get(3)).toEqual({ text: '', title: TITLES.defaultTitle });
  });
});

describe('restart guarantee (the browser outlives this worker)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pre-gate reports render nothing; the gate resolving on re-renders them all', () => {
    const state = createBadgeState(TITLES);
    // Absence and badge-worthy alike stay unrendered before the gate resolves:
    // no wrong badge in between, no flash before options are read.
    expect(state.processSummary(11, NO_WPR)).toBeNull();
    expect(state.processSummary(11, CACHED_WPR)).toBeNull();
    // The gate resolves on — the kept records now carry their states,
    // gray absence included (the last report on the tab wins).
    expect(state.setFeatureEnabled(true)).toEqual<BadgeEffect[]>([
      { kind: 'set', tabId: 11, display: dotFor(CACHED_WPR), title: titleOf(CACHED_WPR) }
    ]);
  });

  it('a gate resolving off sweeps stranded badges across every tab (glue)', async () => {
    fakeBrowser.reset();
    await fakeBrowser.tabs.create({ url: 'https://site.test/one' });
    await fakeBrowser.tabs.create({ url: 'https://site.test/two' });
    await optionsStore.setValue({
      improvements: { 'wp-dashboard-dbugger-entry': true },
      appearance: 'system',
      features: {
        toolbarBadge: false,
        sbsScrollSync: false,
        sbsMobileSim: false,
        sbsDesktopWidth: false,
        detectionWidget: true
      }
    });
    // The sweep reads the default tooltip from the manifest (the fake has none).
    vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
      manifest_version: 3,
      name: TITLES.name,
      version: '1.0.0',
      action: { default_title: TITLES.defaultTitle }
    });
    // Stranded state: badges + tooltips Chrome holds that no fresh state
    // model knows of.
    const ids = (await fakeBrowser.tabs.query({}))
      .map((tab) => tab.id)
      .filter((id): id is number => typeof id === 'number');
    for (const id of ids) {
      await fakeBrowser.action.setBadgeText({ tabId: id, text: '●' });
      await fakeBrowser.action.setTitle({ tabId: id, title: titleOf(CACHED_WPR) });
    }
    // The real glue minus the message wiring: the state machine behind the
    // runtime is exactly what production binds, and the applier is real.
    const state = createBadgeState(TITLES);
    const runtime: BadgeRuntime = {
      processSummary: (tabId, summary) => state.processSummary(tabId, summary),
      navigationStarted: (tabId) => state.navigationStarted(tabId),
      tabRemoved: (tabId) => {
        state.tabRemoved(tabId);
      },
      setFeatureEnabled: (enabled) => state.setFeatureEnabled(enabled),
      apply: applyBadgeEffect
    };
    expect(state.setFeatureEnabled(false)).toEqual<BadgeEffect[]>([]);

    await watchBadgeGate(runtime);
    for (const id of ids) {
      // The fake answers the callback-shaped bare string (`getScopedValue`
      // unwraps to a string, not a result-details wrapper) — assert on it.
      expect(await fakeBrowser.action.getBadgeText({ tabId: id })).toBe('');
      expect(await fakeBrowser.action.getTitle({ tabId: id })).toBe(TITLES.defaultTitle);
    }
  });

  it("the gate's sweep and model clears write only through the runtime's queue", async () => {
    fakeBrowser.reset();
    const tab = await fakeBrowser.tabs.create({ url: 'https://site.test/one' });
    await optionsStore.setValue({
      improvements: { 'wp-dashboard-dbugger-entry': true },
      appearance: 'system',
      features: {
        toolbarBadge: false,
        sbsScrollSync: false,
        sbsMobileSim: false,
        sbsDesktopWidth: false,
        detectionWidget: true
      }
    });
    vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
      manifest_version: 3,
      name: TITLES.name,
      version: '1.0.0',
      action: { default_title: TITLES.defaultTitle }
    });
    const direct = vi.spyOn(fakeBrowser.action, 'setBadgeText');
    const state = createBadgeState(TITLES);
    state.setFeatureEnabled(true);
    // A badge the model knows (tab 77) besides the browser's real tab.
    expect(state.processSummary(77, CACHED_WPR)).not.toBeNull();
    const apply = vi.fn<BadgeRuntime['apply']>(() => Promise.resolve());
    await watchBadgeGate({
      processSummary: (tabId, summary) => state.processSummary(tabId, summary),
      navigationStarted: (tabId) => state.navigationStarted(tabId),
      tabRemoved: (tabId) => {
        state.tabRemoved(tabId);
      },
      setFeatureEnabled: (enabled) => state.setFeatureEnabled(enabled),
      apply
    });
    const ids = (await fakeBrowser.tabs.query({}))
      .map((each) => each.id)
      .filter((id): id is number => typeof id === 'number');
    expect(ids).toContain(tab.id);
    // Every browser tab swept, then the model's own known badge.
    expect(apply.mock.calls).toEqual([
      ...ids.map((id) => [clearBadgeEffect(id, TITLES)]),
      [clearBadgeEffect(77, TITLES)]
    ]);
    expect(direct).not.toHaveBeenCalled();
  });
});
