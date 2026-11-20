import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../../../lib/logger';

const { onMessage, sendMessage } = vi.hoisted(() => ({
  onMessage: vi.fn(),
  sendMessage: vi.fn()
}));
vi.mock('../../../../lib/messaging', () => ({ onMessage, sendMessage }));

const { askRucssConsent, realRucssConsentGate, rucssConsentAnswer, watchRucssConsentAnswers } =
  await import('./data-consent');

/** A logger double. */
function logDouble() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

describe('askRucssConsent', () => {
  it('maps the background answer: granted and asking pass, failed reads ask-failed', async () => {
    for (const [status, gate] of [
      ['granted', 'granted'],
      ['asking', 'asking'],
      ['failed', 'ask-failed'],
      ['missing', 'ask-failed']
    ] as const) {
      const ask = vi.fn(() => Promise.resolve({ status }));
      await expect(askRucssConsent(4, { ask, log: logDouble() })).resolves.toBe(gate);
      expect(ask).toHaveBeenCalledWith(4);
    }
  });

  it('reads ask-failed (logged) on a junk answer, no receiver or a rejected send', async () => {
    const junk = logDouble();
    await expect(
      askRucssConsent(1, { ask: () => Promise.resolve({ status: 'yes' }), log: junk })
    ).resolves.toBe('ask-failed');
    const rejected = logDouble();
    await expect(
      askRucssConsent(1, { ask: () => Promise.reject(new Error('boom')), log: rejected })
    ).resolves.toBe('ask-failed');
    expect(rejected.warn).toHaveBeenCalledWith('RUCSS data-consent ask failed', 'boom');
    await expect(
      askRucssConsent(1, {
        ask: () =>
          Promise.reject(
            new Error('Could not establish connection. Receiving end does not exist.')
          ),
        log: logDouble()
      })
    ).resolves.toBe('ask-failed');
  });
});

describe('rucssConsentAnswer', () => {
  it("acts only on this tool's own answers (another tool's grant restarts nothing)", () => {
    expect(rucssConsentAnswer({ feature: 'rucss', granted: true })).toBe(true);
    expect(rucssConsentAnswer({ feature: 'pagespeed', granted: true })).toBeNull();
    expect(rucssConsentAnswer({ feature: 'rucss', granted: false })).toBe(false);
    expect(rucssConsentAnswer({ feature: 'pagespeed', granted: false })).toBeNull();
    expect(rucssConsentAnswer({ granted: true })).toBeNull();
  });
});

describe('the production wiring', () => {
  it('asks the background for the named tab', async () => {
    sendMessage.mockResolvedValueOnce({ status: 'asking' });
    await expect(realRucssConsentGate(9, logDouble())()).resolves.toBe('asking');
    expect(sendMessage).toHaveBeenCalledWith('askDataConsent', { feature: 'rucss', tabId: 9 });
  });

  it('follows the answers, acknowledging each push; a throwing consumer is logged', () => {
    const stop = vi.fn();
    onMessage.mockReturnValueOnce(stop);
    const onAnswer = vi.fn();
    const log = logDouble();
    expect(watchRucssConsentAnswers(onAnswer, log)).toBe(stop);
    const listener = onMessage.mock.calls[0]?.[1] as (message: { data: unknown }) => true;
    expect(listener({ data: { feature: 'rucss', granted: true } })).toBe(true);
    expect(listener({ data: { feature: 'pagespeed', granted: false } })).toBe(true);
    expect(listener({ data: 'junk' })).toBe(true);
    expect(onAnswer.mock.calls).toEqual([[true]]);
    onAnswer.mockImplementationOnce(() => {
      throw new Error('bad');
    });
    expect(listener({ data: { feature: 'rucss', granted: false } })).toBe(true);
    expect(log.error).toHaveBeenCalledOnce();
  });
});
