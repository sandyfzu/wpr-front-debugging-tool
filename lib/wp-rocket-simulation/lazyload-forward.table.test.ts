/**
 * O1 for LazyLoad (images): the forward transform reproduces every
 * LazyLoad-only row of the plugin-derived simulation table byte for byte,
 * under each supported WP Rocket version (its own exclusion literals and
 * printed texts from the packaged data file). The rows' pages get
 * LazyLoad's head and footer texts where the table's harness prints them
 * (this suite's own placement, the oracle's rule) before the pass reads
 * them. Rows with Defer/Delay JS on too belong to the composed suites.
 * A row the transform refuses by design (a named reference outside the
 * ported table) must be refused — identity, the step named — and its
 * other cases are checked with that reference left out.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asciiLowerCase } from '../exclusion-builder/literal-rows';
import { expectationsFor } from '../exclusion-builder/parity-version-expectations';
import { SUPPORTED_WPR_VERSIONS } from '../wp-rocket/versions';
import { simulateLazyloadImages } from './lazyload-forward';
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
 * A packaged text.
 *
 * @param sha256 Its content key.
 */
function text(sha256: string): string {
  const found = DATA.texts[sha256];
  if (found === undefined) throw new Error(`no text ${sha256}`);
  return found;
}

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

/** WP Rocket's generator meta ending the head (written by the buffer after the hooks). */
const GENERATOR_META_TAIL =
  /<meta name="generator" content="WP Rocket[^"]*" data-wpr-features="[^"]*" \/>$/;

/** WP Rocket's beacon block ending the body (written by the buffer after the hooks). */
const BEACON_BLOCK_TAIL =
  /<script>var rocket_beacon_data = (?:(?!<\/script>)[\s\S])*<\/script><script data-name="wpr-wpr-beacon" src='[^']*' async><\/script>$/;

/**
 * Where a hook's text goes: right before the end tag, or before the block
 * WP Rocket's buffer writes there when the page ends the element with it.
 *
 * @param html The page.
 * @param end The end tag's offset.
 * @param tail The block's pattern.
 */
function hookOffset(html: string, end: number, tail: RegExp): number {
  const found = tail.exec(html.slice(0, end));
  return found === null ? end : found.index;
}

/**
 * The page as WordPress prints it with LazyLoad on: its `wp_head` text
 * before `</head>`, its `wp_footer` text before `</body>`.
 *
 * @param html The table row's page.
 * @param head The `wp_head` text.
 * @param footer The `wp_footer` text.
 */
function withHookTexts(html: string, head: string, footer: string): string {
  // ASCII-caseless like the harness: Unicode lowering can change lengths (`İ`) and offsets.
  const lower = asciiLowerCase(html);
  const headAt = hookOffset(html, lower.indexOf('</head>'), GENERATOR_META_TAIL);
  const bodyAt = hookOffset(html, lower.indexOf('</body>'), BEACON_BLOCK_TAIL);
  return html.slice(0, headAt) + head + html.slice(headAt, bodyAt) + footer + html.slice(bodyAt);
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
      const footer =
        text(entry.optionsScript.sha256) +
        text(entry.runtimeTag.beforeUrl.sha256) +
        `${lazyload.assetsUrl}js/${entry.runtime.jsPath}` +
        text(entry.runtimeTag.afterUrl.sha256);
      const page = withHookTexts(row.html, text(entry.noJsStyle.sha256), footer);
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
