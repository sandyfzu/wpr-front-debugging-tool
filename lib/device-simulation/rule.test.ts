/**
 * The rule derivation contract: injective, stable ids; the exact session
 * rule — tab-scoped document requests with an outright UA rewrite of the
 * profile's string; and the fail-fast refusal of broken tab ids.
 */
import { describe, expect, it } from 'vitest';
import { DEVICE_SIM_RULE_ID_BASE, deviceSimRule, deviceSimRuleId } from './rule';
import { DEVICE_SIMULATION_PROFILE } from './profiles';

describe('deviceSimRuleId', () => {
  it('is injective among tabs and stable across calls', () => {
    for (const tabId of [1, 2, 457, 50_000, 999_999]) {
      expect(deviceSimRuleId(tabId)).toBe(DEVICE_SIM_RULE_ID_BASE + tabId);
      expect(deviceSimRuleId(tabId)).toBe(deviceSimRuleId(tabId));
    }
  });

  it('throws on a broken tab id (a bug, not a life event)', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => deviceSimRuleId(bad)).toThrow(/positive integer/);
    }
  });
});

describe('deviceSimRule', () => {
  it('derives the exact session rule for the tab', () => {
    expect(deviceSimRule(42)).toEqual({
      id: DEVICE_SIM_RULE_ID_BASE + 42,
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
