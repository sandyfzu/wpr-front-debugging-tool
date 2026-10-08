/**
 * The badge state machine's guarantees, end to end as effects (the glue's
 * browser action calls stay thin): presence decides the dot, navigation
 * clears before any new page answers, absence clears regardless of what this
 * worker's memory thinks (the browser outlives it), a closed tab leaves no
 * state, and the option gate can never render a badge the user didn't ask
 * for — including the stranded ones a restart left behind.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { describe, expect, it } from 'vitest';
import {
  applyBadgeEffect,
  badgeFor,
  createBadgeState,
  watchBadgeGate,
  type BadgeEffect,
  type BadgeRuntime
} from './badge';
import { optionsStore } from '../../lib/storage/options';
import type { DetectionSummary } from '../../lib/messaging/validate';

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
  it('gives the cached state one color and present-but-uncached another, as dots', () => {
    const cached = badgeFor(CACHED_WPR);
    const uncached = badgeFor(UNCACHED_WPR);
    // The exact colors are pinned: green reads as cached, blue as present,
    // and the two states must always stay distinguishable at a glance.
    expect(cached).toEqual({ text: '●', color: '#1a7f37' });
    expect(uncached).toEqual({ text: '●', color: '#0969da' });
    expect(cached?.color).not.toBe(uncached?.color);
  });

  it('clears non-present summaries and gives null inputs nothing', () => {
    expect(badgeFor(NO_WPR)).toBeNull();
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

  it('absence reports always clear, applied and never-applied tabs alike', () => {
    const state = createBadgeState();
    state.setFeatureEnabled(true);
    state.processSummary(9, CACHED_WPR);
    expect(state.processSummary(9, NO_WPR)).toEqual<BadgeEffect | null>({
      kind: 'clear',
      tabId: 9
    });
    // Memory cannot veto a clear: after a service-worker restart Chrome may
    // still render a badge this fresh instance never saw, so every absence
    // report answers with the write that removes it — for an applied tab
    // again, and for a tab whose badge it cannot recall at all.
    expect(state.processSummary(9, NO_WPR)).toEqual<BadgeEffect | null>({
      kind: 'clear',
      tabId: 9
    });
    expect(state.processSummary(12, NO_WPR)).toEqual<BadgeEffect | null>({
      kind: 'clear',
      tabId: 12
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

describe('restart guarantee (the browser outlives this worker)', () => {
  it('an absence report clears before the gate ever resolves; badge-worthy stays unrendered', () => {
    const state = createBadgeState();
    expect(state.processSummary(11, NO_WPR)).toEqual<BadgeEffect | null>({
      kind: 'clear',
      tabId: 11
    });
    expect(state.processSummary(11, CACHED_WPR)).toBeNull();
  });

  it('a gate resolving off sweeps stranded badges across every tab (glue)', async () => {
    fakeBrowser.reset();
    await fakeBrowser.tabs.create({ url: 'https://site.test/one' });
    await fakeBrowser.tabs.create({ url: 'https://site.test/two' });
    await optionsStore.setValue({
      improvements: { 'wp-dashboard-dbugger-entry': true },
      appearance: 'system',
      features: { toolbarBadge: false }
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
