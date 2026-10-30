/**
 * O1 for LazyLoad (images): the forward transform reproduces every
 * LazyLoad-only row of the plugin-derived simulation table byte for byte,
 * under each supported WP Rocket version (its own exclusion literals and
 * printed texts from the packaged data file). The rows' pages get
 * LazyLoad's head and footer texts placed by the placement module (the
 * oracle's rule: these rows pin the two against each other) before the
 * pass reads them. Rows with Defer/Delay JS on too belong to the composed suites.
 * A row the transform refuses by design (a named reference outside the
 * ported table) must be refused — identity, the step named — and its
 * other cases are checked with that reference left out.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectationsFor } from '../exclusion-builder/parity-version-expectations';
import { SUPPORTED_WPR_VERSIONS } from '../wp-rocket/versions';
import { simulateLazyloadImages } from './lazyload-forward';
import { lazyloadAssetsUrl } from './lazyload-assets-url';
import { packagedVersion } from '../exclusion-session/packaged-simulation-data';
import { composeLazyloadHookTexts, placeLazyloadHookTexts } from './lazyload-hook-texts';
import { SIMULATION_DATA_PATH, readSimulationData } from './simulation-data';
import { parseSimulationTable } from './simulation-parity-table';

const HERE = dirname(fileURLToPath(import.meta.url));

const TABLE = parseSimulationTable(
  JSON.parse(readFileSync(join(HERE, 'simulation-parity.fixtures.json'), 'utf8'))
);

const DATA = (() => {
  const read = readSimulationData(
    JSON.parse(readFileSync(join(HERE, '../../public', SIMULATION_DATA_PATH), 'utf8'))
  );
  if (!read.ok) throw new Error(read.problem);
  return read.data;
})();

/** The LazyLoad-only rows. */
const LAZYLOAD_ROWS = TABLE.rows.filter((row) => row.feature === 'lazyload');

/**
 * A packaged row list.
 *
 * @param sha256 Its content key.
 */
function rows(sha256: string): readonly string[] {
  const found = DATA.rowLists[sha256];
  if (found === undefined) throw new Error(`no row list ${sha256}`);
  return found;
}

/** Rows refused by design, with the step named and the text whose removal makes them reproducible. */
const REFUSED: Readonly<Record<string, { readonly step: string; readonly drop: string }>> = {
  'simulate-lazyload-background-values': {
    step: 'lazyload-entities',
    drop: '<div style="background-image:url(/e4&lpar;x&rpar;.png)">html5 named</div>'
  }
};

/** The first differing offset with a little context, or null when equal. */
function firstDifference(actual: string, expected: string): string | null {
  if (actual === expected) return null;
  let at = 0;
  while (at < actual.length && actual[at] === expected[at]) at++;
  return `at ${String(at)}: got ${JSON.stringify(actual.slice(at - 40, at + 80))}, want ${JSON.stringify(expected.slice(at - 40, at + 80))}`;
}

describe.each(SUPPORTED_WPR_VERSIONS.map((pin) => [pin.version] as const))(
  'LazyLoad (images) simulation parity under WP Rocket %s',
  (version) => {
    const entry = DATA.versions[version]?.lazyload;
    if (entry === undefined) throw new Error(`no LazyLoad data for ${version}`);
    // The version's texts through the extension's own package reader.
    const read = packagedVersion(DATA, version);
    if (!read.ok) throw new Error(`no package for ${version}: ${read.cause}`);
    const lazyloadPackage = read.package.lazyload;
    const literals = {
      excludedAttributes: rows(entry.excludedAttributes.sha256),
      excludedSrc: rows(entry.excludedSrc.sha256)
    };

    it('covers every LazyLoad row', () => {
      expect(LAZYLOAD_ROWS.length).toBeGreaterThanOrEqual(20);
    });

    it.each(LAZYLOAD_ROWS.map((row) => [row.id, row] as const))('%s', (_id, row) => {
      const lazyload = row.lazyload;
      if (lazyload === undefined) throw new Error(`${row.id} holds no lazyload`);
      const placed = placeLazyloadHookTexts(
        row.html,
        composeLazyloadHookTexts(lazyloadPackage, lazyload.assetsUrl)
      );
      // The harness takes only pages with one `</head>` then one `</body>`: no fallback.
      if (!placed.ok || placed.placement.fallbacks.length > 0) {
        throw new Error(`${row.id}: ${JSON.stringify(placed)}`);
      }
      const page = placed.html;
      const out = simulateLazyloadImages({ html: page, literals, rows: lazyload.rows });
      const refused = REFUSED[row.id];
      if (refused === undefined) {
        expect(firstDifference(out.html, expectationsFor(row, version).served)).toBeNull();
        return;
      }
      expect(out).toEqual({
        html: page,
        report: {
          state: 'not-applicable',
          unreproduced: refused.step,
          images: 0,
          pictures: 0,
          backgrounds: 0
        }
      });
      expect(page).toContain(refused.drop);
      // The element's own output, as the plugin wrote it, then dropped from both sides.
      const served = expectationsFor(row, version).served;
      const servedDrop =
        '<div data-bg="/e4(x).png" class="rocket-lazyload" style="">html5 named</div>';
      expect(served).toContain(servedDrop);
      const rest = simulateLazyloadImages({
        html: page.replace(refused.drop, ''),
        literals,
        rows: lazyload.rows
      });
      expect(firstDifference(rest.html, served.replace(servedDrop, ''))).toBeNull();
    });
  }
);

describe('the LazyLoad rows pin the placement rule against the harness', () => {
  it('place texts both before the buffer blocks and right before the end tags', () => {
    const placements = LAZYLOAD_ROWS.map((row) => {
      const placed = placeLazyloadHookTexts(row.html, { head: '', footer: '' });
      return placed.ok ? `${placed.placement.head} ${placed.placement.footer}` : placed.refused;
    });
    expect(new Set(placements.flatMap((pair) => pair.split(' ')))).toEqual(
      new Set(['before-end-tag', 'before-generator-meta', 'before-beacon-block'])
    );
  });

  it("derive the live page's assets URL from its beacon tag", () => {
    const docker = LAZYLOAD_ROWS.find((row) => row.id === 'simulate-lazyload-docker-off');
    if (docker?.lazyload === undefined) throw new Error('no docker row');
    expect(lazyloadAssetsUrl(docker.html, 'http://127.0.0.1:8493/')).toEqual({
      url: docker.lazyload.assetsUrl,
      source: 'beacon'
    });
  });
});
