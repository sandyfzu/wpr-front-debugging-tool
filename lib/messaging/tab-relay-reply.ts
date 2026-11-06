/**
 * The tab relay's reply contract (`relayTabAsk`, background → the asking
 * page): the content script's untrusted answer, or why there is none. Kept
 * apart from the request registry (`./tab-relay`) so the asking side — the
 * panel's relay client — imports no ask's request parser: those belong to
 * the background and to each tool's own (possibly lazily loaded) code.
 */
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';

/**
 * Why a relay produced no answer:
 * - `refused` — the sender may not name a tab (not our tab-less extension page),
 * - `invalid-request` — the request broke the contract,
 * - `no-receiver` — nothing in the tab answered (content script not injected
 *   yet, navigating, a page outside the host permissions, or the tab closed),
 * - `failed` — anything else (logged by the background).
 */
export const TAB_RELAY_FAILURES = ['refused', 'invalid-request', 'no-receiver', 'failed'] as const;

/** One relay failure (see {@link TAB_RELAY_FAILURES}). */
export type TabRelayFailure = (typeof TAB_RELAY_FAILURES)[number];

/** The relay's answer: the content script's untrusted answer, or why there is none. */
export type TabRelayReply =
  | { readonly ok: true; readonly answer: unknown }
  | { readonly ok: false; readonly failure: TabRelayFailure };

/**
 * Validate an untrusted relay reply (exact keys; the answer itself stays
 * untrusted for the asking caller's own validator).
 *
 * @param input The received reply.
 * @returns The reply, or null on any violation.
 */
export function parseTabRelayReply(input: unknown): TabRelayReply | null {
  if (!isRecord(input)) return null;
  const ok = ownValue(input, 'ok');
  if (ok === true && hasOnlyKeys(input, ['ok', 'answer'])) {
    return { ok, answer: ownValue(input, 'answer') };
  }
  const failure = ownValue(input, 'failure');
  if (ok !== false || !hasOnlyKeys(input, ['ok', 'failure'])) return null;
  const known = TAB_RELAY_FAILURES.find((name) => name === failure);
  return known === undefined ? null : { ok, failure: known };
}
