/**
 * Pins the shared class fragments: the two motion moments keep the exact
 * literals the UI/UX bar sanctions (token-driven, so the global reduced-motion
 * collapse reaches them) — any drift fails here.
 */
import { describe, expect, it } from 'vitest';
import { DISABLED, FOCUS_RING, KEY_CHIP, MOTION_REVEAL, MOTION_TURN } from './classes';

describe('motion class constants', () => {
  it('pin the exact sanctioned literals', () => {
    expect(MOTION_REVEAL).toBe(
      'transition-opacity duration-[var(--motion-base)] ease-[var(--ease-entrance)] starting:opacity-0'
    );
    expect(MOTION_TURN).toBe(
      'transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)]'
    );
  });
});

describe('interaction class constants', () => {
  it('keep the focus ring keyboard-only and the disabled state hoverable', () => {
    expect(FOCUS_RING).toMatch(/^(focus-visible:\S+ ?)+$/);
    expect(DISABLED).not.toContain('pointer-events-none');
  });
});

describe('key chip', () => {
  it('is a quiet hairline box in the sans stack at meta size, token colors only', () => {
    for (const fragment of [
      'rounded-sm',
      'border-line-2',
      'bg-surface-1',
      'font-sans',
      'text-2xs',
      'text-fg-muted'
    ]) {
      expect(KEY_CHIP.split(' ')).toContain(fragment);
    }
    expect(KEY_CHIP).not.toMatch(/#|rgb|transition/);
  });
});
