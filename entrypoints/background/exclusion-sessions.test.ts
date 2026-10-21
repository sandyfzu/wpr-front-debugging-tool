/**
 * The background wiring over the fake browser: every session channel is
 * registered and answers through the real messenger, the registry holds
 * the Chromium row, and the tab-close and update hooks reach the stores.
 * The lifecycle itself is pinned in `lib/exclusion-session/controller.test.ts`.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../../lib/messaging';
import { EMPTY_EXCLUSION_SET } from '../../lib/exclusion-builder/set';
import {
  getExclusionSessionRecords,
  putExclusionSessionRecord
} from '../../lib/storage/exclusion-sessions';
import { initExclusionSessions } from './exclusion-sessions';
import { CHROMIUM_INTERCEPTION_ROW } from './chromium-interception';
import { INTERCEPTION_BACKENDS } from './interception-backends';

const WARNING = { state: 'unavailable', cause: 'detached', at: 1 } as const;

/** Let unawaited listener work settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(() => {
  // The fake browser leaves the debugger events unimplemented; the Chromium
  // row's backend registers its listeners on them at creation.
  vi.spyOn(browser.debugger.onEvent, 'addListener').mockImplementation(() => {});
  vi.spyOn(browser.debugger.onDetach, 'addListener').mockImplementation(() => {});
  initExclusionSessions();
});

describe('exclusion-session wiring', () => {
  it('registers the Chromium debugger backend row in a Chromium build (run-time detected)', () => {
    expect(INTERCEPTION_BACKENDS).toContain(CHROMIUM_INTERCEPTION_ROW);
  });

  it('keeps the Firefox-only streaming-filter row out of a Chromium build', () => {
    // The test runner builds for Chromium.
    expect(INTERCEPTION_BACKENDS.map((row) => row.id)).not.toContain('stream-filter');
  });

  it('registers the streaming-filter row in a Firefox build', async () => {
    vi.stubEnv('BROWSER', 'firefox');
    vi.resetModules();
    try {
      const firefox = await import('./interception-backends');
      // …and only it: the debugger-protocol row stays out of the Firefox bundle.
      expect(firefox.INTERCEPTION_BACKENDS.map((row) => row.id)).toEqual(['stream-filter']);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('answers the overlay channels (a tab-less sender is no page)', async () => {
    await expect(
      sendMessage('applyExclusionSession', { set: EMPTY_EXCLUSION_SET })
    ).resolves.toEqual({
      outcome: 'unavailable',
      cause: 'unsupported-page'
    });
    await expect(sendMessage('stopExclusionSession')).resolves.toEqual({ state: 'inactive' });
    await expect(sendMessage('getExclusionSession')).resolves.toEqual({ state: 'inactive' });
    await expect(sendMessage('getSavedExclusionSet')).resolves.toEqual({ set: null });
    await expect(sendMessage('saveExclusionSet', { set: EMPTY_EXCLUSION_SET })).resolves.toEqual({
      outcome: 'not-saved',
      reason: 'unsupported-page'
    });
  });

  it('refuses the panel channel to a sender that is not this extension’s page, reaching the sender', async () => {
    // The fake runtime delivers an empty sender (no extension id).
    await expect(sendMessage('getExclusionSessionForTab', { tabId: 1 })).rejects.toThrow(
      /only extension pages/
    );
  });

  it('cleans a closed tab’s record', async () => {
    await putExclusionSessionRecord(7, WARNING);
    await fakeBrowser.tabs.onRemoved.trigger(7, { windowId: 1, isWindowClosing: false });
    await flush();
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
  });

  it('clears every session on an extension update, not on install', async () => {
    await putExclusionSessionRecord(8, WARNING);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await flush();
    await expect(getExclusionSessionRecords()).resolves.toEqual({ '8': WARNING });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.0.0' });
    await flush();
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
  });
});
