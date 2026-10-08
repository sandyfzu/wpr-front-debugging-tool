/**
 * The per-tab toolbar badge: at-a-glance WP Rocket presence and cache state
 * for the tab currently shown by the toolbar icon.
 *
 * The state machine is pure: callers hand in already-validated summaries and
 * tab ids, and receive the display effects (set/dot by color, or clear) they
 * must apply through `browser.action`. Keeping the mapping out of the
 * `browser.action` calls makes the toggle, navigation, and cleanup behavior
 * fully unit-testable while the entrypoint glue stays a few awaited calls.
 *
 * Ordering guarantees (why the state exists at all):
 * - Navigation clears first: badges are recomputed per page load and a stale
 *   dot must never describe a page that no longer occupies the tab.
 * - A disabled feature never renders a badge: the feature gate is resolved
 *   from options at boot and watched for changes, so the toggle applies live.
 * - Before the gate is known (the first moments after a service worker wake),
 *   summaries are recorded but nothing renders — a badge can appear once the
 *   gate resolves, never a wrong one in between.
 */

import { createLogger } from '../../lib/logger';
import { onMessage } from '../../lib/messaging';
import { resolveSenderTabId } from '../../lib/messaging/sender';
import { parseDetectionSummary, type DetectionSummary } from '../../lib/messaging/validate';
import { getOptions, optionsStore } from '../../lib/storage/options';

const log = createLogger('badge');

/** The badge renders as a bare dot: presence is in its color, not in text. */
const BADGE_DOT = '●';

/**
 * Badge colors as extension-API values, not theme tokens: these are rendered
 * by the browser chrome itself (`setBadgeBackgroundColor` takes a fixed
 * color), outside any of this extension's styled surfaces, so palette
 * resolution cannot apply and one literal per state is the whole story.
 */
const CACHED_STATE_COLOR = '#1a7f37';
const UNCACHED_PRESENT_COLOR = '#0969da';

/** What a tab's action badge must display: dot text plus background color. */
export interface BadgeDisplay {
  text: string;
  color: string;
}

/** One change to apply to the browser action (the pure core's only output). */
export type BadgeEffect =
  { kind: 'set'; tabId: number; display: BadgeDisplay } | { kind: 'clear'; tabId: number };

export interface BadgeRuntime {
  /**
   * Record a page's reported summary for a tab; the returned effect reflects
   * both the summary and the current feature gate (null → nothing to do).
   */
  processSummary(tabId: number, summary: DetectionSummary): BadgeEffect | null;
  /** Mark the start of a fresh page load; stale badges must not survive it. */
  navigationStarted(tabId: number): BadgeEffect | null;
  /** Drop every trace of a closed tab (no browser call — the tab is gone). */
  tabRemoved(tabId: number): void;
  /** Resolve or change the feature gate; may produce batched clear effects. */
  setFeatureEnabled(enabled: boolean): BadgeEffect[];
  /**
   * Apply effects to the browser action; resolves unconditionally (every
   * browser call is awaited and caught), so callers may `void` it.
   */
  apply(effect: BadgeEffect | null): Promise<void>;
}

/** The state machine surface — every runtime call except the browser applier. */
export type BadgeStateModel = Omit<BadgeRuntime, 'apply'>;

/**
 * Summary → badge state: green while the page is served cached, blue while
 * WP Rocket is present but the visit was uncached, nothing otherwise (an
 * absent WP Rocket, or a summary that describes neither state is a clear).
 *
 * @param summary The two booleans a content push reported, or null.
 * @returns A dot to apply, or null when the tab must show no badge.
 */
export function badgeFor(summary: DetectionSummary | null): BadgeDisplay | null {
  if (summary === null) return null;
  if (summary.wprPresent && summary.cached) return { text: BADGE_DOT, color: CACHED_STATE_COLOR };
  if (summary.wprPresent) return { text: BADGE_DOT, color: UNCACHED_PRESENT_COLOR };
  return null;
}

/**
 * The pure badge state machine over per-tab summaries. Instances are created
 * per runtime glue; the glue applies returned effects and owes nothing to
 * this class (which stays free of `browser.action` for testability).
 *
 * State kept per tab: the latest reported summary + whether a badge is
 * currently applied, so every transition knows both what to render next and
 * what must be cleaned on the way out.
 */
class BadgeStateModelImpl implements BadgeStateModel {
  /** Latest renderable summary per tab — kept even while the gate is off/unknown. */
  #summaries = new Map<number, DetectionSummary>();
  /** Tabs this state currently has a badge applied to (its own writes only). */
  #applied = new Set<number>();
  /**
   * Feature gate; null until options resolve — nothing renders in between,
   * which is what keeps an opted-out user from ever seeing a flash of badge.
   */
  #gate: boolean | null = null;

  processSummary(tabId: number, summary: DetectionSummary): BadgeEffect | null {
    this.#summaries.set(tabId, summary);
    // Unknown or off: nothing renders for this report. A later gate change
    // re-resolves from the kept summary; navigation always re-checks first.
    if (this.#gate !== true) return null;
    const display = badgeFor(summary);
    if (display !== null) {
      this.#applied.add(tabId);
      return { kind: 'set', tabId, display };
    }
    return this.#applied.has(tabId) ? this.#clearEffect(tabId) : null;
  }

  navigationStarted(tabId: number): BadgeEffect | null {
    this.#summaries.delete(tabId);
    return this.#applied.has(tabId) ? this.#clearEffect(tabId) : null;
  }

  tabRemoved(tabId: number): void {
    this.#summaries.delete(tabId);
    this.#applied.delete(tabId);
  }

  setFeatureEnabled(enabled: boolean): BadgeEffect[] {
    this.#gate = enabled;
    if (enabled) {
      // Re-resolve from the kept summaries: a toggle re-arms without a page
      // reprocessing, and navigation keeps every such value page-truthful.
      return [...this.#summaries.entries()].flatMap(([tabId, summary]): BadgeEffect[] => {
        const display = badgeFor(summary);
        if (display === null) return this.#applied.has(tabId) ? [this.#clearEffect(tabId)] : [];
        this.#applied.add(tabId);
        return [{ kind: 'set', tabId, display }];
      });
    }
    const effects = [...this.#applied].map((tabId) => this.#clearEffect(tabId));
    // Cleared badges only: the summaries stay recorded for a later re-enable
    // to restore without a page reprocess — navigation keeps them truthful.
    this.#applied.clear();
    return effects;
  }

  #clearEffect(tabId: number): BadgeEffect {
    this.#applied.delete(tabId);
    return { kind: 'clear', tabId };
  }
}

/**
 * Apply one effect to the browser action — resolves (never rejects: every
 * call is awaited and caught) so callers can `void` it safely.
 * @param effect Effect to apply, or null (no-op).
 */
export async function applyBadgeEffect(effect: BadgeEffect | null): Promise<void> {
  if (effect === null) return;
  try {
    if (effect.kind === 'clear') {
      // An empty text removes the badge; no color touch, the tab default stays.
      await browser.action.setBadgeText({ tabId: effect.tabId, text: '' });
      return;
    }
    await browser.action.setBadgeBackgroundColor({
      tabId: effect.tabId,
      color: effect.display.color
    });
    await browser.action.setBadgeText({ tabId: effect.tabId, text: effect.display.text });
    return;
  } catch (cause) {
    log.warn('Badge update ignored', effect.kind, effect.tabId, cause);
  }
}

/**
 * Build a fresh, unrendering-until-enabled badge state — the testable seam
 * over the pure core (the runtime wires one and binds its effect applier).
 */
export function createBadgeState(): BadgeStateModel {
  return new BadgeStateModelImpl();
}

/**
 * Runtime wiring for the badge feature. Must run once: it creates the state
 * machine, binds its `browser.action` applier, and listens for content
 * pushes with sender (not payload-borne) tab resolution.
 *
 * @returns Runtime callbacks for the header capture (navigation clears) and
 *   the feature gate (options are resolved after this, see `watchBadgeGate`).
 */
export function initBadge(): BadgeRuntime {
  const state = new BadgeStateModelImpl();

  onMessage('reportDetectionSummary', ({ data, sender }) => {
    const summary = parseDetectionSummary(data);
    if (summary === null) {
      log.warn('Malformed detection summary ignored');
      return true;
    }
    const tabId = resolveSenderTabId(sender);
    if (tabId === null) {
      // A sender without a tab cannot own a badge; trusting it would stamp
      // the global badge or the wrong tab's.
      log.warn('Detection summary from a tabless sender ignored');
      return true;
    }
    void applyBadgeEffect(state.processSummary(tabId, summary));
    return true;
  });

  return {
    processSummary: (tabId, summary) => state.processSummary(tabId, summary),
    navigationStarted: (tabId) => state.navigationStarted(tabId),
    tabRemoved: (tabId) => {
      state.tabRemoved(tabId);
    },
    setFeatureEnabled: (enabled) => state.setFeatureEnabled(enabled),
    apply: applyBadgeEffect
  };
}

/**
 * A never-rendering substitute for a session whose badge wiring could not
 * come up: navigation clear, summary recording, and the option gate all stay
 * operations other code can call without branching, producing exactly no
 * browser writes.
 */
export function createDisabledBadgeRuntime(): BadgeRuntime {
  // Deliberate zero-effect calls, never rejecting: a session without wiring
  // is fully operable for its other subsystems.
  return {
    processSummary: () => null,
    navigationStarted: () => null,
    tabRemoved: () => {},
    setFeatureEnabled: () => [],
    apply: (): Promise<void> => Promise.resolve()
  };
}

/**
 * Resolve the toolbar-badge option once and keep following it: the options
 * toggle must apply without a service worker restart.
 *
 * @param badge The runtime to gate.
 */
export async function watchBadgeGate(badge: BadgeRuntime): Promise<void> {
  const applyGate = async (): Promise<void> => {
    for (const effect of badge.setFeatureEnabled((await getOptions()).features.toolbarBadge)) {
      void applyBadgeEffect(effect);
    }
  };
  await applyGate();
  optionsStore.watch(() => {
    void applyGate().catch((cause: unknown) => {
      log.error('Badge option change ignored', cause);
    });
  });
}
