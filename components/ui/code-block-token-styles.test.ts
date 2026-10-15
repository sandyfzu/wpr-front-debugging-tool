/**
 * Token classes: deterministic names, the shape guard, and rule installation
 * once per class per root (document or shadow root).
 */
import { describe, expect, it } from 'vitest';
import {
  installTokenStyles,
  isTokenDeclarations,
  isTokenStyle,
  tokenClassName
} from './code-block-token-styles';

describe('tokenClassName', () => {
  it('names a declaration list deterministically', () => {
    expect(tokenClassName('color:red')).toBe(tokenClassName('color:red'));
    expect(tokenClassName('color:red')).not.toBe(tokenClassName('color:blue'));
    expect(tokenClassName('color:red')).toMatch(/^fdt-tk-[0-9a-z]+$/);
  });
});

describe('isTokenStyle', () => {
  it.each([
    [['fdt-tk-a1', 'color:light-dark(#cf222e, #ff7b72)'], true],
    [['fdt-tk-a1', 'color:light-dark(#CF222E,#FF7B72)'], true],
    [['fdt-tk-a1', 'color:#0550ae;font-style:italic'], true],
    [['fdt-tk-a1', 'color:red;font-style:italic'], true],
    [['fdt-tk-a1', 'font-weight:bold;text-decoration:underline'], true],
    [['fdt-tk-a1', 'background-image:url(https://evil.test/x.png)'], false],
    [['fdt-tk-a1', 'color:url(x)'], false],
    [['fdt-tk-a1', 'color:var(--x)'], false],
    [['fdt-tk-a1', 'color:light-dark(red, url(x))'], false],
    [['fdt-tk-a1', 'color:#12'], false],
    [['fdt-tk-a1', 'background:red'], false],
    [['fdt-tk-a1', 'color'], false],
    [['fdt-tk-a1', 'color:red;'], false],
    [['fdt-tk-A1', 'color:red'], false],
    [['other', 'color:red'], false],
    [['fdt-tk-a1', 'color:red}x{color:blue'], false],
    [['fdt-tk-a1', 'color:"x"'], false],
    [['fdt-tk-a1', ''], false],
    [['fdt-tk-a1'], false],
    ['fdt-tk-a1', false]
  ])('%j → %s', (style, expected) => {
    expect(isTokenStyle(style)).toBe(expected);
  });
});

describe('installTokenStyles', () => {
  it('adopts one sheet per root and inserts each valid class once', () => {
    const before = document.adoptedStyleSheets.length;
    installTokenStyles(document, [
      ['fdt-tk-one', 'color:red'],
      ['fdt-tk-two', 'color:blue'],
      ['bad', 'color:green']
    ]);
    installTokenStyles(document, [['fdt-tk-one', 'color:red']]);
    expect(document.adoptedStyleSheets.length).toBe(before + 1);
    const sheet = document.adoptedStyleSheets.at(-1);
    const rules = [...(sheet?.cssRules ?? [])].map((rule) => rule.cssText.replace(/\s/g, ''));
    expect(rules).toEqual(['.fdt-tk-one{color:red;}', '.fdt-tk-two{color:blue;}']);
  });

  it("keeps a root's existing adopted sheets when adding its own", () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const existing = new CSSStyleSheet();
    shadow.adoptedStyleSheets = [existing];
    installTokenStyles(shadow, [['fdt-tk-one', 'color:red']]);
    expect(shadow.adoptedStyleSheets).toHaveLength(2);
    expect(shadow.adoptedStyleSheets[0]).toBe(existing);
  });

  it('installs into a shadow root separately and ignores detached nodes', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    installTokenStyles(shadow, [['fdt-tk-one', 'color:red']]);
    expect(shadow.adoptedStyleSheets).toHaveLength(1);
    const detached = document.createElement('span');
    expect(() => {
      installTokenStyles(detached, [['fdt-tk-one', 'color:red']]);
    }).not.toThrow();
  });
});

describe('isTokenDeclarations', () => {
  it('accepts the declarations the real themes emit', () => {
    expect(isTokenDeclarations('color:light-dark(#24292E, #E1E4E8)')).toBe(true);
    expect(isTokenDeclarations('color:light-dark(#6A737D, #8b949e);font-style:italic')).toBe(true);
  });

  it('rejects anything outside the allow-list', () => {
    expect(isTokenDeclarations('')).toBe(false);
    expect(isTokenDeclarations('background-image:url(x)')).toBe(false);
    expect(isTokenDeclarations(':red')).toBe(false);
  });
});
