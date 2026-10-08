/**
 * Parse the WP Rocket diagnoser report embedded in a page.
 *
 * When the diagnoser plugin issued, it prints two JSON `<script>` elements
 * (no-rocket environment and per-option data). Both may be malformed (a
 * report printed by a faulting run), so text goes through a JSON repair
 * step before parsing — loaded lazily, the repairer is the heaviest part
 * of this module and pages without a diagnoser print never pay for it.
 */

import type { DiagnoserDocData } from '../wp-rocket/types';
import { DIAGNOSER_NO_ROCKET_DATA_ID, DIAGNOSER_ROCKET_DATA_ID } from '../wp-rocket/constants';
import { createLogger } from '../logger';

const log = createLogger('diagnostics');

/**
 * Extract and parse both diagnoser payloads from a parsed page.
 *
 * Malformed or wrong-shaped element contents resolve to `null` — the panel
 * renders an explicit "report unreadable" state rather than guessing. A
 * parse failure is logged (message-level context only; element text is page
 * content and never logged).
 *
 * @param document The parsed page document.
 * @returns The two reports (each null when the element is missing or its
 *   content unreliable), as one record ready for fixtures/messaging.
 */
export async function extractDiagnoserData(document: Document): Promise<DiagnoserDocData> {
  const noRocketData = await parseSlot(document.getElementById(DIAGNOSER_NO_ROCKET_DATA_ID));
  const rocketData = await parseSlot(document.getElementById(DIAGNOSER_ROCKET_DATA_ID));
  return { noRocketData, rocketData };
}

/**
 * Parse one diagnoser element's text.
 *
 * @returns The parsed JSON (validated structurally), or null.
 */
async function parseSlot(element: Element | null): Promise<Record<string, unknown> | null> {
  if (element === null) return null;
  const text = element.textContent;
  if (typeof text !== 'string' || text.trim() === '') return null;
  try {
    const { jsonrepair } = await import('jsonrepair');
    const repaired = jsonrepair(text);
    const parsed = JSON.parse(repaired) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch (error) {
    log.error(
      `Diagnoser element #${element.id} did not contain parsable JSON`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
