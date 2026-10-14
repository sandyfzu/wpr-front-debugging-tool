/**
 * Pins the shared class fragments: the three motion moments must keep the
 * exact literals the UI/UX bar sanctions, and every one stays token-driven
 * (no literal durations/easings, no `transition-all`) so the global
 * reduced-motion collapse keeps reaching them.
 */
import { describe, expect, it } from 'vitest';
import { DISABLED, FOCUS_RING, MOTION_LIFT, MOTION_REVEAL, MOTION_TURN } from './classes';

/** The three motion constants, named for readable failures. */
const MOTION = { MOTION_REVEAL, MOTION_TURN, MOTION_LIFT };

describe('motion class constants', () => {
  it('pin the exact sanctioned literals', () => {
    expect(MOTION_REVEAL).toBe(
      'transition-opacity duration-[var(--motion-base)] ease-[var(--ease-entrance)] starting:opacity-0'
    );
    expect(MOTION_TURN).toBe(
      'transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)]'
    );
    expect(MOTION_LIFT).toBe(
      'transition-[box-shadow,border-color] duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:shadow-elev-2 hover:border-line-3'
    );
  });

  it.each(Object.entries(MOTION))('%s reads its timing from the motion tokens only', (_, value) => {
    expect(value).toMatch(/duration-\[var\(--motion-(fast|base|slow)\)\]/);
    expect(value).toMatch(/ease-\[var\(--ease-(standard|entrance)\)\]/);
    // The bar's grep gate, applied to the constants themselves.
    expect(value).not.toMatch(/transition-all|animate-|duration-[0-9]|\b(sm|md|lg|xl):/);
    expect(value).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|cubic-bezier|\d+ms/);
  });

  it('animate only compositor-friendly properties (no layout properties)', () => {
    expect(MOTION_REVEAL).toContain('transition-opacity');
    expect(MOTION_TURN).toContain('transition-transform');
    expect(MOTION_LIFT).toContain('transition-[box-shadow,border-color]');
    for (const value of Object.values(MOTION)) {
      expect(value).not.toMatch(/height|width|top|margin|translate/);
    }
  });

  it('carry no reduced-motion overrides of their own (tokens.css collapses them globally)', () => {
    for (const value of Object.values(MOTION)) {
      expect(value).not.toMatch(/motion-(safe|reduce):/);
    }
  });
});

describe('interaction class constants', () => {
  it('keep the focus ring keyboard-only and the disabled state hoverable', () => {
    expect(FOCUS_RING).toMatch(/^(focus-visible:\S+ ?)+$/);
    expect(DISABLED).not.toContain('pointer-events-none');
  });
});
