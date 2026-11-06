/**
 * The beacon runner load: only a top-frame http(s) sender is answered, on
 * its own tab — the built runner script is injected into the sending
 * document when the browser names it (else the tab's top frame); any other
 * sender is refused before anything is injected; an injection failure
 * rejects (logged). The registered channel answers over messaging.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../../lib/messaging';
import {
  BEACON_RUNNER_SCRIPT,
  answerBeaconRunnerLoad,
  registerBeaconRunnerLoad
} from './beacon-runner-load';
import type { InjectScripts } from './top-frame-injection';

/** A top-frame page sender on tab 7. */
const PAGE = { tab: { id: 7 }, frameId: 0, url: 'https://example.com/a?b=1' } as const;

/** Senders that must be refused. */
const REFUSED = [
  ['a sub-frame', { ...PAGE, frameId: 2 }],
  ['a tabless sender (an extension page)', { id: 'ext', url: 'chrome-extension://x/panel.html' }],
  ['a non-web page', { ...PAGE, url: 'chrome://settings' }],
  ['no sender', undefined]
] as const;

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('answerBeaconRunnerLoad', () => {
  it('injects the runner script into the sender tab’s top frame when no document is named', async () => {
    const inject = vi.fn<InjectScripts>(() => Promise.resolve());
    await expect(answerBeaconRunnerLoad(PAGE, inject)).resolves.toBe(true);
    expect(inject).toHaveBeenCalledWith({ tabId: 7, documentId: null }, [BEACON_RUNNER_SCRIPT]);
    // WXT emits unlisted scripts at the output root.
    expect(BEACON_RUNNER_SCRIPT).toBe('/beacon-runner.js');
  });

  it('aims the injection at the sending document when the browser names it', async () => {
    const inject = vi.fn<InjectScripts>(() => Promise.resolve());
    await answerBeaconRunnerLoad({ ...PAGE, documentId: 'DOC-1' }, inject);
    expect(inject).toHaveBeenCalledWith({ tabId: 7, documentId: 'DOC-1' }, [BEACON_RUNNER_SCRIPT]);
  });

  it.each(REFUSED)('refuses %s without injecting', async (_label, sender) => {
    const inject = vi.fn<InjectScripts>(() => Promise.resolve());
    await expect(answerBeaconRunnerLoad(sender, inject)).rejects.toThrow(
      'loadBeaconRunner: only a top-frame page may load the runner'
    );
    expect(inject).not.toHaveBeenCalled();
  });

  it('rejects with the injection’s own failure (logged)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cause = new Error('Cannot access contents of the page');
    await expect(answerBeaconRunnerLoad(PAGE, () => Promise.reject(cause))).rejects.toBe(cause);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('registerBeaconRunnerLoad', () => {
  it('answers the channel by injecting the runner (the fake sender is a tabless extension page: refused)', async () => {
    const execute = vi.spyOn(browser.scripting, 'executeScript').mockResolvedValue([] as never);
    registerBeaconRunnerLoad();
    // The fake browser's sender has no tab: the shared answer refuses it before any injection.
    await expect(sendMessage('loadBeaconRunner', undefined)).rejects.toThrow(
      'only a top-frame page may load the runner'
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
