/**
 * A header row as every panel surface (the Headers & Cookies page, the
 * Detections preview) shows and copies it, through the shared redaction
 * rule (`lib/redaction/rule`).
 */

import type { HeaderRowVM } from './headers-view-model';
import { REDACTED, redactHeaderValue } from '../redaction/rule';

/** A header row as a panel surface shows and copies it. */
export interface ShownHeader extends HeaderRowVM {
  /** True when the captured value was withheld (see {@link shownHeader}). */
  readonly redacted: boolean;
}

/**
 * A header row of the shared headers model as every panel surface may show
 * and copy it. A secret-bearing header keeps its name and loses its whole
 * value — attributes and hint included (a hint can echo the value); a
 * `Set-Cookie` keeps only a well-formed cookie name, which is caching
 * evidence. Other headers keep their value as the rule's
 * `reduceHeaderValue` leaves it. Valueless rows pass untouched.
 *
 * @param header A row of the shared headers model.
 * @returns The row to render and copy, flagged when its value was withheld.
 */
export function shownHeader(header: HeaderRowVM): ShownHeader {
  if (header.value === null) return { ...header, redacted: false };
  const exported = redactHeaderValue(header.name, header.value);
  if (!exported.redacted) return { ...header, value: exported.value, redacted: false };
  return {
    name: header.name,
    value: exported.cookieName === null ? REDACTED : `${exported.cookieName}=${REDACTED}`,
    hint: null,
    redacted: true
  };
}
