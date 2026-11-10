/**
 * Text contracts between the docker site's detection-matrix fixtures and the
 * debugging tool's real engine. The browser tier (`site-detection-matrix`)
 * proves the rounds end to end; these pins keep fixture drift from silently
 * turning a round into a no-op:
 *
 * - every matrix flag is a cached query flag (an unlisted flag would serve
 *   plain, unoptimized WordPress and every round would assert the wrong page);
 * - the suite's baseline guards mirror the bootstrap (forced pairs, flag list),
 *   the forced set covers every key a combination writes (so up.sh undoes a
 *   killed run), and the guards catch every combination left behind;
 * - the no-store flag rides the plugin's own cache-file filter;
 * - the decoy literals really trip the engine's footprint checks (and only
 *   while the meta is absent), and the decoy scripts carry the Delay JS
 *   exclusion stem;
 * - the edge layer's stripper removes exactly the engine's cache footers, and
 *   its header table answers the engine's served-layer vocabulary as the
 *   rounds declare;
 * - the bootstrap defines the filesystem modes the plugin's hourly debug-log
 *   truncation needs (without them that truncation fatals the wp-cli settings
 *   write it runs in);
 * - Apache accepts connections without TCP_DEFER_ACCEPT (with it, a browser's
 *   idle preconnected socket stalls its next navigation behind the port
 *   forwarder, the browser tier's admin-login timeout).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { servedCacheLayer } from '../../lib/detection/cache-context';
import { runDetection } from '../../lib/detection/run-detection';
import { CACHE_COMMENT_MARKERS, FEATURE_META_TOKENS } from '../../lib/wp-rocket/constants';
import {
  BOOTSTRAP_FORCED,
  DECOY_SELECTORS,
  SETTINGS_COMBOS,
  baselineDrift,
  baselineMetaDrift,
  matrixFixtureFlags
} from '../../tests/e2e/helpers/detection-matrix';

const DOCKER = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PLUGIN = readFileSync(join(DOCKER, 'fixtures', 'fdt-fixtures.php'), 'utf8');
const EDGE_LAYER = readFileSync(join(DOCKER, 'fixtures', 'edge', 'fdt-edge.php'), 'utf8');
const BOOTSTRAP = readFileSync(join(DOCKER, 'bootstrap', 'bootstrap.sh'), 'utf8');
const COMPOSE = readFileSync(join(DOCKER, 'docker-compose.yml'), 'utf8');
const ACCEPT_FILTER = readFileSync(join(DOCKER, 'apache', 'accept-filter.conf'), 'utf8');

/**
 * A PHP constant's value: one single-quoted literal, or several joined by `.`
 * (the fixtures never escape inside these literals).
 *
 * @param source The PHP file text.
 * @param name The constant name.
 * @throws When the constant is missing — the contract is unreadable then.
 */
function phpConstant(source: string, name: string): string {
  const match = new RegExp(`const ${name}\\s*=\\s*((?:'[^']*'\\s*(?:\\.\\s*)?)+);`).exec(source);
  if (match?.[1] === undefined) throw new Error(`${name} is no longer a literal constant`);
  return [...match[1].matchAll(/'([^']*)'/g)].map((part) => part[1]).join('');
}

/** The cached query flags the bootstrap stores (its one JSON list). */
function cachedQueryFlags(): string[] {
  const match = /cache_query_strings '(\[[^\]]*\])' --format=json/.exec(BOOTSTRAP);
  if (match?.[1] === undefined) throw new Error('bootstrap.sh lost its cache_query_strings write');
  return JSON.parse(match[1]) as string[];
}

/** A page around the given head/body markup, with or without the generator meta. */
function page(head: string, body: string, meta: boolean): string {
  const generator = meta
    ? '<meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_delay_js wpr_desktop" />'
    : '';
  return `<!doctype html><html><head>${generator}${head}</head><body>${body}</body></html>`;
}

/** The edge stripper's PCRE, as the equivalent JS regex (same syntax subset). */
function edgeStripper(): RegExp {
  const match = /preg_replace\(\s*'\/(.+)\/s',/.exec(EDGE_LAYER);
  if (match?.[1] === undefined) throw new Error('fdt-edge.php lost its signature regex');
  return new RegExp(match[1].replace(/\\'/g, "'"), 'gs');
}

describe('detection-matrix fixture contracts', () => {
  it('lists every matrix flag as a cached query flag', () => {
    const flags = [
      phpConstant(FIXTURE_PLUGIN, 'FIXTURE_FLAG_META_OFF'),
      phpConstant(FIXTURE_PLUGIN, 'FIXTURE_FLAG_WHITE_LABEL'),
      phpConstant(FIXTURE_PLUGIN, 'FIXTURE_FLAG_DECOY'),
      phpConstant(FIXTURE_PLUGIN, 'FIXTURE_FLAG_VERSIONLESS'),
      phpConstant(FIXTURE_PLUGIN, 'FIXTURE_FLAG_NO_STORE'),
      phpConstant(EDGE_LAYER, 'FDT_EDGE_FLAG_STRIP'),
      phpConstant(EDGE_LAYER, 'FDT_EDGE_FLAG_HEADER')
    ];
    expect(flags).toEqual([
      'fdt-meta-off',
      'fdt-white-label',
      'fdt-decoy',
      'fdt-wpr-versionless',
      'fdt-no-store',
      'fdt-edge-strip',
      'fdt-edge-header'
    ]);
    for (const flag of flags) expect(cachedQueryFlags()).toContain(flag);
    // Every flag a round URL sends is a fixture flag the bootstrap lists.
    for (const flag of matrixFixtureFlags()) expect(cachedQueryFlags(), flag).toContain(flag);
  });

  it('declares exactly the forced pairs the bootstrap re-applies every boot', () => {
    const loop =
      /^for pair in ([\w= ]+); do\n\trun_wp option patch insert wp_rocket_settings "\$\{pair%%=\*\}" "\$\{pair#\*=\}" --format=json /m.exec(
        BOOTSTRAP
      );
    if (loop?.[1] === undefined) throw new Error('bootstrap.sh lost its forced-pair loop');
    const pairs = loop[1].split(' ').map((pair) => {
      const match = /^(\w+)=([01])$/.exec(pair);
      if (match?.[1] === undefined)
        throw new Error(`bootstrap.sh forces a malformed pair: ${pair}`);
      return [match[1], Number(match[2])] as const;
    });
    expect(new Set(pairs.map(([key]) => key)).size, 'no key forced twice').toBe(pairs.length);
    expect(Object.fromEntries(pairs)).toEqual(BOOTSTRAP_FORCED);
  });

  it('forces every key a settings combination writes, so up.sh undoes a killed run', () => {
    for (const combo of SETTINGS_COMBOS) {
      for (const key of Object.keys(combo.overrides)) {
        expect(BOOTSTRAP_FORCED, `${combo.id} writes ${key}`).toHaveProperty(key);
      }
    }
  });

  it('flags every test combination as drift, and the baseline as none', () => {
    const baseline = { ...BOOTSTRAP_FORCED, cache_query_strings: cachedQueryFlags() };
    expect(baselineDrift(baseline)).toEqual([]);
    for (const combo of SETTINGS_COMBOS) {
      const left = baselineDrift({ ...baseline, ...combo.overrides });
      if (combo.id === 'baseline') expect(left, combo.id).toEqual([]);
      else expect(left.length, `${combo.id} left behind is caught`).toBeGreaterThan(0);
    }
    // A stack booted by an older bootstrap lacks the newer flags.
    expect(baselineDrift({ ...baseline, cache_query_strings: ['fdt-error'] })).toEqual([
      `cache_query_strings lacks ${matrixFixtureFlags()
        .filter((flag) => flag !== 'fdt-error')
        .join(', ')}`
    ]);
    expect(baselineDrift({ ...baseline, cache_query_strings: undefined })).toHaveLength(1);
    // Each forced key alone, off its value or absent, is drift (a partial leftover).
    for (const [key, value] of Object.entries(BOOTSTRAP_FORCED)) {
      expect(baselineDrift({ ...baseline, [key]: 1 - value }), key).toEqual([
        `${key} is not ${String(value)}`
      ]);
      expect(baselineDrift({ ...baseline, [key]: undefined }), `${key} absent`).toHaveLength(1);
    }
  });

  it('reads a live render off the baseline by its declared features', () => {
    const meta = (tokens: string) =>
      `<meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="${tokens}" />`;
    const t = FEATURE_META_TOKENS;
    const baseline = [t.delay_js, t.defer_all_js, t.minify_js, t.lazyload, 'wpr_desktop'];
    expect(baselineMetaDrift(meta(baseline.join(' ')))).toEqual([]);
    // all-off: only the device token is left.
    expect(baselineMetaDrift(meta('wpr_desktop'))).toEqual(
      [t.delay_js, t.defer_all_js, t.minify_js, t.lazyload].map((token) => `${token} missing`)
    );
    // media-preload: the JS tokens go, the media/preload tokens arrive.
    expect(
      baselineMetaDrift(meta(`${t.lazyload} ${t.lazyload_iframes} ${t.preload_links} wpr_desktop`))
    ).toEqual([
      `${t.delay_js} missing`,
      `${t.defer_all_js} missing`,
      `${t.minify_js} missing`,
      `${t.lazyload_iframes} declared`,
      `${t.preload_links} declared`
    ]);
    expect(baselineMetaDrift('<html></html>')).toEqual([
      'the generator meta carries no data-wpr-features'
    ]);
  });

  it('keeps no-store renders out of the cache through the plugin filter', () => {
    expect(FIXTURE_PLUGIN).toMatch(
      /add_filter\( 'do_rocket_generate_caching_files', 'fixture_skip_cache_file', PHP_INT_MAX \);/
    );
  });

  it('selects every decoy element exactly once', () => {
    const markup =
      phpConstant(FIXTURE_PLUGIN, 'FIXTURE_HEAD_DECOYS') +
      phpConstant(FIXTURE_PLUGIN, 'FIXTURE_BODY_DECOYS');
    const doc = new DOMParser().parseFromString(page(markup, '', false), 'text/html');
    for (const selector of DECOY_SELECTORS) {
      expect(doc.querySelectorAll(selector).length, selector).toBe(1);
    }
    // Every decoy element (head and body literals) has its selector.
    const elements = (markup.match(/<(?:style|script|link|div)\b/g) ?? []).length;
    expect(elements).toBe(DECOY_SELECTORS.length);
  });

  /**
   * A decoy row's exact expected shape: the verdict plus the row's own facts
   * (no decoy is a critical-path style, so the async CSS row records none).
   */
  const withFacts = (row: string, verdict: { present: boolean; source?: string }) =>
    row === 'async_css' ? { ...verdict, criticalStyle: false } : verdict;

  it('trips exactly the five decoy footprints when the meta is absent', () => {
    const head = phpConstant(FIXTURE_PLUGIN, 'FIXTURE_HEAD_DECOYS');
    const body = phpConstant(FIXTURE_PLUGIN, 'FIXTURE_BODY_DECOYS');
    const plain = runDetection(page('', '', false)).detections;
    const decoyed = runDetection(page(head, body, false)).detections;
    const rows = [
      'remove_unused_css',
      'async_css',
      'preload_links',
      'self_hosted_fonts',
      'lazyload_css_bg_img'
    ] as const;
    for (const row of rows) {
      expect(plain[row], `${row} without decoys`).toEqual(withFacts(row, { present: false }));
      expect(decoyed[row], `${row} with decoys`).toEqual(
        withFacts(row, { present: true, source: 'footprint' })
      );
    }
    // Nothing else moved: the decoys assert no other row (inventories such as
    // the script list may grow; presence and source may not).
    const others = (Object.keys(decoyed) as (keyof typeof decoyed)[]).filter(
      (key) => key !== 'wpr' && !(rows as readonly string[]).includes(key)
    );
    /** A row's verdict fields (the beacon row carries no `source`). */
    const verdict = (entry: { present: boolean; source?: string }) => ({
      present: entry.present,
      source: entry.source
    });
    for (const key of others) {
      expect(verdict(decoyed[key]), key).toEqual(verdict(plain[key]));
    }
  });

  it('keeps every decoy row refuted while the meta is issued', () => {
    const head = phpConstant(FIXTURE_PLUGIN, 'FIXTURE_HEAD_DECOYS');
    const body = phpConstant(FIXTURE_PLUGIN, 'FIXTURE_BODY_DECOYS');
    const detections = runDetection(page(head, body, true)).detections;
    for (const row of [
      'remove_unused_css',
      'async_css',
      'preload_links',
      'self_hosted_fonts',
      'lazyload_css_bg_img'
    ] as const) {
      expect(detections[row], row).toEqual(withFacts(row, { present: false, source: 'meta' }));
    }
  });

  it('stamps every decoy script with the Delay JS exclusion stem', () => {
    const stem = phpConstant(FIXTURE_PLUGIN, 'FIXTURE_DECOY_STEM');
    const head = phpConstant(FIXTURE_PLUGIN, 'FIXTURE_HEAD_DECOYS');
    const scripts = head.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toHaveLength(2);
    for (const script of scripts) expect(script).toContain(stem);
    expect(FIXTURE_PLUGIN).toMatch(/fixture_error_assets\(\) \), \[ FIXTURE_DECOY_STEM \] \)/);
  });

  it('strips every cache footer the engine reads, and nothing else', () => {
    const stripper = edgeStripper();
    for (const marker of CACHE_COMMENT_MARKERS) {
      const html = `</html>\n<!-- ${marker} - Debug: cached@1792538092 -->`;
      expect(html.replace(stripper, ''), marker).toBe('</html>');
    }
    const foreign = '</html><!-- wpr_delay_js --><!-- Served by a proxy -->';
    expect(foreign.replace(stripper, '')).toBe(foreign);
  });

  it('answers the edge header table as the rounds declare', () => {
    const table = [...EDGE_LAYER.matchAll(/'([\w-]+)'\s*=> \[ '([\w-]+)', '([A-Z]+)' \]/g)].map(
      (row) => ({ flag: row[1], name: row[2] ?? '', value: row[3] ?? '' })
    );
    expect(table.map((row) => row.flag)).toEqual(['sg', 'cf', 'cf-dynamic', 'proxy']);
    const layers = table.map((row) => servedCacheLayer([{ name: row.name, value: row.value }]));
    // SiteGround and Cloudflare serves are named; a DYNAMIC Cloudflare
    // response and the generic proxy header name no layer.
    expect(layers).toEqual(['SiteGround', 'Cloudflare', null, null]);
  });

  it('defines the filesystem modes before WordPress loads, so wp-cli settings writes survive the hourly debug-log truncation', () => {
    const insert =
      /sed -i "s#\^require_once ABSPATH \. 'wp-settings\.php';#\$GUARDS_MARKER(.+)#"/.exec(
        BOOTSTRAP
      );
    if (insert?.[1] === undefined) throw new Error('bootstrap.sh lost its debug-log guards insert');
    expect(insert[1]).toContain(
      "define( 'FS_CHMOD_DIR', ( fileperms( ABSPATH ) \\& 0777 | 0755 ) );"
    );
    expect(insert[1]).toContain(
      "define( 'FS_CHMOD_FILE', ( fileperms( ABSPATH . 'index.php' ) \\& 0777 | 0644 ) );"
    );
    // The guards land right above the wp-settings require, i.e. before any plugin runs.
    expect(insert[1].endsWith("\\nrequire_once ABSPATH . 'wp-settings.php';")).toBe(true);
  });

  it('serves Apache without deferred accept, so an idle preconnected socket answers at once', () => {
    // The only directive line (comments aside) disables the accept filter for http.
    const directives = ACCEPT_FILTER.split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(directives).toEqual(['AcceptFilter http none']);
    // Loaded by the serving container through the image's conf-enabled include, read-only.
    expect(COMPOSE).toContain(
      '- ./apache/accept-filter.conf:/etc/apache2/conf-enabled/fdt-accept-filter.conf:ro'
    );
  });
});
