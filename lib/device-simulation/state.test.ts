/**
 * The boundary guards: the ask's answer / push shape and the set-payload
 * shape accept exactly their declared keys with boolean values, and every
 * hostile variant — wrong types, missing or extra keys, inherited-key
 * pollution — rejects to null.
 */
import { describe, expect, it } from 'vitest';
import { parseDeviceSimState, parseDeviceSimUpdate } from './state';

describe('parseDeviceSimState', () => {
  it('accepts the exact two-boolean shape, rebuilt fresh', () => {
    expect(parseDeviceSimState({ available: true, enabled: false })).toEqual({
      available: true,
      enabled: false
    });
  });

  it('rejects every hostile variant', () => {
    const hostile: unknown[] = [
      null,
      undefined,
      'enabled',
      42,
      [],
      ['available'],
      {},
      { available: true },
      { enabled: true },
      { available: 1, enabled: true },
      { available: true, enabled: 'true' },
      { available: true, enabled: true, extra: true },
      Object.create({ available: true, enabled: true }) // inherited-only keys: not own state
    ];
    for (const payload of hostile) {
      expect(parseDeviceSimState(payload)).toBeNull();
    }
  });
});

describe('parseDeviceSimUpdate', () => {
  it('accepts the exact single-boolean shape', () => {
    expect(parseDeviceSimUpdate({ enabled: true })).toEqual({ enabled: true });
    expect(parseDeviceSimUpdate({ enabled: false })).toEqual({ enabled: false });
  });

  it('rejects every hostile variant', () => {
    const hostile: unknown[] = [
      null,
      undefined,
      'true',
      0,
      [],
      [true],
      {},
      { enabled: 'true' },
      { enabled: true, forced: false },
      Object.create({ enabled: true })
    ];
    for (const payload of hostile) {
      expect(parseDeviceSimUpdate(payload)).toBeNull();
    }
  });
});
