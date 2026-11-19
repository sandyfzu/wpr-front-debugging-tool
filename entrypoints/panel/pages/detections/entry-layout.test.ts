/**
 * The Detections layout classes: each body per layout, the group surface and
 * one entry's grid (areas, line floors and the card surface) per shape.
 */
import { describe, expect, it } from 'vitest';
import {
  blockClass,
  CARDS_BODY,
  DETECTIONS_CONTROLS,
  DETECTIONS_LIST_COLUMN,
  entryClass,
  flatBodyClass,
  GROUP_HEADER,
  GROUP_SURFACE,
  GROUPED_BODY,
  ROWS_SURFACE
} from './entry-layout';

/** The class tokens of a class string. */
const tokens = (classes: string): string[] => classes.split(/\s+/u).filter(Boolean);

describe('bodies', () => {
  it('paints calm rows on one surface: 4 px gaps, no hairlines', () => {
    expect(tokens(ROWS_SURFACE)).toEqual(
      expect.arrayContaining(['flex', 'flex-col', 'gap-1', 'bg-surface-1'])
    );
    for (const body of [ROWS_SURFACE, CARDS_BODY, GROUP_SURFACE, GROUPED_BODY])
      expect(body).not.toMatch(/divide-|border-t/u);
  });

  it('bounds List to the reading column; Cards is a grid only from regular', () => {
    expect(flatBodyClass('list')).toBe(`${ROWS_SURFACE} ${DETECTIONS_LIST_COLUMN}`);
    expect(flatBodyClass('cards')).toBe(CARDS_BODY);
    expect(CARDS_BODY).toContain('@regular:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]');
    expect(tokens(CARDS_BODY).filter((token) => !token.startsWith('@regular:'))).toEqual(
      tokens(ROWS_SURFACE)
    );
  });

  it('flows groups in two balanced columns from wide, never splitting a group', () => {
    expect(tokens(GROUPED_BODY)).toContain('@wide:columns-2');
    expect(tokens(GROUP_SURFACE)).toEqual(expect.arrayContaining(['break-inside-avoid', 'mb-3']));
    // The last group's bottom margin is cancelled by the body.
    expect(tokens(GROUPED_BODY)).toContain('-mb-3');
    expect(tokens(GROUP_HEADER)).toContain('px-3.5');
  });

  it('bounds the blocks above the rows only in List', () => {
    expect(blockClass(DETECTIONS_CONTROLS, 'grouped')).toBe(DETECTIONS_CONTROLS);
    expect(blockClass(DETECTIONS_CONTROLS, 'cards')).toBe(DETECTIONS_CONTROLS);
    expect(blockClass(undefined, 'grouped')).toBeUndefined();
    expect(blockClass(DETECTIONS_CONTROLS, 'list')).toBe(
      `${DETECTIONS_CONTROLS} ${DETECTIONS_LIST_COLUMN}`
    );
    expect(blockClass(undefined, 'list')).toBe(DETECTIONS_LIST_COLUMN);
  });
});

describe('entryClass', () => {
  it('lays a plain one-line row on three areas with the 36 px floor', () => {
    const row = tokens(entryClass({ layout: 'grouped', hasLink: false, twoLine: false }));
    expect(row).toEqual(expect.arrayContaining(['min-h-9', 'px-3.5', 'rounded-lg']));
    expect(row).toContain('[grid-template-areas:"icon_main_state"]');
    expect(row.some((token) => token.startsWith('min-h-14.5'))).toBe(false);
    expect(row.some((token) => token.includes('border'))).toBe(false);
  });

  it('takes the 58 px floor for a note line', () => {
    expect(tokens(entryClass({ layout: 'list', hasLink: false, twoLine: true }))).toContain(
      'min-h-14.5'
    );
  });

  it('puts a row link under the name below regular, beside the state from regular', () => {
    const row = tokens(entryClass({ layout: 'grouped', hasLink: true, twoLine: false }));
    expect(row).toContain('[grid-template-areas:"icon_main_state"_"._link_."]');
    expect(row).toContain('@regular:[grid-template-areas:"icon_main_link_state"]');
    // A stacked link is a second line only where it stacks.
    expect(row).toContain('@max-regular:min-h-14.5');
    expect(row).not.toContain('min-h-14.5');
  });

  it('keeps List rows and Grouped rows identical', () => {
    for (const hasLink of [false, true])
      for (const twoLine of [false, true])
        expect(entryClass({ layout: 'list', hasLink, twoLine })).toBe(
          entryClass({ layout: 'grouped', hasLink, twoLine })
        );
  });

  it('makes a Cards entry a card from regular, its link always under the name', () => {
    const card = tokens(entryClass({ layout: 'cards', hasLink: true, twoLine: false }));
    expect(card).toEqual(
      expect.arrayContaining([
        '@regular:border',
        '@regular:border-line-1',
        '@regular:bg-surface-1',
        '@regular:h-full',
        'min-h-14.5'
      ])
    );
    expect(card).toContain('[grid-template-areas:"icon_main_state"_"._link_."]');
    expect(card.some((token) => token.includes('icon_main_link_state'))).toBe(false);
    const plain = tokens(entryClass({ layout: 'cards', hasLink: false, twoLine: false }));
    expect(plain).not.toContain('min-h-14.5');
    expect(plain).toContain('@regular:border');
  });
});
