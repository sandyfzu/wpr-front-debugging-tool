/**
 * Header rows through the redaction rule ({@link redactHeaderValue}): the
 * capture-time step the background runs before it stores or serves a row,
 * so no surface downstream ever holds a secret-bearing value. Re-running it
 * over its own output is a no-op for withheld rows (the flag is final), so
 * an export can run it again as defence in depth without double-processing.
 */

import type { PageHeader } from '../wp-rocket/types';
import { redactHeaderValue } from './rule';

/**
 * Redact one header row.
 *
 * @param row A row as captured or served: an ordinary `{ name, value? }`
 *   pair, or an already withheld row (kept withheld, never re-judged).
 * @returns A fresh row with only the contract's keys: an ordinary row with
 *   its value reduced by the rule, or a withheld `{ name, redacted: true,
 *   cookieName? }` row with no value at all.
 */
export function redactPageHeader(row: PageHeader): PageHeader {
  if (row.redacted === true) return withheld(row.name, row.cookieName ?? null);
  if (row.value === undefined) return { name: row.name };
  const reduced = redactHeaderValue(row.name, row.value);
  if (!reduced.redacted) return { name: row.name, value: reduced.value };
  return withheld(row.name, reduced.cookieName);
}

/**
 * A withheld row, rebuilt with only its own keys (a stray `value` beside the
 * flag never survives).
 *
 * @param name The header name.
 * @param cookieName The kept `Set-Cookie` cookie name, or null.
 * @returns The withheld row.
 */
function withheld(name: string, cookieName: string | null): PageHeader {
  return cookieName === null ? { name, redacted: true } : { name, redacted: true, cookieName };
}

/**
 * Redact a header list, row by row, order kept.
 *
 * @param rows The rows.
 * @returns A fresh list of redacted rows (see {@link redactPageHeader}).
 */
export function redactPageHeaders(rows: readonly PageHeader[]): PageHeader[] {
  return rows.map(redactPageHeader);
}
