/**
 * Device-simulation state across the messaging boundaries: what a caller
 * learns (the ask's answer, the live push) and what it may command (the set
 * payload). The shapes are tiny but they cross a boundary, so hostile
 * payloads reject to `null` under the shared validators' rules — exact key
 * sets, fresh own-key rebuilds, no inherited-key leakage.
 */
import { isRecord } from '../../utils/is-record';

/** What the background answers and pushes: whether simulation exists here, and its current state. */
export interface DeviceSimState {
  /** The browser can simulate at all (Chromium session DNR present). */
  available: boolean;
  /** The tab's document requests currently carry the simulated UA. */
  enabled: boolean;
}

/**
 * Parse the ask's answer or the push payload.
 *
 * @param input The untrusted payload.
 * @returns The state, or null on any shape violation (extra or missing keys,
 *   non-boolean values). Exact keys: future fields ride protocol rows, never
 *   silently through this guard.
 */
export function parseDeviceSimState(input: unknown): DeviceSimState | null {
  if (!isRecord(input) || Object.keys(input).length !== 2) return null;
  const available = input['available'];
  const enabled = input['enabled'];
  if (typeof available !== 'boolean' || typeof enabled !== 'boolean') return null;
  return { available, enabled };
}

/** What a `setDeviceSimulation` command may carry: exactly one boolean. */
export interface DeviceSimUpdate {
  /** The simulation's target state for the sender's tab. */
  enabled: boolean;
}

/**
 * Parse a `setDeviceSimulation` payload.
 *
 * @param input The untrusted payload.
 * @returns The update, or null on any shape violation.
 */
export function parseDeviceSimUpdate(input: unknown): DeviceSimUpdate | null {
  if (!isRecord(input) || Object.keys(input).length !== 1) return null;
  const enabled = input['enabled'];
  if (typeof enabled !== 'boolean') return null;
  return { enabled };
}
