/** The image states: the local exclusion read and the state table. */
import { describe, expect, it } from 'vitest';
import { FDT_EXCLUDED_RESOURCE } from '../wp-rocket/constants';
import {
  LAZYLOAD_IMAGE_STATES,
  isFdtExcludedImage,
  lazyloadImageState,
  type LazyloadStateId
} from './lazyload-states';
import type { LazyloadImageResource } from './resources-view-model';

/** One image row with overrides. */
function image(overrides: Partial<LazyloadImageResource> = {}): LazyloadImageResource {
  return { id: 0, src: '/a.jpg', lazyloaded: false, excludedReasons: [], ...overrides };
}

describe('isFdtExcludedImage', () => {
  it('holds on a non-lazyloaded image carrying the marker, beside other reasons too', () => {
    expect(isFdtExcludedImage(image({ excludedReasons: [FDT_EXCLUDED_RESOURCE] }))).toBe(true);
    expect(
      isFdtExcludedImage(image({ excludedReasons: ['data-skip-lazy', FDT_EXCLUDED_RESOURCE] }))
    ).toBe(true);
  });

  it('a lazyloaded image was not kept out, whatever it carries', () => {
    expect(
      isFdtExcludedImage(image({ lazyloaded: true, excludedReasons: [FDT_EXCLUDED_RESOURCE] }))
    ).toBe(false);
  });

  it('page reasons alone are no FDT exclusion', () => {
    expect(isFdtExcludedImage(image({ excludedReasons: ['skip-lazy'] }))).toBe(false);
    expect(isFdtExcludedImage(image())).toBe(false);
  });
});

describe('LAZYLOAD_IMAGE_STATES', () => {
  it('lists the exclusion first, then Lazyloaded, each with a one-word label', () => {
    expect(LAZYLOAD_IMAGE_STATES.map(({ id, label }) => [id, label])).toEqual([
      ['excluded', 'Excluded'],
      ['lazyloaded', 'Lazyloaded']
    ]);
  });

  it('the two states never hold together', () => {
    for (const row of [
      image({ lazyloaded: true, excludedReasons: [FDT_EXCLUDED_RESOURCE] }),
      image({ excludedReasons: [FDT_EXCLUDED_RESOURCE] }),
      image({ lazyloaded: true }),
      image()
    ]) {
      expect(LAZYLOAD_IMAGE_STATES.filter((state) => state.holds(row)).length).toBeLessThan(2);
    }
  });

  it('looks a state up by id and fails fast on an unknown one', () => {
    expect(lazyloadImageState('lazyloaded').holds(image({ lazyloaded: true }))).toBe(true);
    expect(() => lazyloadImageState('nope' as LazyloadStateId)).toThrow(
      'Unknown image state id: "nope".'
    );
  });
});
