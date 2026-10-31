/** Whether a served page already delays its scripts with WP Rocket. */
import { describe, expect, it } from 'vitest';
import { alreadyServesDelayJs } from './already-served';

describe('alreadyServesDelayJs', () => {
  it.each([
    [
      'the generator meta declaring Delay JS',
      '<meta name="generator" content="WP Rocket 3.24" data-wpr-features="wpr_defer_js wpr_delay_js">'
    ],
    ['a delay type', '<script type="text/rocketlazyloadscript" data-rocket-src="/a.js"></script>'],
    ['the old delay type', '<script type="rocketlazyloadscript">x()</script>'],
    ['a data-rocket-src', '<script data-rocket-src="/a.js"></script>'],
    [
      'the controller run in an inline body',
      '<script>(()=>{class RocketLazyLoadScripts{}RocketLazyLoadScripts.run();})();</script>'
    ]
  ])('reads %s as served', (_name, markup) => {
    expect(alreadyServesDelayJs(`<html><head>${markup}</head><body></body></html>`)).toBe(true);
  });

  it.each([
    ['no footprint', '<script src="/a.js"></script><script>var a;</script>'],
    ['a meta without the token', '<meta name="generator" data-wpr-features="wpr_defer_js">'],
    ['the token on another meta', '<meta name="description" data-wpr-features="wpr_delay_js">'],
    ['a name in prose', '<p>RocketLazyLoadScripts.run() and type="text/rocketlazyloadscript"</p>'],
    ['a name in <pre>', '<pre>&lt;script type="text/rocketlazyloadscript"&gt;</pre>'],
    ['a name in a comment', '<!-- <script type="text/rocketlazyloadscript"></script> -->'],
    ['a name in an attribute', '<div data-x=\'<script data-rocket-src="/a.js"></script>\'></div>'],
    ['the controller named, not run', '<script>if (window.RocketLazyLoadScripts) {}</script>'],
    [
      'a footprint inside a masked svg',
      '<svg><script type="text/rocketlazyloadscript">x</script></svg>'
    ],
    ['a footprint inside a masked xmp', '<xmp><script data-rocket-src="/a.js"></script></xmp>'],
    ['another plugin’s delay type', '<script type="text/x-delayed">x</script>']
  ])('reads %s as not served', (_name, markup) => {
    expect(alreadyServesDelayJs(`<html><head></head><body>${markup}</body></html>`)).toBe(false);
  });

  it('counts a footprint after a masked region', () => {
    expect(
      alreadyServesDelayJs('<svg><p>x</p></svg><script data-rocket-src="/a.js"></script>')
    ).toBe(true);
  });
});
