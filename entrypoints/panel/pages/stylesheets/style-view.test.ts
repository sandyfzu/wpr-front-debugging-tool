/**
 * The Stylesheets page's pure rules: chips per state (label, source, hover
 * text naming the feature), the "+N" split, row views and their reuse test,
 * seed heights, the cut line, and every page state the read machine maps to.
 */
import { describe, expect, it } from 'vitest';
import type { PageStylesheetsReply } from '../../../../lib/messaging/page-stylesheets';
import type { CssStyleResource } from '../../../../lib/panel/style-states';
import type { AskRunState, ShownAnswer } from '../ask-run';
import {
  STYLE_ROW_ESTIMATE,
  estimateStyleRow,
  listCutNote,
  mediaDetail,
  sameStyleRow,
  styleRowViews,
  styleStateChips,
  stylesheetsView,
  type StylesheetsOutcome
} from './style-view';

/** A classified row with overrides. */
function row(overrides: Partial<CssStyleResource> = {}): CssStyleResource {
  return {
    id: 0,
    type: 'external',
    source: 'live',
    elementId: '',
    className: '',
    href: 'https://s.test/a.css',
    media: '',
    preview: '',
    chars: 0,
    content: 'https://s.test/a.css',
    minified: false,
    critical: false,
    rocketAsync: false,
    hostedFont: false,
    ...overrides
  };
}

const REPLY: PageStylesheetsReply = { styles: [], total: 0 };

/** One answer on screen. */
function answer(outcome: StylesheetsOutcome, sequence = 1): ShownAnswer<StylesheetsOutcome> {
  return { outcome, page: 'p', provisional: false, sequence };
}

/** A machine state. */
function state(
  pending: boolean,
  shown: StylesheetsOutcome | null,
  failure: StylesheetsOutcome | null = null
): AskRunState<StylesheetsOutcome> {
  return {
    pending,
    shown: shown === null ? null : answer(shown),
    failure: failure === null ? null : answer(failure, 2)
  };
}

const GOOD: StylesheetsOutcome = { kind: 'reply', reply: REPLY };
const MISS: StylesheetsOutcome = { kind: 'page-unreachable', miss: 'timeout' };

describe('styleStateChips', () => {
  it('names each state in one word, most important first, with the feature on hover', () => {
    const chips = styleStateChips(
      row({ rocketAsync: true, minified: true, hostedFont: true, critical: true })
    );
    expect(chips.map((chip) => [chip.id, chip.label, chip.source])).toEqual([
      ['critical', 'Critical', 'wp-rocket'],
      ['async', 'Async', 'wp-rocket'],
      ['minified', 'Minified', 'wp-rocket'],
      ['font', 'Font', 'wp-rocket']
    ]);
    expect(chips.map((chip) => chip.title)).toEqual([
      'Critical-path CSS printed by WP Rocket (Load CSS asynchronously)',
      'Loaded without blocking rendering by WP Rocket (Load CSS asynchronously)',
      'Minified by WP Rocket (Minify CSS files)',
      'Google Fonts stylesheet served from the site by WP Rocket (Self-host Google Fonts)'
    ]);
    expect(
      styleStateChips(row({ type: 'inline', elementId: 'wpr-usedcss', href: '' }))[0]?.title
    ).toBe('The used CSS WP Rocket kept (Remove Unused CSS)');
    expect(
      styleStateChips(row({ type: 'inline', elementId: 'wpr-lazyload-bg-container' }))[0]?.title
    ).toBe('Printed by WP Rocket for LazyLoad CSS backgrounds');
    expect(styleStateChips(row())).toEqual([]);
  });

  it('attributes every state to WP Rocket (no FDT simulation or exclusion touches styles)', () => {
    const sources = [
      row({ rocketAsync: true, minified: true, hostedFont: true, critical: true }),
      row({ type: 'inline', elementId: 'wpr-usedcss', href: '' }),
      row({ type: 'inline', elementId: 'wpr-lazyload-bg-container' })
    ].flatMap((style) => styleStateChips(style).map((chip) => [chip.id, chip.source]));
    expect(Object.fromEntries(sources)).toEqual({
      critical: 'wp-rocket',
      async: 'wp-rocket',
      minified: 'wp-rocket',
      font: 'wp-rocket',
      rucss: 'wp-rocket',
      'lazy-bg': 'wp-rocket'
    });
  });
});

describe('styleRowViews', () => {
  it('splits a row past three chips into three and "+N", naming the hidden ones', () => {
    const [view] = styleRowViews([
      row({ rocketAsync: true, minified: true, hostedFont: true, critical: true })
    ]);
    expect(view?.chips.visible.map((chip) => chip.label)).toEqual([
      'Critical',
      'Async',
      'Minified'
    ]);
    // The hidden Font is WP Rocket's: the "+N" chip carries the rocket.
    expect(view?.chips.overflow).toEqual({
      label: '+1',
      title: 'Also: Font (WP Rocket)',
      hidesWpRocket: true
    });
  });

  it('builds the identity once per view', () => {
    const [view] = styleRowViews([row({ type: 'inline', elementId: 'a', className: 'b c' })]);
    expect(view?.identity).toBe('#a.b.c');
    expect(view?.chips.visible).toEqual([]);
  });
});

describe('mediaDetail', () => {
  it('hides no media and the default all, names anything else', () => {
    expect(mediaDetail('')).toBeNull();
    expect(mediaDetail(' ALL ')).toBeNull();
    expect(mediaDetail('print')).toBe('media: print');
    expect(mediaDetail(' (max-width: 600px) ')).toBe('media: (max-width: 600px)');
    expect(styleRowViews([row({ media: 'all' })])[0]?.mediaDetail).toBeNull();
  });
});

describe('sameStyleRow', () => {
  it('holds for equal fields and breaks on any shown or state field', () => {
    const [base] = styleRowViews([row()]);
    if (base === undefined) throw new Error('no view');
    expect(sameStyleRow(base, { ...base })).toBe(true);
    for (const change of [
      { type: 'inline' },
      { source: 'snapshot' },
      { elementId: 'x' },
      { className: 'x' },
      { href: 'x' },
      { media: 'print' },
      { preview: 'x' },
      { chars: 1 },
      { minified: true },
      { critical: true },
      { rocketAsync: true },
      { hostedFont: true }
    ] as const) {
      expect(sameStyleRow(base, { ...base, ...change }), JSON.stringify(change)).toBe(false);
    }
  });
});

describe('estimateStyleRow', () => {
  it('seeds each type with its own height', () => {
    const [external, inline] = styleRowViews([row(), row({ type: 'inline' })]);
    if (external === undefined || inline === undefined) throw new Error('no views');
    expect(estimateStyleRow(external)).toBe(STYLE_ROW_ESTIMATE.external);
    expect(estimateStyleRow(inline)).toBe(STYLE_ROW_ESTIMATE.inline);
  });
});

describe('listCutNote', () => {
  it('speaks only when the page has more styles than the list', () => {
    expect(listCutNote({ styles: [], total: 0 })).toBeNull();
    expect(listCutNote({ styles: new Array(2_000).fill(null) as never, total: 5_000 })).toBe(
      'Showing the first 2,000 of 5,000 styles.'
    );
  });
});

describe('stylesheetsView', () => {
  it('loads before the first answer', () => {
    expect(stylesheetsView(state(true, null), false)).toEqual({ status: 'loading' });
    expect(stylesheetsView(state(false, null), false)).toEqual({ status: 'loading' });
  });

  it('shows the list, refreshing while a newer read runs', () => {
    expect(stylesheetsView(state(false, GOOD), false)).toEqual({
      status: 'ready',
      reply: REPLY,
      refreshing: false,
      refreshMiss: null
    });
    expect(stylesheetsView(state(true, GOOD, MISS), false)).toEqual({
      status: 'ready',
      reply: REPLY,
      refreshing: true,
      refreshMiss: null
    });
  });

  it('keeps the list beside a refresh that missed', () => {
    expect(stylesheetsView(state(false, GOOD, MISS), false)).toEqual({
      status: 'ready',
      reply: REPLY,
      refreshing: false,
      refreshMiss: 'timeout'
    });
  });

  it('fails with the named miss while no list exists; a retry loads again', () => {
    expect(stylesheetsView(state(false, MISS), false)).toEqual({
      status: 'failed',
      miss: 'timeout'
    });
    expect(stylesheetsView(state(true, MISS), false)).toEqual({ status: 'loading' });
  });

  it('never shows a list of an earlier page load', () => {
    expect(stylesheetsView(state(true, GOOD), true)).toEqual({ status: 'loading' });
    expect(stylesheetsView(state(false, GOOD), true)).toEqual({ status: 'loading' });
    expect(stylesheetsView(state(false, GOOD, MISS), true)).toEqual({
      status: 'failed',
      miss: 'timeout'
    });
  });
});
