/**
 * The production ask: the top-frame stylesheet ask over the tab transport,
 * its answer guarded, every miss mapped to the page's unreachable outcome
 * (a real send failure logged), and the deps reading the shell's identity.
 */
import { describe, expect, it, vi } from 'vitest';
import type { TabAsks } from '../../../../lib/messaging/tab-asks';
import { makeFdtData } from '../../state/fixtures';
import { askPageStylesheets, realStylesheetsDeps } from './real-deps';

/** Tab asks answering the stylesheet ask with `answer`. */
function asksAnswering(answer: () => Promise<unknown>): TabAsks {
  return { listPageStylesheets: vi.fn(answer) } as unknown as TabAsks;
}

describe('askPageStylesheets', () => {
  it('asks the given tab and returns the guarded inventory', async () => {
    const asks = asksAnswering(() => Promise.resolve({ styles: [], total: 3 }));
    await expect(askPageStylesheets(asks, 7)).resolves.toEqual({
      kind: 'reply',
      reply: { styles: [], total: 3 }
    });
    expect(asks.listPageStylesheets).toHaveBeenCalledWith(7);
  });

  it('maps a malformed answer, no receiver, a failure and the deadline to misses', async () => {
    await expect(
      askPageStylesheets(
        asksAnswering(() => Promise.resolve({ styles: 'x', total: 0 })),
        1
      )
    ).resolves.toEqual({ kind: 'page-unreachable', miss: 'invalid-reply' });
    await expect(
      askPageStylesheets(
        asksAnswering(() =>
          Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'))
        ),
        1
      )
    ).resolves.toEqual({ kind: 'page-unreachable', miss: 'no-receiver' });
    await expect(
      askPageStylesheets(
        asksAnswering(() => Promise.reject(new Error('boom'))),
        1
      )
    ).resolves.toEqual({ kind: 'page-unreachable', miss: 'failed' });
    await expect(
      askPageStylesheets(
        asksAnswering(() => new Promise(() => undefined)),
        1,
        5
      )
    ).resolves.toEqual({ kind: 'page-unreachable', miss: 'timeout' });
  });
});

describe('realStylesheetsDeps', () => {
  it('reads the page identity and its settled flag off the shell state', () => {
    const ready = realStylesheetsDeps({
      state: () => ({ status: 'ready', data: makeFdtData({ scriptSnapshotId: 'p' }), fetchedAt: 0 })
    });
    expect(ready.pageId()).toBe('p');
    expect(ready.pageSettled()).toBe(true);
    const loading = realStylesheetsDeps({ state: () => ({ status: 'loading' }) as never });
    expect(loading.pageId()).toBeNull();
    expect(loading.pageSettled()).toBe(false);
  });
});
