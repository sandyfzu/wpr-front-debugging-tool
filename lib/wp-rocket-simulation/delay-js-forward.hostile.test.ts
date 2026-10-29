/**
 * The forward transform runs synchronously on the document's critical
 * path, so it must stay linear on any page: 4 MiB pages shaped against
 * each scan WP Rocket's own regexes backtrack on (these shapes took
 * seconds to minutes before the scans were made linear), plus a
 * realistic comment-heavy page.
 */
import { describe, expect, it } from 'vitest';
import { HOSTILE_CEILING_MS } from '../../vitest.shared';
import { simulateDelayJs, type DelayJsForwardResult } from './delay-js-forward';

const MIB4 = 4 * 1024 * 1024;

/**
 * `unit` repeated to 4 MiB.
 *
 * @param unit The repeated text.
 */
const fill = (unit: string): string => unit.repeat(Math.ceil(MIB4 / unit.length));

/**
 * Simulate a page and time it.
 *
 * @param html The page.
 */
function timed(html: string): { readonly result: DelayJsForwardResult; readonly ms: number } {
  const started = performance.now();
  const result = simulateDelayJs({ html, runtime: 'R', ieFallback: 'F', listRows: [], rows: [] });
  return { result, ms: performance.now() - started };
}

describe('simulateDelayJs — linear on hostile 4 MiB pages', () => {
  it.each([
    [
      'a script conditional with a whitespace body',
      `<head></head><!--[if IE]><script a>${' '.repeat(MIB4)}x<![endif]-->`
    ],
    ['`<!--[if` with no `]`', `<head></head>${fill('<!--[if')}`],
    ['`<meta charset` repeated in the head', `<html><head>${fill('<meta charset')}</head>`],
    ['`<meta charset` repeated, no `<html>`', `${fill('<meta charset')}</head>`],
    ['`<meta ` repeated before one `charset`', `<head>${fill('<meta ')}charset</head>`],
    [
      '`http-equiv` metas sharing one far `>`',
      `<html><head>${fill('<meta http-equiv=x Content-Type"charset ')}</head>`
    ],
    ['`<head` with no `>`', fill('<head')],
    ['`<head ` with no `>`', fill('<head ')],
    ['`<html ` with no `>` before a charset meta', `${fill('<html ')}<meta charset="x"></head>`],
    ['`<script` openings before one far `>`', `<head></head>${fill('<script')}>`],
    ['comments with no `--!>`', `<head></head>${fill('<!-- x -->')}`],
    [
      'conditionals that keep overwriting the page start',
      `<html><head><meta <!--[if a]>x<![endif]--> charset=utf-8></head><body></body></html>${fill('<!--[if a]><!--{{WP_ROCKET_CONDITIONAL}}--><![endif]--><!--[if b]>y<![endif]-->')}`
    ]
  ])('%s', (_name, html) => {
    const { ms } = timed(html);
    expect(ms).toBeLessThan(HOSTILE_CEILING_MS);
  });

  it('a realistic page: comments, scripts, svgs, body metas, a head conditional', () => {
    const block = `<!-- block --><p>${'text '.repeat(40)}</p><script src="/wp-content/plugins/p/a.js?ver=1"></script><script>var x=${'1'.repeat(200)};</script><svg><path d="M0 0"/></svg><meta itemprop="position" content="1">\n`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><!--[if lt IE 9]><script src="/h.js"></script><![endif]--></head><body>${fill(block)}</body></html>`;
    const { result, ms } = timed(html);
    expect(result.report.state).toBe('simulated');
    expect(result.report.delayed).toBeGreaterThan(10_000);
    expect(ms).toBeLessThan(HOSTILE_CEILING_MS);
  });
});
