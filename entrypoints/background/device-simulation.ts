/**
 * The simulated-device sessions for the compare overlay: while an overlay is
 * open with its "mobile comparison" switch on, the owning tab's document
 * requests carry the simulated phone user agent through exactly one session
 * DNR rule keyed by the tab id; every exit path (switch off, overlay close,
 * main-frame navigation, tab close, invalidation) removes it again.
 *
 * Lifecycle rules this module owns:
 * - **Rules are the state**: there is no per-tab memory here. Each ask reads
 *   the session-rule store fresh, so answers stay truthful across service
 *   worker restarts (Chrome persists session rules across them) with no
 *   memory to drift.
 * - **Sender-resolved ownership**: the tab comes from the runtime sender,
 *   never from a payload, and the analysis host (PageSpeed Insights flow)
 *   always refuses — the viewer flow is not a session to spoof.
 * - **Removals are unconditional**: a remove call for a rule id that does
 *   not exist resolves quietly (the browser ignores absent ids); a closed
 *   tab's rule dies with the same one-line call, no tab pre-check.
 * - **The sweep converges ghosts**: at service-worker start, rules whose
 *   tab is gone — or whose isolated world answers nothing, the
 *   extension-reload era's leftovers — are removed; a still-alive simulated
 *   session keeps its rule untouched, and a removal whose tab still exists
 *   pushes the settled off-state so a concurrently restoring overlay
 *   converges. Family membership is the rule's exact shape (the
 *   derivation's own signature), never an id assumption — another
 *   session-rule feature's rules would never match it.
 */

import { createLogger } from '../../lib/logger';
import { onMessage, sendMessage } from '../../lib/messaging';
import {
  resolveSenderTabId,
  resolveSenderUrl,
  type LooseMessageSender
} from '../../lib/messaging/sender';
import type { DeviceSimRule, DeviceSimRuleLike } from '../../lib/device-simulation/rule';
import {
  deviceSimRule,
  deviceSimRuleId,
  isDeviceSimRuleShape
} from '../../lib/device-simulation/rule';
import { canSimulate } from '../../lib/device-simulation/can-simulate';
import type { DeviceSimState, DeviceSimUpdate } from '../../lib/device-simulation/state';
import { parseDeviceSimUpdate } from '../../lib/device-simulation/state';
import { isPsiHost } from '../../lib/side-by-side/analysis-host';

const log = createLogger('device-simulation');

/** The session-rule store seam: three calls, nothing the browser API adds. */
export interface SimRuleStore {
  /**
   * Upsert the session rule — one atomic `updateSessionRules` call listing
   * the rule's id in both lists (removals happen first, additions second),
   * which makes repeat calls idempotent.
   */
  upsert(rule: DeviceSimRule): Promise<void>;
  /** Remove one session rule by id; an absent id resolves harmlessly. */
  remove(ruleId: number): Promise<void>;
  /** The session rules the extension currently has registered, as stored. */
  listRules(): Promise<DeviceSimRuleLike[]>;
}

/** The tab seam the boot sweep probes rules' would-be sessions against. */
export interface SimTabProber {
  /** Whether the tab exists (a closed tab cannot simulate anymore). */
  exists(tabId: number): Promise<boolean>;
  /** Whether the tab's isolated world answers our probe (a dead world is a ghost). */
  reachable(tabId: number): Promise<boolean>;
}

/** The per-tab state push after a real transition. */
export type DeviceSimPush = (tabId: number, state: DeviceSimState) => Promise<void>;

/** Everything the session model needs the browser to do. */
export interface DeviceSimSessionDeps {
  rules: SimRuleStore;
  tabs: SimTabProber;
  push: DeviceSimPush;
  /** Feature-detected once by the runtime wiring (`'declarativeNetRequest' in browser`). */
  dnrAvailable: boolean;
}

/** The session model: every lifecycle surface, browser effects injected. */
export interface DeviceSimSessions {
  /** Answer `getDeviceSimulation` (sender resolved, possibly shapeless). */
  answerGet(sender: LooseMessageSender | undefined): Promise<DeviceSimState>;
  /** Answer `setDeviceSimulation` with a payload the boundary already validated. */
  answerSet(
    sender: LooseMessageSender | undefined,
    update: DeviceSimUpdate
  ): Promise<DeviceSimState>;
  /** A main-frame response started on the tab — the session's page is ending. */
  mainFrameNavigation(tabId: number): Promise<void>;
  /** The tab is closing — its rule dies without ceremony. */
  tabRemoved(tabId: number): Promise<void>;
  /** Boot reconciliation: remove family rules without a live session. Never rejects. */
  sweep(): Promise<void>;
}

/** The answer every refusal carries: nothing to simulate, nothing enabled. */
const UNAVAILABLE: DeviceSimState = { available: false, enabled: false };

/**
 * The ask's sender narrowed to the two facts a simulated session is owned
 * by: a rule-encodable tab and its page URL. Anything shapeless (extension
 * surface, hand-crafted sender, missing or unparseable URL) refuses — a
 * session needs a real tab and a real site, and each refusal is logged (a
 * tab-less one at debug: expected traffic).
 *
 * @returns The owning tab id with whether its page is the analysis host, or
 *   null when the sender cannot own a session.
 */
function sessionOwner(
  sender: LooseMessageSender | undefined
): { tabId: number; analysisHost: boolean } | null {
  const tabId = resolveSenderTabId(sender);
  if (tabId === null) {
    // Expected traffic, not a fault: the relay runs in every http(s) frame,
    // and a browser can run content scripts in frames no tab hosts (Firefox
    // does) — those can never own a session, so the refusal is the answer.
    log.debug('Simulation ask from a sender without a tab ignored', {
      frameId: sender?.frameId,
      origin: resolveSenderUrl(sender)?.origin
    });
    return null;
  }
  // The rule id encoding keys positive integers; a tab id below 1 can
  // never own a rule, so refuse it before anything browser-shaped happens.
  if (tabId < 1) {
    log.warn('Simulation ask for a tab id the rule encoding cannot key ignored', { tabId });
    return null;
  }
  const pageUrl = resolveSenderUrl(sender);
  if (pageUrl === null) {
    log.warn('Simulation ask from a sender without a page URL ignored', { tabId });
    return null;
  }
  return { tabId, analysisHost: isPsiHost(pageUrl) };
}

/**
 * Whether the sender may run simulations, logged on refusal: the analysis
 * host ask is a wiring mistake worth a visibility line, the capability miss
 * is the advertised Firefox degrade.
 *
 * @returns The owner, or null when the ask must be refused.
 */
function simulationOwner(sender: LooseMessageSender | undefined, dnrAvailable: boolean) {
  const owner = sessionOwner(sender);
  if (owner === null) return null;
  if (!canSimulate({ dnrAvailable, analysisHost: owner.analysisHost })) {
    if (owner.analysisHost) {
      // The identity pair asks from every http/https frame, including the
      // PSI pages it must never touch — an analysis-host refusal is expected
      // regular traffic, not a warning.
      log.debug('Simulation refused on the analysis host', { tabId: owner.tabId });
    } else {
      log.debug('Simulation unavailable: the browser has no session DNR', {
        tabId: owner.tabId
      });
    }
    return null;
  }
  return owner;
}

/**
 * Whether the tab's rule is currently in the session store.
 *
 * @throws Propagates a failing read only to `answerGet`/`answerSet`, which
 *   contain it — the ask rows must answer, never throw.
 */
async function hasRule(deps: DeviceSimSessionDeps, tabId: number): Promise<boolean> {
  const rules = await deps.rules.listRules();
  return rules.some((rule) => rule.id === deviceSimRuleId(tabId));
}

/**
 * Deliver the post-transition state to the tab: only the overlay in
 * transition listens, and its absence (page changed, script not injected)
 * is the expected case — a push with nowhere to land is not an error.
 */
function notifyStateChange(deps: DeviceSimSessionDeps, tabId: number, state: DeviceSimState): void {
  void deps.push(tabId, state).catch((cause: unknown) => {
    log.debug('Simulation state push without a listener (expected)', { tabId, cause });
  });
}

/**
 * The session model over injected browser effects: the pure-ish unit every
 * lifecycle rule above is pinned against. Keeps no state of its own.
 *
 * @param deps The browser seams (rules store, tab prober, push) and the
 *   once-resolved capability fact.
 */
export function createDeviceSimSessions(deps: DeviceSimSessionDeps): DeviceSimSessions {
  return {
    async answerGet(sender: LooseMessageSender | undefined): Promise<DeviceSimState> {
      const owner = simulationOwner(sender, deps.dnrAvailable);
      if (owner === null) return UNAVAILABLE;
      let enabled: boolean;
      try {
        enabled = await hasRule(deps, owner.tabId);
      } catch (cause) {
        // A store read the ask cannot survive truthfully: refuse, and the
        // switch's next ask re-reads. The handler contract (never throws) holds.
        log.error('Session store read failed — ask refused', { cause, tabId: owner.tabId });
        return UNAVAILABLE;
      }
      return { available: true, enabled };
    },

    async answerSet(
      sender: LooseMessageSender | undefined,
      update: DeviceSimUpdate
    ): Promise<DeviceSimState> {
      const owner = simulationOwner(sender, deps.dnrAvailable);
      if (owner === null) return UNAVAILABLE;
      const tabId = owner.tabId;

      // One read drives the whole decision: the transition is against what
      // the store holds right now, and a failing read refuses without any
      // browser write (an unverified mutation could act on stale state).
      let present: boolean;
      try {
        present = await hasRule(deps, tabId);
      } catch (cause) {
        log.error('Session store read failed — command refused', { cause, tabId });
        return UNAVAILABLE;
      }

      if (update.enabled) {
        if (present) return { available: true, enabled: true };
        try {
          await deps.rules.upsert(deviceSimRule(tabId));
        } catch (cause) {
          log.error('Session rule add failed — simulation not enabled', { cause, tabId });
          return { available: true, enabled: false };
        }
        const state: DeviceSimState = { available: true, enabled: true };
        notifyStateChange(deps, tabId, state);
        return state;
      }

      if (!present) return { available: true, enabled: false };
      try {
        await deps.rules.remove(deviceSimRuleId(tabId));
      } catch (cause) {
        // The store keeps what it had: the sim-on state stays on, truthfully.
        log.error('Session rule removal failed — simulation stays on', { cause, tabId });
        return { available: true, enabled: true };
      }
      const state: DeviceSimState = { available: true, enabled: false };
      notifyStateChange(deps, tabId, state);
      return state;
    },

    async mainFrameNavigation(tabId: number): Promise<void> {
      try {
        await deps.rules.remove(deviceSimRuleId(tabId));
      } catch (cause) {
        log.error('Navigation rule removal failed — the sweep will converge', {
          cause,
          tabId
        });
      }
    },

    async tabRemoved(tabId: number): Promise<void> {
      try {
        await deps.rules.remove(deviceSimRuleId(tabId));
      } catch (cause) {
        log.error('Closed-tab rule removal failed', { cause, tabId });
      }
    },

    async sweep(): Promise<void> {
      let rules: DeviceSimRuleLike[];
      try {
        rules = await deps.rules.listRules();
      } catch (cause) {
        log.error('Boot sweep could not list session rules', { cause });
        return;
      }
      for (const rule of rules) {
        // The family is the shape, not an id band: a stored rule that is not
        // exactly this module's own derivation for its id (another
        // session-rule feature's rule) is never probed or removed. The
        // extension-scoped read only bounds the work; the predicate decides.
        if (!isDeviceSimRuleShape(rule)) continue;
        const tabId = rule.id as number;
        try {
          // A rule without a live simulated session is a ghost: a closed tab
          // cannot simulate anymore, and a tab whose isolated world answers
          // nothing belongs to an extension-reload era. Live sessions keep
          // their rule; the asks re-read the store, so they need no memory
          // seeding.
          const exists = await deps.tabs.exists(tabId);
          if (!exists) {
            await deps.rules.remove(tabId);
            log.info('Boot sweep removed a rule whose tab is gone', { tabId });
            continue;
          }
          const reachable = await deps.tabs.reachable(tabId);
          if (!reachable) {
            await deps.rules.remove(tabId);
            log.info('Boot sweep removed a rule whose isolated world went silent', { tabId });
            // The tab outlived its world: an overlay restoring itself in
            // exactly this window re-established the rule between this
            // sweep's listing and removal, so it now believes a session the
            // store no longer holds. The settled-state push converges it;
            // when nobody answers, the push's own degrade swallows that.
            notifyStateChange(deps, tabId, { available: true, enabled: false });
          }
        } catch (cause) {
          log.error('Boot sweep rule processing failed', { cause, tabId });
        }
      }
    }
  };
}

/**
 * A never-simulating substitute for a session whose wiring could not come
 * up: every operation stays callable — asks resolve unavailable, hooks
 * remove nothing — so sibling subsystems never branch around a broken
 * registration.
 */
export function createDisabledDeviceSimSessions(): DeviceSimSessions {
  return {
    answerGet: () => Promise.resolve(UNAVAILABLE),
    answerSet: () => Promise.resolve(UNAVAILABLE),
    mainFrameNavigation: () => Promise.resolve(),
    tabRemoved: () => Promise.resolve(),
    sweep: () => Promise.resolve()
  };
}

/**
 * The part the header-capture wires up: a main-frame response ends the
 * tab's simulated session.
 */
export type SimMainFrameHook = Pick<DeviceSimSessions, 'mainFrameNavigation'>;

/**
 * Register the runtime. Runs once per service worker start: the two ask rows
 * and the tab-removal listener register synchronously; the boot sweep is
 * `main()`'s own bootstrap step (it never rejects). Everything here fails
 * its own way with a typed answer and a log line — never a thrown handler.
 *
 * @returns The session model whose sweep `main()` awaits at boot.
 */
export function initDeviceSimSessions(): DeviceSimSessions {
  // Feature-detected once: both engines above their floors expose the
  // namespace with a granted permission (Chromium MV3, Firefox 113+ MV2 —
  // BCD: tabIds and modifyHeaders both land there). An older Firefox or an
  // ungranted permission hides it, and the honest degrade is an unavailable
  // answer, never a half-working sim.
  const dnrAvailable = 'declarativeNetRequest' in browser;

  const deps: DeviceSimSessionDeps = {
    dnrAvailable,
    rules: {
      upsert: async (rule: DeviceSimRule): Promise<void> => {
        // One atomic replace call: removals first (an absent id is ignored),
        // then the addition — repeat calls converge to exactly one rule per tab.
        await browser.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [rule.id],
          addRules: [rule]
        });
      },
      remove: async (ruleId: number): Promise<void> => {
        await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
      },
      listRules: async (): Promise<DeviceSimRuleLike[]> =>
        // The read-back is browser-shaped; its unknown-field look is
        // validated by the family predicate at the sweep, never trusted.
        browser.declarativeNetRequest.getSessionRules()
    },
    tabs: {
      exists: async (tabId: number): Promise<boolean> => {
        try {
          // An id-only tabs read needs no `tabs` permission.
          await browser.tabs.get(tabId);
          return true;
        } catch (cause) {
          log.debug('Sweep tab probe found no tab', { tabId, cause });
          return false;
        }
      },
      reachable: async (tabId: number): Promise<boolean> => {
        // A tab-targeted send resolves when the tab's world answers; the
        // rejection (no listener — a cold load, or a world from an
        // extension-reload era) IS the answer.
        try {
          await sendMessage('reportDeviceSimulationLiveness', undefined, tabId);
          return true;
        } catch (cause) {
          log.debug('Sweep liveness probe went unanswered', { tabId, cause });
          return false;
        }
      }
    },
    push: async (tabId: number, state: DeviceSimState): Promise<void> => {
      // The typed ack resolves true; the adapter discards it so the model's
      // seam stays a plain completion signal.
      await sendMessage('deviceSimulationChanged', state, tabId);
    }
  };

  const model = createDeviceSimSessions(deps);

  onMessage('getDeviceSimulation', ({ sender }): Promise<DeviceSimState> => {
    return model.answerGet(sender);
  });

  onMessage('setDeviceSimulation', ({ sender, data }): Promise<DeviceSimState> => {
    const update = parseDeviceSimUpdate(data);
    if (update === null) {
      log.warn('Malformed simulation update ignored');
      return Promise.resolve(UNAVAILABLE);
    }
    return model.answerSet(sender, update);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    try {
      void model.tabRemoved(tabId);
    } catch (cause) {
      log.error('Closed-tab rule cleanup failed', { cause, tabId });
    }
  });

  return model;
}
