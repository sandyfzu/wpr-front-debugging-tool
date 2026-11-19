/** The sections' open state: choice over seeded defaults over the built-in rule; one seed only. */
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createRucssSectionsState, type RucssSectionsState } from './sections';

/**
 * Run `body` with a fresh state inside a root.
 *
 * @param body The test body.
 */
function withState(body: (state: RucssSectionsState) => void): void {
  createRoot((dispose) => {
    body(createRucssSectionsState());
    dispose();
  });
}

describe('createRucssSectionsState', () => {
  it('opens only the request before anything is seeded', () => {
    withState((state) => {
      expect(state.isOpen('request')).toBe(true);
      expect(state.isOpen('keep')).toBe(false);
      expect(state.isOpen('adjust')).toBe(false);
    });
  });

  it('reads the seeded defaults, and only the first seed', () => {
    withState((state) => {
      state.seed({ request: false, keep: true, adjust: false });
      expect(state.isOpen('request')).toBe(false);
      expect(state.isOpen('keep')).toBe(true);
      state.seed({ request: true, keep: false, adjust: true });
      expect(state.isOpen('request')).toBe(false);
      expect(state.isOpen('keep')).toBe(true);
      expect(state.isOpen('adjust')).toBe(false);
    });
  });

  it('lets a choice win over the defaults, per section', () => {
    withState((state) => {
      state.seed({ request: true, keep: true, adjust: false });
      state.setOpen('keep', false);
      state.setOpen('adjust', true);
      expect(state.isOpen('keep')).toBe(false);
      expect(state.isOpen('adjust')).toBe(true);
      expect(state.isOpen('request')).toBe(true);
    });
  });

  it('keeps a choice made before the seed', () => {
    withState((state) => {
      state.setOpen('adjust', true);
      state.seed({ request: true, keep: false, adjust: false });
      expect(state.isOpen('adjust')).toBe(true);
      expect(state.isOpen('keep')).toBe(false);
    });
  });
});
