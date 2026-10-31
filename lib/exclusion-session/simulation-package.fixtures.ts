/**
 * Test fixture: a version's LazyLoad package as the packaged data gives it
 * (short texts in WP Rocket's shapes; the pin names no real file).
 */
import type { SimulationLazyloadPackage } from './simulation-sources';

/** A LazyLoad package with WP Rocket-shaped texts and one literal of each kind. */
export const LAZYLOAD_PACKAGE_FIXTURE: SimulationLazyloadPackage = {
  noJsStyle:
    '<noscript><style id="rocket-lazyload-nojs-css">[data-lazy-src]{display:none !important;}</style></noscript>',
  optionsScript:
    '<script>window.lazyLoadOptions=[{elements_selector:"img[data-lazy-src]"}];</script>',
  runtimeTagBeforeUrl: '<script data-no-minify="1" async src="',
  runtimeTagAfterUrl: '"></script>',
  runtimeJsPath: 'lazyload/17.8.3/lazyload.min.js',
  excludedAttributes: ['data-no-lazy='],
  excludedSrc: ['/wpcf7_captcha/'],
  runtime: { sha256: '0'.repeat(64), bytes: 1 }
};
