/**
 * The Stylesheets page's pure rules: chips per state (label, source, hover
 * text naming the feature), the row views (names, previews, sizes and bars,
 * the "+N" split), content keys and the reuse tests, the detail's kind and
 * facts, the cut line, and every page state the read machine maps to.
 */
import { describe, expect, it } from 'vitest';
import type { PageStylesheetsReply } from '../../../../lib/messaging/page-stylesheets';
import type { CssStyleResource } from '../../../../lib/panel/style-states';
import type { AskRunState, ShownAnswer } from '../ask-run';
import {
  CRITICAL_SNAPSHOT_NOTE,
  EMPTY_STYLE_PREVIEW,
  NO_HREF_NAME,
  SNAPSHOT_ROW_KEY,
  listCutNote,
  mediaDetail,
  sameStyleRow,
  sameStyleView,
  sizeShare,
  styleFacts,
  styleKind,
  styleRowKeys,
  styleRowViews,
  styleSearchField,
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
    minifyAttribute: false,
    critical: false,
    rocketAsync: false,
    hostedFont: false,
    ...overrides
  };
}

const REPLY: PageStylesheetsReply = { styles: [], total: 0, snapshotId: 'a'.repeat(32) };

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
  it('splits a row past two chips into two and "+N", keeping every chip for the detail', () => {
    const [view] = styleRowViews([
      row({ rocketAsync: true, minified: true, hostedFont: true, critical: true })
    ]);
    expect(view?.rowChips.visible.map((chip) => chip.label)).toEqual(['Critical', 'Async']);
    // The hidden ones are WP Rocket's: the "+N" chip carries the rocket.
    expect(view?.rowChips.overflow).toEqual({
      label: '+2',
      title: 'Also: Minified (WP Rocket), Font (WP Rocket)',
      hidesWpRocket: true
    });
    expect(view?.chips.map((chip) => chip.id)).toEqual(['critical', 'async', 'minified', 'font']);
  });

  it('names links by file name, inline styles by #id.class or ordinal among inline styles', () => {
    const views = styleRowViews([
      row({ href: 'https://s.test/a/theme.css?ver=2' }),
      row({ href: '' }),
      row({ type: 'inline', elementId: 'a', className: 'b c', href: '' }),
      row({ type: 'inline', href: '' }),
      row({ type: 'inline', href: '' })
    ]);
    expect(views.map((view) => [view.name, view.monoName])).toEqual([
      ['theme.css', false],
      [NO_HREF_NAME, false],
      ['#a.b.c', true],
      ['Inline style #2', false],
      ['Inline style #3', false]
    ]);
  });

  it('previews URLs without scheme, CSS or Empty, media first; the snapshot row its note', () => {
    const views = styleRowViews([
      row({ href: 'https://s.test/a.css', media: 'print' }),
      row({ type: 'inline', href: '', preview: 'a{b:c}' }),
      row({ type: 'inline', href: '', preview: '' }),
      row({ type: 'inline', href: '', source: 'snapshot', elementId: 'rocket-critical-css' })
    ]);
    expect(views.map((view) => view.preview)).toEqual([
      'media: print · s.test/a.css',
      'a{b:c}',
      EMPTY_STYLE_PREVIEW,
      CRITICAL_SNAPSHOT_NOTE
    ]);
  });

  it('sizes live inline styles only, the bar on a square-root scale of the largest', () => {
    const views = styleRowViews([
      row({ type: 'inline', chars: 10_000 }),
      row({ type: 'inline', chars: 2_500 }),
      row({ type: 'inline', chars: 1 }),
      row({ chars: 0 }),
      row({ type: 'inline', source: 'snapshot', chars: 0 })
    ]);
    expect(views.map((view) => view.size)).toEqual(['10K', '2.5K', '1', undefined, undefined]);
    expect(views.map((view) => view.sizeShare)).toEqual([1, 0.5, 0.02, undefined, undefined]);
  });
});

describe('sizeShare', () => {
  it('is the square root of the share, floored at 2 %, capped at 1, none when empty or without a max', () => {
    expect(sizeShare(25, 100)).toBe(0.5);
    expect(sizeShare(1, 10_000)).toBe(0.02);
    expect(sizeShare(0, 100)).toBeUndefined();
    expect(sizeShare(200, 100)).toBe(1);
    expect(sizeShare(5, 0)).toBeUndefined();
  });
});

describe('styleRowKeys', () => {
  it('keys live rows by content and counts exact duplicates; the snapshot row has its own', () => {
    const rows = [
      row({ source: 'snapshot', type: 'inline', elementId: 'rocket-critical-css' }),
      row({ href: 'https://s.test/a.css' }),
      row({ href: 'https://s.test/a.css' }),
      row({ type: 'inline', href: '', preview: 'x{}' })
    ];
    const keys = styleRowKeys(rows);
    expect(keys[0]).toBe(SNAPSHOT_ROW_KEY);
    expect(new Set(keys).size).toBe(4);
    // A style added above keeps every key below it.
    const shifted = styleRowKeys([row({ href: 'https://s.test/new.css' }), ...rows.slice(1)]);
    expect(shifted.slice(1)).toEqual(keys.slice(1));
  });

  it('changes the key when an identifying field changes, not when the size does', () => {
    const base = row({ type: 'inline', href: '', elementId: 'a', preview: 'x' });
    const [key] = styleRowKeys([base]);
    expect(styleRowKeys([{ ...base, chars: 99, minified: true }])[0]).toBe(key);
    for (const change of [
      { type: 'external' },
      { elementId: 'b' },
      { href: 'h' },
      { className: 'c' },
      { media: 'print' },
      { preview: 'y' }
    ] as const) {
      expect(styleRowKeys([{ ...base, ...change }])[0], JSON.stringify(change)).not.toBe(key);
    }
  });
});

describe('mediaDetail', () => {
  it('hides no media and the default all, names anything else', () => {
    expect(mediaDetail('')).toBeNull();
    expect(mediaDetail(' ALL ')).toBeNull();
    expect(mediaDetail('print')).toBe('media: print');
    expect(mediaDetail(' (max-width: 600px) ')).toBe('media: (max-width: 600px)');
  });
});

describe('sameStyleRow / sameStyleView', () => {
  it('holds for equal fields and breaks on any shown or state field', () => {
    const base = row();
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
      { minifyAttribute: true },
      { critical: true },
      { rocketAsync: true },
      { hostedFont: true }
    ] as const) {
      expect(sameStyleRow(base, { ...base, ...change }), JSON.stringify(change)).toBe(false);
    }
  });

  it('breaks a view on a moved row (the CSS read addresses its position)', () => {
    const [view] = styleRowViews([row()]);
    const [moved] = styleRowViews([row({ id: 3 })]);
    if (view === undefined || moved === undefined) throw new Error('no views');
    expect(sameStyleView(view, styleRowViews([row()])[0] as typeof view)).toBe(true);
    expect(sameStyleView(view, moved)).toBe(false);
  });
});

describe('styleKind + styleFacts + styleSearchField', () => {
  it('names the kind of each row', () => {
    const [link, inline, snapshot] = styleRowViews([
      row(),
      row({ type: 'inline' }),
      row({ type: 'inline', source: 'snapshot' })
    ]);
    expect([link, inline, snapshot].map((view) => (view ? styleKind(view) : ''))).toEqual([
      'Stylesheet link',
      'Inline style',
      'Critical-path style'
    ]);
  });

  it('lists only the facts that hold', () => {
    const [plain, stamped, inline] = styleRowViews([
      row(),
      row({
        elementId: 'i',
        media: 'print',
        rocketAsync: true,
        minifyAttribute: true,
        hostedFont: true
      }),
      row({ type: 'inline', elementId: 'i', chars: 1_234 })
    ]);
    expect(plain ? styleFacts(plain) : null).toEqual([]);
    expect(stamped ? styleFacts(stamped).map((fact) => fact.label) : null).toEqual([
      'Element',
      'Media',
      'Async stamp',
      'Minify stamp',
      'Hosted font'
    ]);
    // An inline style's identity is its name: no Element fact.
    expect(inline ? styleFacts(inline) : null).toEqual([
      { label: 'Size', value: '1,234 characters', mono: false }
    ]);
  });

  it('searches the row’s searched field', () => {
    const [view] = styleRowViews([row({ content: 'needle' })]);
    expect(view ? styleSearchField(view) : '').toBe('needle');
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
