import { describe, expect, it } from 'vitest';
import { applyTheme, isAppearance, nextAppearance, resolveTheme, type Appearance } from './theme';

describe('isAppearance (the vocabulary guard)', () => {
  it('accepts exactly the three documented choices', () => {
    expect(isAppearance('system')).toBe(true);
    expect(isAppearance('dark')).toBe(true);
    expect(isAppearance('light')).toBe(true);
  });

  it('rejects values typed wider than the vocabulary', () => {
    expect(isAppearance('neon')).toBe(false);
    expect(isAppearance('')).toBe(false);
    expect(isAppearance(true)).toBe(false);
    expect(isAppearance(0)).toBe(false);
    expect(isAppearance(null)).toBe(false);
    expect(isAppearance(undefined)).toBe(false);
    // Casing is not forgiven: the vocabulary is exact.
    expect(isAppearance('Dark')).toBe(false);
  });
});

describe('nextAppearance (the keyboard cycle)', () => {
  it('walks the registry order and wraps system → dark → light → system', () => {
    expect(nextAppearance('system')).toBe('dark');
    expect(nextAppearance('dark')).toBe('light');
    expect(nextAppearance('light')).toBe('system');
  });

  it('names the offending value for a choice outside the registry', () => {
    expect(() => nextAppearance('neon' as Appearance)).toThrow(new RegExp("unknown choice 'neon'"));
  });
});

describe('resolveTheme', () => {
  it('explicit dark/light win over the system preference', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('system follows the OS scheme', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('applyTheme', () => {
  // Attribute-level behavior with a real DOM (happy-dom via the test environment).
  it('sets data-theme on the root element', () => {
    const root = document.documentElement;
    applyTheme(root, 'light');
    expect(root.getAttribute('data-theme')).toBe('light');
    applyTheme(root, 'dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('clears the attribute for system (media query takes over)', () => {
    const root = document.documentElement;
    root.dataset.theme = 'dark';
    applyTheme(root, null);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('declares system on injected containers, where the media query cannot rule', () => {
    // Inside a shadow root the mount's :host isolation reset aborts the scheme
    // chain; the container must carry the choice itself — system as "system",
    // whose tokens rule declares `color-scheme: light dark` (live-following).
    const container = document.createElement('div');
    applyTheme(container, 'system');
    expect(container.getAttribute('data-theme')).toBe('system');
  });
});
