/**
 * The identity entrypoint's registration envelope and its coexistence with
 * the MAIN-world capture: the document-start pins are read off the real
 * definition the bundler registers, and one page runs both MAIN-world
 * modules at once to prove they tolerate each other.
 */
import { describe, expect, it } from 'vitest';
import identityDefinition from '../ua-identity.content';
import { DEVICE_SIMULATION_PROFILE } from '../../lib/device-simulation/profiles';
import { startUaIdentity } from '../../lib/device-simulation/identity';
import type { UaIdentityBridge } from '../../lib/device-simulation/identity';
import { URL_PATTERNS } from '../../lib/wp-rocket/constants';
import { startUndefinedReferenceCapture } from '../main-world/capture-undefined-references';

describe('the MAIN-world identity registration envelope', () => {
  it('runs at document start, on the page world, in every frame, on every http/https document', () => {
    expect(identityDefinition.matches).toEqual(URL_PATTERNS);
    expect(identityDefinition.runAt).toBe('document_start');
    expect(identityDefinition.allFrames).toBe(true);
    // The MAIN world option is typed literally on the definition — the
    // presence of the exact `'MAIN'` value is the pin, not its shape.
    expect('world' in identityDefinition).toBe(true);
    expect(identityDefinition.world === 'MAIN').toBe(true);
    expect(typeof identityDefinition.main).toBe('function');
  });
});

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

/**
 * A minimal announcement-capable bridge: only the driver's announce half,
 * with an unresolved boot ask (the real channel hangs until the relay
 * answers — the shadow here is driven by announcements alone).
 */
function makeStubBridge(): { bridge: UaIdentityBridge; announce: (payload: unknown) => void } {
  let handler: ((payload: unknown) => void) | null = null;
  return {
    bridge: {
      askRelay: () => new Promise(() => undefined),
      onRelayAnnouncement: (onAnnouncement) => {
        handler = onAnnouncement;
        return (): void => {
          handler = null;
        };
      }
    } satisfies UaIdentityBridge,
    announce: (payload) => handler?.(payload)
  };
}

/** Fire a page error through a real window event, exactly as scripts do. */
const pageError = (thrownValue: unknown): void => {
  window.dispatchEvent(new ErrorEvent('error', { error: thrownValue }));
};

describe('one page, both MAIN-world modules', () => {
  it('the capture keeps recording errors across the identity define and restore', async () => {
    const sends: string[][] = [];
    const stopCapture = startUndefinedReferenceCapture({
      eventTarget: window,
      sendBatch: (words) => sends.push(words),
      flushDelayMs: 2
    });
    const nav = makeNavigatorStub();
    const { bridge, announce } = makeStubBridge();
    const stopIdentity = startUaIdentity({
      bridge,
      navigatorLike: nav,
      simulatedUserAgent: DEVICE_SIMULATION_PROFILE.userAgent,
      frameTick: (): Promise<void> => Promise.resolve()
    });

    // An error before the identity knows anything:
    pageError(new ReferenceError('firstThing is not defined'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The shadow turns on:
    announce({ available: true, enabled: true });
    expect((nav as { userAgent: string }).userAgent).toBe(DEVICE_SIMULATION_PROFILE.userAgent);

    // An error while the shadow is live:
    pageError(new ReferenceError('secondThing is not defined'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The shadow turns off:
    announce({ available: true, enabled: false });
    expect((nav as { userAgent: string }).userAgent).toBe('real-ua');

    // An error after the restore:
    pageError(new ReferenceError('thirdThing is not defined'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sends.map((words) => [...words])).toEqual([
      ['firstThing'],
      ['secondThing'],
      ['thirdThing']
    ]);
    stopIdentity();
    stopCapture();
  });
});
