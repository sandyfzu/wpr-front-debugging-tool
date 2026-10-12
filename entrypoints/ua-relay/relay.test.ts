/**
 * The identity relay: boot order (ask handler before the background ask),
 * boundary validation of every state it relays, and the full pair round trip
 * over real window messengers — relay and page-world identity hearing each
 * other through the same postMessage plumbing a frame actually has, with the
 * extension side faked.
 */
import { describe, expect, it } from 'vitest';
import { defineWindowMessaging, type WindowMessenger } from '@webext-core/messaging/page';
import { DEVICE_SIMULATION_PROFILE } from '../../lib/device-simulation/profiles';
import { startUaIdentity } from '../../lib/device-simulation/identity';
import type { UaIdentityBridge } from '../../lib/device-simulation/identity';
import type { DeviceSimState } from '../../lib/device-simulation/state';
import {
  UA_IDENTITY_BRIDGE_NAMESPACE,
  type UaIdentityProtocolMap
} from '../../lib/messaging/window-bridge';
import { createLogger, type Logger } from '../../lib/logger';
import { startUaIdentityRelay } from './relay';
import type { UaRelayExtensionChannel, UaRelayWindowBridge } from './relay';

/** The one simulated device's identity: the string a simulated half reads. */
const PROFILE_UA: string = DEVICE_SIMULATION_PROFILE.userAgent;
/** The states in play. */
const ON: DeviceSimState = { available: true, enabled: true };
const OFF: DeviceSimState = { available: false, enabled: false };

/** Swallowing spot for the modules' diagnostics under test. */
const log: Logger = createLogger('ua-relay-test');

/**
 * Scripted extension side over a shared call ledger: the ask can be planted
 * to resolve later (the not-yet-known era), pushes are driven from the test.
 */
function makeFakeExtension(calls: string[]): UaRelayExtensionChannel & {
  /** Plant the boot ask's answer (any number of pending asks resolve at once). */
  answerAsk(value: unknown): void;
  /** Drive one tab push through the subscription. */
  emitPush(payload: unknown): void;
} {
  let pushHandlers: Array<(payload: unknown) => void> = [];
  const pendingAsks: Array<(value: unknown) => void> = [];
  return {
    answerAsk: (value) => {
      pendingAsks.splice(0).forEach((resolve) => {
        resolve(value);
      });
    },
    emitPush: (payload) => {
      calls.push('emitPush');
      for (const handler of pushHandlers) handler(payload);
    },
    askBackground: (): Promise<unknown> => {
      calls.push('askBackground');
      return new Promise((resolve) => pendingAsks.push(resolve));
    },
    onBackgroundPush: (handler) => {
      calls.push('onBackgroundPush');
      pushHandlers.push(handler);
      return (): void => {
        calls.push('onBackgroundPushRemoved');
        pushHandlers = pushHandlers.filter((registered) => registered !== handler);
      };
    }
  };
}

/**
 * Recording window bridge over the same call ledger: the ask answer is
 * observable on demand, announcements accumulate.
 */
function recordWindowBridge(calls: string[]): UaRelayWindowBridge & {
  /** The current answer to a page-world ask (throws when no handler is left). */
  askAnswer(): DeviceSimState;
  /** Everything announced to the page world, in order. */
  readonly announced: DeviceSimState[];
} {
  let askHandler: (() => DeviceSimState) | null = null;
  const announced: DeviceSimState[] = [];
  return {
    announced,
    askAnswer: () => askHandler?.() ?? assertAskHandlerPresent(),
    onIdentityAsk: (handler) => {
      calls.push('onIdentityAsk');
      askHandler = handler;
      return () => {
        calls.push('onIdentityAskRemoved');
        askHandler = null;
      };
    },
    announceIdentityState: (state) => {
      calls.push('announceIdentityState');
      announced.push(state);
    }
  };
}

/** The never-assigned ask handler is a relay removed mid-flight — test abort. */
function assertAskHandlerPresent(): never {
  throw new Error('The relay under test was stopped before this answer');
}

/** The relay's window bridge mapped exactly as the entrypoint glue maps it. */
function mapRealWindowBridge(
  messenger: WindowMessenger<UaIdentityProtocolMap>
): UaRelayWindowBridge {
  return {
    onIdentityAsk: (handler) => messenger.onMessage('uaIdentityRequest', () => handler()),
    announceIdentityState: (state) => {
      void messenger.sendMessage('uaIdentityUpdate', state).catch((cause: unknown) => {
        log.debug('Announcement was refused', cause);
      });
    }
  };
}

/** The driver's bridge mapped exactly as the identity entrypoint glue maps it. */
function mapRealIdentityBridge(
  messenger: WindowMessenger<UaIdentityProtocolMap>
): UaIdentityBridge {
  return {
    askRelay: () => messenger.sendMessage('uaIdentityRequest'),
    onRelayAnnouncement: (handler) =>
      messenger.onMessage('uaIdentityUpdate', ({ data }) => {
        handler(data);
        return true;
      })
  };
}

/**
 * A navigator stub shaped like the real thing: `userAgent` is a prototype
 * getter, so an instance-level define and its delete behave as on the page.
 */
function makeNavigatorStub(): object {
  const prototype = {} as { userAgent: unknown };
  Object.defineProperty(prototype, 'userAgent', {
    get: () => 'real-ua',
    enumerable: true,
    configurable: true
  });
  return Object.create(prototype) as object;
}

/** The page value's read. */
const readUserAgent = (nav: object): string => (nav as { userAgent: string }).userAgent;

/** Flush one full microtask batch (messaging round trips settle within one). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('startUaIdentityRelay — the relay state machine', () => {
  it('registers the ask handler and the push subscription before asking the background', () => {
    const calls: string[] = [];
    const extension = makeFakeExtension(calls);
    const windowBridge = recordWindowBridge(calls);
    startUaIdentityRelay({ extension, windowBridge, log });
    expect(calls.slice(0, 3)).toEqual(['onIdentityAsk', 'onBackgroundPush', 'askBackground']);
  });

  it('answers a page-world ask from the not-yet-known state while the boot ask is in flight', async () => {
    const calls: string[] = [];
    const extension = makeFakeExtension(calls);
    const windowBridge = recordWindowBridge(calls);
    startUaIdentityRelay({ extension, windowBridge, log });
    expect(windowBridge.askAnswer()).toEqual({ available: false, enabled: false });
    extension.answerAsk(ON);
    await settle();
    expect(windowBridge.askAnswer()).toEqual(ON);
  });

  it('announces the boot answer; a repeating push is not re-announced', async () => {
    const calls: string[] = [];
    const extension = makeFakeExtension(calls);
    const windowBridge = recordWindowBridge(calls);
    startUaIdentityRelay({ extension, windowBridge, log });
    extension.answerAsk(ON);
    await settle();
    expect(windowBridge.announced).toEqual([ON]);
    extension.emitPush(ON);
    expect(windowBridge.announced).toEqual([ON]);
  });

  it('relays a state change from the tab push; malformed pushes are ignored', () => {
    const calls: string[] = [];
    const extension = makeFakeExtension(calls);
    const windowBridge = recordWindowBridge(calls);
    startUaIdentityRelay({ extension, windowBridge, log });
    extension.emitPush({ available: true, extra: 'hostile' });
    extension.emitPush(42);
    expect(windowBridge.announced).toEqual([]);
    extension.emitPush(ON);
    expect(windowBridge.announced).toEqual([ON]);
  });

  it('a background ask failure degrades the cache to all-off; pushes still relay later', async () => {
    const calls: string[] = [];
    const extension = makeFakeExtension(calls);
    const windowBridge = recordWindowBridge(calls);
    (extension as unknown as { askBackground: () => Promise<unknown> }).askBackground = () =>
      Promise.reject(new Error('background not answering'));
    startUaIdentityRelay({ extension, windowBridge, log });
    await settle();
    expect(windowBridge.askAnswer()).toEqual({ available: false, enabled: false });
    extension.emitPush(ON);
    expect(windowBridge.announced).toEqual([ON]);
  });

  it('stop() removes the ask handler and the push subscription', async () => {
    const calls: string[] = [];
    const extension = makeFakeExtension(calls);
    const windowBridge = recordWindowBridge(calls);
    const stop = startUaIdentityRelay({ extension, windowBridge, log });
    extension.answerAsk(ON);
    await settle();
    stop();
    extension.emitPush(OFF);
    expect(windowBridge.announced).toEqual([ON]); // the push subscription is gone
    expect(calls).toContain('onBackgroundPushRemoved');
  });
});

/* Full pair — page-world identity and relay over the real bridge namespace. */
describe('the identity pair over the real window bridge', () => {
  it('round-trips a frame: the ask answers all-off first, a state lands, and off restores', async () => {
    // Two independent messengers under the shared namespace: the same window
    // has two worlds in production, so the instances — not the window — are
    // the hearers.
    const relayMessenger = defineWindowMessaging<UaIdentityProtocolMap>({
      namespace: UA_IDENTITY_BRIDGE_NAMESPACE
    });
    const identityMessenger = defineWindowMessaging<UaIdentityProtocolMap>({
      namespace: UA_IDENTITY_BRIDGE_NAMESPACE
    });
    const calls: string[] = [];
    const extension = makeFakeExtension(calls);
    const nav = makeNavigatorStub();

    // Relay first: the production invariant — the ask handler exists before
    // the page world can even send its question.
    startUaIdentityRelay({
      extension,
      windowBridge: mapRealWindowBridge(relayMessenger),
      log
    });
    const stopIdentity = startUaIdentity({
      bridge: mapRealIdentityBridge(identityMessenger),
      navigatorLike: nav,
      simulatedUserAgent: PROFILE_UA
    });

    // The ask round-trips while the background ask is still in flight: the
    // page view stays inert.
    await settle();
    expect(readUserAgent(nav)).toBe('real-ua');

    // The real state lands late over the extension fake; the relay announces
    // it over the bridge and the shadow defines.
    extension.answerAsk(ON);
    await settle();
    expect(readUserAgent(nav)).toBe(PROFILE_UA);

    // Simulation turning off restores the page's own identity.
    extension.emitPush(OFF);
    await settle();
    expect(readUserAgent(nav)).toBe('real-ua');
    stopIdentity();
  });
});
