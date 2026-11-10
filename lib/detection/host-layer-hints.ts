/**
 * The Headers page's plain copy for every documented host-layer form (the
 * `host-layers` vocabulary's forms, keyed by header then form). Kept apart
 * from the vocabulary so surfaces that only need the verdict never ship it;
 * completeness against the vocabulary is pinned by the tests.
 *
 * Copy names the layer and the documented status, never a WP Rocket add-on.
 */

import { IDENTITY_FORM, type MarkerRead } from './host-layers';

/** Header → form → hint. */
export const HOST_LAYER_HINTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'sg-f-cache': {
    HIT: "SiteGround's file cache served this response (HIT).",
    MISS: "SiteGround's file cache did not serve this response (MISS).",
    BYPASS: "SiteGround's file cache was told to skip this response (BYPASS)."
  },
  'cf-cache-status': {
    HIT: "Cloudflare's edge cache served this response from its cache (HIT).",
    STALE: "Cloudflare's edge cache served an expired copy from its cache (STALE).",
    REVALIDATED:
      "Cloudflare's edge cache served its copy after the origin confirmed it was still valid (REVALIDATED).",
    UPDATING:
      "Cloudflare's edge cache served its copy while refreshing it from the origin (UPDATING).",
    MISS: "Cloudflare's edge cache did not serve this response (MISS).",
    EXPIRED:
      'Cloudflare found its cached copy expired and served this response from the origin (EXPIRED).',
    DYNAMIC: 'Cloudflare marks this response dynamic — it does not cache it here (DYNAMIC).',
    BYPASS: 'Cloudflare was told to skip its cache for this response (BYPASS).',
    NONE: 'Cloudflare did not serve this response from its cache (NONE).',
    UNKNOWN: 'Cloudflare did not serve this response from its cache (UNKNOWN).'
  },
  'cf-ray': {
    [IDENTITY_FORM]:
      "Cloudflare proxied this response (the value is Cloudflare's request id, not a cache status)."
  },
  'x-litespeed-cache': {
    HIT: 'The LiteSpeed cache served this response from cache (HIT).',
    MISS: 'The LiteSpeed cache did not serve this response (MISS).'
  },
  'x-sucuri-cache': {
    HIT: "Sucuri's firewall cache served this response (HIT).",
    STALE: "Sucuri's firewall cache served an older cached copy (STALE).",
    UPDATING: "Sucuri's firewall cache served an older copy while fetching a fresh one (UPDATING).",
    REVALIDATED:
      "Sucuri's firewall cache reused its copy after the server confirmed it was unchanged (REVALIDATED).",
    MISS: "Sucuri's firewall fetched this response from the server (MISS).",
    EXPIRED:
      "Sucuri's firewall found its copy too old and fetched a fresh one from the server (EXPIRED).",
    BYPASS: "Sucuri's firewall skipped its cache for this response (BYPASS)."
  },
  'x-sucuri-id': {
    [IDENTITY_FORM]:
      "Sucuri's firewall handled this response (the value is the firewall node's id, not a cache status)."
  },
  'x-varnish': {
    HIT: 'Varnish found this object in its cache (two request ids) — usually served from that copy, unless its rules passed the request on to the server.',
    MISS: 'Varnish did not serve this response from its cache (one request id: not a hit).'
  },
  'x-proxy-cache': {
    HIT: "The host's proxy cache served this response (HIT).",
    STALE: "The host's proxy cache served an expired copy (STALE).",
    UPDATING: "The host's proxy cache served its copy while refreshing it (UPDATING).",
    REVALIDATED:
      "The host's proxy cache served its copy after the server confirmed it was unchanged (REVALIDATED).",
    MISS: "The host's proxy cache did not serve this response (MISS).",
    EXPIRED:
      "The host's proxy cache found its copy expired and fetched this response from the server (EXPIRED).",
    BYPASS: "The host's proxy cache was told to skip this response (BYPASS)."
  }
};

/**
 * The hint for one read marker value.
 *
 * @param header The marker's lowercase header name.
 * @param read The marker's read of the value.
 * @returns The copy, or null for a form the copy table lacks (the tests keep it complete).
 */
export function hostLayerHint(header: string, read: MarkerRead): string | null {
  return HOST_LAYER_HINTS[header]?.[read.form] ?? null;
}
