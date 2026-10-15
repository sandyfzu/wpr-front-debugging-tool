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
 *   pair, or an already withheld row (returned as is).
 * @returns The row the contract admits: an ordinary row with its value
 *   reduced by the rule, or a withheld `{ name, redacted: true,
 *   cookieName? }` row with no value at all.
 */
export function redactPageHeader(row: PageHeader): PageHeader {
  if (row.redacted === true) return row;
  if (row.value === undefined) return { name: row.name };
  const reduced = redactHeaderValue(row.name, row.value);
  if (!reduced.redacted) return { name: row.name, value: reduced.value };
  return reduced.cookieName === null
    ? { name: row.name, redacted: true }
    : { name: row.name, redacted: true, cookieName: reduced.cookieName };
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
