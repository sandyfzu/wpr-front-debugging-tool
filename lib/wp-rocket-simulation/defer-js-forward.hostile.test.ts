/**
 * The forward Defer JS transform runs synchronously on the document's
 * critical path, so it must stay linear on any page: pages shaped against
 * each scan of WP Rocket's Defer JS regexes (where PCRE backtracks or
 * rescans), against its `str_replace` rewrites, plus a realistic page —
 * each timed at 1 and 4 MiB.
 */
import { describe, expect, it } from 'vitest';
import { LINEAR_SCALING_TIMEOUT_MS, linearScaling } from '../../vitest.shared';
import { simulateDeferJs, type DeferJsForwardResult } from './defer-js-forward';

/**
 * `unit` repeated to `bytes`.
 *
 * @param unit The repeated text.
 * @param bytes The target length.
 */
const fill = (unit: string, bytes: number): string => unit.repeat(Math.ceil(bytes / unit.length));

/**
 * Simulate a page with a small list and a jQuery-free inline list.
 *
 * @param html The page.
 */
const simulate = (html: string): DeferJsForwardResult =>
  simulateDeferJs({
    html,
    rows: ['keep\\.js'],
    lists: { external: ['gist.github.com'], inline: ['DOMContentLoaded'] },
    inlineQuoteDelimiter: '/'
  });

describe('simulateDeferJs — linear on hostile pages', () => {
  it.each<[string, (bytes: number) => string]>([
    ['`<script` + whitespace before one far `>`', (bytes) => `<script ${' '.repeat(bytes)}>`],
    ['`<script ` openings before one far `>`', (bytes) => `${fill('<script ', bytes)}>`],
    ['`src` candidates in one far stretch', (bytes) => `<script ${fill(' src', bytes)}>`],
    ['unclosed `src="` values', (bytes) => `<script ${fill(" src='x", bytes)}>`],
    ['a URL with no closing quote', (bytes) => `<script src="${'a'.repeat(bytes)}>`],
    ['quotes before one far `>`', (bytes) => `<script ${'"'.repeat(bytes)}>`],
    ['an inline script with no `</script>`', (bytes) => `<script>${'a'.repeat(bytes)}`],
    ['`<script>` openings with no close', (bytes) => fill('<script>a', bytes)],
    ['an unclosed comment', (bytes) => `<!--${'a'.repeat(bytes)}`],
    ['`<!--` openings with one far close', (bytes) => `${fill('<!--', bytes)}-->`],
    ['a long comment', (bytes) => `<!--${'a'.repeat(bytes)}--><script src="a.js"></script>`],
    [
      'many distinct deferrable scripts (str_replace rescans)',
      (bytes) => {
        let out = '';
        for (let index = 0; out.length < bytes; index++)
          out += `<script src="/${String(index)}.js"></script>`;
        return out;
      }
    ],
    [
      'many distinct jQuery inline scripts',
      (bytes) => {
        let out = '';
        for (let index = 0; out.length < bytes; index++)
          out += `<script>jQuery(${String(index)});</script>`;
        return out;
      }
    ],
    [
      'script tags with no `src` anywhere after them',
      (bytes) => fill('<script type="text/x">v</script>', bytes)
    ],
    [
      '`<script ` runs closed by one `>` each',
      (bytes) => fill(`${'<script '.repeat(1000)}>`, bytes)
    ],
    [
      '`<script é` runs closed by one `>` each (multibyte)',
      (bytes) => fill(`${'<script é'.repeat(1000)}>`, bytes)
    ],
    [
      'jQuery inline scripts whose bodies hold `<`',
      (bytes) => {
        let out = '';
        for (let index = 0; out.length < bytes; index++)
          out += `<script>if(a<b<${String(index)}){jQuery(1)}</script>`;
        return out;
      }
    ],
    [
      'overlapping tag texts (replayed call by call, bounded)',
      (bytes) => {
        let out = '';
        for (let index = 0; out.length < bytes; index++) {
          const inner = `<script src="r${String(index)}.js">`;
          out += `<script src="q<script src="${inner}"></script>${inner}</script>`;
        }
        return out;
      }
    ],
    [
      'whitespace runs before `async` in a matched tag',
      (bytes) => `<script src="a.js"${' '.repeat(bytes)}x>`
    ]
  ])(
    '%s',
    (_name, build) => {
      expect(linearScaling(build, simulate).violation).toBeUndefined();
    },
    LINEAR_SCALING_TIMEOUT_MS
  );

  it(
    'a realistic page: comments, repeated scripts, jQuery inline code',
    () => {
      const block = `<!-- block --><p>${'text '.repeat(40)}</p><script src="/wp-content/plugins/p/a.js?ver=1"></script><script>jQuery(function(){var x=${'1'.repeat(100)};});</script>\n`;
      const page = (bytes: number): string =>
        `<!DOCTYPE html><html><head><title>t</title><!--[if lt IE 9]><script src="/h.js"></script><![endif]--></head><body>${fill(block, bytes)}</body></html>`;
      const scaling = linearScaling(page, simulate);
      expect(scaling.violation).toBeUndefined();
      expect(scaling.output?.report).toMatchObject({ state: 'simulated', deferred: 1, wrapped: 1 });
    },
    LINEAR_SCALING_TIMEOUT_MS
  );
});
