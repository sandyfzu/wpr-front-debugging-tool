/** The OS → keyboard-convention mapping and its never-rejecting resolver. */
import { describe, expect, it, vi } from 'vitest';
import { chordPlatformFromOs, resolveChordPlatform } from './palette-chord-platform';

describe('chordPlatformFromOs', () => {
  it('maps the platform-info OS: only mac uses Command', () => {
    expect(chordPlatformFromOs('mac')).toBe('mac');
    for (const os of ['win', 'linux', 'cros', 'android', 'openbsd', 'fuchsia', '', 'MAC']) {
      expect(chordPlatformFromOs(os)).toBe('other');
    }
  });
});

describe('resolveChordPlatform', () => {
  it('maps the reported OS without warning', async () => {
    const log = { warn: vi.fn() };
    expect(
      await resolveChordPlatform({ getPlatformInfo: () => Promise.resolve({ os: 'mac' }), log })
    ).toBe('mac');
    expect(
      await resolveChordPlatform({ getPlatformInfo: () => Promise.resolve({ os: 'win' }), log })
    ).toBe('other');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('logs and resolves other when platform info rejects', async () => {
    const log = { warn: vi.fn() };
    const cause = new Error('gone');
    expect(await resolveChordPlatform({ getPlatformInfo: () => Promise.reject(cause), log })).toBe(
      'other'
    );
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Platform info'), cause);
  });
});

describe('resolveChordPlatform with a fallback', () => {
  it('resolves the fallback when platform info rejects, and names it', async () => {
    const log = { warn: vi.fn() };
    const cause = new Error('gone');
    expect(
      await resolveChordPlatform({
        getPlatformInfo: () => Promise.reject(cause),
        fallback: () => 'mac',
        log
      })
    ).toBe('mac');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Command convention'), cause);
  });

  it('never asks the fallback when platform info answers', async () => {
    const fallback = vi.fn(() => 'mac' as const);
    expect(
      await resolveChordPlatform({
        getPlatformInfo: () => Promise.resolve({ os: 'win' }),
        fallback,
        log: { warn: vi.fn() }
      })
    ).toBe('other');
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe('resolveChordPlatform with a throwing fallback', () => {
  it('still resolves other (never rejects) and logs both failures', async () => {
    const log = { warn: vi.fn() };
    expect(
      await resolveChordPlatform({
        getPlatformInfo: () => Promise.reject(new Error('gone')),
        fallback: () => {
          throw new Error('no navigator');
        },
        log
      })
    ).toBe('other');
    expect(log.warn).toHaveBeenCalledTimes(2);
  });
});
