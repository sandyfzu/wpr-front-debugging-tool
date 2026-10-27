/**
 * The badge state machine's guarantees, end to end as effects (the glue's
 * browser action calls stay thin): every reported page gets its state dot —
 * green cached, blue present-uncached, gray no WP Rocket (owner decision,
 * 2026-10-08) — navigation clears before any new page answers, a closed tab
 * leaves no state, and the option gate can never render a badge the user
 * didn't ask for — including the stranded ones a restart left behind.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { describe, expect, it, vi } from 'vitest';
import {
  applyBadgeEffect,
  badgeFor,
  createBadgeState,
  initBadge,
  watchBadgeGate,
  type BadgeEffect,
  type BadgeRuntime
} from './badge';
import { optionsStore } from '../../lib/storage/options';
import type { DetectionSummary } from '../../lib/messaging/validate';
import type { ToolbarBadgeApi } from './toolbar-action';

const CACHED_WPR = { wprPresent: true, cached: true } satisfies DetectionSummary;
const UNCACHED_WPR = { wprPresent: true, cached: false } satisfies DetectionSummary;
const NO_WPR = { wprPresent: false, cached: false } satisfies DetectionSummary;

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

describe('feature gate', () => {
  it('renders nothing while the gate is unresolved, then re-applies from records', () => {
    const state = createBadgeState();
    // First moments of a session: a summary arrives before options resolved.
    expect(state.processSummary(1, CACHED_WPR)).toBeNull();
    // The gate resolves on — the kept summary is all that's needed.
    expect(state.setFeatureEnabled(true)).toEqual<BadgeEffect[]>([
      { kind: 'set', tabId: 1, display: dotFor(CACHED_WPR) }
    ]);
  });

  it('never renders while off, and switching off clears every applied badge', () => {
    const state = createBadgeState();
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
    const state = createBadgeState();
    state.setFeatureEnabled(true);
    state.processSummary(5, UNCACHED_WPR);
    state.setFeatureEnabled(false);
    expect(state.setFeatureEnabled(true)).toEqual<BadgeEffect[]>([
      { kind: 'set', tabId: 5, display: dotFor(UNCACHED_WPR) }
    ]);
  });

  it('absence reports render the neutral dot, replacing whatever the tab showed', () => {
    const state = createBadgeState();
    state.setFeatureEnabled(true);
    state.processSummary(9, CACHED_WPR);
    // A non-WP-Rocket page is a visible state of its own (owner decision,
    // 2026-10-08): the gray dot replaces the old page's dot, applied or not,
    // and repeating the report repeats the honest write.
    expect(state.processSummary(9, NO_WPR)).toEqual<BadgeEffect | null>({
      kind: 'set',
      tabId: 9,
      display: dotFor(NO_WPR)
    });
    expect(state.processSummary(9, NO_WPR)).toEqual<BadgeEffect | null>({
      kind: 'set',
      tabId: 9,
      display: dotFor(NO_WPR)
    });
    expect(state.processSummary(12, NO_WPR)).toEqual<BadgeEffect | null>({
      kind: 'set',
      tabId: 12,
      display: dotFor(NO_WPR)
    });
  });

  it('an off-gate report is recorded but silent', () => {
    const state = createBadgeState();
    state.setFeatureEnabled(false);
    state.processSummary(2, CACHED_WPR);
    expect(state.processSummary(2, CACHED_WPR)).toBeNull();
  });
});

describe('navigation and cleanup', () => {
  it('navigation clears unconditionally; unknown tabs clear too, never a no-op', () => {
    const state = createBadgeState();
    // Fresh memory cannot know whether Chrome still renders a stranded badge
    // (a restart emptied it): every navigation answers with the clear.
    expect(state.navigationStarted(3)).toEqual<BadgeEffect | null>({
      kind: 'clear',
      tabId: 3
    });
    state.setFeatureEnabled(true);
    state.processSummary(3, CACHED_WPR);
    state.navigationStarted(3);
    // Idempotent by write: yet another navigation answers the same way — the
    // browser write is free, a stale badge is not.
    expect(state.navigationStarted(3)).toEqual<BadgeEffect | null>({
      kind: 'clear',
      tabId: 3
    });
  });

  it('a closed tab leaves no state behind for a later gate change', () => {
    const state = createBadgeState();
    state.setFeatureEnabled(false); // off — reports are recorded by design
    state.processSummary(8, CACHED_WPR);
    state.tabRemoved(8);
    // The recorded badge has nowhere to apply anymore — across re-enables too.
    expect(state.setFeatureEnabled(true)).toEqual<BadgeEffect[]>([]);
  });

  it('navigation drops the known summary along with the badge', () => {
    const state = createBadgeState();
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
    await applyBadgeEffect({ kind: 'set', tabId, display: dotFor(CACHED_WPR) });
    // The fake answers the callback-shaped values (bare string for the text,
    // the raw color values) — exactly what a debug pane would see.
    expect(await fakeBrowser.action.getBadgeText({ tabId })).toBe('●');
    expect(await fakeBrowser.action.getBadgeTextColor({ tabId })).toBe('#1a7f37');
    expect(await fakeBrowser.action.getBadgeBackgroundColor({ tabId })).toEqual([0, 0, 0, 0]);
    await applyBadgeEffect({ kind: 'clear', tabId });
    expect(await fakeBrowser.action.getBadgeText({ tabId })).toBe('');
  });
});

describe('the applier on an injected toolbar API (the Manifest V2 namespace shape)', () => {
  /** A toolbar API recording each write as `[method, details]`, in call order. */
  function recordingApi(): { api: ToolbarBadgeApi; calls: Array<[string, unknown]> } {
    const calls: Array<[string, unknown]> = [];
    const record =
      (method: string) =>
      (details: unknown): Promise<void> => {
        calls.push([method, details]);
        return Promise.resolve();
      };
    const api = {
      setBadgeText: record('setBadgeText'),
      setBadgeBackgroundColor: record('setBadgeBackgroundColor'),
      setBadgeTextColor: record('setBadgeTextColor')
    } as unknown as ToolbarBadgeApi;
    return { api, calls };
  }

  it('writes tile, text color, text (last), clear = empty text, through the injected API', async () => {
    const { api, calls } = recordingApi();
    await applyBadgeEffect({ kind: 'set', tabId: 4, display: dotFor(UNCACHED_WPR) }, api);
    await applyBadgeEffect({ kind: 'clear', tabId: 4 }, api);
    expect(calls).toEqual([
      ['setBadgeBackgroundColor', { tabId: 4, color: [0, 0, 0, 0] }],
      ['setBadgeTextColor', { tabId: 4, color: '#0969da' }],
      ['setBadgeText', { tabId: 4, text: '●' }],
      ['setBadgeText', { tabId: 4, text: '' }]
    ]);
  });

  it('logs and resolves when the browser has no toolbar API (never throws per update)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(applyBadgeEffect({ kind: 'clear', tabId: 9 }, null)).resolves.toBeUndefined();
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
});

describe('restart guarantee (the browser outlives this worker)', () => {
  it('pre-gate reports render nothing; the gate resolving on re-renders them all', () => {
    const state = createBadgeState();
    // Absence and badge-worthy alike stay unrendered before the gate resolves:
    // no wrong badge in between, no flash before options are read.
    expect(state.processSummary(11, NO_WPR)).toBeNull();
    expect(state.processSummary(11, CACHED_WPR)).toBeNull();
    // The gate resolves on — the kept records now carry their states,
    // gray absence included (the last report on the tab wins).
    expect(state.setFeatureEnabled(true)).toEqual<BadgeEffect[]>([
      { kind: 'set', tabId: 11, display: dotFor(CACHED_WPR) }
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
        sbsDesktopWidth: false
      }
    });
    // Stranded state: badges Chrome holds that no fresh state model knows of.
    const ids = (await fakeBrowser.tabs.query({}))
      .map((tab) => tab.id)
      .filter((id): id is number => typeof id === 'number');
    for (const id of ids) {
      await fakeBrowser.action.setBadgeText({ tabId: id, text: '●' });
    }
    // The real glue minus the message wiring: the state machine behind the
    // runtime is exactly what production binds, and the applier is real.
    const state = createBadgeState();
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
    }
  });
});
