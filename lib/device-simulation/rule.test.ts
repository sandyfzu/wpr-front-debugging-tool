/**
 * The rule derivation contract: injective, stable ids inside the
 * session-rule id space; the exact session rule — tab-scoped document
 * requests with an outright UA rewrite of the profile's string; the
 * fail-fast refusal of broken tab ids; and the family shape the sweep
 * reads as its identity.
 */
import { describe, expect, it } from 'vitest';
import {
  deviceSimRule,
  deviceSimRuleId,
  isDeviceSimRuleShape,
  type DeviceSimRuleLike
} from './rule';
import { DEVICE_SIMULATION_PROFILE } from './profiles';

/** The ceiling the session-rule id binding enforces (verified live: above it, `updateSessionRules` throws). */
const INT32_MAX = 2_147_483_647;

describe('deviceSimRuleId', () => {
  it('is injective among tabs and stable across calls', () => {
    for (const tabId of [1, 2, 457, 50_000, 999_999, 1_998_392_600]) {
      expect(deviceSimRuleId(tabId)).toBe(tabId);
      expect(deviceSimRuleId(tabId)).toBe(deviceSimRuleId(tabId));
    }
    expect(deviceSimRuleId(2)).not.toBe(deviceSimRuleId(3));
  });

  it('always encodes a value the session-rule id space accepts', () => {
    // The bug this pins: tab ids are int32 values that Chromium hands out
    // very large, so an id derived additively could pass the ceiling and
    // fail the rule add for exactly that tab's request. The bare tab id
    // stays inside by construction, up to the id ceiling itself.
    expect(deviceSimRuleId(INT32_MAX)).toBe(INT32_MAX);
    for (const tabId of [1, 999_999, 1_998_392_600, INT32_MAX]) {
      expect(deviceSimRuleId(tabId)).toBeLessThanOrEqual(INT32_MAX);
    }
  });

  it('throws on a broken tab id (a bug, not a life event)', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => deviceSimRuleId(bad)).toThrow(/positive integer/);
    }
  });

  it('throws above the session-rule id ceiling — the rejected-add failure the encoding exists to prevent', () => {
    // A caller handing a tab id outside the id space (impossible from a real
    // tab today) gets the fail-fast refusal instead of a rule the browser
    // would reject with a binding error.
    for (const bad of [INT32_MAX + 1, 4e9]) {
      expect(() => deviceSimRuleId(bad)).toThrow(/ceiling/);
    }
    expect(deviceSimRuleId(INT32_MAX)).toBe(INT32_MAX);
  });
});

describe('deviceSimRule', () => {
  it('derives the exact session rule for the tab', () => {
    expect(deviceSimRule(42)).toEqual({
      id: 42,
      priority: 1,
      condition: { tabIds: [42], resourceTypes: ['main_frame', 'sub_frame'] },
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'user-agent', operation: 'set', value: DEVICE_SIMULATION_PROFILE.userAgent }
        ]
      }
    });
  });

  it('is stable: repeated derivation produces equal rules', () => {
    expect(deviceSimRule(7)).toEqual(deviceSimRule(7));
  });

  it('scopes the rewrite to the tab on the exact id it would remove', () => {
    const rule = deviceSimRule(9);
    expect(rule.condition.tabIds).toEqual([9]);
    expect(rule.id).toBe(deviceSimRuleId(9));
  });

  it('throws on the same invalid tab ids the id derivation refuses', () => {
    for (const bad of [0, -3, 2.5, Number.NaN]) {
      expect(() => deviceSimRule(bad)).toThrow(/positive integer/);
    }
  });
});

describe('isDeviceSimRuleShape', () => {
  it('confirms exactly the rules the module derives, keyed to the id', () => {
    expect(isDeviceSimRuleShape(deviceSimRule(42))).toBe(true);
    expect(isDeviceSimRuleShape(deviceSimRule(1_998_392_600))).toBe(true);
  });

  it('refuses a foreign shape, whatever the id', () => {
    const ours = deviceSimRule(42);
    const deviations: DeviceSimRuleLike[] = [
      { ...ours, priority: 2 },
      { ...ours, condition: { tabIds: [43], resourceTypes: ['main_frame', 'sub_frame'] } },
      { ...ours, condition: { tabIds: [42], resourceTypes: ['main_frame'] } },
      { ...ours, action: { type: 'redirect', requestHeaders: [] } },
      {
        ...ours,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'user-agent', operation: 'set', value: 'other-ua' }]
        }
      }
    ];
    for (const rule of deviations) expect(isDeviceSimRuleShape(rule)).toBe(false);
  });

  it('refuses rules outside the id domain the derivation could ever produce', () => {
    const ours = deviceSimRule(42);
    const outside: DeviceSimRuleLike[] = [
      { ...ours, id: Number.NaN },
      { ...ours, id: 0 },
      { ...ours, id: -4 },
      { ...ours, id: '42' },
      { ...ours, id: 2_147_483_648 }
    ];
    for (const rule of outside) expect(isDeviceSimRuleShape(rule)).toBe(false);
  });

  it('refuses malformed header entries, not just different ones', () => {
    const ours = deviceSimRule(42);
    const malformed: DeviceSimRuleLike[] = [
      { ...ours, action: { type: 'modifyHeaders', requestHeaders: [null] } },
      { ...ours, action: { type: 'modifyHeaders', requestHeaders: 'ua' } },
      { ...ours, action: { type: 'modifyHeaders', requestHeaders: [] } }
    ];
    for (const rule of malformed) expect(isDeviceSimRuleShape(rule)).toBe(false);
  });
});
