/** The chord-platform channel: OS mapping, failure degrade, and its registration. */
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger';

const { onMessage } = vi.hoisted(() => ({ onMessage: vi.fn() }));
vi.mock('../../lib/messaging', () => ({ onMessage }));

const { answerChordPlatform, registerChordPlatform } = await import('./chord-platform');

/** A logger double (no console noise; calls assertable). */
function logDouble() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

describe('answerChordPlatform', () => {
  it('answers mac for macOS and other for every other OS', async () => {
    for (const [os, expected] of [
      ['mac', 'mac'],
      ['win', 'other'],
      ['linux', 'other'],
      ['cros', 'other']
    ] as const) {
      const log = logDouble();
      expect(
        await answerChordPlatform({ getPlatformInfo: () => Promise.resolve({ os }), log })
      ).toBe(expected);
      expect(log.warn).not.toHaveBeenCalled();
    }
  });

  it('logs and answers other when platform info rejects', async () => {
    const log = logDouble();
    const cause = new Error('gone');
    expect(await answerChordPlatform({ getPlatformInfo: () => Promise.reject(cause), log })).toBe(
      'other'
    );
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Platform info'), cause);
  });
});

describe('registerChordPlatform', () => {
  it('registers the getChordPlatform channel answering from runtime platform info', async () => {
    const getPlatformInfo = vi
      .spyOn(browser.runtime, 'getPlatformInfo')
      // The callback overload confuses the mock's inferred return type.
      .mockResolvedValue({ os: 'mac', arch: 'arm' } as never);
    registerChordPlatform();
    expect(onMessage).toHaveBeenCalledWith('getChordPlatform', expect.any(Function));
    const handler = onMessage.mock.calls[0]?.[1] as () => Promise<string>;
    expect(await handler()).toBe('mac');
    expect(getPlatformInfo).toHaveBeenCalledOnce();
  });
});
