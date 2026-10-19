/**
 * A header row as every panel surface (the Headers & Cookies page, the
 * Detections preview) shows and copies it.
 *
 * The background already redacts at capture, so rows normally arrive
 * withheld (`redacted`) or reduced; this step turns a withheld row into its
 * marker text. It also re-applies the shared rule to any unflagged row —
 * defence in depth for a payload that bypassed the capture (one produced
 * before capture-time redaction existed, a test fixture, a future producer):
 * the rule is cheap, and on an already reduced value it changes nothing.
 */

import type { HeaderRowVM } from './headers-view-model';
import { REDACTED, redactHeaderValue } from '../redaction/rule';

/** A header row whose `value` is display text (a withheld value reads as its marker). */
export type ShownHeader = HeaderRowVM;

/**
 * The marker text of a withheld value.
 *
 * @param cookieName The kept `Set-Cookie` cookie name, or null.
 * @returns `name=(value redacted)` or `(value redacted)`.
 */
function withheldText(cookieName: string | null): string {
  return cookieName === null ? REDACTED : `${cookieName}=${REDACTED}`;
}

/**
 * The shown form of one row of the shared headers model. A withheld row
 * keeps its name and reads as the marker (a `Set-Cookie` with its cookie
 * name), hint dropped (a hint can echo the value). Other rows keep their
 * value as the rule leaves it. Valueless rows pass untouched.
 *
 * @param header A row of the shared headers model.
 * @returns The row to render and copy, flagged when its value was withheld.
 */
export function shownHeader(header: HeaderRowVM): ShownHeader {
  if (header.redacted) {
    return {
      name: header.name,
      value: withheldText(header.cookieName ?? null),
      hint: null,
      redacted: true,
      // Carried so re-passing a shown row is idempotent: the second pass
      // reads the same cookie name and rebuilds the same marker text.
      ...(header.cookieName === undefined ? {} : { cookieName: header.cookieName })
    };
  }
  if (header.value === null) return header;
  const exported = redactHeaderValue(header.name, header.value);
  if (!exported.redacted) return { ...header, value: exported.value };
  return {
    name: header.name,
    value: withheldText(exported.cookieName),
    hint: null,
    redacted: true
  };
}
