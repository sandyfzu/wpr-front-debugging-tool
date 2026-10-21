import { describe, expect, it, vi } from 'vitest';
import { validSet } from '../../../lib/messaging/exclusion-session.fixtures';
import { createMessagingSessionPort, portOutcome, type SessionTransport } from './port';

/** A transport whose sends answer `answer` and whose pushes are fired by hand. */
function transport(answer: (row: string, data: unknown) => Promise<unknown>) {
  let handler: ((raw: unknown) => void) | null = null;
  const remove = vi.fn(() => {
    handler = null;
  });
  const send = vi.fn(answer);
  const fake: SessionTransport = {
    send,
    listen: (next) => {
      handler = next;
      return remove;
    }
  };
  return { fake, send, remove, push: (raw: unknown) => handler?.(raw) };
}

const log = { warn: vi.fn() };

describe('portOutcome', () => {
  it('passes answers through', () => {
    expect(portOutcome('x', { kind: 'reply', reply: 1 }, log)).toEqual({ kind: 'reply', reply: 1 });
  });

  it('names the dead extension context apart from other failures', () => {
    const dead = portOutcome(
      'x',
      { kind: 'failed', cause: new Error('Extension context invalidated.') },
      log
    );
    expect(dead).toEqual({ kind: 'problem', problem: 'context-invalidated' });
    const other = portOutcome('x', { kind: 'failed', cause: 'boom' }, log);
    expect(other).toEqual({ kind: 'problem', problem: 'failed' });
    expect(log.warn).toHaveBeenCalledWith('Session ask "x" failed', 'boom');
  });

  it('maps the expected misses one to one', () => {
    for (const kind of ['no-receiver', 'timeout', 'invalid-reply'] as const) {
      expect(portOutcome('x', { kind }, log)).toEqual({ kind: 'problem', problem: kind });
    }
  });
});

describe('createMessagingSessionPort', () => {
  it('asks each row with its payload and guards the answer', async () => {
    const t = transport((row) =>
      Promise.resolve(
        row === 'applyExclusionSession' ? { outcome: 'applying' } : { state: 'inactive' }
      )
    );
    const port = createMessagingSessionPort(t.fake, log);
    expect(await port.apply(validSet())).toEqual({ kind: 'reply', reply: { outcome: 'applying' } });
    expect(t.send).toHaveBeenCalledWith('applyExclusionSession', { set: validSet() });
    expect(await port.status()).toEqual({ kind: 'reply', reply: { state: 'inactive' } });
    expect(await port.stop()).toEqual({ kind: 'reply', reply: { state: 'inactive' } });
    expect(t.send).toHaveBeenCalledWith('stopExclusionSession', undefined);
  });

  it('turns a malformed answer into invalid-reply', async () => {
    const port = createMessagingSessionPort(transport(() => Promise.resolve({ set: 7 })).fake, log);
    expect(await port.savedSet()).toEqual({ kind: 'problem', problem: 'invalid-reply' });
  });

  it('answers a save with the guarded reply', async () => {
    const t = transport(() => Promise.resolve({ outcome: 'saved' }));
    const port = createMessagingSessionPort(t.fake, log);
    expect(await port.save(validSet())).toEqual({ kind: 'reply', reply: { outcome: 'saved' } });
    expect(t.send).toHaveBeenCalledWith('saveExclusionSet', { set: validSet() });
  });

  it('turns an absent background into no-receiver', async () => {
    const port = createMessagingSessionPort(
      transport(() =>
        Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'))
      ).fake,
      log
    );
    expect(await port.status()).toEqual({ kind: 'problem', problem: 'no-receiver' });
  });

  it('delivers only valid pushes and stops after unsubscribe', () => {
    const t = transport(() => Promise.resolve(null));
    const port = createMessagingSessionPort(t.fake, log);
    const listener = vi.fn();
    const off = port.onStatus(listener);
    t.push({ state: 'inactive' });
    t.push({ state: 'bogus' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('Dropped an invalid session status push');
    off();
    off();
    expect(t.remove).toHaveBeenCalledTimes(1);
    t.push({ state: 'inactive' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
