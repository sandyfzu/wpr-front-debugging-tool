/** The platform reads: the client-hints-first name and the macOS check. */
import { describe, expect, it } from 'vitest';
import { isMacPlatform, platformName } from './platform';

describe('platformName', () => {
  it('prefers the client-hints platform over the deprecated one', () => {
    expect(platformName({ platform: 'MacIntel', userAgentData: { platform: 'Windows' } })).toBe(
      'Windows'
    );
  });

  it('falls back to the deprecated platform when the hint is missing or empty', () => {
    expect(platformName({ platform: 'Win32' })).toBe('Win32');
    expect(platformName({ platform: 'Win32', userAgentData: {} })).toBe('Win32');
    expect(platformName({ platform: 'Win32', userAgentData: { platform: '' } })).toBe('Win32');
  });

  it('is empty when neither source says anything', () => {
    expect(platformName({})).toBe('');
  });
});

describe('isMacPlatform', () => {
  it('recognizes macOS from either source', () => {
    expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isMacPlatform({ platform: 'Win32', userAgentData: { platform: 'macOS' } })).toBe(true);
  });

  it('is false for other platforms (iPhone included) and for missing facts', () => {
    expect(isMacPlatform({ platform: 'iPhone' })).toBe(false);
    expect(isMacPlatform({ platform: 'Win32' })).toBe(false);
    expect(isMacPlatform({ platform: 'Linux x86_64' })).toBe(false);
    expect(isMacPlatform({ platform: 'MacIntel', userAgentData: { platform: 'Linux' } })).toBe(
      false
    );
    expect(isMacPlatform({})).toBe(false);
  });
});
