/**
 * The forward transform runs synchronously on the document's critical
 * path, so it must stay linear on any page: pages shaped against each
 * scan WP Rocket's own regexes backtrack on (these shapes took seconds to
 * minutes before the scans were made linear), plus a realistic
 * comment-heavy page — each timed at 1 and 4 MiB.
 */
import { describe, expect, it } from 'vitest';
import { linearScaling } from '../../vitest.shared';
import { simulateDelayJs, type DelayJsForwardResult } from './delay-js-forward';

/**
 * `unit` repeated to `bytes`.
 *
 * @param unit The repeated text.
 * @param bytes The target length.
 */
const fill = (unit: string, bytes: number): string => unit.repeat(Math.ceil(bytes / unit.length));

/**
 * Simulate a page.
 *
 * @param html The page.
 */
const simulate = (html: string): DelayJsForwardResult =>
  simulateDelayJs({ html, runtime: 'R', ieFallback: 'F', listRows: [], rows: [] });

describe('simulateDelayJs — linear on hostile pages', () => {
  it.each<[string, (bytes: number) => string]>([
    [
      'a script conditional with a whitespace body',
      (bytes) => `<head></head><!--[if IE]><script a>${' '.repeat(bytes)}x<![endif]-->`
    ],
    ['`<!--[if` with no `]`', (bytes) => `<head></head>${fill('<!--[if', bytes)}`],
    [
      '`<meta charset` repeated in the head',
      (bytes) => `<html><head>${fill('<meta charset', bytes)}</head>`
    ],
    ['`<meta charset` repeated, no `<html>`', (bytes) => `${fill('<meta charset', bytes)}</head>`],
    [
      '`<meta ` repeated before one `charset`',
      (bytes) => `<head>${fill('<meta ', bytes)}charset</head>`
    ],
    [
      '`http-equiv` metas sharing one far `>`',
      (bytes) => `<html><head>${fill('<meta http-equiv=x Content-Type"charset ', bytes)}</head>`
    ],
    ['`<head` with no `>`', (bytes) => fill('<head', bytes)],
    ['`<head ` with no `>`', (bytes) => fill('<head ', bytes)],
    [
      '`<html ` with no `>` before a charset meta',
      (bytes) => `${fill('<html ', bytes)}<meta charset="x"></head>`
    ],
    ['`<script` openings before one far `>`', (bytes) => `<head></head>${fill('<script', bytes)}>`],
    ['comments with no `--!>`', (bytes) => `<head></head>${fill('<!-- x -->', bytes)}`],
    [
      'conditionals that keep overwriting the page start',
      (bytes) =>
        `<html><head><meta <!--[if a]>x<![endif]--> charset=utf-8></head><body></body></html>${fill('<!--[if a]><!--{{WP_ROCKET_CONDITIONAL}}--><![endif]--><!--[if b]>y<![endif]-->', bytes)}`
    ]
  ])('%s', (_name, build) => {
    expect(linearScaling(build, simulate).violation).toBeUndefined();
  });

  it('a realistic page: comments, scripts, svgs, body metas, a head conditional', () => {
    const block = `<!-- block --><p>${'text '.repeat(40)}</p><script src="/wp-content/plugins/p/a.js?ver=1"></script><script>var x=${'1'.repeat(200)};</script><svg><path d="M0 0"/></svg><meta itemprop="position" content="1">\n`;
    const page = (bytes: number): string =>
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><!--[if lt IE 9]><script src="/h.js"></script><![endif]--></head><body>${fill(block, bytes)}</body></html>`;
    const scaling = linearScaling(page, simulate);
    expect(scaling.violation).toBeUndefined();
    expect(scaling.output?.report.state).toBe('simulated');
    expect(scaling.output?.report.delayed).toBeGreaterThan(10_000);
  });
});
