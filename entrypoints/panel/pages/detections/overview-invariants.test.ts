/**
 * The overview model's broken-invariant guard: the bar's selectors never
 * answer "no data yet" for a loaded payload, so a tile that receives one
 * fails fast, naming the tile and the answer (the tiles' boundary contains
 * it). The selectors are mocked to produce the impossible answers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Selectors from '../../top-bar/selectors';
import { summarizeFdtData } from '../../../../lib/panel/detections-summary';
import { makeFdtData } from '../../state/fixtures';
import { cacheTile, stackTile, wprTile } from './overview';

/** The answer kind the mocked selectors return (null = the real answer). */
const forced = vi.hoisted(() => ({ kind: null as 'loading' | 'unavailable' | null }));

vi.mock('../../top-bar/selectors', async (importOriginal) => {
  const actual = await importOriginal<typeof Selectors>();
  return {
    ...actual,
    wprSegment: (...args: Parameters<typeof actual.wprSegment>) =>
      forced.kind === null ? actual.wprSegment(...args) : { kind: forced.kind },
    cacheSegment: (...args: Parameters<typeof actual.cacheSegment>) =>
      forced.kind === null ? actual.cacheSegment(...args) : { kind: forced.kind },
    platformSegment: (...args: Parameters<typeof actual.platformSegment>) =>
      forced.kind === 'loading' ? { kind: 'loading' } : actual.platformSegment(...args)
  };
});

afterEach(() => {
  forced.kind = null;
});

const DATA = makeFdtData();
const SUMMARY = summarizeFdtData(DATA).summary;

describe('overview tiles on an impossible "no data" answer', () => {
  it.each(['loading', 'unavailable'] as const)('the WP Rocket tile throws on %s', (kind) => {
    forced.kind = kind;
    expect(() => wprTile(DATA)).toThrow(
      `Overview WP Rocket tile: a loaded payload answered "${kind}".`
    );
  });

  it.each(['loading', 'unavailable'] as const)('the cache tile throws on %s', (kind) => {
    forced.kind = kind;
    expect(() => cacheTile(DATA, SUMMARY, 0)).toThrow(
      `Overview page cache tile: a loaded payload answered "${kind}".`
    );
  });

  it('the stack tile throws on loading', () => {
    forced.kind = 'loading';
    expect(() => stackTile(DATA, SUMMARY)).toThrow(
      'Overview stack tile: a loaded payload answered "loading".'
    );
  });

  it('answers normally with the real selectors', () => {
    expect(wprTile(DATA)).toEqual({ kind: 'not-detected' });
  });
});
