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
