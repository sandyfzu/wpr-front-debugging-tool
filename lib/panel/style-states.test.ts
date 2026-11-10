/**
 * The style states: page facts off the detection record, the Minified rule
 * (verdict + footprint, stamp only under proof), the live Critical rule, the
 * id-based states and the state table.
 */
import { describe, expect, it } from 'vitest';
import type { WprDetections } from '../wp-rocket/types';
import { ALL, MINIFIED, MOVED, inline, link, rows, statesOf } from './stylesheet.fixtures';
import {
  CSS_STYLE_STATES,
  cssStyleState,
  isLiveCriticalStyle,
  isStylesheetMinified,
  sameStylesheetPageFacts,
  stylesheetPageFacts,
  type CssStateId
} from './style-states';

describe('stylesheetPageFacts', () => {
  /** A record shape with just the rows the facts read. */
  const detections = (minify: boolean, wpr: boolean, critical: boolean): WprDetections =>
    ({
      wpr: { present: wpr },
      minify_css: { present: minify },
      async_css: { present: false, criticalStyle: critical }
    }) as unknown as WprDetections;

  it('reads the three verdicts as given', () => {
    expect(stylesheetPageFacts(detections(true, false, true))).toEqual({
      minifyCss: true,
      wprProven: false,
      criticalStyle: true
    });
    expect(stylesheetPageFacts(detections(false, true, false))).toEqual({
      minifyCss: false,
      wprProven: true,
      criticalStyle: false
    });
  });

  it('compares fact sets field by field', () => {
    expect(sameStylesheetPageFacts(ALL, { ...ALL })).toBe(true);
    for (const key of ['minifyCss', 'wprProven', 'criticalStyle'] as const) {
      expect(sameStylesheetPageFacts(ALL, { ...ALL, [key]: false }), key).toBe(false);
    }
  });
});

describe('isStylesheetMinified', () => {
  it('reads the cache URL under the Minify CSS verdict alone', () => {
    expect(isStylesheetMinified(link({ href: MINIFIED }), { ...ALL, wprProven: false })).toBe(true);
    expect(isStylesheetMinified(link({ href: MINIFIED }), { ...ALL, minifyCss: false })).toBe(
      false
    );
  });

  it('counts the stamp alone only where WP Rocket is proven', () => {
    const stamped = link({ href: MOVED, minifyAttribute: true });
    expect(isStylesheetMinified(stamped, ALL)).toBe(true);
    expect(isStylesheetMinified(stamped, { ...ALL, wprProven: false })).toBe(false);
    expect(isStylesheetMinified(stamped, { ...ALL, minifyCss: false })).toBe(false);
    expect(isStylesheetMinified(link({ href: MOVED }), ALL)).toBe(false);
  });

  it('never reads an inline style, a URL-less link or a JavaScript cache URL', () => {
    expect(isStylesheetMinified(inline({ minifyAttribute: true, href: MINIFIED }), ALL)).toBe(
      false
    );
    expect(isStylesheetMinified(link({ href: '', minifyAttribute: true }), ALL)).toBe(false);
    expect(
      isStylesheetMinified(link({ href: 'https://s.test/wp-content/cache/min/1/a.js' }), ALL)
    ).toBe(false);
  });
});

describe('isLiveCriticalStyle', () => {
  it('needs the snapshot fact, an inline style and the exact id', () => {
    const critical = inline({ id: 'rocket-critical-css' });
    expect(isLiveCriticalStyle(critical, ALL)).toBe(true);
    expect(isLiveCriticalStyle(critical, { ...ALL, criticalStyle: false })).toBe(false);
    expect(isLiveCriticalStyle(inline({ id: 'Rocket-Critical-CSS' }), ALL)).toBe(false);
    expect(isLiveCriticalStyle(link({ id: 'rocket-critical-css' }), ALL)).toBe(false);
  });
});

describe('the state table', () => {
  it('reads each state from WP Rocket’s own markup only', () => {
    const facts = { ...ALL, criticalStyle: false };
    const built = rows(
      [
        inline({ id: 'wpr-usedcss' }),
        inline({ id: 'wpr-lazyload-bg-container' }),
        inline({ id: 'wpr-lazyload-bg-exclusion' }),
        inline({ id: 'WPR-USEDCSS' }),
        link({ href: MINIFIED, rocketAsync: true }),
        link({ hostedFont: true }),
        link({ id: 'wpr-usedcss' })
      ],
      facts
    );
    expect(built.map(statesOf)).toEqual([
      ['rucss'],
      ['lazy-bg'],
      ['lazy-bg'],
      [],
      ['async', 'minified'],
      ['font'],
      []
    ]);
  });

  it('orders the chips most important first and spells them in one word', () => {
    expect(CSS_STYLE_STATES.map((state) => [state.id, state.label])).toEqual([
      ['critical', 'Critical'],
      ['rucss', 'RUCSS'],
      ['lazy-bg', 'Lazy BG'],
      ['async', 'Async'],
      ['minified', 'Minified'],
      ['font', 'Font']
    ]);
  });

  it('finds a state by id and fails loudly on an unknown one', () => {
    expect(cssStyleState('font').label).toBe('Font');
    expect(() => cssStyleState('combined' as CssStateId)).toThrow('Unknown style state id');
  });
});
