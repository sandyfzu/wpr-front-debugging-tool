/** The OS → keyboard-convention mapping. */
import { describe, expect, it } from 'vitest';
import { chordPlatformFromOs } from './palette-chord-platform';

describe('chordPlatformFromOs', () => {
  it('maps the platform-info OS: only mac uses Command', () => {
    expect(chordPlatformFromOs('mac')).toBe('mac');
    for (const os of ['win', 'linux', 'cros', 'android', 'openbsd', 'fuchsia', '', 'MAC']) {
      expect(chordPlatformFromOs(os)).toBe('other');
    }
  });
});
