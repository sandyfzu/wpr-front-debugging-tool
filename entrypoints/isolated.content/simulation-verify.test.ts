import { describe, expect, it, vi } from 'vitest';
import type { ScheduleTimer } from '../../lib/messaging/bounded-ask';
import { EXCLUSION_SESSION_DEADLINES_MS } from '../../lib/messaging/exclusion-session';
import { createSimulationMarkerVerifier, UNVERIFIED_MARKERS } from './simulation-verify';

const ID = '0123456789abcdef0123456789abcdef';

/** A verifier over `send`, with spied logs and an invalidation flag. */
function rig(send: (markerId: string) => Promise<unknown>, schedule?: ScheduleTimer) {
  const log = { debug: vi.fn(), warn: vi.fn() };
  let invalid = false;
  const verify = createSimulationMarkerVerifier({
    send,
    isInvalid: () => invalid,
    log,
    ...(schedule === undefined ? {} : { schedule })
  });
  return {
    verify,
    log,
    invalidate: () => {
      invalid = true;
    }
  };
}

describe('createSimulationMarkerVerifier', () => {
  it('asks with the id and answers the features the background vouches for', async () => {
    const send = vi.fn(() => Promise.resolve({ features: ['delay_js'] }));
    const { verify, log } = rig(send);
    await expect(verify(ID)).resolves.toEqual(['delay_js']);
    expect(send).toHaveBeenCalledWith(ID);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('answers nothing for an unverified id', async () => {
    await expect(rig(() => Promise.resolve({ features: [] })).verify(ID)).resolves.toEqual([]);
  });

  it('answers nothing (debug) when nothing listens', async () => {
    const { verify, log } = rig(() =>
      Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'))
    );
    await expect(verify(ID)).resolves.toEqual([]);
    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('answers nothing (debug) past the deadline', async () => {
    const delays: number[] = [];
    const schedule: ScheduleTimer = (run, ms) => {
      delays.push(ms);
      run();
      return () => undefined;
    };
    const send = vi.fn(() => new Promise<unknown>(() => undefined));
    const { verify, log } = rig(send, schedule);
    await expect(verify(ID)).resolves.toEqual([]);
    expect(delays).toEqual([EXCLUSION_SESSION_DEADLINES_MS.verifyMarker]);
    expect(log.debug).toHaveBeenCalledTimes(1);
  });

  it('answers nothing (warned) for a malformed answer or a refusal', async () => {
    for (const send of [
      () => Promise.resolve({ features: ['lazyload'] }),
      () => Promise.resolve(true),
      () => Promise.reject(new Error('verifySimulationMarker: only a top-frame page may ask'))
    ]) {
      const { verify, log } = rig(send);
      await expect(verify(ID)).resolves.toEqual([]);
      expect(log.warn).toHaveBeenCalledTimes(1);
    }
  });

  it('stays quiet once the extension context is gone', async () => {
    const { verify, log, invalidate } = rig(() =>
      Promise.reject(new Error('Extension context invalidated.'))
    );
    invalidate();
    await expect(verify(ID)).resolves.toEqual([]);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.debug).not.toHaveBeenCalled();
  });

  it('the extension-free verifier vouches for nothing', async () => {
    await expect(UNVERIFIED_MARKERS(ID)).resolves.toEqual([]);
  });
});
