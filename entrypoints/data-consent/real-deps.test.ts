import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger';
import type { DataConsentApi } from '../../lib/data-consent/consent';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../../lib/messaging', () => ({ sendMessage }));

const { realConsentFlowDeps, removedDataCollection } = await import('./real-deps');

/** A logger double. */
function logDouble() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

const request = vi.fn<DataConsentApi['request']>(() => Promise.resolve(true));
const API: DataConsentApi = {
  getAll: () => Promise.resolve({ data_collection: [] }),
  request
};

beforeEach(() => {
  fakeBrowser.reset();
  sendMessage.mockReset();
});

describe('removedDataCollection', () => {
  it('reads the removed data types, tolerating a payload without them', () => {
    expect(removedDataCollection({ data_collection: ['browsingActivity', 3] })).toEqual([
      'browsingActivity'
    ]);
    expect(removedDataCollection({ permissions: ['tabs'] })).toEqual([]);
    expect(removedDataCollection({ data_collection: 'browsingActivity' })).toEqual([]);
  });
});

describe('realConsentFlowDeps', () => {
  it('pushes the answer for the asking tool; no tool listening is fine (debug only)', async () => {
    const log = logDouble();
    const deps = realConsentFlowDeps({ feature: 'rucss', next: null }, API, vi.fn(), log);
    sendMessage.mockResolvedValueOnce(true);
    await deps.sendAnswer(true);
    expect(sendMessage).toHaveBeenCalledWith('dataConsentAnswered', {
      feature: 'rucss',
      granted: true
    });
    sendMessage.mockRejectedValueOnce(
      new Error('Could not establish connection. Receiving end does not exist.')
    );
    await expect(deps.sendAnswer(false)).resolves.toBeUndefined();
    expect(log.debug).toHaveBeenCalledOnce();
    sendMessage.mockRejectedValueOnce(new Error('boom'));
    await deps.sendAnswer(false);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('requests through the API it was given', async () => {
    const deps = realConsentFlowDeps({ feature: 'rucss', next: null }, API, vi.fn(), logDouble());
    await deps.request({ data_collection: ['browsingActivity'] });
    expect(request).toHaveBeenCalledWith({ data_collection: ['browsingActivity'] });
  });

  it('closes its own tab, and rejects when it is not in one', async () => {
    const deps = realConsentFlowDeps({ feature: 'rucss', next: null }, API, vi.fn(), logDouble());
    vi.spyOn(fakeBrowser.tabs, 'getCurrent').mockResolvedValueOnce({ id: 5 } as never);
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValueOnce();
    await deps.closeTab();
    expect(remove).toHaveBeenCalledWith(5);
    vi.spyOn(fakeBrowser.tabs, 'getCurrent').mockResolvedValueOnce(undefined);
    await expect(deps.closeTab()).rejects.toThrow('not in a tab');
  });

  it('follows grant removals until unsubscribed', () => {
    const added: { listener?: (removed: object) => void } = {};
    vi.spyOn(fakeBrowser.permissions.onRemoved, 'addListener').mockImplementation((listener) => {
      added.listener = listener;
    });
    const removeListener = vi
      .spyOn(fakeBrowser.permissions.onRemoved, 'removeListener')
      .mockImplementation(() => undefined);
    const deps = realConsentFlowDeps({ feature: 'rucss', next: null }, API, vi.fn(), logDouble());
    const seen = vi.fn();
    const stop = deps.watchRemoved(seen);
    added.listener?.({ data_collection: ['browsingActivity'] });
    expect(seen).toHaveBeenCalledWith(['browsingActivity']);
    stop();
    expect(removeListener).toHaveBeenCalledWith(added.listener);
  });

  it('follows grants until unsubscribed', () => {
    const watched: { listener?: (added: object) => void } = {};
    vi.spyOn(fakeBrowser.permissions.onAdded, 'addListener').mockImplementation((listener) => {
      watched.listener = listener;
    });
    const removeListener = vi
      .spyOn(fakeBrowser.permissions.onAdded, 'removeListener')
      .mockImplementation(() => undefined);
    const deps = realConsentFlowDeps({ feature: 'rucss', next: null }, API, vi.fn(), logDouble());
    const seen = vi.fn();
    const stop = deps.watchAdded(seen);
    watched.listener?.({ data_collection: ['browsingActivity'], permissions: [] });
    expect(seen).toHaveBeenCalledWith(['browsingActivity']);
    stop();
    expect(removeListener).toHaveBeenCalledWith(watched.listener);
  });
});
