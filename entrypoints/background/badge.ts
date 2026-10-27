/**
 * The per-tab toolbar badge: at-a-glance WP Rocket presence and cache state
 * for the tab currently shown by the toolbar icon.
 *
 * The state machine is pure: callers hand in already-validated summaries and
 * tab ids, and receive the display effects (set/dot by color, or clear) they
 * must apply through the toolbar button's API (`./toolbar-action`). Keeping
 * the mapping out of those calls makes the toggle, navigation, and cleanup behavior
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
 * - Clears are unconditional, never membership-vetoed: the browser keeps
 *   rendering per-tab badges across the very restarts that empty this
 *   model's memory, so after a wake a stranded badge can exist that this
 *   instance never heard of. A redundant clear write is free; a wrong badge
 *   is not.
 */

import { createLogger } from '../../lib/logger';
import { onMessage } from '../../lib/messaging';
import { resolveSenderTabId } from '../../lib/messaging/sender';
import { parseDetectionSummary, type DetectionSummary } from '../../lib/messaging/validate';
import { getOptions, optionsStore } from '../../lib/storage/options';
import { TOOLBAR_NAMESPACE, toolbarBadgeApi, type ToolbarBadgeApi } from './toolbar-action';

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
/** The state every page without WP Rocket carries: clearly not something the plugin produced. */
const ABSENT_STATE_COLOR = '#6e7781';
/** The tile is transparent: the dot is the glyph in its state color (see `applyBadgeEffect`). */
const TRANSPARENT_TILE: [number, number, number, number] = [0, 0, 0, 0];

/** What a tab's action badge must display: the dot glyph plus its color. */
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
 * WP Rocket is present but the visit was uncached, gray while the page
 * carries no WP Rocket at all — every reported page gets a visible state
 * (owner decision, 2026-10-08); only an unreported tab (browser-internal
 * pages, or the moments before a page's content script answers) shows
 * nothing.
 *
 * @param summary The two booleans a content push reported, or null.
 * @returns A dot to apply, or null when the tab must show no badge.
 */
export function badgeFor(summary: DetectionSummary | null): BadgeDisplay | null {
  if (summary === null) return null;
  if (!summary.wprPresent) return { text: BADGE_DOT, color: ABSENT_STATE_COLOR };
  if (summary.cached) return { text: BADGE_DOT, color: CACHED_STATE_COLOR };
  return { text: BADGE_DOT, color: UNCACHED_PRESENT_COLOR };
}

/**
 * The pure badge state machine over per-tab summaries. Instances are created
 * per runtime glue; the glue applies returned effects and owes nothing to
 * this class (which stays free of browser calls for testability).
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
    const display = badgeFor(summary);
    if (this.#gate !== true) return null;
    if (display === null) {
      // Unreachable with a validated summary (`badgeFor` is total over
      // summaries) — the shape stays for the type, producing no browser
      // write on an impossible branch.
      return null;
    }
    this.#applied.add(tabId);
    return { kind: 'set', tabId, display };
  }

  navigationStarted(tabId: number): BadgeEffect | null {
    this.#summaries.delete(tabId);
    // Unconditional, same restart reason: the old page's badge must die with
    // its page even when this model never saw it applied.
    return this.#clearEffect(tabId);
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
 * Apply one effect to the toolbar button — resolves (never rejects: every
 * call is awaited and caught) so callers can `void` it safely.
 * @param effect Effect to apply, or null (no-op).
 * @param api The toolbar badge API to write through (this build's by
 *   default); null — a browser without it — is logged, never thrown.
 */
export async function applyBadgeEffect(
  effect: BadgeEffect | null,
  api: ToolbarBadgeApi | null = toolbarBadgeApi()
): Promise<void> {
  if (effect === null) return;
  if (api === null) {
    log.warn('Badge update ignored: no toolbar button API', effect.kind, effect.tabId);
    return;
  }
  try {
    if (effect.kind === 'clear') {
      // An empty text removes the badge; no color touch, the tab default stays.
      await api.setBadgeText({ tabId: effect.tabId, text: '' });
      return;
    }
    // The dot is the glyph itself in its state color, over a transparent
    // tile — Chrome's default (a colored tile with white text) renders the
    // glyph off-center inside the square and reads as a defect. The
    // transparent tile is a fixed browser-chrome value, outside theme
    // resolution. The text lands last, so any earlier failure leaves nothing
    // rendered rather than a half-applied badge; the next report re-runs all.
    await api.setBadgeBackgroundColor({
      tabId: effect.tabId,
      color: TRANSPARENT_TILE
    });
    await api.setBadgeTextColor({ tabId: effect.tabId, color: effect.display.color });
    await api.setBadgeText({ tabId: effect.tabId, text: effect.display.text });
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
 * machine, binds its toolbar-button applier, and listens for content
 * pushes with sender (not payload-borne) tab resolution.
 *
 * @param api The toolbar badge API (this build's by default).
 * @returns Runtime callbacks for the header capture (navigation clears) and
 *   the feature gate (options are resolved after this, see `watchBadgeGate`).
 * @throws {@link Error} When `api` is null: the browser exposes no toolbar
 *   button API for this build, so no badge could ever render.
 */
export function initBadge(api: ToolbarBadgeApi | null = toolbarBadgeApi()): BadgeRuntime {
  if (api === null) {
    throw new Error(`No toolbar button API (browser.${TOOLBAR_NAMESPACE}) in this browser`);
  }
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
    void applyBadgeEffect(state.processSummary(tabId, summary), api);
    return true;
  });

  return {
    processSummary: (tabId, summary) => state.processSummary(tabId, summary),
    navigationStarted: (tabId) => state.navigationStarted(tabId),
    tabRemoved: (tabId) => {
      state.tabRemoved(tabId);
    },
    setFeatureEnabled: (enabled) => state.setFeatureEnabled(enabled),
    apply: (effect) => applyBadgeEffect(effect, api)
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
 * Clear the feature's badge on every tab without consulting memory: Chrome
 * keeps rendering per-tab badges across the service-worker restarts that
 * empty the state model, so a gate turning off (or boot resolving off) must
 * reach badges it lost track of.
 *
 * `tabs.query({})` needs no `tabs` permission: ids are always served — only
 * url/title-class fields are withheld without it, and this sweep reads
 * nothing else.
 */
async function sweepRenderedBadges(): Promise<void> {
  const api = toolbarBadgeApi();
  // No toolbar button API: no badge can exist, and boot already reported why.
  if (api === null) return;
  const ids = (await browser.tabs.query({}))
    .map((tab) => tab.id)
    .filter((id): id is number => typeof id === 'number');
  await Promise.allSettled(ids.map((id) => applyBadgeEffect({ kind: 'clear', tabId: id }, api)));
}

/**
 * Resolve the toolbar-badge option once and keep following it: the options
 * toggle must apply without a service worker restart.
 *
 * @param badge The runtime to gate.
 */
export async function watchBadgeGate(badge: BadgeRuntime): Promise<void> {
  const applyGate = async (): Promise<void> => {
    const enabled = (await getOptions()).features.toolbarBadge;
    // A gate resolving off must also reach stranded badges: memory cannot
    // enumerate what Chrome still renders from before a restart — ids can.
    // The model's own clears cover exactly the membership it still knows.
    if (!enabled) await sweepRenderedBadges();
    for (const effect of badge.setFeatureEnabled(enabled)) {
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
