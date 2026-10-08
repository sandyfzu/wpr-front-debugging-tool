/**
 * The badge state machine's guarantees, end to end as effects (the glue's
 * browser action calls stay thin): presence decides the dot, navigation
 * clears before any new page answers, a closed tab leaves no state, and the
 * option gate can never render a badge the user didn't ask for.
 */
import { describe, expect, it } from 'vitest';
import { badgeFor, createBadgeState, type BadgeEffect } from './badge';
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

  it('clears a summary-less presence report when a badge was applied for the tab', () => {
    const state = createBadgeState();
    state.setFeatureEnabled(true);
    state.processSummary(9, CACHED_WPR);
    expect(state.processSummary(9, NO_WPR)).toEqual<BadgeEffect | null>({
      kind: 'clear',
      tabId: 9
    });
    // A further never-applied non-presence report is a no-op.
    expect(state.processSummary(9, NO_WPR)).toBeNull();
  });

  it('an off-gate report is recorded but silent', () => {
    const state = createBadgeState();
    state.setFeatureEnabled(false);
    state.processSummary(2, CACHED_WPR);
    expect(state.processSummary(2, CACHED_WPR)).toBeNull();
  });
});

describe('navigation and cleanup', () => {
  it('clears only tabs a badge was applied to; unknown tabs are no-ops', () => {
    const state = createBadgeState();
    expect(state.navigationStarted(3)).toBeNull();
    state.setFeatureEnabled(true);
    state.processSummary(3, CACHED_WPR);
    expect(state.navigationStarted(3)).toEqual<BadgeEffect | null>({ kind: 'clear', tabId: 3 });
    // A cleared badge stays cleared (no browser write for a stale tab).
    expect(state.navigationStarted(3)).toBeNull();
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
