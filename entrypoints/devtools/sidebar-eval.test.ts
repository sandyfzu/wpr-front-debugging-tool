/**
 * The lazyload sidebar's eval pieces, pinned end to end: the built expression
 * runs against real (happy-dom) elements exactly like it will run against the
 * inspected page's `$0`, and the eval-callback result mapping guarantees the
 * pane always receives an object.
 */
import { describe, expect, it } from 'vitest';
import {
  buildLazyloadSidebarExpression,
  LAZYLOAD_SIDEBAR_EXPRESSION,
  sidebarEvalOutcome
} from './sidebar-eval';
import { LAZYLOAD_EXCLUSIONS_LIST } from '../../lib/wp-rocket/constants';

/**
 * Run a built expression the way `inspectedWindow.eval` would: `$0` in
 * scope, one object out. A two-parameter Function keeps the scope exactly
 * `$0`-only — proof the built string embeds everything it needs.
 *
 * @param expression The built eval expression (one self-contained IIFE).
 * @param selection The value devtools would inject as `$0`.
 * @returns What the expression returns for that selection.
 */
function runExpression(expression: string, selection: unknown): unknown {
  // Executing our own expression string is the behavior under test: the
  // string content is built entirely from code and constants in this repo —
  // no untrusted input — so Function-construction is the honest harness.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  return new Function('$0', `return (${expression});`)(selection);
}

describe('buildLazyloadSidebarExpression', () => {
  it('reports a lazyloaded IMG with its load state and src (parity shape)', () => {
    const img = document.createElement('img');
    img.setAttribute('src', 'https://site.test/hero.jpg');
    img.setAttribute('data-lazy-src', 'https://site.test/hero-lazy.jpg');
    expect(runExpression(buildLazyloadSidebarExpression([]), img)).toEqual({
      lazyloadDetected: true,
      imageLoaded: false,
      src: 'https://site.test/hero.jpg'
    });
  });

  it('marks an image loaded once the lazyload status attribute says so', () => {
    const img = document.createElement('img');
    img.setAttribute('src', 'https://site.test/hero.jpg');
    img.setAttribute('data-lazy-src', 'https://site.test/hero-lazy.jpg');
    img.setAttribute('data-ll-status', 'loaded');
    expect(runExpression(buildLazyloadSidebarExpression([]), img)).toEqual({
      lazyloadDetected: true,
      imageLoaded: true,
      src: 'https://site.test/hero.jpg'
    });
  });

  it('detects lazyload through data-lazy-srcset alone', () => {
    const img = document.createElement('img');
    img.setAttribute('src', 'https://site.test/hero.jpg');
    img.setAttribute('data-lazy-srcset', 'https://site.test/hero-2x.jpg 2x');
    const result = runExpression(buildLazyloadSidebarExpression([]), img) as {
      lazyloadDetected: boolean;
    };
    expect(result.lazyloadDetected).toBe(true);
  });

  it('lists the matched exclusions on a non-lazyloaded IMG, src absent as null', () => {
    const img = document.createElement('img');
    img.setAttribute('data-src', 'https://site.test/hero.jpg');
    // The exclusion substrings come from the embedded list — the fixture
    // must carry what real builds embed.
    expect(runExpression(buildLazyloadSidebarExpression(['data-src']), img)).toEqual({
      lazyloadDetected: false,
      excludedReasonsFound: ['data-src'],
      src: null
    });
    expect(runExpression(buildLazyloadSidebarExpression([]), img)).toEqual({
      lazyloadDetected: false,
      excludedReasonsFound: [],
      src: null
    });
  });

  it('keeps the parity key order of the IMG object in both branches', () => {
    const excluded = document.createElement('img');
    expect(
      Object.keys(
        runExpression(buildLazyloadSidebarExpression([]), excluded) as Record<string, unknown>
      )
    ).toEqual(['lazyloadDetected', 'excludedReasonsFound', 'src']);
    const detected = document.createElement('img');
    detected.setAttribute('data-lazy-src', 'https://site.test/hero.jpg');
    expect(
      Object.keys(
        runExpression(buildLazyloadSidebarExpression([]), detected) as Record<string, unknown>
      )
    ).toEqual(['lazyloadDetected', 'imageLoaded', 'src']);
  });

  it('matches quoted exclusions through the JSON embedding', () => {
    const img = document.createElement('img');
    img.setAttribute('class', 'ls-l slide');
    const result = runExpression(buildLazyloadSidebarExpression(['class="ls-l']), img) as {
      excludedReasonsFound: string[];
    };
    // The list is embedded via JSON.stringify: the double quote must arrive
    // intact inside the eval'd array, not break it.
    expect(result.excludedReasonsFound).toEqual(['class="ls-l']);
  });

  it('inventories the WP Rocket attributes of a non-IMG element', () => {
    const script = document.createElement('script');
    script.setAttribute('type', 'rocketlazyloadscript');
    script.setAttribute('data-rocket-src', 'https://site.test/app.js');
    script.setAttribute('data-rocket-defer', '');
    expect(runExpression(buildLazyloadSidebarExpression([]), script)).toEqual({
      rocketAttributes: ['data-rocket-src', 'data-rocket-defer', 'type=rocketlazyloadscript']
    });
  });

  it('inventories the MIME-like Delay JS type value verbatim', () => {
    const script = document.createElement('script');
    script.setAttribute('type', 'text/rocketlazyloadscript');
    const result = runExpression(buildLazyloadSidebarExpression([]), script) as {
      rocketAttributes: string[];
    };
    expect(result.rocketAttributes).toEqual(['type=text/rocketlazyloadscript']);
  });

  it('inventories the lazy-render, tool-exclusion and lazy-src markers in order', () => {
    const el = document.createElement('div');
    el.setAttribute('data-wpr-fdt-excluded', 'manual');
    el.setAttribute('data-lazy-src', 'https://site.test/pic.jpg');
    el.setAttribute('data-lazy-srcset', 'https://site.test/pic-2x.jpg 2x');
    el.setAttribute('data-wpr-lazyrender', '');
    expect(runExpression(buildLazyloadSidebarExpression([]), el)).toEqual({
      rocketAttributes: [
        'data-wpr-lazyrender',
        'data-wpr-fdt-excluded',
        'data-lazy-src',
        'data-lazy-srcset'
      ]
    });
  });

  it('answers the fallback object when nothing applies', () => {
    expect(
      runExpression(buildLazyloadSidebarExpression([]), document.createElement('div'))
    ).toEqual({ please: 'Select an element' });
  });

  it('treats non-element selections (or no selection) as the fallback', () => {
    for (const selection of [null, undefined, document.createTextNode('text')]) {
      expect(runExpression(buildLazyloadSidebarExpression([]), selection)).toEqual({
        please: 'Select an element'
      });
    }
  });

  it('treats whole documents and fragments as non-elements too', () => {
    // DevTools reports these without a nodeType of 1; all fall through the
    // same branch as text nodes.
    const selections: { name: string; node: unknown }[] = [
      { name: 'xml document', node: document.implementation.createDocument(null, '', null) },
      { name: 'html document', node: document.implementation.createHTMLDocument('') },
      { name: 'fragment', node: document.createDocumentFragment() }
    ];
    for (const { name, node } of selections) {
      expect(
        runExpression(buildLazyloadSidebarExpression([]), node),
        `selection kind: ${name}`
      ).toEqual({ please: 'Select an element' });
    }
  });

  it('reports imageLoaded false for any non-loaded lazyload status stamp', () => {
    const img = document.createElement('img');
    img.setAttribute('src', 'https://site.test/hero.jpg');
    img.setAttribute('data-lazy-src', 'https://site.test/hero-lazy.jpg');
    img.setAttribute('data-ll-status', 'loading');
    expect(runExpression(buildLazyloadSidebarExpression([]), img)).toEqual({
      lazyloadDetected: true,
      imageLoaded: false,
      src: 'https://site.test/hero.jpg'
    });
  });

  it('embeds the real exclusion list in the shipped expression', () => {
    // Behavioral pin: an IMG excluded by a list entry the detection engine
    // ships, matched against the very constant the pane carries.
    const img = document.createElement('img');
    img.setAttribute('class', 'skip-lazy');
    const result = runExpression(LAZYLOAD_SIDEBAR_EXPRESSION, img) as {
      excludedReasonsFound: string[];
    };
    // The list deliberately carries overlapping entries (`skip-lazy` and the
    // class-pinned variant); match-by-substring reports every match.
    expect(result.excludedReasonsFound).toEqual(['skip-lazy', 'class="skip-lazy"']);
    // And the embedded copy is the JSON of the full real list (24 entries).
    expect(LAZYLOAD_SIDEBAR_EXPRESSION).toContain(JSON.stringify([...LAZYLOAD_EXCLUSIONS_LIST]));
  });
});

describe('sidebarEvalOutcome', () => {
  it('passes a successful object result through unchanged', () => {
    const object = { lazyloadDetected: true, imageLoaded: false, src: null };
    expect(sidebarEvalOutcome(object, undefined)).toEqual({ object });
  });

  it('maps an in-page exception to an error object naming the thrown value', () => {
    const outcome = sidebarEvalOutcome(undefined, { isException: true, value: 'TypeError: boom' });
    expect(outcome.object).toEqual({ evalError: 'TypeError: boom' });
    expect(outcome.failure).toBe('TypeError: boom');
  });

  it('maps a DevTools-side failure to its code and description', () => {
    const outcome = sidebarEvalOutcome(undefined, {
      isError: true,
      code: 'E_NOTFOUND',
      description: 'Content script not found',
      details: []
    });
    expect(outcome.object).toEqual({ evalError: 'E_NOTFOUND: Content script not found' });
    expect(outcome.failure).toBe('E_NOTFOUND: Content script not found');
  });

  it('turns a missing object result into the error object as well', () => {
    const outcome = sidebarEvalOutcome(undefined, undefined);
    expect(outcome.object).toHaveProperty('evalError');
    expect(typeof outcome.failure).toBe('string');
  });

  it('rejects array results as non-object outcomes', () => {
    const outcome = sidebarEvalOutcome(['not', 'an object'], undefined);
    expect(outcome.object).toHaveProperty('evalError');
    expect(outcome.failure).toBeDefined();
  });
});
