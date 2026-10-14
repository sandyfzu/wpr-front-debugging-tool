/**
 * Pins the shared class fragments: the three motion moments keep the exact
 * literals the UI/UX bar sanctions (token-driven, so the global reduced-motion
 * collapse reaches them) — any drift fails here.
 */
import { describe, expect, it } from 'vitest';
import { DISABLED, FOCUS_RING, MOTION_LIFT, MOTION_REVEAL, MOTION_TURN } from './classes';

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
});

describe('interaction class constants', () => {
  it('keep the focus ring keyboard-only and the disabled state hoverable', () => {
    expect(FOCUS_RING).toMatch(/^(focus-visible:\S+ ?)+$/);
    expect(DISABLED).not.toContain('pointer-events-none');
  });
});
