/**
 * The session DNR rule that puts the simulated phone UA on a tab's document
 * requests, derived from the owning tab. Deriving here keeps the encoding
 * declared once — the background service stays a lifecycle wrapper
 * (add/remove/sweep) over these plain objects and invents nothing itself.
 */
import { DEVICE_SIMULATION_PROFILE } from './profiles';

/** The rule shape, structurally a `declarativeNetRequest` session `Rule`; the service hands it to `updateSessionRules` verbatim. */
export interface DeviceSimRule {
  id: number;
  priority: number;
  condition: {
    /** Session rules only (verified): scope the rewrite to the overlay's tab. */
    tabIds: number[];
    /**
     * Documents only, on purpose: mobile decisions happen on document
     * requests, so the open host page's own fetch/XHR keeps its real UA —
     * the debugging session stays honest while the pages compare mobile.
     */
    resourceTypes: Array<'main_frame' | 'sub_frame'>;
  };
  action: {
    type: 'modifyHeaders';
    /** `set` removes same-name headers — an outright UA rewrite, not an append. */
    requestHeaders: Array<{ header: 'user-agent'; operation: 'set'; value: string }>;
  };
}

/** Whether the stored rule is a derivation of this module — the sweep reads it as the family identity. */
export interface DeviceSimRuleLike {
  /**
   * `unknown` because the store returns browser-shaped values (every field
   * optional there): the predicate validates, never trusts.
   */
  id?: unknown;
  priority?: unknown;
  condition?: { tabIds?: unknown; resourceTypes?: unknown };
  action?: { type?: unknown; requestHeaders?: unknown };
}

/**
 * The session-rule id ceiling the DNR store enforces — 2^31 − 1. The store
 * rejects a value above it with a binding error (verified live: the
 * maximum accepted, +1 rejected with `Error in invocation of
 * updateSessionRules`), and tab ids come from the same int32 space, so a
 * derivation keyed by the tab id itself never needs an offset to collide
 * with that ceiling.
 */
export const DNR_RULE_ID_CEILING = 2_147_483_647;

/**
 * Whether the stored rule is exactly this module's own derivation for its
 * id — the sweep's family identity. Under `id == tabId` the family is not
 * an id band, so membership is the rule's shape: tab-scoped, document-only
 * requests rewritten to the module's user agent. A rule from a second
 * session-rule feature (none exists in this extension yet) never matches
 * and the sweep leaves it untouched.
 *
 * @param rule The stored rule as the read-back presented it (fields unknown — validated here).
 */
export function isDeviceSimRuleShape(rule: DeviceSimRuleLike): boolean {
  if (
    typeof rule.id !== 'number' ||
    !Number.isInteger(rule.id) ||
    rule.id < 1 ||
    rule.id > DNR_RULE_ID_CEILING ||
    rule.priority !== 1
  ) {
    return false;
  }
  const tabIds = rule.condition?.tabIds;
  if (!Array.isArray(tabIds) || tabIds.length !== 1 || tabIds[0] !== rule.id) {
    return false;
  }
  const resourceTypes = rule.condition?.resourceTypes;
  if (
    !Array.isArray(resourceTypes) ||
    resourceTypes.length !== 2 ||
    resourceTypes[0] !== 'main_frame' ||
    resourceTypes[1] !== 'sub_frame'
  ) {
    return false;
  }
  if (rule.action?.type !== 'modifyHeaders') return false;
  const headers: unknown = rule.action.requestHeaders;
  if (!Array.isArray(headers) || headers.length !== 1) return false;
  const header: unknown = headers[0];
  if (header === null || typeof header !== 'object') return false;
  const headerShape = header as { header?: unknown; operation?: unknown; value?: unknown };
  return (
    headerShape.header === 'user-agent' &&
    headerShape.operation === 'set' &&
    headerShape.value === DEVICE_SIMULATION_PROFILE.userAgent
  );
}

/**
 * The rule id for a tab — the tab id itself.
 *
 * Injective among live tabs and stable across calls, and always inside the
 * session-rule id space: tab ids come from the same int32 space as
 * {@link DNR_RULE_ID_CEILING}, while an additive offset on top of a tab id
 * could cross that ceiling and fail the rule add for exactly the request it
 * names (the reported toggle failure).
 *
 * @param tabId The owning tab's id.
 * @returns The owning tab's id.
 * @throws {@link Error} when `tabId` is not a positive integer within the
 *   session-rule id space — a broken caller, not a life event.
 */
export function deviceSimRuleId(tabId: number): number {
  assertValidTabId(tabId);
  return tabId;
}

/**
 * Derive the tab's simulation rule.
 *
 * @param tabId The owning tab's id.
 * @returns The rule to add for a sim-on session (remove by {@link deviceSimRuleId}).
 *   Whatever it derives, {@link isDeviceSimRuleShape} confirms as the family's own.
 * @throws {@link Error} on an invalid tab id.
 */
export function deviceSimRule(tabId: number): DeviceSimRule {
  return {
    id: deviceSimRuleId(tabId),
    // Uniqueness comes from the id (per-tab, injective among live tabs);
    // priority 1 leaves room for any later layered rule.
    priority: 1,
    condition: { tabIds: [tabId], resourceTypes: ['main_frame', 'sub_frame'] },
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'user-agent', operation: 'set', value: DEVICE_SIMULATION_PROFILE.userAgent }
      ]
    }
  };
}

/**
 * Refuse a broken tab id per the fail-fast rule: positive integers only,
 * and inside the session-rule id space the DNR store enforces — anything
 * else cannot encode a rule (a broken caller, not a life event).
 *
 * @param tabId The value to check.
 * @throws {@link Error} naming the offending value.
 */
function assertValidTabId(tabId: number): void {
  if (!Number.isInteger(tabId) || tabId < 1) {
    throw new Error(
      `Device-simulation rule needs a positive integer tab id, got: ${String(tabId)}`
    );
  }
  if (tabId > DNR_RULE_ID_CEILING) {
    throw new Error(
      `Device-simulation rule id ${String(tabId)} exceeds the session-rule id ceiling ${String(DNR_RULE_ID_CEILING)}`
    );
  }
}
