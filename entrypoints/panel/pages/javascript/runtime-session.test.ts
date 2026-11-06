/**
 * The Runtime states session: a show reads when nothing is shown or the
 * shown read is stale, never while a read is pending nor over a current
 * answer; "Read again" always re-reads; a throwing read shows as a failed
 * page ask.
 */
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../../../lib/logger';
import type { LiveScriptsOutcome } from '../../../../lib/script-runtime/read-live';
import { ASK_THREW } from '../ask-run';
import { createRuntimeStatesSession } from './runtime-session';

/** A silent logger. */
function logDouble(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const READ: LiveScriptsOutcome = { kind: 'read', scripts: [], total: 0, truncated: false };

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

describe('createRuntimeStatesSession', () => {
  it('reads on the first show only, once while pending', async () => {
    await createRoot(async (dispose) => {
      const read = vi.fn(() => Promise.resolve(READ));
      const session = createRuntimeStatesSession({ read, pageId: () => 'p1', log: logDouble() });
      session.ensure();
      session.ensure(); // pending: not read twice
      await settle();
      expect(session.read.state().shown?.outcome).toBe(READ);
      session.ensure(); // a current answer: not read again
      expect(read).toHaveBeenCalledTimes(1);
      await session.read.start(); // Read again
      expect(read).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('re-reads on show once the page reloaded since the shown read', async () => {
    await createRoot(async (dispose) => {
      const [page, setPage] = createSignal<string | null>('p1');
      const read = vi.fn(() => Promise.resolve(READ));
      const session = createRuntimeStatesSession({ read, pageId: page, log: logDouble() });
      session.ensure();
      await settle();
      setPage('p2');
      expect(session.read.stale()).toBe(true);
      session.ensure();
      await settle();
      expect(read).toHaveBeenCalledTimes(2);
      expect(session.read.stale()).toBe(false);
      dispose();
    });
  });

  it('shows a thrown read as a failed page ask and records nothing once disposed', async () => {
    await createRoot(async (dispose) => {
      const read = vi.fn<() => Promise<LiveScriptsOutcome>>(() =>
        Promise.reject(new Error('gone'))
      );
      const session = createRuntimeStatesSession({ read, pageId: () => null, log: logDouble() });
      await session.read.start();
      expect(session.read.state().shown?.outcome).toEqual(ASK_THREW);
      session.dispose();
      read.mockResolvedValueOnce(READ);
      await session.read.start();
      expect(session.read.state().shown?.outcome).toEqual(ASK_THREW);
      dispose();
    });
  });
});
