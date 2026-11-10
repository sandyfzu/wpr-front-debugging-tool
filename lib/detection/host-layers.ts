/**
 * The host-layer header vocabulary: the hosting caches, CDNs and firewalls a
 * response's headers can name, one table read by every surface — the page
 * cache verdict (`cache-context`), the Headers page's caching group and
 * hints (`headers-view-model`, its copy keyed by this table's forms in
 * `host-layer-hints`) and the Detections page's Host layers card. A header
 * joins only with a vendor-documented meaning for the forms it reads; every
 * other value of it is unreadable (no hint, no verdict). The copy lives
 * apart so the content script, which needs only the verdict, never ships it.
 *
 * A host layer is the host's own machinery, never proof of a WP Rocket
 * add-on: `cf-cache-status` shows Cloudflare is in front of the site, not
 * that WP Rocket's Cloudflare add-on is enabled (likewise Sucuri, Varnish).
 */

import type { PageHeaders } from '../wp-rocket/types';

/** The layers this vocabulary names. */
export type HostLayerId =
  'cloudflare' | 'sucuri' | 'varnish' | 'host-proxy' | 'litespeed' | 'siteground';

/**
 * What one marker row says: its layer served the response from cache, did
 * not, or (identity markers, withheld or unreadable values) only that the
 * layer handled the response.
 */
export type MarkerReading = 'served' | 'not-served' | 'present';

/**
 * A readable marker value: its reading and its documented form (the status
 * key the Headers page's hint copy is keyed by).
 */
export interface MarkerRead {
  readonly reading: MarkerReading;
  readonly form: string;
}

/** One header a layer is identified by. */
export interface HostLayerMarker {
  /** Lowercase header name. */
  readonly header: string;
  /** The documented forms this marker reads, each with its reading. */
  readonly forms: Readonly<Record<string, MarkerReading>>;
  /**
   * Read a trimmed value; null when the value is not a documented form (the
   * row still shows its layer, with no hint).
   */
  readonly read: (value: string) => MarkerRead | null;
  /** Whether some form reads `served` (a cache-status marker, not an identity one). */
  readonly cacheStatus: boolean;
}

/** One host layer and the headers that name it. */
export interface HostLayer {
  readonly id: HostLayerId;
  /** The card/report label. */
  readonly label: string;
  /** The name the cache verdict copy uses mid-sentence ("A {evidence} cache-layer marker"). */
  readonly evidence: string;
  /** Status marker first, identity markers after (the card's reading order). */
  readonly markers: readonly HostLayerMarker[];
}

/**
 * A marker over a form table: `toForm` maps a trimmed value onto its form
 * key, and only a key of the table reads.
 *
 * @param header The lowercase header name.
 * @param forms Form key → its reading.
 * @param toForm The value → form-key mapping.
 */
function marker(
  header: string,
  forms: Readonly<Record<string, MarkerReading>>,
  toForm: (value: string) => string
): HostLayerMarker {
  const table = new Map(Object.entries(forms));
  return {
    header,
    forms,
    cacheStatus: [...table.values()].includes('served'),
    read: (value) => {
      const form = toForm(value);
      const reading = table.get(form);
      return reading === undefined ? null : { reading, form };
    }
  };
}

/**
 * A cache-status marker whose value is the status itself (case-folded).
 *
 * @param header The lowercase header name.
 * @param statuses Uppercase status → its reading.
 */
function statusMarker(
  header: string,
  statuses: Readonly<Record<string, MarkerReading>>
): HostLayerMarker {
  return marker(header, statuses, (value) => value.toUpperCase());
}

/** The one form of an identity marker (its value is an id, never a status). */
export const IDENTITY_FORM = 'ID';

/**
 * An identity marker: its presence names the layer, whatever its value.
 *
 * @param header The lowercase header name.
 */
function identityMarker(header: string): HostLayerMarker {
  return marker(header, { [IDENTITY_FORM]: 'present' }, () => IDENTITY_FORM);
}

/**
 * Varnish's hit form: the current request id plus the id that stored the
 * object. Varnish also prints it when its rules pass a found object on to
 * the backend (a pass from `vcl_hit`), so it proves a cache lookup hit, not
 * a serve — the verdict built on it is hedged ("Possibly cached").
 */
const VARNISH_HIT = /^\d+ \d+$/;

/** Varnish's non-hit form: the current request id alone. */
const VARNISH_MISS = /^\d+$/;

/**
 * The vocabulary, in verdict precedence: when several layers report a serve,
 * the first named here is the one the cache verdict names. The order runs
 * outermost hop first, because an outer cache's stored copy carries the
 * headers the inner layers stamped when it was filled — a Cloudflare HIT
 * replays the origin's `sg-f-cache: HIT` too, yet only Cloudflare served it:
 * the CDNs (Cloudflare, then Sucuri's firewall, which a site may still put
 * behind Cloudflare), then the host's reverse proxies in front of the web
 * server (Varnish, the generic proxy cache), then the web server's own cache
 * (LiteSpeed), then the PHP-level file cache (SiteGround's optimizer).
 * Sources (vendor docs or vendor code) for every form are recorded with the
 * table's tests.
 */
export const HOST_LAYERS: readonly HostLayer[] = [
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    evidence: 'Cloudflare',
    markers: [
      statusMarker('cf-cache-status', {
        HIT: 'served',
        STALE: 'served',
        REVALIDATED: 'served',
        UPDATING: 'served',
        MISS: 'not-served',
        // Found in cache but expired: the response itself came from the origin.
        EXPIRED: 'not-served',
        DYNAMIC: 'not-served',
        BYPASS: 'not-served',
        NONE: 'not-served',
        UNKNOWN: 'not-served'
      }),
      identityMarker('cf-ray')
    ]
  },
  {
    id: 'sucuri',
    label: 'Sucuri',
    evidence: 'Sucuri',
    markers: [
      statusMarker('x-sucuri-cache', {
        HIT: 'served',
        STALE: 'served',
        UPDATING: 'served',
        REVALIDATED: 'served',
        MISS: 'not-served',
        EXPIRED: 'not-served',
        BYPASS: 'not-served'
      }),
      identityMarker('x-sucuri-id')
    ]
  },
  {
    id: 'varnish',
    label: 'Varnish',
    evidence: 'Varnish',
    markers: [
      marker('x-varnish', { HIT: 'served', MISS: 'not-served' }, (value) =>
        VARNISH_HIT.test(value) ? 'HIT' : VARNISH_MISS.test(value) ? 'MISS' : ''
      )
    ]
  },
  {
    // A header many hosts' proxies send (SiteGround's dynamic cache among
    // them): it names no vendor, so it is never labeled as one. Its value is
    // conventionally nginx's `$upstream_cache_status`, so it reads that
    // variable's full documented set.
    id: 'host-proxy',
    label: 'Host proxy cache',
    evidence: 'host proxy',
    markers: [
      statusMarker('x-proxy-cache', {
        HIT: 'served',
        // Served from the stored copy: stale (use-stale rules), stale while
        // the copy refreshes, or after the upstream confirmed it unchanged.
        STALE: 'served',
        UPDATING: 'served',
        REVALIDATED: 'served',
        MISS: 'not-served',
        // The stored copy had expired: the request went to the upstream.
        EXPIRED: 'not-served',
        BYPASS: 'not-served'
      })
    ]
  },
  {
    id: 'litespeed',
    label: 'LiteSpeed',
    evidence: 'LiteSpeed',
    // The first comma token decides: `hit,litemage` is a LiteMage hit.
    markers: [
      marker('x-litespeed-cache', { HIT: 'served', MISS: 'not-served' }, (value) =>
        value
          .replace(/,[\s\S]*$/, '')
          .trim()
          .toUpperCase()
      )
    ]
  },
  {
    id: 'siteground',
    label: 'SiteGround',
    evidence: 'SiteGround',
    // SiteGround's own optimizer plugin writes these for its file cache.
    markers: [
      statusMarker('sg-f-cache', { HIT: 'served', MISS: 'not-served', BYPASS: 'not-served' })
    ]
  }
];

/** A marker with its owning layer (the lookup's unit). */
export interface LayerMarkerEntry {
  readonly layer: HostLayer;
  readonly marker: HostLayerMarker;
}

/** Every marker by lowercase header name (names are unique across the table). */
const MARKERS_BY_HEADER: ReadonlyMap<string, LayerMarkerEntry> = new Map(
  HOST_LAYERS.flatMap((layer) =>
    layer.markers.map((marker) => [marker.header, { layer, marker }] as const)
  )
);

/**
 * The marker a header name is, if any.
 *
 * @param name The captured header name (any casing).
 */
export function hostLayerMarker(name: string): LayerMarkerEntry | undefined {
  return MARKERS_BY_HEADER.get(name.toLowerCase());
}

/**
 * The last captured row per marker header (later duplicates are the last
 * hop, matching the capture's header-intake rule).
 */
function lastMarkerRows(headers: PageHeaders): Map<string, PageHeaders[number]> {
  const rows = new Map<string, PageHeaders[number]>();
  for (const row of headers) {
    const nameLower = row.name.toLowerCase();
    if (MARKERS_BY_HEADER.has(nameLower)) rows.set(nameLower, row);
  }
  return rows;
}

/**
 * One marker row's reading: withheld or unreadable values only show the layer.
 *
 * @param marker The marker.
 * @param row The captured row.
 */
function rowReading(marker: HostLayerMarker, row: PageHeaders[number]): MarkerReading {
  if (row.redacted === true) return 'present';
  return marker.read((row.value ?? '').trim())?.reading ?? 'present';
}

/** What the cache-status markers say about who served the response. */
export type ServedLayerScan =
  | { readonly kind: 'served'; readonly layer: HostLayer }
  | { readonly kind: 'withheld' }
  | { readonly kind: 'none' };

/**
 * The first layer (table order) whose cache-status marker says it served
 * the response. A withheld status row is remembered but does not stop the
 * scan: another layer's served marker still wins. Identity markers never
 * count — a layer handling the response is not a cache serve.
 *
 * @param headers The captured response headers.
 * @returns The served layer, a withheld status marker, or neither.
 */
export function scanServedLayer(headers: PageHeaders): ServedLayerScan {
  const rows = lastMarkerRows(headers);
  let withheld = false;
  for (const layer of HOST_LAYERS) {
    for (const marker of layer.markers) {
      if (!marker.cacheStatus) continue;
      const row = rows.get(marker.header);
      if (row === undefined) continue;
      if (row.redacted === true) withheld = true;
      else if (marker.read((row.value ?? '').trim())?.reading === 'served') {
        return { kind: 'served', layer };
      }
    }
  }
  return withheld ? { kind: 'withheld' } : { kind: 'none' };
}

/** One layer the capture shows: its strongest reading and the headers that named it. */
export interface CapturedHostLayer {
  readonly id: HostLayerId;
  readonly label: string;
  readonly reading: MarkerReading;
  /** The captured header names (captured casing), in the layer's marker order. */
  readonly headers: readonly string[];
}

/** Reading strength: a cache-status statement outranks plain presence. */
const READING_RANK: Readonly<Record<MarkerReading, number>> = {
  present: 0,
  'not-served': 1,
  served: 2
};

/**
 * Every layer the capture names, in table order; absent layers are left out
 * (an empty list means no card, never a negative). A layer's reading is its
 * strongest marker's: served, then not served, then present.
 *
 * @param headers The captured response headers, or null when none were.
 */
export function capturedHostLayers(headers: PageHeaders | null): CapturedHostLayer[] {
  if (headers === null) return [];
  const rows = lastMarkerRows(headers);
  const layers: CapturedHostLayer[] = [];
  for (const layer of HOST_LAYERS) {
    let reading: MarkerReading | null = null;
    const names: string[] = [];
    for (const marker of layer.markers) {
      const row = rows.get(marker.header);
      if (row === undefined) continue;
      names.push(row.name);
      const current = rowReading(marker, row);
      if (reading === null || READING_RANK[current] > READING_RANK[reading]) reading = current;
    }
    if (reading !== null)
      layers.push({ id: layer.id, label: layer.label, reading, headers: names });
  }
  return layers;
}

/**
 * A captured layer's short state, for the card and the report. Worded as a
 * hit, never as a serve: Varnish's hit form also stands on a hit its rules
 * passed on to the server.
 */
export const HOST_LAYER_READING_TEXT: Readonly<Record<MarkerReading, string>> = {
  served: 'cache hit',
  'not-served': 'no cache hit',
  present: 'present'
};

/**
 * Why a host layer is not an add-on statement — the card tooltip's and the
 * report's shared caveat.
 */
export const HOST_LAYER_ADD_ON_CAVEAT =
  "A host layer is the host's own service: these headers do not show whether WP Rocket's Cloudflare, Sucuri or Varnish add-on is enabled.";
