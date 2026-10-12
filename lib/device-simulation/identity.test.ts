/**
 * The page-world identity: descriptor define/restore exactness, the driver's
 * state machine (listener-before-ask, apply-on-change, inert while inactive),
 * boundary validation of untrusted state messages, and the bounded boot-ask
 * retry pacing that keeps the shadow landing in the document-start era.
 */
import { describe, expect, it } from 'vitest';
import { DEVICE_SIMULATION_PROFILE } from './profiles';
import { defineUserAgentShadow, startUaIdentity } from './identity';
import type { UaIdentityBridge } from './identity';

/** The one simulated device's identity: the string the shadow must present. */
const PROFILE_UA: string = DEVICE_SIMULATION_PROFILE.userAgent;

/**
 * A navigator stub: `userAgent` lives on the prototype as a getter, exactly
 * as it does on the page's `Navigator.prototype`, so define-then-restore
 * behaves like the real surface.
 */
function makeNavigatorStub(realUserAgent: string): object {
  const prototype = {} as { userAgent: unknown };
  Object.defineProperty(prototype, 'userAgent', {
    get: () => realUserAgent,
    enumerable: true,
    configurable: true
  });
  return Object.create(prototype) as object;
}

/** The identity as an own property value (`descriptor.value` short only). */
const readOwnUserAgent = (nav: object): string | undefined =>
  (nav as { userAgent?: string }).userAgent;

/** The states the background answers and pushes, in play in every test. */
const ON = { available: true, enabled: true };
const OFF = { available: false, enabled: false };

describe('defineUserAgentShadow', () => {
  it('defines the own shadow; reads return the simulated identity', () => {
    const nav = makeNavigatorStub('real-ua');
    const restore = defineUserAgentShadow(nav, PROFILE_UA);
    expect(restore).not.toBeNull();
    expect(readOwnUserAgent(nav)).toBe(PROFILE_UA);
  });

  it('restore deletes the own property; the prototype value returns intact', () => {
    const nav = makeNavigatorStub('real-ua');
    const restore = defineUserAgentShadow(nav, PROFILE_UA);
    expect(restore).not.toBeNull();
    expect(restore?.()).toBe(true);
    expect(Object.getOwnPropertyDescriptor(nav, 'userAgent')).toBeUndefined();
    expect(readOwnUserAgent(nav)).toBe('real-ua');
  });

  it('refuses to define over a preexisting own property — ours is not this one', () => {
    const nav = makeNavigatorStub('real-ua') as { userAgent?: string };
    Object.defineProperty(nav, 'userAgent', { value: 'page-owned-spoof', configurable: true });
    const restore = defineUserAgentShadow(nav, PROFILE_UA);
    expect(restore).toBeNull();
    expect(nav.userAgent).toBe('page-owned-spoof');
  });

  it('refuses on an unwriteable target (frozen) and never throws', () => {
    const nav = Object.freeze({}) as object;
    expect(defineUserAgentShadow(nav, PROFILE_UA)).toBeNull();
  });

  it('refuses when the target rejects descriptor reads and never throws', () => {
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('hostile accessor');
        }
      }
    );
    expect(defineUserAgentShadow(hostile, PROFILE_UA)).toBeNull();
  });

  it('reports a restore that no longer lands (the page froze the navigator afterwards)', () => {
    const nav = makeNavigatorStub('real-ua');
    const restore = defineUserAgentShadow(nav, PROFILE_UA);
    expect(restore).not.toBeNull();
    // The page's own defense: `Object.freeze` seals every own property;
    // deleting ours now throws in strict mode and the handle says so.
    Object.freeze(nav);
    expect(restore?.()).toBe(false);
    expect(readOwnUserAgent(nav)).toBe(PROFILE_UA); // frozen in place, honestly
  });
});

/**
 * A recording bridge for the driver: call order is observable, the ask can be
 * scripted per attempt, and announcements are emitted from the test side.
 */
interface BridgeHarness {
  bridge: UaIdentityBridge;
  /** Outgoing calls, in start order — the listener-before-ask pin's data. */
  readonly calls: string[];
  /** Ask call count: the bounded retry's pace, observable without async timing. */
  askCount: () => number;
  /** Script the ask attempts, in order. */
  scriptAsks: (scripts: Array<AskAttempt>) => void;
  /** Emit one announcement to whatever listener is installed (or null when removed). */
  emitAnnouncement: (payload: unknown) => void;
}

/**
 * One scripted ask attempt: an `answer` settles with its payload (and must
 * carry one), a `refuse` rejects, a `hang` never settles — the bridge's
 * documented no-listener semantics.
 */
interface AskAttempt {
  kind: 'answer' | 'refuse' | 'hang';
  payload?: unknown;
}

/** Build the recording bridge with an initially-empty ask script. */
function makeFakeBridge(): BridgeHarness {
  const calls: string[] = [];
  let handler: ((payload: unknown) => void) | null = null;
  const askScripts: AskAttempt[] = [];
  return {
    calls,
    askCount: () => calls.filter((call) => call === 'askRelay').length,
    scriptAsks: (scripts) => askScripts.push(...scripts),
    bridge: {
      askRelay: () => {
        calls.push('askRelay');
        const script: AskAttempt = askScripts.shift() ?? { kind: 'hang' };
        if (script.kind === 'refuse') return Promise.reject(new Error(String(script.payload)));
        if (script.kind === 'answer') return Promise.resolve(script.payload);
        return new Promise(() => undefined); // hang
      },
      onRelayAnnouncement: (onAnnouncement) => {
        calls.push('onRelayAnnouncement');
        handler = onAnnouncement;
        return () => {
          calls.push('onRelayAnnouncementRemoved');
          handler = null;
        };
      }
    } satisfies UaIdentityBridge,
    emitAnnouncement: (payload) => {
      handler?.(payload);
    }
  };
}

/** A controllable frame tick: every call parks one `resolve` for the test. */
function makeFrameTick(): {
  frameTick: () => Promise<void>;
  runPendingTicks: () => void;
  tickCount: () => number;
} {
  const resolvers: Array<() => void> = [];
  return {
    frameTick: () => {
      return new Promise<void>((resolve) => resolvers.push(resolve));
    },
    runPendingTicks: () => {
      resolvers.splice(0).forEach((resolve) => {
        resolve();
      });
    },
    tickCount: () => resolvers.length
  };
}

/** Flush one full microtask batch so the fired asks settle before asserting. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('startUaIdentity — the boot path', () => {
  it('registers the announcement listener before the boot ask goes out', () => {
    const { bridge, calls } = makeFakeBridge();
    startUaIdentity({ bridge, navigatorLike: {}, simulatedUserAgent: PROFILE_UA });
    expect(calls.slice(0, 2)).toEqual(['onRelayAnnouncement', 'askRelay']);
  });

  it('defines the shadow synchronously on a valid announcement (no async step needed)', () => {
    const { bridge, emitAnnouncement } = makeFakeBridge();
    const nav = makeNavigatorStub('real-ua');
    startUaIdentity({ bridge, navigatorLike: nav, simulatedUserAgent: PROFILE_UA });
    emitAnnouncement(ON);
    expect(readOwnUserAgent(nav)).toBe(PROFILE_UA);
  });

  it('boot answer enables: after the answer the reads carry the simulated identity', async () => {
    const harness = makeFakeBridge();
    harness.scriptAsks([{ kind: 'answer', payload: ON }]);
    const nav = makeNavigatorStub('real-ua');
    startUaIdentity({
      bridge: harness.bridge,
      navigatorLike: nav,
      simulatedUserAgent: PROFILE_UA
    });
    await settle();
    expect(readOwnUserAgent(nav)).toBe(PROFILE_UA);
  });

  it('boot answer disables: nothing is defined — inert while inactive', async () => {
    const harness = makeFakeBridge();
    harness.scriptAsks([{ kind: 'answer', payload: OFF }]);
    const nav = makeNavigatorStub('real-ua');
    startUaIdentity({
      bridge: harness.bridge,
      navigatorLike: nav,
      simulatedUserAgent: PROFILE_UA
    });
    await settle();
    expect(Object.getOwnPropertyDescriptor(nav, 'userAgent')).toBeUndefined();
    expect(readOwnUserAgent(nav)).toBe('real-ua');
  });

  it('a malformed boot answer is ignored: no shadow, no throw, no state applied', async () => {
    const harness = makeFakeBridge();
    harness.scriptAsks([{ kind: 'answer', payload: { enabled: true } }]); // missing `available`
    const nav = makeNavigatorStub('real-ua');
    startUaIdentity({
      bridge: harness.bridge,
      navigatorLike: nav,
      simulatedUserAgent: PROFILE_UA
    });
    await settle();
    expect(Object.getOwnPropertyDescriptor(nav, 'userAgent')).toBeUndefined();
  });

  it('an ask rejection keeps the driver alive; the announcement channel still works', async () => {
    const harness = makeFakeBridge();
    harness.scriptAsks([{ kind: 'refuse' }]);
    const nav = makeNavigatorStub('real-ua');
    startUaIdentity({
      bridge: harness.bridge,
      navigatorLike: nav,
      simulatedUserAgent: PROFILE_UA
    });
    await settle();
    harness.emitAnnouncement(ON);
    expect(readOwnUserAgent(nav)).toBe(PROFILE_UA);
  });
});

describe('startUaIdentity — the state machine', () => {
  it('applies on change only: an announcement repeating the state is a no-op', () => {
    const { bridge, emitAnnouncement } = makeFakeBridge();
    const nav = makeNavigatorStub('real-ua');
    startUaIdentity({ bridge, navigatorLike: nav, simulatedUserAgent: PROFILE_UA });
    emitAnnouncement(ON);
    expect(readOwnUserAgent(nav)).toBe(PROFILE_UA);
    emitAnnouncement(ON);
    // The shadow is still the one own property and still ours: a re-apply of
    // this state would have been refused as preexisting (`null`), which the
    // held value shows did not happen — the state machine skipped it.
    expect(readOwnUserAgent(nav)).toBe(PROFILE_UA);
  });

  it('disable restores; a later re-enable redefines (the toggle has no dead ends)', () => {
    const { bridge, emitAnnouncement } = makeFakeBridge();
    const nav = makeNavigatorStub('real-ua');
    startUaIdentity({ bridge, navigatorLike: nav, simulatedUserAgent: PROFILE_UA });
    emitAnnouncement(ON);
    expect(readOwnUserAgent(nav)).toBe(PROFILE_UA);
    emitAnnouncement(OFF);
    expect(Object.getOwnPropertyDescriptor(nav, 'userAgent')).toBeUndefined();
    expect(readOwnUserAgent(nav)).toBe('real-ua');
    emitAnnouncement(ON);
    expect(readOwnUserAgent(nav)).toBe(PROFILE_UA);
  });

  it('malformed announcements are refused — every key-set violation offered, none swallowed', () => {
    const { bridge, emitAnnouncement } = makeFakeBridge();
    const nav = makeNavigatorStub('real-ua');
    startUaIdentity({ bridge, navigatorLike: nav, simulatedUserAgent: PROFILE_UA });
    const hostiles: unknown[] = [
      undefined,
      null,
      42,
      'on',
      { available: true, enabled: 'true' },
      { available: true },
      { enabled: true },
      { available: true, enabled: true, extra: 1 }
    ];
    for (const payload of hostiles) emitAnnouncement(payload);
    expect(Object.getOwnPropertyDescriptor(nav, 'userAgent')).toBeUndefined();
  });
});

describe('startUaIdentity — the bounded boot ask', () => {
  it('re-asks once per frame tick while unanswered, up to the three-attempt bound', async () => {
    const harness = makeFakeBridge(); // no script: every ask hangs
    const ticks = makeFrameTick();
    startUaIdentity({
      bridge: harness.bridge,
      navigatorLike: {},
      simulatedUserAgent: PROFILE_UA,
      frameTick: ticks.frameTick
    });
    expect(harness.askCount()).toBe(1);
    for (let attempt = 2; attempt <= 3; attempt++) {
      ticks.runPendingTicks();
      await settle();
      expect(harness.askCount()).toBe(attempt);
    }
    ticks.runPendingTicks();
    await settle();
    expect(harness.askCount()).toBe(3); // bounded: no dead asks ever again
  });

  it('a settled answer ends the retry schedule; later ticks stay silent', async () => {
    const harness = makeFakeBridge();
    harness.scriptAsks([{ kind: 'hang' }, { kind: 'answer', payload: OFF }]); // first hangs, second answers
    const ticks = makeFrameTick();
    startUaIdentity({
      bridge: harness.bridge,
      navigatorLike: {},
      simulatedUserAgent: PROFILE_UA,
      frameTick: ticks.frameTick
    });
    await settle();
    expect(harness.askCount()).toBe(1);
    ticks.runPendingTicks();
    await settle();
    expect(harness.askCount()).toBe(2);
    ticks.runPendingTicks();
    await settle();
    expect(harness.askCount()).toBe(2); // the answer settled the ask era
  });

  it('stop() drops the pending retry: no ask after it, and announcements end', async () => {
    const harness = makeFakeBridge();
    const ticks = makeFrameTick();
    const nav = makeNavigatorStub('real-ua');
    const stop = startUaIdentity({
      bridge: harness.bridge,
      navigatorLike: nav,
      simulatedUserAgent: PROFILE_UA,
      frameTick: ticks.frameTick
    });
    ticks.runPendingTicks();
    await settle();
    expect(harness.askCount()).toBe(2);
    stop();
    ticks.runPendingTicks();
    await settle();
    expect(harness.askCount()).toBe(2);
    // The announcement remover already cleared the handler: an announcement
    // arriving after the stop defines nothing (and would be dead work).
    harness.emitAnnouncement(ON);
    expect(Object.getOwnPropertyDescriptor(nav, 'userAgent')).toBeUndefined();
  });

  it('a failing frame tick does not break the driver (the retry schedule self-retires)', async () => {
    const harness = makeFakeBridge();
    const nav = makeNavigatorStub('real-ua');
    startUaIdentity({
      bridge: harness.bridge,
      navigatorLike: nav,
      simulatedUserAgent: PROFILE_UA,
      frameTick: (): Promise<void> => Promise.reject(new Error('no animation frames here'))
    });
    await settle();
    // Ask attempt 1 went out; the schedule died at its first tick and the
    // announcements channel still runs:
    expect(harness.askCount()).toBe(1);
    harness.emitAnnouncement(ON);
    expect(readOwnUserAgent(nav)).toBe(PROFILE_UA);
  });

  it('a push has newer truth: a stale ask answer landing later changes nothing', async () => {
    const harness = makeFakeBridge();
    const nav = makeNavigatorStub('real-ua');
    startUaIdentity({
      bridge: harness.bridge,
      navigatorLike: nav,
      simulatedUserAgent: PROFILE_UA
    });
    // The push lands first (the change itself)…
    harness.emitAnnouncement(ON);
    expect(readOwnUserAgent(nav)).toBe(PROFILE_UA);
    // …then a boot-ask answer — a snapshot older than the push — resolves
    // late and is DROPPED: the shadow must not flicker back to a snapshot.
    harness.scriptAsks([{ kind: 'answer', payload: OFF }]);
    await settle();
    expect(readOwnUserAgent(nav)).toBe(PROFILE_UA);
  });

  it('the first answer wins: a snapshot that lands while nothing is known applies', async () => {
    const harness = makeFakeBridge();
    const nav = makeNavigatorStub('real-ua');
    startUaIdentity({
      bridge: harness.bridge,
      navigatorLike: nav,
      simulatedUserAgent: PROFILE_UA
    });
    harness.scriptAsks([{ kind: 'answer', payload: OFF }]);
    await settle();
    expect(readOwnUserAgent(nav)).toBe('real-ua');
    // The snapshot era is over: a second ask answer is dead information.
    harness.scriptAsks([{ kind: 'answer', payload: ON }]);
    await settle();
    expect(Object.getOwnPropertyDescriptor(nav, 'userAgent')).toBeUndefined();
  });
});
