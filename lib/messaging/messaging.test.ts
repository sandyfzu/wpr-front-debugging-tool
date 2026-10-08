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
import { WINDOW_BRIDGE_NAMESPACE, windowMessenger, type WindowProtocolMap } from './window-bridge';

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
