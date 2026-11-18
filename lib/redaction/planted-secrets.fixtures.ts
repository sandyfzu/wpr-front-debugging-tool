/**
 * A raw header capture with a secret planted in every sensitive class the
 * rule covers, beside rows that must survive intact. Every planted secret
 * contains {@link PLANTED} and nothing else does, so "no secret survived" is
 * one substring check over any serialized output.
 */
import type { PageHeader } from '../wp-rocket/types';

/** The marker every planted secret carries (and no kept text does). */
export const PLANTED = 'PLANTED';

/** Raw response headers as `webRequest` hands them, secrets planted. */
export const PLANTED_RAW_HEADERS: readonly PageHeader[] = [
  { name: 'Cache-Control', value: 'public, max-age=600' },
  { name: 'X-Cache', value: 'HIT' },
  { name: 'Surrogate-Key', value: 'post-1 term-2' },
  { name: 'X-Cache-Key', value: 'https://example.com/page/' },
  { name: 'Set-Cookie', value: 'wordpress_logged_in_ab=PLANTED_SESSION|1; path=/; HttpOnly' },
  // Firefox folds several cookies into one value, joined by line breaks.
  { name: 'set-cookie', value: 'wp_first=PLANTED_FOLD_A; Path=/\nwp_second=PLANTED_FOLD_B' },
  { name: 'Set-Cookie', value: 'PLANTED_NAMELESS\nwp_late=PLANTED_FOLD_C' },
  { name: 'Authorization', value: 'Bearer PLANTED_BEARER' },
  { name: 'Proxy-Authorization', value: 'Basic PLANTED_BASIC==' },
  { name: 'X-WP-Nonce', value: 'PLANTED_WP_NONCE' },
  { name: 'X-Api-Key', value: 'PLANTED_API_KEY' },
  { name: 'X-Debug-Token-Link', value: 'https://example.com/_profiler/PLANTED_PROFILER' },
  {
    name: 'Location',
    value: 'https://example.com/next?_wpnonce=PLANTED_LOC_NONCE&ok=1#access_token=PLANTED_FRAG'
  },
  {
    name: 'Content-Location',
    value: 'https://user:PLANTED_PASS@example.com/a;jsessionid=PLANTED_JS'
  },
  { name: 'Refresh', value: '0; url=https://example.com/?token=PLANTED_REFRESH' },
  { name: 'Link', value: '<https://example.com/f.css?sig=PLANTED_LINK_SIG>; rel=preload' },
  { name: 'WWW-Authenticate', value: 'Digest realm="site", nonce="PLANTED_DIGEST"' },
  { name: 'X-Binary' }
];

/**
 * Inline script bodies carrying nonces and keys in every shape a text scrub
 * misses — call arguments, nested objects, JSON inside strings, template
 * literals, arrays, PHP-style `=>`, concatenation: an export must withhold
 * the bodies whole.
 */
export const PLANTED_INLINE_BODIES: readonly string[] = [
  'wp.apiFetch.nonceMiddleware = wp.apiFetch.createNonceMiddleware( "PLANTED_CORE_NONCE" );',
  'var elementorFrontendConfig = {"nonces":{"floatingButtonsClickTracking":"PLANTED_ELEMENTOR"}};',
  'var s = JSON.parse(\'{\\"nonce\\":\\"PLANTED_JSON_IN_STRING\\"}\');',
  'const k = { nonce: `PLANTED_TEMPLATE` };',
  'var c = {"nonce":["PLANTED_ARRAY"]};',
  "$cfg = array( 'nonce' => 'PLANTED_PHP_ARROW' );",
  'var o = {"nonce":"a"+"PLANTED_CONCAT"};',
  "var wcSettings = JSON.parse( decodeURIComponent( '%7B%22storeApiNonce%22%3A%22PLANTED_ENCODED%22%7D' ) );",
  'var cfg = {"root":"https:\\/\\/a.example\\/wp-json\\/","nonce":"PLANTED_LOCALIZED"};'
];

/**
 * Options-like objects keyed in camelCase and the other spellings
 * the name rule must read word by word.
 */
export const PLANTED_OPTIONS: Readonly<Record<string, unknown>> = {
  accessKey: 'PLANTED_ACCESS_KEY',
  licenseKey: 'PLANTED_LICENSE_KEY',
  userEmail: 'PLANTED_USER_EMAIL',
  adminEmail: 'PLANTED_ADMIN_EMAIL',
  userLogin: 'PLANTED_USER_LOGIN',
  userPass: 'PLANTED_USER_PASS',
  APIKey: 'PLANTED_API_KEY_CAPS',
  LOGGED_IN_SALT: 'PLANTED_SALT',
  code_verifier: 'PLANTED_PKCE',
  nested: { cloudflareApiKey: 'PLANTED_CF', secret_cache_key: 'PLANTED_CACHE_SECRET' },
  // Visible evidence: never redacted.
  minify_css_key: '5f1a2b3c4d5e6',
  cdn_state: 'enabled'
};
