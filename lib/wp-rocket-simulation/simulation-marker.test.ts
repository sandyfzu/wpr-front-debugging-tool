import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SimulationFactRow } from '../wp-rocket/types';
import {
  parseSimulationMarker,
  serializeSimulationMarker,
  SIMULATION_MARKER_LIMITS
} from './simulation-marker';
import { SIMULATED_FEATURES, type SimulatedFeatureId } from './spec';

const ID = '0123456789abcdef0123456789abcdef';

describe('simulation marker grammar', () => {
  it("names features by the detection rows' own ids", () => {
    expectTypeOf<SimulatedFeatureId>().toEqualTypeOf<SimulationFactRow>();
  });

  it('round-trips a note', () => {
    const content = serializeSimulationMarker({ features: ['delay_js'], markerId: ID });
    expect(content).toBe(`v1 delay_js=simulated id=${ID}`);
    expect(parseSimulationMarker(content ?? '')).toEqual({ features: ['delay_js'], markerId: ID });
  });

  it('serializes nothing the grammar cannot state', () => {
    expect(serializeSimulationMarker({ features: [], markerId: ID })).toBeNull();
    expect(serializeSimulationMarker({ features: ['delay_js'], markerId: 'ABC' })).toBeNull();
    expect(
      serializeSimulationMarker({ features: ['delay_js', 'delay_js'], markerId: ID })
    ).toBeNull();
    expect(
      serializeSimulationMarker({
        features: ['lazyload' as unknown as 'delay_js'],
        markerId: ID
      })
    ).toBeNull();
  });

  it('bounds hold every registry feature plus the id', () => {
    const all = serializeSimulationMarker({
      features: SIMULATED_FEATURES.map(({ id }) => id),
      markerId: ID
    });
    expect(all?.length).toBeLessThanOrEqual(SIMULATION_MARKER_LIMITS.chars);
    expect(all?.split(' ')).toHaveLength(SIMULATION_MARKER_LIMITS.tokens);
  });

  it.each([
    ['empty', ''],
    ['version only', 'v1'],
    ['no feature', `v1 id=${ID}`],
    ['no id', 'v1 delay_js=simulated'],
    ['other version', `v2 delay_js=simulated id=${ID}`],
    ['upper-case id', `v1 delay_js=simulated id=${ID.toUpperCase()}`],
    ['short id', `v1 delay_js=simulated id=${ID.slice(1)}`],
    ['long id', `v1 delay_js=simulated id=${ID}0`],
    ['id first', `v1 id=${ID} delay_js=simulated`],
    ['other state', `v1 delay_js=off id=${ID}`],
    ['unknown feature', `v1 lazyload=simulated id=${ID}`],
    ['repeated feature', `v1 delay_js=simulated delay_js=simulated id=${ID}`],
    ['double space', `v1  delay_js=simulated id=${ID}`],
    ['leading space', ` v1 delay_js=simulated id=${ID}`],
    ['trailing space', `v1 delay_js=simulated id=${ID} `],
    ['tab separator', `v1\tdelay_js=simulated id=${ID}`],
    ['inherited key', `v1 constructor=simulated id=${ID}`],
    ['oversized', `v1 delay_js=simulated id=${ID}${' '.repeat(200)}`]
  ])('rejects %s', (_case, content) => {
    expect(parseSimulationMarker(content)).toBeNull();
  });
});
