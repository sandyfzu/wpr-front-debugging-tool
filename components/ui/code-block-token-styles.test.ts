/**
 * Token classes: deterministic names, the shape guard, and rule installation
 * once per class per root (document or shadow root).
 */
import { describe, expect, it } from 'vitest';
import { installTokenStyles, isTokenStyle, tokenClassName } from './code-block-token-styles';

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
    [['fdt-tk-a1', 'color:red;font-style:italic'], true],
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
