/**
 * The inventory's row views: names (file name, identity, ordinal among
 * inline styles only), preview lines (identity + full URL, media first, the
 * empty forms), inline sizes and size bars, and the Test result chip on the injected style only.
 */
import { describe, expect, it } from 'vitest';
import type { PageStyleEntry } from '../../../../lib/messaging/page-styles';
import { RUCSS_RESULT_STYLE_ID } from '../../../../lib/rucss-tester/run-plan';
import { NO_STATE_CHIPS } from '../resource-list/state-chips';
import { EMPTY_STYLE_PREVIEW, NO_HREF_NAME } from '../resource-list/style-words';
import { inventoryRowView, inventoryRowViews, isTestResult, TEST_RESULT_CHIP } from './styles-view';

const INLINE: PageStyleEntry = {
  kind: 'inline',
  id: '',
  className: '',
  href: '',
  media: '',
  preview: 'a{color:red}',
  chars: 12
};

const LINK: PageStyleEntry = {
  kind: 'link',
  id: 'theme-css',
  className: '',
  href: 'https://a.test/wp-content/themes/t/style.css?ver=1',
  media: '',
  preview: '',
  chars: 0
};

describe('inventoryRowView — links', () => {
  it('names a link by its file and previews its identity and full URL', () => {
    expect(inventoryRowView(LINK, 0, 12)).toEqual({
      kind: 'link',
      name: 'style.css',
      monoName: false,
      preview: '#theme-css · https://a.test/wp-content/themes/t/style.css?ver=1',
      size: undefined,
      sizeShare: undefined,
      chips: NO_STATE_CHIPS
    });
  });

  it('leads with the media, and drops an absent identity', () => {
    expect(inventoryRowView({ ...LINK, id: '', media: 'print' }, 0, 12).preview).toBe(
      'media: print · https://a.test/wp-content/themes/t/style.css?ver=1'
    );
  });

  it('hides the default media all, like the Stylesheets page', () => {
    expect(inventoryRowView({ ...LINK, media: ' all ' }, 0, 12).preview).toBe(
      '#theme-css · https://a.test/wp-content/themes/t/style.css?ver=1'
    );
    expect(inventoryRowView({ ...INLINE, media: 'ALL' }, 1, 12).preview).toBe('a{color:red}');
  });

  it('says a link has no address in its name and preview', () => {
    const view = inventoryRowView({ ...LINK, id: '', href: '' }, 0, 12);
    expect(view.name).toBe(NO_HREF_NAME);
    expect(view.preview).toBe(NO_HREF_NAME);
  });

  it('never marks a link as the test result, even with the result id', () => {
    const link = { ...LINK, id: RUCSS_RESULT_STYLE_ID };
    expect(isTestResult(link)).toBe(false);
    expect(inventoryRowView(link, 0, 12).chips).toBe(NO_STATE_CHIPS);
  });
});

describe('inventoryRowView — inline styles', () => {
  it('names an anonymous style by its ordinal, its CSS start as preview, its size compact', () => {
    expect(inventoryRowView(INLINE, 3, 12)).toEqual({
      kind: 'inline',
      name: 'Inline style #3',
      monoName: false,
      preview: 'a{color:red}',
      size: '12',
      sizeShare: 1,
      chips: NO_STATE_CHIPS
    });
    expect(inventoryRowView({ ...INLINE, chars: 18_600 }, 1, 12).size).toBe('18.6K');
  });

  it('sizes the bar against the list’s largest inline style (none when empty or unscaled)', () => {
    expect(inventoryRowView({ ...INLINE, chars: 3 }, 1, 12).sizeShare).toBe(0.5);
    expect(inventoryRowView({ ...INLINE, chars: 0 }, 1, 12).sizeShare).toBeUndefined();
    expect(inventoryRowView(INLINE, 1, 0).sizeShare).toBeUndefined();
  });

  it('names a style by its identity, in mono', () => {
    const view = inventoryRowView({ ...INLINE, id: 'x', className: ' a  b ' }, 1, 12);
    expect(view.name).toBe('#x.a.b');
    expect(view.monoName).toBe(true);
  });

  it('says an empty style is empty, sized 0, media first', () => {
    const view = inventoryRowView({ ...INLINE, preview: '', chars: 0, media: 'screen' }, 1, 12);
    expect(view.preview).toBe(`media: screen · ${EMPTY_STYLE_PREVIEW}`);
    expect(view.size).toBe('0');
  });

  it('chips the injected result style only', () => {
    const result = { ...INLINE, id: RUCSS_RESULT_STYLE_ID };
    expect(isTestResult(result)).toBe(true);
    expect(inventoryRowView(result, 1, 12).chips).toEqual({
      visible: [TEST_RESULT_CHIP],
      overflow: null
    });
    expect(isTestResult(INLINE)).toBe(false);
  });
});

describe('inventoryRowViews', () => {
  it('numbers inline styles among themselves, in list order', () => {
    const views = inventoryRowViews([INLINE, LINK, INLINE, { ...INLINE, id: 'named' }, INLINE]);
    expect(views.map((view) => view.name)).toEqual([
      'Inline style #1',
      'style.css',
      'Inline style #2',
      '#named',
      'Inline style #4'
    ]);
  });

  it('scales every inline bar to the largest inline style; links draw none', () => {
    const views = inventoryRowViews([
      { ...INLINE, chars: 400 },
      LINK,
      { ...INLINE, chars: 100 },
      { ...INLINE, chars: 0 }
    ]);
    expect(views.map((view) => view.sizeShare)).toEqual([1, undefined, 0.5, undefined]);
  });

  it('maps an empty list to no rows', () => {
    expect(inventoryRowViews([])).toEqual([]);
  });
});
