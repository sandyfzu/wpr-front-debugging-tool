/**
 * Which captured header values are secrets, and how a secret-bearing value
 * is redacted before it leaves the panel (into a copied report, a ticket,
 * a log). The ONE declaring site of the rule: anything that exports header
 * values runs them through {@link redactHeaderValue}.
 *
 * The rule is name-based and deliberately over-inclusive — redacting a
 * harmless value costs a support engineer one question, leaking a session
 * token costs the site owner their account:
 *
 * - **exact names** — the credential carriers of HTTP itself (`cookie`,
 *   `set-cookie`, `set-cookie2`, `authorization`, `proxy-authorization`) and
 *   the debug-profiler links that grant access to a request's internals
 *   (`x-debug-token`, `x-debug-token-link`);
 * - **name fragments** — any name containing `token`, `secret`, `session`,
 *   `auth`, `nonce`, `signature`, `api-key`/`api_key`/`apikey`, `csrf`,
 *   `xsrf`, `password`/`passwd` or `credential` (custom headers such as
 *   `X-Session-Id`, `X-Api-Key`, `X-Auth-User`, `X-WP-Nonce`).
 *
 * `Set-Cookie` alone keeps the cookie's NAME (which cookie the server set is
 * useful evidence for caching issues); its value and attributes never pass.
 */

/** Header names whose values are always secret (compared lowercase). */
const SENSITIVE_HEADER_NAMES: ReadonlySet<string> = new Set([
  'cookie',
  'set-cookie',
  'set-cookie2',
  'authorization',
  'proxy-authorization',
  'x-debug-token',
  'x-debug-token-link'
]);

/** Name fragments that mark a custom header as secret-bearing (case-insensitive). */
const SENSITIVE_NAME_FRAGMENT =
  /token|secret|session|auth|nonce|signature|api[-_]?key|csrf|xsrf|passw(?:or)?d|credential/i;

/** What a redacted value reads as. */
export const REDACTED = '(value redacted)';

/**
 * Whether a header's value must never leave the panel verbatim.
 *
 * @param name The header name, any casing.
 * @returns True for the exact credential names and any name carrying a fragment.
 */
export function isSensitiveHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return SENSITIVE_HEADER_NAMES.has(lower) || SENSITIVE_NAME_FRAGMENT.test(lower);
}

/**
 * The exportable form of one header value.
 *
 * @param name The header name, any casing.
 * @param value The captured value.
 * @returns `{ redacted: false, value }` for an ordinary header;
 *   `{ redacted: true, cookieName }` for a sensitive one, where `cookieName`
 *   is the `Set-Cookie` cookie's name when one is well-formed (the text
 *   before `=` within the first `;`-segment, trimmed, non-empty), else null —
 *   a nameless `Set-Cookie: SECRET` keeps nothing.
 */
export function redactHeaderValue(
  name: string,
  value: string
):
  | { readonly redacted: false; readonly value: string }
  | { readonly redacted: true; readonly cookieName: string | null } {
  if (!isSensitiveHeader(name)) return { redacted: false, value };
  if (name.trim().toLowerCase() !== 'set-cookie') return { redacted: true, cookieName: null };
  const firstSegment = value.split(';', 1)[0] ?? '';
  const equals = firstSegment.indexOf('=');
  const cookieName = equals === -1 ? '' : firstSegment.slice(0, equals).trim();
  return { redacted: true, cookieName: cookieName === '' ? null : cookieName };
}
