/** The inventory's counts line (a cut list said so). */
import { describe, expect, it } from 'vitest';
import type { PageStyleEntry } from '../../../../lib/messaging/page-styles';
import { inventorySummary } from './styles-list';

const INLINE: PageStyleEntry = {
  kind: 'inline',
  id: '',
  className: '',
  href: '',
  media: '',
  preview: '',
  chars: 0
};

describe('inventorySummary', () => {
  it('counts each kind, singular and plural', () => {
    expect(inventorySummary({ styles: [INLINE], total: 1 })).toBe(
      '1 style · 1 inline · 0 stylesheet links'
    );
    expect(inventorySummary({ styles: [INLINE, { ...INLINE, kind: 'link' }], total: 2 })).toBe(
      '2 styles · 1 inline · 1 stylesheet link'
    );
  });

  it('says when the list was cut', () => {
    expect(inventorySummary({ styles: [INLINE], total: 2_500 })).toBe(
      '2,500 styles (first 1 listed) · 1 inline · 0 stylesheet links'
    );
  });
});
