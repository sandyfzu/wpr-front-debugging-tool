import { describe, expect, it } from 'vitest';
import { OVERLAY_MODES } from './modes';
import { ExclusionsConfig } from './exclusions/mode';

describe('OVERLAY_MODES', () => {
  it('ships the Exclusions mode first, its counts inline (no results panel)', () => {
    expect(OVERLAY_MODES[0]).toEqual({
      id: 'exclusions',
      label: 'Exclusions',
      Config: ExclusionsConfig,
      Results: null
    });
  });

  it('keeps mode ids unique (one row per tool)', () => {
    const ids = OVERLAY_MODES.map((mode) => mode.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
