/**
 * The beacon runner bridge: publish/read round trip, refusal of anything
 * missing, malformed, dead or throwing, and the newest injection owning the page.
 */
import { describe, expect, it } from 'vitest';
import {
  BEACON_RUNNER_GLOBAL,
  publishBeaconRunner,
  readBeaconRunner,
  type BeaconRunner,
  type IsolatedWorld
} from './runner-bridge';

/** A runner whose liveness the test controls. */
function runner(alive: () => boolean = () => true): BeaconRunner {
  return {
    alive,
    start: () => ({
      done: Promise.resolve({ kind: 'failed', message: 'unused' }),
      partial: () => null,
      cancel: () => undefined
    })
  };
}

describe('runner bridge', () => {
  it('reads back the published live runner', () => {
    const world: IsolatedWorld = {};
    const published = runner();
    publishBeaconRunner(world, published);
    expect(readBeaconRunner(world)).toBe(published);
  });

  it.each([
    ['nothing', undefined],
    ['a primitive', 'runner'],
    ['a record missing start', { alive: () => true }],
    ['a record with non-function members', { alive: true, start: true }]
  ])('refuses %s', (_label, value) => {
    expect(readBeaconRunner({ [BEACON_RUNNER_GLOBAL]: value })).toBeNull();
  });

  it('refuses a dead runner and one whose liveness check throws', () => {
    expect(readBeaconRunner({ [BEACON_RUNNER_GLOBAL]: runner(() => false) })).toBeNull();
    const throwing = runner(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(readBeaconRunner({ [BEACON_RUNNER_GLOBAL]: throwing })).toBeNull();
  });

  it('lets the newest injection replace an earlier runner', () => {
    const world: IsolatedWorld = {};
    const older = runner();
    const newer = runner();
    publishBeaconRunner(world, older);
    publishBeaconRunner(world, newer);
    expect(readBeaconRunner(world)).toBe(newer);
  });
});
