/**
 * The error-words wire contract: the acceptance caps of one
 * undefined-references batch plus the printability rule every word must
 * satisfy. Intentionally the leaf modules on both sides of the window bridge
 * depend on — the MAIN-world capture side is a ≤ 2 KB page-world bundle, so
 * this file stays free of everything else (no guard tables, no footprints):
 * the sender imports only these few bytes and both ends stay in lockstep
 * from one table.
 */

/**
 * Acceptance caps of one error-words batch, shared by the capture side (its
 * admission limits) and the receiving guard (its wholesale rejection
 * limits). Real pages sit orders of magnitude below; violation ⇒ the whole
 * batch is refused, never a silent partial cut.
 */
export const ERROR_WORD_LIMITS = { count: 50, chars: 200 } as const;

/**
 * Control characters that never belong in user-visible text: C0 (except
 * tab/newline/carriage-return), DEL, and the C1 range. Everything else,
 * including non-ASCII letters, passes.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/;

/**
 * Whether a string is renderable as text: no control characters beyond
 * tab/newline/carriage-return and no lone surrogates (unpaired halves are
 * replacement-garbage, not words). Used by the receiving guard and by the
 * MAIN-world capture side, whose admitted words must match — one malformed
 * word would otherwise reject the whole batch on arrival.
 */
export function isPrintable(value: string): boolean {
  if (CONTROL_CHARS.test(value)) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return false;
    // A paired surrogate iterates as one code point ≥ 0x10000; a lone one
    // keeps its 0xD800–0xDFFF value and is rejected.
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false;
  }
  return true;
}
