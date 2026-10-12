/**
 * Messenger contract tests against the fake browser runtime:
 *
 * - the extension messenger performs a REAL request/response round trip
 *   (listener registers, send resolves with the handler's return);
 * - a send with no listener rejects — the documented runtime semantics every
 *   push sender must catch;
 * - the window-bridge namespace is the single-sourced constant both worlds
 *   import, and two independent messengers under it can hear each other.
 */
import { describe, expect, it } from 'vitest';
import { defineWindowMessaging } from '@webext-core/messaging/page';
import { onMessage, sendMessage } from './index';
import {
  UA_IDENTITY_BRIDGE_NAMESPACE,
  WINDOW_BRIDGE_NAMESPACE,
  uaIdentityMessenger,
  windowMessenger,
  type UaIdentityProtocolMap,
  type WindowProtocolMap
} from './window-bridge';

describe('extension messenger', () => {
  it('round-trips a request/response through the fake runtime', async () => {
    const removeListener = onMessage('getFdtData', () => null);
    try {
      await expect(sendMessage('getFdtData')).resolves.toBeNull();
    } finally {
      removeListener();
    }
  });

  it('round-trips payload data and validates it reaches the receiver', async () => {
    const seen: string[] = [];
    const removeListener = onMessage('undefinedReferencesUpdated', ({ data }) => {
      seen.push(...data);
      return true;
    });
    try {
      await expect(sendMessage('undefinedReferencesUpdated', ['jQuery', 'wp'])).resolves.toBe(true);
      expect(seen).toEqual(['jQuery', 'wp']);
    } finally {
      removeListener();
    }
  });

  it('rejects a send whose channel has no listener (the catch-me contract)', async () => {
    // Runtime text differs by platform ("No listeners available" on the fake
    // runtime, "Could not establish connection" in Chromium, "No response"
    // for tab-targeted sends) — the constant is the rejection itself.
    await expect(sendMessage('getFdtData')).rejects.toThrow(
      /No listeners|No response|Could not establish/i
    );
  });

  it('a handler returning undefined resolves the send with undefined (pin of the library contract)', async () => {
    // This is why ack rows are typed `(): true`: the type system forces the
    // deliberate acknowledgement exactly where a silent `return` would be
    // indistinguishable from a transport failure to readers.
    const removeListener = onMessage('notifyPanelReload', () => undefined);
    try {
      await expect(sendMessage('notifyPanelReload')).resolves.toBeUndefined();
    } finally {
      removeListener();
    }
  });
});

describe('window-bridge namespace', () => {
  it('is the exported constant both worlds must share', () => {
    expect(WINDOW_BRIDGE_NAMESPACE).toBe('wpr-fdt-undefined-references');
    expect(typeof windowMessenger.onMessage).toBe('function');
    expect(typeof windowMessenger.sendMessage).toBe('function');
  });

  it('independent messengers under the same namespace hear each other', async () => {
    const senderSide = defineWindowMessaging<WindowProtocolMap>({
      namespace: WINDOW_BRIDGE_NAMESPACE
    });
    const seen: string[] = [];
    const removeListener = windowMessenger.onMessage('undefinedReferenceBatch', ({ data }) => {
      seen.push(...data);
      return true;
    });
    try {
      await senderSide.sendMessage('undefinedReferenceBatch', ['React']);
      expect(seen).toEqual(['React']);
    } finally {
      removeListener();
    }
  });
});

describe('identity bridge', () => {
  it('carries its own namespace, distinct from the error batches one', () => {
    expect(UA_IDENTITY_BRIDGE_NAMESPACE).toBe('wpr-fdt-ua-identity');
    expect(UA_IDENTITY_BRIDGE_NAMESPACE).not.toBe(WINDOW_BRIDGE_NAMESPACE);
  });

  it('round-trips the ask and the acknowledged push across two instances', async () => {
    const relaySide = defineWindowMessaging<UaIdentityProtocolMap>({
      namespace: UA_IDENTITY_BRIDGE_NAMESPACE
    });
    const identitySide = defineWindowMessaging<UaIdentityProtocolMap>({
      namespace: UA_IDENTITY_BRIDGE_NAMESPACE
    });
    const removeAsk = relaySide.onMessage('uaIdentityRequest', () => ({
      available: true,
      enabled: false
    }));
    const removes: Array<() => void> = [removeAsk];
    const seen: unknown[] = [];
    try {
      // The ask's answer arrives as the cached state:
      await expect(identitySide.sendMessage('uaIdentityRequest')).resolves.toEqual({
        available: true,
        enabled: false
      });
      // The push goes relay → identity and is acknowledged (true) there:
      removes.push(
        identitySide.onMessage('uaIdentityUpdate', ({ data }) => {
          seen.push(data);
          return true;
        })
      );
      await expect(
        relaySide.sendMessage('uaIdentityUpdate', { available: true, enabled: true })
      ).resolves.toBe(true);
      expect(seen).toEqual([{ available: true, enabled: true }]);
    } finally {
      for (const remove of removes.reverse()) remove();
    }
  });

  it('the two namespaces stay independent inside one window (no cross-pair answers)', async () => {
    // One window has two pairs in production (error batches + identity); if
    // their namespaces collided, each pair's sibling instance would answer
    // the other's channels — this pins the separation the design leans on.
    const errorPair = defineWindowMessaging<WindowProtocolMap>({
      namespace: WINDOW_BRIDGE_NAMESPACE
    });
    const identityPair = defineWindowMessaging<UaIdentityProtocolMap>({
      namespace: UA_IDENTITY_BRIDGE_NAMESPACE
    });
    const removeErrorListener = windowMessenger.onMessage('undefinedReferenceBatch', () => true);
    const removeIdentityListener = uaIdentityMessenger.onMessage('uaIdentityRequest', () => ({
      available: false,
      enabled: false
    }));
    try {
      await expect(errorPair.sendMessage('undefinedReferenceBatch', [])).resolves.toBe(true);
      await expect(identityPair.sendMessage('uaIdentityRequest')).resolves.toEqual({
        available: false,
        enabled: false
      });
    } finally {
      removeErrorListener();
      removeIdentityListener();
    }
  });
});
