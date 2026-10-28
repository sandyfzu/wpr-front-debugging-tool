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
