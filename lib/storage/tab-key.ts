/**
 * The canonical map key of a tab id in per-tab `session:` maps — one
 * declaring site for every store keyed by tab.
 */
import { numericTabId } from '../messaging/sender';

/** A canonical decimal tab key: no sign, exponent, fraction or leading zero. */
const CANONICAL_TAB_KEY = /^(?:0|[1-9]\d*)$/;

/**
 * The canonical map key of a tab id, or null for anything not tab shaped.
 *
 * @param key A stored key (decimal string) or a numeric tab id.
 */
export function tabKey(key: string | number): string | null {
  if (typeof key === 'string' && !CANONICAL_TAB_KEY.test(key)) return null;
  const tabId = numericTabId(typeof key === 'number' ? key : Number(key));
  return tabId === null ? null : String(tabId);
}
