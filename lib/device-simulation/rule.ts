/**
 * The session DNR rule that puts the simulated phone UA on a tab's document
 * requests, derived from the owning tab. Deriving here keeps the encoding
 * declared once — the background service stays a lifecycle wrapper
 * (add/remove/sweep) over these plain objects and invents nothing itself.
 */
import { DEVICE_SIMULATION_PROFILE } from './profiles';

/**
 * Session rule ids start far above any tab id the extension will meet:
 * `id = base + tabId` is injective among live tabs, and one base makes the
 * sweep's "rules of this family" listing a single comparison.
 */
export const DEVICE_SIM_RULE_ID_BASE = 1_000_000_000;

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

/**
 * The rule id for a tab — stable across calls, injective among live tabs.
 *
 * @param tabId The owning tab's id.
 * @throws {@link Error} when `tabId` is not a positive integer — a broken
 *   caller, not a life event.
 */
export function deviceSimRuleId(tabId: number): number {
  assertValidTabId(tabId);
  return DEVICE_SIM_RULE_ID_BASE + tabId;
}

/**
 * Derive the tab's simulation rule.
 *
 * @param tabId The owning tab's id.
 * @returns The rule to add for a sim-on session (remove by {@link deviceSimRuleId}).
 * @throws {@link Error} on an invalid tab id.
 */
export function deviceSimRule(tabId: number): DeviceSimRule {
  return {
    id: deviceSimRuleId(tabId),
    // The extension's only DNR rule family: uniqueness comes from the id,
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
 * Refuse a broken tab id per the fail-fast rule: Chrome tab ids are positive
 * integers — anything else cannot come from a real sender.
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
}
