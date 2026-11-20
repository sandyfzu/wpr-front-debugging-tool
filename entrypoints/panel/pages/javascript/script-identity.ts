/**
 * Row identity for the JavaScript page: rows are keyed by the script itself,
 * never by document position, so a script added or removed above leaves
 * every other row's key — its DOM, its selection — untouched.
 */
import type { JsScriptResource } from '../../../../lib/panel/resources-view-model';
import { reconcileList } from '../../../../lib/panel/list-behavior';
import { NO_SCRIPT_SIMULATION, type ScriptSimulation } from '../../../../lib/panel/script-states';
import { sameScript, scriptRowView, type ContentCapture, type ScriptRowView } from './script-view';

/** How much of an inline script's head and tail its signature hashes. */
const SIGNATURE_EDGE_CHARS = 512;

/**
 * 32-bit FNV-1a over a string's UTF-16 units.
 *
 * @param text The text to hash.
 * @param seed The offset basis (a second seed gives an independent hash).
 */
export function fnv1a(text: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * A script's signature, without its occurrence: external scripts by URL;
 * inline scripts by length plus hashes of their head and tail (constant work
 * per script however large; two different scripts sharing all three are
 * told apart at reconciliation, which compares the full text).
 *
 * @param row The classified script.
 */
export function scriptSignature(row: JsScriptResource): string {
  if (row.type === 'external') return `e|${row.content}`;
  const text = row.content;
  const head = fnv1a(text.slice(0, SIGNATURE_EDGE_CHARS)).toString(36);
  const tail = fnv1a(text.slice(-SIGNATURE_EDGE_CHARS)).toString(36);
  return `i|${String(text.length)}|${head}|${tail}`;
}

/**
 * Every row's key: its signature plus its occurrence among rows sharing the
 * signature (the same script included twice keeps two distinct keys).
 *
 * @param rows The classified scripts, in document order.
 * @returns One unique key per row.
 */
export function scriptKeys(rows: readonly JsScriptResource[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const signature = scriptSignature(row);
    const occurrence = seen.get(signature) ?? 0;
    seen.set(signature, occurrence + 1);
    return `${signature}#${String(occurrence)}`;
  });
}

/**
 * Build the row views for a fresh row list, reusing every previous view whose
 * key, script data and capture state are unchanged (whatever its position).
 * A soft refresh of an unchanged page hands the list the very same objects —
 * no re-mount, no re-highlight — and only changed rows are re-derived.
 *
 * @param previous The views of the previous pass (`[]` on the first).
 * @param rows The fresh classified rows, in document order.
 * @param captures Each row's capture state, by position (missing: complete).
 * @param simulation The features a verified simulation ran on the page (the
 *   caller passes `[]` as `previous` when they change: every chip re-derives).
 * @returns The new views (`previous` itself when nothing changed).
 */
export function reconcileRowViews(
  previous: readonly ScriptRowView[],
  rows: readonly JsScriptResource[],
  captures: readonly ContentCapture[] = [],
  simulation: ScriptSimulation = NO_SCRIPT_SIMULATION
): readonly ScriptRowView[] {
  const keys = scriptKeys(rows);
  /**
   * Resolve the parallel key array without falling back to document-position identity.
   * @param index The classified row's position.
   * @returns Its signature-and-occurrence key.
   * @throws {@link Error} When the parallel key array is inconsistent.
   */
  const keyAt = (index: number): string => {
    const key = keys[index];
    if (key === undefined) throw new Error(`Missing script identity at row ${String(index)}.`);
    return key;
  };
  return reconcileList(
    previous,
    rows,
    (view) => view.key,
    (_row, index) => keyAt(index),
    (prior, row, index) =>
      prior.capture === (captures[index] ?? 'complete') && sameScript(prior.row, row),
    (row, index) => scriptRowView(row, keyAt(index), captures[index] ?? 'complete', simulation)
  );
}
