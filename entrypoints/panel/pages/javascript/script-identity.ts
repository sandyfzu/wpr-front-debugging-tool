/**
 * Row identity for the JavaScript page: rows are keyed by the script itself,
 * never by document position, so a script added or removed above leaves
 * every other row's key — its DOM, its expanded flag — untouched.
 */
import type { JsScriptResource } from '../../../../lib/panel/resources-view-model';
import {
  inlineCode,
  sameScript,
  scriptStateBadges,
  type ContentCapture,
  type ScriptRowView
} from './script-view';

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
 * A DOM-id-safe token for a key (`aria-controls` targets): two independent
 * 32-bit hashes, so ids collide only by chance across ~2^64.
 *
 * @param key The row key.
 */
export function domIdOf(key: string): string {
  return `fdt-js-code-${fnv1a(key).toString(36)}${fnv1a(key, 0x01000193).toString(36)}`;
}

/**
 * Build one row view.
 *
 * @param row The classified script.
 * @param key The row's key.
 * @param capture How much inline text was captured.
 */
export function buildRowView(
  row: JsScriptResource,
  key: string,
  capture: ContentCapture = 'complete'
): ScriptRowView {
  return {
    key,
    domId: domIdOf(key),
    row,
    capture,
    badges: scriptStateBadges(row),
    code: row.type === 'inline' ? inlineCode(row.content) : null
  };
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
 * @returns The new views (`previous` itself when nothing changed).
 */
export function reconcileRowViews(
  previous: readonly ScriptRowView[],
  rows: readonly JsScriptResource[],
  captures: readonly ContentCapture[] = []
): readonly ScriptRowView[] {
  const byKey = new Map(previous.map((view) => [view.key, view]));
  const keys = scriptKeys(rows);
  let changed = previous.length !== rows.length;
  const next = rows.map((row, index) => {
    const key = keys[index] ?? String(index);
    const capture = captures[index] ?? 'complete';
    const prior = byKey.get(key);
    const view =
      prior !== undefined && prior.capture === capture && sameScript(prior.row, row)
        ? prior
        : buildRowView(row, key, capture);
    if (view !== previous[index]) changed = true;
    return view;
  });
  return changed ? next : previous;
}
