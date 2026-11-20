import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRules, type CssRule } from './css-rules.fixtures';

/**
 * Pins the one reduced-motion rule: `tokens.css` — imported by the page
 * layer (`theme.css`) and by every injected UI's shadow-root stylesheet —
 * drops animations and transitions outright (no entrance paints its `from`
 * frame on any surface) and keeps the duration collapse for timers that read
 * computed durations. The browser tier proves the rendered result; this pins
 * the declarations and who loads them.
 */

/** This test's directory: every relative path below resolves against it. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** The reduced-motion media prelude. */
const REDUCE = '@media (prefers-reduced-motion: reduce)';

/** The universal selectors the rule covers. */
const UNIVERSAL = ['*', '::before', '::after'];

/**
 * Read a repo file.
 *
 * @param file The path, relative to this test's directory.
 * @returns The file's UTF-8 text.
 */
function read(file: string): string {
  return readFileSync(join(HERE, file), 'utf8');
}

/**
 * The declarations a stylesheet makes under reduced motion, per universal selector.
 *
 * @param css The stylesheet text.
 * @returns Selector → its declarations inside the reduced-motion block.
 */
function reduceDeclarations(css: string): Map<string, CssRule['declarations']> {
  const found = new Map<string, CssRule['declarations']>();
  for (const rule of parseRules(css)) {
    if (rule.within.length !== 1 || rule.within[0] !== REDUCE) continue;
    found.set(rule.selector, [...(found.get(rule.selector) ?? []), ...rule.declarations]);
  }
  return found;
}

describe('reduced motion', () => {
  it('the token layer drops every animation and transition on every surface', () => {
    const declared = reduceDeclarations(read('tokens.css'));
    for (const selector of UNIVERSAL) {
      expect(declared.get(selector), selector).toEqual([
        ['animation-name', 'none !important'],
        ['animation-duration', '0.01ms !important'],
        ['animation-iteration-count', '1 !important'],
        ['transition-property', 'none !important'],
        ['transition-duration', '0.01ms !important'],
        ['scroll-behavior', 'auto !important']
      ]);
    }
  });

  it('the page layer re-declares nothing (one declaring site) and imports the tokens', () => {
    const css = read('theme.css');
    expect(reduceDeclarations(css).size).toBe(0);
    expect(css).toContain("@import './tokens.css';");
  });

  it('only the extension pages load the page layer; injected UIs import the tokens alone', () => {
    for (const page of [
      '../../entrypoints/panel/index.html',
      '../../entrypoints/options/index.html'
    ]) {
      expect(read(page), page).toContain('href="../../assets/css/theme.css"');
    }
    for (const injected of [
      '../../entrypoints/command-palette.content/styles.css',
      '../../entrypoints/exclusion-overlay.content/styles.css',
      '../../entrypoints/isolated.content/styles.css'
    ]) {
      const css = read(injected);
      expect(css, injected).toContain("@import '../../assets/css/tokens.css';");
      expect(css, injected).not.toContain('theme.css');
    }
  });
});
