/**
 * The inspected-tab ask: runs over the found transport and tab, and answers
 * "not listening" without asking when either is missing.
 */
import { describe, expect, it, vi } from 'vitest';
import type { TabAsks } from '../../../lib/messaging/tab-asks';
import { askInspectedTab, PAGE_NOT_LISTENING, type InspectedTabSource } from './inspected-tab';

/** A transport double (only its identity matters here). */
const ASKS = {} as TabAsks;

describe('askInspectedTab', () => {
  it('runs the ask over the transport for the inspected tab', async () => {
    const ask = vi.fn<(asks: TabAsks, tabId: number) => Promise<string>>(() =>
      Promise.resolve('answer')
    );
    await expect(askInspectedTab(ask, { asks: () => ASKS, tabId: () => 7 })).resolves.toBe(
      'answer'
    );
    expect(ask).toHaveBeenCalledWith(ASKS, 7);
  });

  it.each<[string, InspectedTabSource]>([
    ['no transport', { asks: () => null, tabId: () => 7 }],
    ['no inspected tab', { asks: () => ASKS, tabId: () => null }]
  ])('answers "not listening" without asking with %s', async (_name, source) => {
    const ask = vi.fn(() => Promise.resolve('answer'));
    await expect(askInspectedTab(ask, source)).resolves.toBe(PAGE_NOT_LISTENING);
    expect(ask).not.toHaveBeenCalled();
  });

  it('reads the source per ask (the inspected tab may change)', async () => {
    let tabId = 1;
    const ask = vi.fn((_asks: TabAsks, id: number) => Promise.resolve(id));
    const source = { asks: () => ASKS, tabId: () => tabId };
    await askInspectedTab(ask, source);
    tabId = 2;
    await askInspectedTab(ask, source);
    expect(ask.mock.calls.map((call) => call[1])).toEqual([1, 2]);
  });
});
