/**
 * The per-tab toolbar badge: at-a-glance WP Rocket presence and cache state
 * for the tab currently shown by the toolbar icon — a colored dot, explained
 * by the button's per-tab tooltip (each state's title names it in words).
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
 * - The tooltip travels with the dot: a set writes the state's title, a
 *   clear writes the manifest's default title back (no dot, no state words).
 * - Effects land whole and in order per tab: every write (summary sets,
 *   navigation and gate clears, the sweep) goes through one per-tab queue
 *   (`createBadgeApplier`), so the write order inside an effect is what the
 *   tab ends with — never an interleave of two effects.
 */

import { createLogger } from '../../lib/logger';
import { onMessage } from '../../lib/messaging';
import { resolveSenderTabId } from '../../lib/messaging/sender';
import { parseDetectionSummary, type DetectionSummary } from '../../lib/messaging/validate';
import { getOptions, optionsStore } from '../../lib/storage/options';
import {
  TOOLBAR_NAMESPACE,
  toolbarDisplayApi,
  toolbarTitles,
  type ToolbarDisplayApi,
  type ToolbarTitles
} from './toolbar-action';

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

/** The three states a reported page can be in. */
type BadgeState = 'cached' | 'uncached' | 'absent';

/**
 * Each state's dot color and the tooltip words that explain it (the color
 * alone is explained nowhere else in the browser chrome).
 */
const BADGE_STATES: Readonly<Record<BadgeState, { color: string; caption: string }>> = {
  cached: { color: CACHED_STATE_COLOR, caption: 'WP Rocket active, page served from cache' },
  uncached: {
    color: UNCACHED_PRESENT_COLOR,
    caption: 'WP Rocket active, page not served from cache'
  },
  absent: { color: ABSENT_STATE_COLOR, caption: 'WP Rocket not detected' }
};

/** Between the extension name and a state's caption in the tooltip. */
const TITLE_SEPARATOR = ' · ';

/** What a tab's action badge must display: the dot glyph plus its color. */
export interface BadgeDisplay {
  text: string;
  color: string;
}

/**
 * One change to apply to the browser action (the pure core's only output):
 * `title` is the tab's tooltip — the state's words on a set, the manifest's
 * default tooltip on a clear.
 */
export type BadgeEffect =
  | { kind: 'set'; tabId: number; display: BadgeDisplay; title: string }
  | { kind: 'clear'; tabId: number; title: string };

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
   * Apply an effect to the browser action, queued behind the tab's earlier
   * effects (each lands whole, in call order); resolves unconditionally
   * (every browser call is awaited and caught), so callers may `void` it.
   * Every toolbar write for a tab must go through here.
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
  return { text: BADGE_DOT, color: BADGE_STATES[badgeStateOf(summary)].color };
}

/**
 * Classify a summary: absence first (a page without WP Rocket is never
 * "cached"), then the cache verdict.
 *
 * @param summary A validated summary.
 */
function badgeStateOf(summary: DetectionSummary): BadgeState {
  if (!summary.wprPresent) return 'absent';
  return summary.cached ? 'cached' : 'uncached';
}

/**
 * Summary → the tab's tooltip: the extension name, then the state in words.
 *
 * @param summary The two booleans a content push reported, or null.
 * @param name The extension's name (from the manifest — never re-typed).
 * @returns The tooltip, or null when the tab shows no state (no badge).
 */
export function badgeTitleFor(summary: DetectionSummary | null, name: string): string | null {
  if (summary === null) return null;
  return `${name}${TITLE_SEPARATOR}${BADGE_STATES[badgeStateOf(summary)].caption}`;
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
  /** The tooltip texts: the name every set title starts with, the clears' default. */
  readonly #titles: ToolbarTitles;
  /** Latest renderable summary per tab — kept even while the gate is off/unknown. */
  #summaries = new Map<number, DetectionSummary>();
  /** Tabs this state currently has a badge applied to (its own writes only). */
  #applied = new Set<number>();
  /**
   * Feature gate; null until options resolve — nothing renders in between,
   * which is what keeps an opted-out user from ever seeing a flash of badge.
   */
  #gate: boolean | null = null;

  /** @param titles The tooltip texts (the manifest's, resolved by the glue). */
  constructor(titles: ToolbarTitles) {
    this.#titles = titles;
  }

  processSummary(tabId: number, summary: DetectionSummary): BadgeEffect | null {
    this.#summaries.set(tabId, summary);
    if (this.#gate !== true) return null;
    // Null only on an impossible branch (`badgeFor` is total over validated
    // summaries) — the shape stays for the type, producing no browser write.
    return this.#setEffect(tabId, summary);
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
        const effect = this.#setEffect(tabId, summary);
        if (effect !== null) return [effect];
        return this.#applied.has(tabId) ? [this.#clearEffect(tabId)] : [];
      });
    }
    const effects = [...this.#applied].map((tabId) => this.#clearEffect(tabId));
    // Cleared badges only: the summaries stay recorded for a later re-enable
    // to restore without a page reprocess — navigation keeps them truthful.
    this.#applied.clear();
    return effects;
  }

  /**
   * The set effect for a summary (recording the tab as applied), or null
   * when the summary renders nothing.
   */
  #setEffect(tabId: number, summary: DetectionSummary): BadgeEffect | null {
    const display = badgeFor(summary);
    const title = badgeTitleFor(summary, this.#titles.name);
    if (display === null || title === null) return null;
    this.#applied.add(tabId);
    return { kind: 'set', tabId, display, title };
  }

  #clearEffect(tabId: number): BadgeEffect {
    this.#applied.delete(tabId);
    return clearBadgeEffect(tabId, this.#titles);
  }
}

/**
 * The effect that returns a tab's button to its defaults: no dot, the
 * manifest's tooltip. Shared by the state model and the stranded-badge sweep.
 *
 * @param tabId The tab to clear.
 * @param titles The tooltip texts (only the default is used).
 */
export function clearBadgeEffect(tabId: number, titles: ToolbarTitles): BadgeEffect {
  return { kind: 'clear', tabId, title: titles.defaultTitle };
}

/**
 * Apply one effect to the toolbar button — resolves (never rejects: every
 * call is awaited and caught) so callers can `void` it safely. A failed
 * write skips the rest of the effect (logged); the next report or
 * navigation re-runs it whole.
 *
 * @param effect Effect to apply, or null (no-op).
 * @param api The toolbar display API to write through (this build's by
 *   default); null — a browser without it — is logged, never thrown.
 */
export async function applyBadgeEffect(
  effect: BadgeEffect | null,
  api: ToolbarDisplayApi | null = toolbarDisplayApi()
): Promise<void> {
  if (effect === null) return;
  if (api === null) {
    log.warn('Badge update ignored: no toolbar button API', effect.kind, effect.tabId);
    return;
  }
  try {
    if (effect.kind === 'clear') {
      // An empty text removes the badge; no color touch, the tab default
      // stays. The dot goes first: a visible stale state dies before its
      // (hover-only) words do.
      await api.setBadgeText({ tabId: effect.tabId, text: '' });
      await api.setTitle({ tabId: effect.tabId, title: effect.title });
      return;
    }
    // The words land first and the dot last, so a dot that appears always
    // carries its own state's tooltip. The dot is the glyph itself in its
    // state color, over a transparent tile — Chrome's default (a colored
    // tile with white text) renders the glyph off-center inside the square
    // and reads as a defect. The transparent tile is a fixed browser-chrome
    // value, outside theme resolution. The text lands last, so any earlier
    // failure leaves no fresh dot rather than a half-applied badge.
    await api.setTitle({ tabId: effect.tabId, title: effect.title });
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

/** Per-tab serialized writes over {@link applyBadgeEffect} (see {@link createBadgeApplier}). */
export interface BadgeApplier {
  /**
   * Queue an effect behind its tab's earlier ones; resolves once its own
   * writes are done (never rejects). Null resolves at once, queueing nothing.
   */
  apply(effect: BadgeEffect | null): Promise<void>;
  /** Tabs with writes still queued or running — 0 once every effect settled. */
  pendingTabs(): number;
}

/**
 * Serialize toolbar writes per tab: each effect's writes all land before the
 * tab's next effect starts, in arrival (call) order. Without it, a navigation
 * clear (2 writes) and a summary set (4 writes) racing on one tab interleave
 * their awaits and can end with the new dot under the default title. Tabs
 * stay independent (one slow tab never delays another). A tab's entry is
 * dropped as soon as its last queued effect settles, so closed tabs leak
 * nothing; a rejecting write (or applier) never stalls the queue.
 *
 * @param api The toolbar display API every effect writes through.
 * @param applyOne The single-effect writer (seam for tests).
 */
export function createBadgeApplier(
  api: ToolbarDisplayApi | null,
  applyOne: (effect: BadgeEffect, api: ToolbarDisplayApi | null) => Promise<void> = applyBadgeEffect
): BadgeApplier {
  /** Each tab's queue tail: the promise of its latest queued effect. */
  const tails = new Map<number, Promise<void>>();
  return {
    apply(effect) {
      if (effect === null) return Promise.resolve();
      const { tabId } = effect;
      // The catch covers a rejecting or throwing writer alike, so a tail
      // never rejects and the next effect always runs.
      const next = (tails.get(tabId) ?? Promise.resolve())
        .then(() => applyOne(effect, api))
        .catch((cause: unknown) => {
          log.warn('Badge update ignored', effect.kind, tabId, cause);
        });
      tails.set(tabId, next);
      return next.finally(() => {
        // Only the latest tail may drop the entry: a newer effect queued in
        // the meantime still owns it.
        if (tails.get(tabId) === next) tails.delete(tabId);
      });
    },
    pendingTabs: () => tails.size
  };
}

/**
 * Build a fresh, unrendering-until-enabled badge state — the testable seam
 * over the pure core (the runtime wires one and binds its effect applier).
 *
 * @param titles The tooltip texts every effect's title is built from.
 */
export function createBadgeState(titles: ToolbarTitles): BadgeStateModel {
  return new BadgeStateModelImpl(titles);
}

/**
 * Runtime wiring for the badge feature. Must run once: it creates the state
 * machine, binds its toolbar-button applier, and listens for content
 * pushes with sender (not payload-borne) tab resolution.
 *
 * @param api The toolbar display API (this build's by default).
 * @param readTitles Reads the tooltip texts (the manifest's by default);
 *   called once, after the API check.
 * @returns Runtime callbacks for the header capture (navigation clears) and
 *   the feature gate (options are resolved after this, see `watchBadgeGate`).
 * @throws {@link Error} When `api` is null: the browser exposes no toolbar
 *   button API for this build, so no badge could ever render — or when the
 *   titles cannot be read (see {@link toolbarTitles}).
 */
export function initBadge(
  api: ToolbarDisplayApi | null = toolbarDisplayApi(),
  readTitles: () => ToolbarTitles = toolbarTitles
): BadgeRuntime {
  if (api === null) {
    throw new Error(`No toolbar button API (browser.${TOOLBAR_NAMESPACE}) in this browser`);
  }
  const state = new BadgeStateModelImpl(readTitles());
  // The one writer for this session: every caller's effects queue per tab.
  const applier = createBadgeApplier(api);

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
    void applier.apply(state.processSummary(tabId, summary));
    return true;
  });

  return {
    processSummary: (tabId, summary) => state.processSummary(tabId, summary),
    navigationStarted: (tabId) => state.navigationStarted(tabId),
    tabRemoved: (tabId) => {
      state.tabRemoved(tabId);
    },
    setFeatureEnabled: (enabled) => state.setFeatureEnabled(enabled),
    apply: (effect) => applier.apply(effect)
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
 * Clear the feature's badge and tooltip on every tab without consulting
 * memory: Chrome keeps rendering per-tab badges and titles across the
 * service-worker restarts that empty the state model, so a gate turning off
 * (or boot resolving off) must reach badges it lost track of.
 *
 * `tabs.query({})` needs no `tabs` permission: ids are always served — only
 * url/title-class fields are withheld without it, and this sweep reads
 * nothing else.
 *
 * @param badge The runtime whose per-tab queue the clears join (so a sweep
 *   never interleaves with a tab's in-flight set).
 */
async function sweepRenderedBadges(badge: BadgeRuntime): Promise<void> {
  // No toolbar button API: no badge can exist, and boot already reported why.
  if (toolbarDisplayApi() === null) return;
  const titles = toolbarTitles();
  const ids = (await browser.tabs.query({}))
    .map((tab) => tab.id)
    .filter((id): id is number => typeof id === 'number');
  await Promise.allSettled(ids.map((id) => badge.apply(clearBadgeEffect(id, titles))));
}

/**
 * Resolve the toolbar-badge option once and keep following it: the options
 * toggle must apply without a service worker restart.
 *
 * The watch is registered before the first read, so a change landing while
 * that read (or its sweep) is pending is never missed; passes run one after
 * another, so a slower earlier pass (an off pass awaiting its sweep) can
 * never land after a later one and leave a stale gate.
 *
 * @param badge The runtime to gate.
 * @returns Settles when the first pass has applied; rejects when it failed.
 */
export async function watchBadgeGate(badge: BadgeRuntime): Promise<void> {
  const applyGate = async (): Promise<void> => {
    const enabled = (await getOptions()).features.toolbarBadge;
    // A gate resolving off must also reach stranded badges: memory cannot
    // enumerate what Chrome still renders from before a restart — ids can.
    // The model's own clears cover exactly the membership it still knows.
    if (!enabled) await sweepRenderedBadges(badge);
    for (const effect of badge.setFeatureEnabled(enabled)) {
      void badge.apply(effect);
    }
  };
  // The tail of the pass chain. An earlier pass's failure is already
  // reported by its own caller, so it never blocks the next pass.
  let tail: Promise<void> = Promise.resolve();
  // Passes are serialized: a never-settling action/storage call would block later passes (accepted: those APIs settle); option changes arrive at human speed, so the queue stays small.
  const enqueue = (): Promise<void> => (tail = tail.catch(() => undefined).then(applyGate));
  optionsStore.watch(() => {
    void enqueue().catch((cause: unknown) => {
      log.error('Badge option change ignored', cause);
    });
  });
  await enqueue();
}
