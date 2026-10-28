/**
 * The simulated-session contract over faked browser seams: ask answers (the
 * store read fresh each time), the set flows (exact rule objects, idempotent
 * repeats, transition-only pushes, truthful failure states), the two removal
 * hooks (unconditional, rejection-proof), and the boot sweep (ghosts die,
 * live sessions are kept with a convergence push for their surviving tabs,
 * foreign-shaped rules untouched, every failure contained).
 *
 * The production registration (`initDeviceSimSessions`) is thin wiring by
 * design: these fakes stand in for exactly the `browser.*` calls it binds.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DeviceSimRule, DeviceSimRuleLike } from '../../lib/device-simulation/rule';
import { deviceSimRule, deviceSimRuleId } from '../../lib/device-simulation/rule';
import type { DeviceSimState } from '../../lib/device-simulation/state';
import {
  createDeviceSimSessions,
  createDisabledDeviceSimSessions,
  type DeviceSimSessionDeps,
  type DeviceSimPush,
  type DeviceSimSessions,
  type SimRuleStore,
  type SimTabProber
} from './device-simulation';
import type { LooseMessageSender } from '../../lib/messaging/sender';

/** A map-backed session-rule store with operation traces. */
function tracedRuleStore(): SimRuleStore & { upserts: DeviceSimRule[]; removals: number[] } {
  const stored = new Map<number, DeviceSimRule | DeviceSimRuleLike>();
  const upserts: DeviceSimRule[] = [];
  const removals: number[] = [];
  return {
    upserts,
    removals,
    upsert: (rule) => {
      upserts.push(rule);
      stored.set(rule.id, rule);
      return Promise.resolve();
    },
    remove: (ruleId) => {
      removals.push(ruleId);
      stored.delete(ruleId);
      return Promise.resolve();
    },
    listRules: () => Promise.resolve([...stored.values()] as DeviceSimRuleLike[])
  };
}

/** A tab prober with per-tab liveness flags: existence and answer liveness. */
function fakeTabs(live: number[], answering: number[]): SimTabProber {
  return {
    exists: (tabId) => Promise.resolve(live.includes(tabId)),
    reachable: (tabId) => Promise.resolve(answering.includes(tabId))
  };
}

/** A push spy recording its calls; a flip makes every send reject. */
function tracedPush(
  broken = false
): DeviceSimPush & { calls: Array<{ tabId: number; state: DeviceSimState }> } {
  const calls: Array<{ tabId: number; state: DeviceSimState }> = [];
  const push: DeviceSimPush = (tabId, state) => {
    calls.push({ tabId, state });
    // Rejected without listeners: the seam's real rejection shape, not a throw.
    return broken ? Promise.reject(new Error('no listener on this tab')) : Promise.resolve();
  };
  return Object.assign(push, { calls });
}

/** A model with its traces, plus per-test overrides over the default seams. */
interface Fixture {
  model: DeviceSimSessions;
  store: ReturnType<typeof tracedRuleStore>;
  push: ReturnType<typeof tracedPush>;
}

function fixture(
  overrides: Partial<DeviceSimSessionDeps> = {},
  store = tracedRuleStore(),
  push = tracedPush()
): Fixture {
  const deps: DeviceSimSessionDeps = {
    rules: store,
    tabs: fakeTabs([], []),
    push,
    dnrAvailable: true,
    ...overrides
  };
  return { model: createDeviceSimSessions(deps), store, push };
}

/** A content-script-shaped sender on a debugged site tab. */
function siteSender(tabId: number): LooseMessageSender {
  return { tab: { id: tabId }, url: 'https://example.dev/page?a=1' };
}

/** The analysis-host sender: the PageSpeed Insights auto-flow page. */
function psiSender(tabId: number): LooseMessageSender {
  return {
    tab: { id: tabId },
    url: 'https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fexample.dev'
  };
}

const UNAVAILABLE: DeviceSimState = { available: false, enabled: false };

describe('answerGet', () => {
  it('reports a rule-less site tab as available and off', async () => {
    const { model } = fixture();
    await expect(model.answerGet(siteSender(17))).resolves.toEqual({
      available: true,
      enabled: false
    });
  });

  it('reports live rules from the store, never from cached memory', async () => {
    const { model } = fixture();
    await model.answerSet(siteSender(9), { enabled: true });
    await expect(model.answerGet(siteSender(9))).resolves.toEqual({
      available: true,
      enabled: true
    });
  });

  it('refuses the analysis host without touching the rule store', async () => {
    const { model, store } = fixture();
    await expect(model.answerGet(psiSender(4))).resolves.toEqual(UNAVAILABLE);
    expect(store.upserts).toHaveLength(0);
    expect(store.removals).toHaveLength(0);
  });

  it('refuses senders that define no usable tab or page URL', async () => {
    const { model, store } = fixture();
    // No tab (extension surface), a tab outside the rule-encoding domain,
    // a missing URL, an unparseable URL: every shapeless ask is unavailable.
    await expect(model.answerGet(undefined)).resolves.toEqual(UNAVAILABLE);
    await expect(model.answerGet({ tab: { id: 0 }, url: 'https://example.dev' })).resolves.toEqual(
      UNAVAILABLE
    );
    await expect(model.answerGet({ tab: { id: 3 } })).resolves.toEqual(UNAVAILABLE);
    await expect(model.answerGet({ tab: { id: 3 }, url: '::::' })).resolves.toEqual(UNAVAILABLE);
    expect(store.upserts).toHaveLength(0);
    expect(store.removals).toHaveLength(0);
  });

  it('a tab-less sender is expected traffic: refused at debug, never warned', async () => {
    // A content script in a frame no tab hosts (Firefox runs some) asks too.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    try {
      const { model } = fixture();
      await expect(
        model.answerGet({ url: 'https://example.dev/page?q=1', frameId: 0 })
      ).resolves.toEqual(UNAVAILABLE);
      expect(warn).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith(
        '[WPR FDT] [device-simulation] Simulation ask from a sender without a tab ignored',
        { frameId: 0, origin: 'https://example.dev' }
      );
    } finally {
      warn.mockRestore();
      debug.mockRestore();
    }
  });

  it('refuses everything when the browser has no session DNR', async () => {
    const { model, store } = fixture({ dnrAvailable: false });
    await expect(model.answerGet(siteSender(7))).resolves.toEqual(UNAVAILABLE);
    expect(store.upserts).toHaveLength(0);
  });
});

describe('answerSet — on', () => {
  it('adds exactly the derived rule, resolves the new state, pushes the transition', async () => {
    const { model, store, push } = fixture();
    await expect(model.answerSet(siteSender(17), { enabled: true })).resolves.toEqual({
      available: true,
      enabled: true
    });
    expect(store.upserts).toEqual([deviceSimRule(17)]);
    expect(push.calls).toEqual([{ tabId: 17, state: { available: true, enabled: true } }]);
  });

  it('a very large tab id rides the plain rule flow unchanged', async () => {
    // Huge int32 tab ids (magnitudes like this observed in live sessions)
    // must encode directly: an additive offset used to cross the session
    // id ceiling and fail the rule add for exactly this shape of tab — the
    // user-visible toggle failure that motivated the identity encoding.
    const { model, store, push } = fixture();
    const tabId = 1_998_392_600;
    await expect(model.answerSet(siteSender(tabId), { enabled: true })).resolves.toEqual({
      available: true,
      enabled: true
    });
    expect(store.upserts).toEqual([deviceSimRule(tabId)]);
    expect(push.calls).toEqual([{ tabId, state: { available: true, enabled: true } }]);
  });

  it('a repeated on is a no-op: no second write, no push', async () => {
    const { model, store, push } = fixture();
    await model.answerSet(siteSender(17), { enabled: true });
    store.upserts.length = 0;
    push.calls.length = 0;
    await expect(model.answerSet(siteSender(17), { enabled: true })).resolves.toEqual({
      available: true,
      enabled: true
    });
    expect(store.upserts).toHaveLength(0);
    expect(push.calls).toHaveLength(0);
  });

  it('a failed add keeps the truthful off state and pushes nothing', async () => {
    const failing = tracedRuleStore();
    failing.upsert = () => Promise.reject(new Error('rule store broke'));
    const { model, push } = fixture({}, failing);
    await expect(model.answerSet(siteSender(17), { enabled: true })).resolves.toEqual({
      available: true,
      enabled: false
    });
    expect(push.calls).toHaveLength(0);
  });
});

describe('answerSet — off', () => {
  it('removes by the exact encoded id, resolves the new state, pushes the transition', async () => {
    const { model, store, push } = fixture();
    await model.answerSet(siteSender(17), { enabled: true });
    push.calls.length = 0;
    await expect(model.answerSet(siteSender(17), { enabled: false })).resolves.toEqual({
      available: true,
      enabled: false
    });
    expect(store.removals).toEqual([deviceSimRuleId(17)]);
    expect(push.calls).toEqual([{ tabId: 17, state: { available: true, enabled: false } }]);
  });

  it('an already-off tab resolves without a write or a push', async () => {
    const { model, store, push } = fixture();
    await expect(model.answerSet(siteSender(17), { enabled: false })).resolves.toEqual({
      available: true,
      enabled: false
    });
    expect(store.removals).toHaveLength(0);
    expect(push.calls).toHaveLength(0);
  });

  it('a failed removal keeps the sim-on state truthfully on', async () => {
    const { model, store, push } = fixture();
    await model.answerSet(siteSender(17), { enabled: true });
    store.remove = () => Promise.reject(new Error('rule store broke'));
    store.removals.length = 0;
    push.calls.length = 0;
    await expect(model.answerSet(siteSender(17), { enabled: false })).resolves.toEqual({
      available: true,
      enabled: true
    });
    expect(push.calls).toHaveLength(0);
  });
});

describe('answerSet — refusals', () => {
  it('refuses the analysis host and the unavailable browser without any store op', async () => {
    const { model, store } = fixture({ dnrAvailable: false });
    await expect(model.answerSet(siteSender(7), { enabled: true })).resolves.toEqual(UNAVAILABLE);
    const comparison = fixture();
    await expect(comparison.model.answerSet(psiSender(7), { enabled: true })).resolves.toEqual(
      UNAVAILABLE
    );
    expect(store.upserts).toHaveLength(0);
    expect(comparison.store.upserts).toHaveLength(0);
  });

  it('refuses a shapeless sender without any store op', async () => {
    const { model, store } = fixture();
    await expect(
      model.answerSet({ tab: { id: 0 }, url: 'https://example.dev' }, { enabled: true })
    ).resolves.toEqual(UNAVAILABLE);
    expect(store.upserts).toHaveLength(0);
  });
});

describe('pushes', () => {
  it('a push with nowhere to land is the expected case — the transition still completes', async () => {
    const { model, push } = fixture({}, tracedRuleStore(), tracedPush(true));
    await expect(model.answerSet(siteSender(3), { enabled: true })).resolves.toEqual({
      available: true,
      enabled: true
    });
    expect(push.calls).toHaveLength(1);
  });
});

describe('removal hooks', () => {
  it('main-frame navigation and tab removal both remove by the tab-encoded id', async () => {
    const { model, store } = fixture();
    await model.mainFrameNavigation(21);
    await model.tabRemoved(21);
    expect(store.removals).toEqual([deviceSimRuleId(21), deviceSimRuleId(21)]);
  });

  it('a rejected removal never escapes the hook (fire-and-forget glue awaits safe promises)', async () => {
    const { model, store } = fixture();
    store.remove = () => Promise.reject(new Error('removal broke'));
    await expect(model.mainFrameNavigation(33)).resolves.toBeUndefined();
    await expect(model.tabRemoved(33)).resolves.toBeUndefined();
  });
});

describe('ask answers under store failures', () => {
  it('get and set resolve a refusal instead of rejecting, with no browser write', async () => {
    const store = tracedRuleStore();
    store.listRules = () => Promise.reject(new Error('store broke'));
    const { model, push } = fixture({}, store);
    await expect(model.answerGet(siteSender(7))).resolves.toEqual(UNAVAILABLE);
    await expect(model.answerSet(siteSender(7), { enabled: true })).resolves.toEqual(UNAVAILABLE);
    await expect(model.answerSet(siteSender(7), { enabled: false })).resolves.toEqual(UNAVAILABLE);
    // An unreadable state is never mutated: refusal happens before any write.
    expect(store.upserts).toHaveLength(0);
    expect(store.removals).toHaveLength(0);
    expect(push.calls).toHaveLength(0);
  });
});

describe('sweep', () => {
  it('keeps a live simulated session untouched', async () => {
    const { model, store } = fixture({
      tabs: fakeTabs([17], [17])
    });
    await model.answerSet(siteSender(17), { enabled: true });
    store.upserts.length = 0;
    await model.sweep();
    expect(store.removals).toHaveLength(0);
    await expect(store.listRules()).resolves.toHaveLength(1);
  });

  it('removes a closed tab-shaped rule and a mute-world extension-reload ghost, converging the surviving tab', async () => {
    const { model, store, push } = fixture({
      tabs: fakeTabs([52], []) // 51 exists in the store but is closed; 52 is alive but never answers
    });
    await store.upsert(deviceSimRule(51));
    await store.upsert(deviceSimRule(52));
    store.upserts.length = 0;
    await model.sweep();
    expect(store.removals).toEqual([deviceSimRuleId(51), deviceSimRuleId(52)]);
    await expect(store.listRules()).resolves.toHaveLength(0);
    // The closed tab cannot hear anything; the mute world's surviving tab
    // gets the settled off-state push so a restoring overlay converges.
    expect(push.calls).toEqual([{ tabId: 52, state: { available: true, enabled: false } }]);
  });

  it('never touches a foreign-shaped rule (another session-rule feature stays intact)', async () => {
    // The device-sim family is the rule's shape, not an id band: a foreign
    // session-rule feature (none in this extension yet) could pass through
    // the extension-scoped read without ever being probed or removed here.
    const store = tracedRuleStore();
    const foreign: DeviceSimRuleLike = {
      id: 9,
      priority: 3,
      condition: { tabIds: [9], resourceTypes: ['main_frame'] },
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'cookie', operation: 'set', value: 'seed=1' }]
      }
    };
    store.listRules = () => Promise.resolve([foreign]);
    const { model } = fixture({ tabs: fakeTabs([9], [9]) }, store);
    await model.sweep();
    expect(store.removals).toHaveLength(0);
  });

  it('never touches a rule the encoding could not have produced', async () => {
    // The shape predicate's first check is the id domain: below 1, above
    // the session-rule ceiling, or not an integer cannot be this module's
    // family — belt over the family identity.
    const store = tracedRuleStore();
    store.listRules = () =>
      Promise.resolve([
        { ...deviceSimRule(7), id: Number.NaN },
        { ...deviceSimRule(7), id: 0 },
        { ...deviceSimRule(7), id: -1 },
        { ...deviceSimRule(7), id: '7' as unknown as number },
        { ...deviceSimRule(7), id: 2_147_483_648 }
      ]);
    const { model } = fixture({ tabs: fakeTabs([7], [7]) }, store);
    await model.sweep();
    expect(store.removals).toHaveLength(0);
  });

  it('a probe failure keeps the rule pending the next sweep, and never rejects', async () => {
    const { model, store } = fixture({
      tabs: {
        exists: () => Promise.reject(new Error('probe broke')),
        reachable: () => Promise.resolve(true)
      }
    });
    await model.answerSet(siteSender(17), { enabled: true });
    store.upserts.length = 0;
    await expect(model.sweep()).resolves.toBeUndefined();
    expect(store.removals).toHaveLength(0);
  });

  it('an unreadable store ends the sweep quietly', async () => {
    const store = tracedRuleStore();
    store.listRules = () => Promise.reject(new Error('store broke'));
    const { model } = fixture({}, store);
    await expect(model.sweep()).resolves.toBeUndefined();
    expect(store.removals).toHaveLength(0);
  });

  it('a failing removal does not stop the remaining rules from being swept', async () => {
    const store = tracedRuleStore();
    await store.upsert(deviceSimRule(41));
    await store.upsert(deviceSimRule(42));
    store.remove = (ruleId) => {
      if (ruleId === deviceSimRuleId(41)) return Promise.reject(new Error('first removal broke'));
      store.removals.push(ruleId);
      return Promise.resolve();
    };
    const { model } = fixture({ tabs: fakeTabs([], []) }, store);
    await model.sweep();
    // The ghost rule that could be removed is; the broken one stays logged.
    expect(store.removals).toEqual([deviceSimRuleId(42)]);
  });
});

describe('createDisabledDeviceSimSessions', () => {
  it('is fully operable and never simulates anything', async () => {
    const disabled = createDisabledDeviceSimSessions();
    await expect(disabled.answerGet(siteSender(7))).resolves.toEqual(UNAVAILABLE);
    await expect(disabled.answerSet(siteSender(7), { enabled: true })).resolves.toEqual(
      UNAVAILABLE
    );
    await expect(disabled.mainFrameNavigation(7)).resolves.toBeUndefined();
    await expect(disabled.tabRemoved(7)).resolves.toBeUndefined();
    await expect(disabled.sweep()).resolves.toBeUndefined();
  });
});
