import { describe, expect, it } from 'vitest';
import { writeSimulationMarker } from './marker-write';

describe('writeSimulationMarker (inert until the marker lands)', () => {
  it('writes nothing, with or without an id', () => {
    const html = '<html><head></head><body></body></html>';
    expect(writeSimulationMarker(html, '0123456789abcdef0123456789abcdef', true)).toEqual({
      html,
      written: false
    });
    expect(writeSimulationMarker(html, undefined, false)).toEqual({ html, written: false });
  });
});
