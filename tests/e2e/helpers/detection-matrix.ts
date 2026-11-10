/**
 * The detection site matrix's round list — the single declaring site of every
 * scripted round's settings combination, URL and expected output (the
 * runbook's round table names these ids; the values live only here).
 *
 * Expectations are the declared precedence restated as literals, never read
 * back from the engine: the generator meta is authoritative whenever its
 * `data-wpr-features` attribute is issued (a missing token refutes the row,
 * whatever markup the page carries); only a tag-absent page falls back to
 * footprints; a row nothing decided reads `Unknown` only where its footprint
 * cannot prove absence (Add missing image dimensions, Self-host Google Fonts).
 * Card wording is the panel's own (`Active`/`Not active`/`Unknown` + the
 * `Meta`/`Footprint` source chip).
 */

import { FEATURE_META_TOKENS } from '../../../lib/wp-rocket/constants';

/** A WP Rocket settings combination, as overrides on the bootstrap baseline. */
export interface SettingsCombo {
  readonly id: ComboId;
  /** What the combination exercises. */
  readonly why: string;
  /** Option keys written over the seeded settings (missing keys are inserted). */
  readonly overrides: Readonly<Record<string, 0 | 1>>;
}

/** The combination ids. */
export type ComboId = 'baseline' | 'media-preload' | 'all-off';

/**
 * The option values the bootstrap forces every boot (the baseline's 1s plus a
 * 0 for every other key a combination turns on) — the snapshot a suite
 * restores must carry them, or the site has drifted (a crashed earlier run)
 * and restoring it would bake the drift in. Mirrors bootstrap.sh's forced-pair
 * loop; `docker/scripts/fdt-fixture-matrix-contract.test.ts` pins the two equal
 * and every {@link SETTINGS_COMBOS} key covered.
 */
export const BOOTSTRAP_FORCED: Readonly<Record<string, 0 | 1>> = {
  cache_mobile: 1,
  do_caching_mobile_files: 1,
  lazyload: 1,
  defer_all_js: 1,
  delay_js: 1,
  minify_css: 1,
  minify_js: 1,
  remove_unused_css: 1,
  lazyload_iframes: 0,
  lazyload_css_bg_img: 0,
  image_dimensions: 0,
  preload_links: 0,
  host_fonts_locally: 0
};

/** The three scripted combinations (wp-cli writes; config regenerated + purged). */
export const SETTINGS_COMBOS: readonly SettingsCombo[] = [
  {
    id: 'baseline',
    why: 'the seeded site: Delay/Defer/Minify JS/LazyLoad images declared',
    overrides: {}
  },
  {
    id: 'media-preload',
    why: 'JS optimizations off; iframes, CSS backgrounds, image dimensions, Preload Links, self-hosted fonts on',
    overrides: {
      delay_js: 0,
      defer_all_js: 0,
      minify_js: 0,
      minify_css: 0,
      lazyload_iframes: 1,
      lazyload_css_bg_img: 1,
      image_dimensions: 1,
      preload_links: 1,
      host_fonts_locally: 1
    }
  },
  {
    id: 'all-off',
    why: 'every page optimization off: the meta declares only the device copy',
    overrides: { delay_js: 0, defer_all_js: 0, minify_js: 0, minify_css: 0, lazyload: 0 }
  }
];

/** A card's expected reading: its status word plus the source chip, when one. */
export type RowExpectation =
  'Active (Meta)' | 'Not active (Meta)' | 'Active (Footprint)' | 'Not active' | 'Unknown';

/** The feature rows a round pins exactly (the beacon family is pinned by invariant). */
export type MatrixRow =
  | 'remove_unused_css'
  | 'async_css'
  | 'delay_js'
  | 'defer_all_js'
  | 'minify_css'
  | 'minify_js'
  | 'minify_concatenate_js'
  | 'lazyload'
  | 'lazyload_iframes'
  | 'lazyload_css_bg_img'
  | 'image_dimensions'
  | 'self_hosted_fonts'
  | 'preload_links'
  | 'rocket_cdn';

/** One round's full row expectation. */
export type RowTable = Readonly<Record<MatrixRow, RowExpectation>>;

/** What the round's cache surfaces must say. */
export interface CacheExpectation {
  /** The strip chip / panel summary chip text (`✓ Cached` carries a stamp after it). */
  readonly chip: string;
  /** The support report's `Page cache:` line (prefix for the stamped form). */
  readonly report: string;
  /** The hosting layer the report/summary must name, or null for no layer line. */
  readonly layer: string | null;
  /** A host header the Headers page must list exactly, when the edge sent one. */
  readonly header?: readonly [name: string, value: string];
}

/** How the round's page is visited. */
export type Visit =
  /** A warm-up fetch first, so the browser receives the stored cached copy. */
  | 'cached'
  /** A fresh cache key (unique nonce), so the browser receives the live render. */
  | 'live'
  /**
   * A never-stored URL (`fdt-no-store=1`): opened after a probe proves a
   * repeat request still answers a live, stamp-free render.
   */
  | 'uncached';

/** What the generator meta looks like on the round's page. */
export type MetaShape = 'versioned' | 'versionless' | 'absent';

/** One scripted round. */
export interface MatrixRound {
  readonly id: string;
  readonly combo: ComboId;
  /** Site path + query (fixture flags), without the live nonce. */
  readonly path: string;
  readonly visit: Visit;
  readonly meta: MetaShape;
  readonly cache: CacheExpectation;
  readonly rows: RowTable;
  /** What the round proves (the runbook's one-line summary). */
  readonly proves: string;
}

/** The cached-copy cache answer (no host layer). */
const CACHED: CacheExpectation = { chip: '✓ Cached', report: 'Cached, generated ', layer: null };

/** Baseline meta (`wpr_delay_js wpr_defer_js wpr_minify_js wpr_lazyload_images wpr_desktop`). */
const BASELINE_META_ROWS: RowTable = {
  remove_unused_css: 'Not active (Meta)',
  async_css: 'Not active (Meta)',
  delay_js: 'Active (Meta)',
  defer_all_js: 'Active (Meta)',
  minify_css: 'Not active (Meta)',
  // Declared although /fdt/ carries no minified script: the plugin appends its
  // minify comment after the candidate loop (the recorded declared-without-
  // applied minify exception) — the meta still decides.
  minify_js: 'Active (Meta)',
  minify_concatenate_js: 'Not active (Meta)',
  lazyload: 'Active (Meta)',
  lazyload_iframes: 'Not active (Meta)',
  lazyload_css_bg_img: 'Not active (Meta)',
  image_dimensions: 'Not active (Meta)',
  self_hosted_fonts: 'Not active (Meta)',
  preload_links: 'Not active (Meta)',
  rocket_cdn: 'Not active (Meta)'
};

/** The baseline render with its meta suppressed: footprints alone decide. */
const BASELINE_FOOTPRINT_ROWS: RowTable = {
  remove_unused_css: 'Not active',
  async_css: 'Not active',
  delay_js: 'Active (Footprint)',
  defer_all_js: 'Active (Footprint)',
  minify_css: 'Not active',
  minify_js: 'Not active',
  minify_concatenate_js: 'Unknown',
  lazyload: 'Active (Footprint)',
  lazyload_iframes: 'Not active',
  lazyload_css_bg_img: 'Not active',
  image_dimensions: 'Unknown',
  self_hosted_fonts: 'Unknown',
  preload_links: 'Not active',
  rocket_cdn: 'Not active'
};

/** The bypassed render (`nowprocket`): no meta; Delay skips, Defer/Minify/LazyLoad stay. */
const BYPASS_ROWS: RowTable = {
  ...BASELINE_FOOTPRINT_ROWS,
  delay_js: 'Not active',
  // `?fdt-delay=1` adds the three fixture scripts, which the bypass still minifies.
  minify_js: 'Active (Footprint)'
};

/** Every row refuted by a device-only meta. */
const ALL_REFUTED_ROWS: RowTable = {
  remove_unused_css: 'Not active (Meta)',
  async_css: 'Not active (Meta)',
  delay_js: 'Not active (Meta)',
  defer_all_js: 'Not active (Meta)',
  minify_css: 'Not active (Meta)',
  minify_js: 'Not active (Meta)',
  minify_concatenate_js: 'Not active (Meta)',
  lazyload: 'Not active (Meta)',
  lazyload_iframes: 'Not active (Meta)',
  lazyload_css_bg_img: 'Not active (Meta)',
  image_dimensions: 'Not active (Meta)',
  self_hosted_fonts: 'Not active (Meta)',
  preload_links: 'Not active (Meta)',
  rocket_cdn: 'Not active (Meta)'
};

/** No meta, no footprint: honest Not active, Unknown where absence is unprovable. */
const NOTHING_ROWS: RowTable = {
  remove_unused_css: 'Not active',
  async_css: 'Not active',
  delay_js: 'Not active',
  defer_all_js: 'Not active',
  minify_css: 'Not active',
  minify_js: 'Not active',
  minify_concatenate_js: 'Unknown',
  lazyload: 'Not active',
  lazyload_iframes: 'Not active',
  lazyload_css_bg_img: 'Not active',
  image_dimensions: 'Unknown',
  self_hosted_fonts: 'Unknown',
  preload_links: 'Not active',
  rocket_cdn: 'Not active'
};

/** The scripted rounds, grouped by combination (each group runs under its combo). */
export const MATRIX_ROUNDS: readonly MatrixRound[] = [
  // --- baseline: precedence arms ------------------------------------------
  {
    id: 'A1-meta',
    combo: 'baseline',
    path: '/fdt/',
    visit: 'cached',
    meta: 'versioned',
    cache: CACHED,
    rows: BASELINE_META_ROWS,
    proves: 'the meta decides every row; a declared minify row needs no minified asset'
  },
  {
    id: 'A2-meta-vs-decoys',
    combo: 'baseline',
    path: '/fdt/?fdt-decoy=1',
    visit: 'cached',
    meta: 'versioned',
    cache: CACHED,
    rows: BASELINE_META_ROWS,
    proves: 'meta-present keys never consult the footprint fallback (five decoy footprints ignored)'
  },
  {
    id: 'A3-tag-absent-decoys',
    combo: 'baseline',
    path: '/fdt/?fdt-decoy=1&fdt-meta-off=1',
    visit: 'cached',
    meta: 'absent',
    cache: CACHED,
    rows: {
      ...BASELINE_FOOTPRINT_ROWS,
      remove_unused_css: 'Active (Footprint)',
      async_css: 'Active (Footprint)',
      lazyload_css_bg_img: 'Active (Footprint)',
      self_hosted_fonts: 'Active (Footprint)',
      preload_links: 'Active (Footprint)'
    },
    proves:
      'tag absent: the same decoys now decide their rows (RUCSS/async CSS by explicit fixture, never a licence-masked toggle)'
  },
  {
    id: 'A4-tag-absent',
    combo: 'baseline',
    path: '/fdt/?fdt-meta-off=1',
    visit: 'cached',
    meta: 'absent',
    cache: CACHED,
    rows: BASELINE_FOOTPRINT_ROWS,
    proves:
      'no meta + no footprint: absence-unprovable rows stay Unknown, the rest honest Not active'
  },
  {
    id: 'A5-digits-free-meta',
    combo: 'baseline',
    path: '/fdt/?fdt-wpr-versionless=1',
    visit: 'cached',
    meta: 'versionless',
    cache: CACHED,
    rows: BASELINE_META_ROWS,
    proves:
      'a digits-free meta is still the authority (not tag absence); only the version is unknown'
  },
  {
    id: 'A6-bypass',
    combo: 'baseline',
    path: '/fdt/?fdt-delay=1&nowprocket=1&fdt-no-store=1&fdt-edge-strip=1',
    visit: 'uncached',
    meta: 'absent',
    cache: {
      chip: 'Bypass requested',
      report: 'Cache bypass requested (nowprocket; no WP Rocket signature; cache state not proven)',
      layer: null
    },
    rows: BYPASS_ROWS,
    proves:
      'the bypass arm, genuinely uncached: no meta, no signature; footprints decide and the bypass reads as a request, never a cache verdict'
  },
  {
    id: 'A7-bypass-host-layer',
    combo: 'baseline',
    path: '/fdt/?fdt-delay=1&nowprocket=1&fdt-no-store=1&fdt-edge-strip=1&fdt-edge-header=sg',
    visit: 'uncached',
    meta: 'absent',
    cache: {
      chip: 'Possibly cached',
      report:
        'Possibly cached (SiteGround cache-layer marker; no WP Rocket signature; cache bypass requested)',
      layer: null,
      header: ['sg-f-cache', 'HIT']
    },
    rows: BYPASS_ROWS,
    proves: 'a served host marker outranks the bypass, which is carried alongside it'
  },
  {
    id: 'A8-bypass-cached-copy',
    combo: 'baseline',
    path: '/fdt/?fdt-delay=1&nowprocket=1',
    visit: 'cached',
    meta: 'absent',
    cache: CACHED,
    rows: BYPASS_ROWS,
    proves:
      "the plugin stores a nowprocket URL that carries a cached query flag (A6 minus fdt-no-store); its own stamp outranks the URL's bypass parameter"
  },
  {
    id: 'A9-white-label',
    combo: 'baseline',
    path: '/fdt/?fdt-white-label=1',
    visit: 'cached',
    meta: 'absent',
    cache: CACHED,
    rows: BASELINE_FOOTPRINT_ROWS,
    proves:
      'a white-label build: no meta, the `Cached for great performance` footer still proves the cache'
  },
  {
    id: 'A10-white-label-stripped',
    combo: 'baseline',
    path: '/fdt/?fdt-white-label=1&fdt-edge-strip=1',
    visit: 'cached',
    meta: 'absent',
    cache: { chip: 'Cache not detected', report: 'Cache not detected', layer: null },
    rows: BASELINE_FOOTPRINT_ROWS,
    proves: 'no meta and no footer: only the optimization footprints prove the plugin'
  },
  // --- baseline: cache context (comment and headers varied independently) -
  {
    id: 'K1-stripped-signature',
    combo: 'baseline',
    path: '/fdt/?fdt-edge-strip=1',
    visit: 'cached',
    meta: 'versioned',
    cache: { chip: 'Cache not detected', report: 'Cache not detected', layer: null },
    rows: BASELINE_META_ROWS,
    proves: 'a stripped comment with no host marker is "not detected" — never "not cached"'
  },
  {
    id: 'K2-host-header-signature-kept',
    combo: 'baseline',
    path: '/fdt/?fdt-edge-header=sg',
    visit: 'cached',
    meta: 'versioned',
    cache: { ...CACHED, header: ['sg-f-cache', 'HIT'] },
    rows: BASELINE_META_ROWS,
    proves: 'a host header beside an intact stamped signature: the stamp settles it, no layer line'
  },
  {
    id: 'K2b-digits-free-stripped',
    combo: 'baseline',
    path: '/fdt/?fdt-wpr-versionless=1&fdt-edge-strip=1',
    visit: 'cached',
    meta: 'versionless',
    cache: { chip: 'Cache not detected', report: 'Cache not detected', layer: null },
    rows: BASELINE_META_ROWS,
    proves: 'with no footer, a digits-free meta alone proves the plugin and still decides every row'
  },
  {
    id: 'K3-stripped-siteground',
    combo: 'baseline',
    path: '/fdt/?fdt-edge-strip=1&fdt-edge-header=sg',
    visit: 'cached',
    meta: 'versioned',
    cache: {
      chip: 'Possibly cached',
      report: 'Possibly cached (SiteGround cache-layer marker; no WP Rocket signature)',
      layer: null,
      header: ['sg-f-cache', 'HIT']
    },
    rows: BASELINE_META_ROWS,
    proves: 'stripped signature + sg-f-cache: HIT names SiteGround'
  },
  {
    id: 'K4-stripped-cloudflare',
    combo: 'baseline',
    path: '/fdt/?fdt-edge-strip=1&fdt-edge-header=cf',
    visit: 'cached',
    meta: 'versioned',
    cache: {
      chip: 'Possibly cached',
      report: 'Possibly cached (Cloudflare cache-layer marker; no WP Rocket signature)',
      layer: null,
      header: ['cf-cache-status', 'HIT']
    },
    rows: BASELINE_META_ROWS,
    proves: 'stripped signature + cf-cache-status: HIT names Cloudflare'
  },
  {
    id: 'K5-cloudflare-not-served',
    combo: 'baseline',
    path: '/fdt/?fdt-edge-strip=1&fdt-edge-header=cf-dynamic',
    visit: 'cached',
    meta: 'versioned',
    cache: {
      chip: 'Cache not detected',
      report: 'Cache not detected',
      layer: null,
      header: ['cf-cache-status', 'DYNAMIC']
    },
    rows: BASELINE_META_ROWS,
    proves: 'cf-cache-status: DYNAMIC is visible but is not a cache serve'
  },
  {
    id: 'K6-generic-proxy',
    combo: 'baseline',
    path: '/fdt/?fdt-edge-strip=1&fdt-edge-header=proxy',
    visit: 'cached',
    meta: 'versioned',
    cache: {
      chip: 'Possibly cached',
      report: 'Possibly cached (host proxy cache-layer marker; no WP Rocket signature)',
      layer: null,
      header: ['x-proxy-cache', 'HIT']
    },
    rows: BASELINE_META_ROWS,
    proves: 'x-proxy-cache: HIT is a served host proxy layer, never labeled SiteGround'
  },
  {
    id: 'K7-live-render-host-layer',
    combo: 'baseline',
    path: '/fdt/?fdt-edge-header=sg',
    visit: 'live',
    meta: 'versioned',
    cache: {
      chip: 'Cache not proven',
      report: 'Plugin fingerprint found, cache not proven for this visit',
      layer: 'SiteGround',
      header: ['sg-f-cache', 'HIT']
    },
    rows: BASELINE_META_ROWS,
    proves: 'a live render (signature without stamp) names the served host layer on its own line'
  },
  // --- media-preload ---------------------------------------------------------
  {
    id: 'B1-meta',
    combo: 'media-preload',
    path: '/fdt/',
    visit: 'cached',
    meta: 'versioned',
    cache: CACHED,
    rows: {
      ...ALL_REFUTED_ROWS,
      lazyload: 'Active (Meta)',
      // Declared with no iframe on the page (like the minify rows).
      lazyload_iframes: 'Active (Meta)',
      lazyload_css_bg_img: 'Active (Meta)',
      // Option on, but the page's images already carry dimensions: not declared.
      image_dimensions: 'Not active (Meta)',
      self_hosted_fonts: 'Active (Meta)',
      preload_links: 'Active (Meta)'
    },
    proves: 'a stored-settings swap moves exactly the declared rows; option-on is not page-applied'
  },
  {
    id: 'B2-tag-absent',
    combo: 'media-preload',
    path: '/fdt/?fdt-meta-off=1',
    visit: 'cached',
    meta: 'absent',
    cache: CACHED,
    rows: {
      ...BASELINE_FOOTPRINT_ROWS,
      delay_js: 'Not active',
      defer_all_js: 'Not active',
      lazyload_iframes: 'Active (Footprint)',
      lazyload_css_bg_img: 'Active (Footprint)',
      preload_links: 'Active (Footprint)'
    },
    proves:
      'the same settings read through footprints only: the font row is Unknown (no hosted-font markup)'
  },
  // --- all-off ---------------------------------------------------------------
  {
    id: 'C1-device-only-meta',
    combo: 'all-off',
    path: '/fdt/',
    visit: 'cached',
    meta: 'versioned',
    cache: CACHED,
    rows: ALL_REFUTED_ROWS,
    proves: 'a meta carrying only the device token refutes every row (never Unknown)'
  },
  {
    id: 'C2-device-only-meta-vs-decoys',
    combo: 'all-off',
    path: '/fdt/?fdt-decoy=1',
    visit: 'cached',
    meta: 'versioned',
    cache: CACHED,
    rows: ALL_REFUTED_ROWS,
    proves: 'decoy footprints stay refuted under a feature-less meta'
  },
  {
    id: 'C3-nothing-anywhere',
    combo: 'all-off',
    path: '/fdt/?fdt-meta-off=1',
    visit: 'cached',
    meta: 'absent',
    cache: CACHED,
    rows: NOTHING_ROWS,
    proves: 'no meta, no footprint: only the cache signature proves the plugin; nothing is invented'
  }
];

/** The query flag a live visit varies: cached, and inert unless its value is `1`. */
export const LIVE_NONCE_FLAG = 'fdt-delay';

/** The fixture query that renders through the plugin but never stores the cache file. */
export const NO_STORE_QUERY = 'fdt-no-store=1';

/** The query flag that asks the fixture for its decoy footprints. */
export const DECOY_FLAG = 'fdt-decoy';

/**
 * One selector per element `?fdt-decoy=1` prints. The markup is declared once,
 * in `docker/fixtures/fdt-fixtures.php`; the fixture contract test pins every
 * selector to exactly one element of it, and the decoy elements' count to
 * this list's length.
 */
export const DECOY_SELECTORS: readonly string[] = [
  'style#wpr-usedcss',
  'script#fdt-decoy-async-css',
  'script#fdt-decoy-preload-links',
  'link[data-wpr-hosted-gf-parameters]',
  'div#wpr-lazyload-bg-container'
];

/**
 * A round path's query parameters.
 *
 * @param path The round's site path + query.
 */
function queryOf(path: string): URLSearchParams {
  const at = path.indexOf('?');
  return new URLSearchParams(at === -1 ? '' : path.slice(at + 1));
}

/**
 * Whether the round's page carries the decoy footprints.
 *
 * @param round The round.
 */
export function wantsDecoys(round: MatrixRound): boolean {
  return queryOf(round.path).get(DECOY_FLAG) === '1';
}

/**
 * Every fixture flag (`fdt-*`) the matrix sends: the rounds' paths plus the
 * live nonce. Each must be one of the site's cached query strings — WP Rocket
 * only processes a query string carrying one, so an unlisted flag serves
 * plain, unoptimized WordPress and its rounds would assert the wrong page.
 * (`nowprocket` is the plugin's own parameter, never a fixture flag.)
 *
 * @param rounds The round list (the shipped one by default).
 * @returns The distinct flags, sorted.
 */
export function matrixFixtureFlags(rounds: readonly MatrixRound[] = MATRIX_ROUNDS): string[] {
  const flags = new Set<string>([LIVE_NONCE_FLAG]);
  for (const round of rounds) {
    for (const key of queryOf(round.path).keys()) if (key.startsWith('fdt-')) flags.add(key);
  }
  return [...flags].sort();
}

/**
 * What keeps a stored-settings snapshot from being the bootstrap baseline: a
 * forced key off its forced value (every combination key is forced, so a run
 * killed before its restore is caught here; an absent key is drift too),
 * or a matrix flag missing from `cache_query_strings` (a stack booted by an
 * older bootstrap).
 *
 * @param settings The stored `wp_rocket_settings` value.
 * @returns One actionable line per problem; empty when at the baseline.
 */
export function baselineDrift(settings: Readonly<Record<string, unknown>>): string[] {
  const problems = Object.entries(BOOTSTRAP_FORCED)
    .filter(([key, value]) => Number(settings[key]) !== value)
    .map(([key, value]) => `${key} is not ${String(value)}`);
  const listed: unknown = settings.cache_query_strings;
  const missing = matrixFixtureFlags().filter(
    (flag) => !(Array.isArray(listed) && listed.includes(flag))
  );
  if (missing.length > 0) problems.push(`cache_query_strings lacks ${missing.join(', ')}`);
  return problems;
}

/**
 * What keeps a live `/fdt/` render from declaring the baseline's features:
 * the A1 round's meta rows, read as tokens (declared = `Active (Meta)`,
 * refuted = `Not active (Meta)`). Every test combination moves at least one
 * of them, so a run killed before its restore shows here — over plain HTTP,
 * cheap enough to check before every browser run.
 *
 * @param html A live (never a stored-copy) render of `/fdt/`.
 * @returns One line per mismatch; empty when the render is the baseline.
 */
export function baselineMetaDrift(html: string): string[] {
  const declared = /<meta\b[^>]*\bdata-wpr-features="([^"]*)"/i.exec(html)?.[1];
  if (declared === undefined) return ['the generator meta carries no data-wpr-features'];
  const tokens = new Set(declared.split(/\s+/).filter(Boolean));
  const baseline = MATRIX_ROUNDS.find((round) => round.id === 'A1-meta');
  if (baseline === undefined) throw new Error('the round list lost its A1-meta baseline round');
  const problems: string[] = [];
  for (const [row, expectation] of Object.entries(baseline.rows) as [MatrixRow, RowExpectation][]) {
    const token = FEATURE_META_TOKENS[row];
    if (expectation === 'Active (Meta)' && !tokens.has(token)) problems.push(`${token} missing`);
    if (expectation === 'Not active (Meta)' && tokens.has(token))
      problems.push(`${token} declared`);
  }
  return problems;
}
