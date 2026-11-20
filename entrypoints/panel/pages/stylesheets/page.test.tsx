/**
 * The Stylesheets page over its read machine (asks injected): states, calm
 * rows (names, previews, size + bar, two chips + "+N"), Critical placement,
 * facets and search, refresh keeping facets/query/selection by content key,
 * and the detail — CSS read on demand from the list's snapshot (chunked,
 * gone, failures, plain past the highlight limit, cut past the read cap),
 * the link's tile and facts, the snapshot row's note — plus the read over
 * the background relay against the real content-side snapshot store.
 */
import { cleanup, fireEvent, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntersectionGate } from '../../../../components/ui/code-block';
import { HIGHLIGHT_MAX_CHARS } from '../../../../components/ui/code-block';
import { PAGE_STYLE_LIMITS } from '../../../../lib/messaging/page-styles';
import type {
  PageStylesheetEntry,
  PageStylesheetsReply
} from '../../../../lib/messaging/page-stylesheets';
import {
  STYLE_SOURCE_CHUNK_CHARS,
  STYLE_SOURCE_MAX_CHARS,
  styleSourceChunk,
  type StyleSourceRequest
} from '../../../../lib/messaging/style-source';
import type { TabAsks } from '../../../../lib/messaging/tab-asks';
import { parseTabRelayRequest, type TabRelayRequest } from '../../../../lib/messaging/tab-relay';
import { relayTabAsks } from '../../../../lib/messaging/tab-relay-client';
import { ANY_VALUE } from '../../../../lib/panel/resource-facets';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { createStyleSnapshots } from '../../../isolated.content/style-inventory/style-snapshot';
import { makeFdtData } from '../../state/fixtures';
import { SEARCH_DEBOUNCE_MS } from '../../state/search';
import type { CodeBlockSeams } from '../javascript/code-seams';
import { PAGE_ASK_MISS_COPY } from '../page-ask-miss';
import {
  installFakeResizeObserver,
  type FakeResizeObservers
} from '../resource-list/fake-resize-observer';
import { DETAIL_CODE_MAX_HEIGHT } from '../resource-list/detail-section';
import { DOUBLE_WINDOW_ROWS, renderPage, type PageHarness } from '../resource-list/page-harness';
import { createTopFrameReader } from '../resource-list/top-frame-reader';
import { StylesheetsPage, STYLESHEETS_SUBTITLE, type StylesheetsPageProps } from './page';
import {
  FORMAT_CSS_LABEL,
  STYLE_DISPLAY_CUT_NOTE,
  STYLE_DISPLAY_MAX_CHARS,
  STYLE_PLAIN_NOTE,
  STYLE_SOURCE_CUT_NOTE,
  STYLE_SOURCE_NOTES
} from './style-detail';
import {
  CRITICAL_SNAPSHOT_DETAIL,
  CRITICAL_SNAPSHOT_NOTE,
  type StylesheetsOutcome
} from './style-view';

/** A minified per-file URL. */
const MINIFIED = 'https://s.test/wp-content/cache/min/1/wp-content/themes/a/style.css';

/** Snapshot ids of successive lists. */
const SNAPSHOTS = ['a'.repeat(32), 'b'.repeat(32)] as const;

/** Code-block seams: no highlighter load, no observer (raw text stays). */
const CODE_SEAMS: CodeBlockSeams = {
  createObserver: (): IntersectionGate => ({
    observe: () => undefined,
    disconnect: () => undefined
  }),
  loadHighlighter: () => new Promise<never>(() => undefined),
  watchOverflow: (_box, _content, onChange) => {
    onChange(false);
    return () => undefined;
  }
};

/** A listed link with overrides. */
function link(overrides: Partial<PageStylesheetEntry> = {}): PageStylesheetEntry {
  return {
    kind: 'link',
    id: '',
    className: '',
    href: 'https://s.test/plain.css',
    media: '',
    preview: '',
    chars: 0,
    minifyAttribute: false,
    rocketAsync: false,
    hostedFont: false,
    ...overrides
  };
}

/** A listed inline style with overrides. */
function inline(overrides: Partial<PageStylesheetEntry> = {}): PageStylesheetEntry {
  return link({ kind: 'inline', href: '', preview: '.a{}', chars: 4, ...overrides });
}

/** A reply listing exactly `styles`. */
function reply(
  styles: PageStylesheetEntry[],
  total = styles.length,
  snapshotId: string = SNAPSHOTS[0]
): StylesheetsOutcome {
  return { kind: 'reply', reply: { styles, total, snapshotId } satisfies PageStylesheetsReply };
}

/** Page data with the facts the chips read. */
function data(
  facts: { minifyCss?: boolean; wpr?: boolean; critical?: boolean; page?: string } = {}
): FdtData {
  const base = makeFdtData().wprDetections;
  return makeFdtData({
    scriptSnapshotId: facts.page ?? 'page-1',
    wprDetections: {
      ...base,
      wpr: { ...base.wpr, present: facts.wpr ?? true },
      minify_css: { ...base.minify_css, present: facts.minifyCss ?? true },
      async_css: { ...base.async_css, criticalStyle: facts.critical ?? false }
    }
  });
}

/**
 * A chunk reader answering every snapshot's positions from `css`, recording
 * the requests (a position without CSS is gone).
 *
 * @param css The CSS of each inline position.
 */
function cssReads(css: Readonly<Record<number, string>>) {
  const requests: StyleSourceRequest[] = [];
  const read = vi.fn((request: StyleSourceRequest): Promise<unknown> => {
    requests.push(request);
    const text = css[request.styleIndex];
    if (text === undefined) return Promise.resolve({ status: 'gone' });
    const kept =
      text.length > STYLE_SOURCE_MAX_CHARS
        ? { text: text.slice(0, STYLE_SOURCE_MAX_CHARS), truncated: true }
        : { text, truncated: false };
    return Promise.resolve(styleSourceChunk(kept, request.offset));
  });
  return { read, requests };
}

/**
 * Like {@link cssReads}, but every answer waits for {@link releaseAll} — so a
 * test can act (close, move the selection) while a chunk is in flight.
 *
 * @param css The CSS of each inline position.
 */
function heldReads(css: Readonly<Record<number, string>>) {
  const answers = cssReads(css);
  // Recorded when asked, not when answered.
  const requests: StyleSourceRequest[] = [];
  let held: (() => void)[] = [];
  const read = (request: StyleSourceRequest): Promise<unknown> => {
    requests.push(request);
    return new Promise((resolve) => {
      held.push(() => {
        resolve(answers.read(request));
      });
    });
  };
  /** Answer every chunk asked so far. */
  const releaseAll = (): void => {
    const waiting = held;
    held = [];
    for (const answer of waiting) answer();
  };
  return { read, requests, releaseAll };
}

let observers: FakeResizeObservers;

/** The list width the current render reports (pane from 830). */
let listWidth = 1000;

/**
 * Let queued promise callbacks run, then report the list width (the list
 * mounts once its read answers, after the render).
 */
async function settle(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
  observers.resize(listWidth);
}

beforeEach(() => {
  observers = installFakeResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * Render the page with a queue of answers (the last one repeats).
 *
 * @param answers The list answers, in order.
 * @param options The initial data, list width (pane from 830) and seams.
 */
function renderStylesheets(
  answers: StylesheetsOutcome[],
  options: { initial?: FdtData; width?: number; seams?: StylesheetsPageProps } = {}
): PageHarness & { ask: ReturnType<typeof vi.fn> } {
  const queue = [...answers];
  const ask = vi.fn((): Promise<StylesheetsOutcome> => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === undefined) throw new Error('renderStylesheets: no answer queued');
    return Promise.resolve(next);
  });
  const harness = renderPage(
    (props) => (
      <StylesheetsPage
        listStylesheets={ask}
        createVirtualizer={props.createVirtualizer}
        codeBlock={CODE_SEAMS}
        openResource={null}
        readStyleChunk={cssReads({}).read}
        {...options.seams}
      />
    ),
    options.initial ?? data()
  );
  listWidth = options.width ?? 1000;
  observers.resize(listWidth);
  return { ...harness, ask };
}

/** The rendered rows. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-fdt="stylesheet-row"]')];
}

/**
 * A field's text in a row.
 *
 * @param row The row.
 * @param hook The field's hook.
 */
function field(row: HTMLElement | undefined, hook: string): string | undefined {
  return row?.querySelector(`[data-fdt="${hook}"]`)?.textContent ?? undefined;
}

/** The rendered rows' names. */
function names(): string[] {
  return rows().map((row) => field(row, 'list-row-name') ?? '');
}

/** The state ids of each rendered row, in order. */
function rowStates(): string[][] {
  return rows().map((row) =>
    [...row.querySelectorAll('[data-fdt="state-chip"]')].map(
      (chip) => chip.getAttribute('data-fdt-state') ?? ''
    )
  );
}

/** Open a row by its name. */
function open(name: string): void {
  const row = rows().find((candidate) => field(candidate, 'list-row-name') === name);
  const button = row?.querySelector<HTMLButtonElement>('[data-fdt-row-open]');
  if (button === null || button === undefined) throw new Error(`no row ${name}`);
  fireEvent.click(button);
}

/** The side pane (throws when closed). */
function pane(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-fdt="detail-pane"]');
  if (found === null) throw new Error('no detail pane');
  return found;
}

/** A facet segment's radio. */
function segment(value: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    `[data-fdt="facet-bar"] [data-fdt-choice-value="${value}"] input`
  );
  if (input === null) throw new Error(`no segment ${value}`);
  return input;
}

/** A facet toggle. */
function toggle(id: string): HTMLElement {
  const button = document.querySelector<HTMLElement>(`[data-fdt-toggle-chip="${id}"]`);
  if (button === null) throw new Error(`no toggle ${id}`);
  return button;
}

/** Type into the page's search field and let the store commit (fake timers). */
function type(text: string): void {
  fireEvent.input(screen.getByRole('searchbox', { name: 'Search stylesheets' }), {
    target: { value: text }
  });
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
}

/** The shown CSS of the open detail (null while none). */
function shownCss(): string | null {
  return (
    pane().querySelector('[data-fdt="style-css"] [data-fdt-code-content]')?.textContent ?? null
  );
}

describe('StylesheetsPage — states', () => {
  it('loads first, then lists the page’s styles under its title', async () => {
    renderStylesheets([reply([link(), inline({ id: 'theme' })])]);
    expect(screen.getByRole('heading', { level: 1, name: 'Stylesheets' })).toBeTruthy();
    expect(screen.getByText(STYLESHEETS_SUBTITLE)).toBeTruthy();
    expect(document.querySelector('[data-fdt="stylesheets-loading"]')).not.toBeNull();
    await settle();
    expect(document.querySelector('[data-fdt="stylesheets-loading"]')).toBeNull();
    expect(names()).toEqual(['plain.css', '#theme']);
    expect(document.querySelector('[data-fdt="stylesheets-total"]')?.textContent).toBe('2 styles');
    expect(field(rows()[1], 'list-row-preview')).toBe('.a{}');
    expect(document.querySelector('[data-fdt="list-head"]')?.textContent).toBe(
      'StyleCharsWP Rocket'
    );
  });

  it('leads a link row with its file name over its URL without scheme, and no size', async () => {
    renderStylesheets([reply([link({ href: 'https://s.test/wp-content/a/b/plain.css?ver=6' })])]);
    await settle();
    const row = rows()[0];
    expect(field(row, 'list-row-name')).toBe('plain.css');
    expect(field(row, 'list-row-preview')).toBe('s.test/wp-content/a/b/plain.css?ver=6');
    expect(row?.querySelector('[data-fdt="list-row-size"]')).toBeNull();
  });

  it('names a link without an address, an inline style by #id.class or its ordinal', async () => {
    renderStylesheets([
      reply([
        link({ href: '' }),
        inline({ id: 'a', className: 'x  y' }),
        inline(),
        inline({ className: 'z', preview: '' })
      ])
    ]);
    await settle();
    expect(names()).toEqual(['No stylesheet address', '#a.x.y', 'Inline style #2', '.z']);
    // Identifiers are mono; ordinal names are not.
    const name = (index: number) => rows()[index]?.querySelector('[data-fdt="list-row-name"]');
    expect(name(1)?.className).toContain('font-mono');
    expect(name(2)?.className).not.toContain('font-mono');
    expect(field(rows()[3], 'list-row-preview')).toBe('Empty');
  });

  it('leads the preview with the media when it says anything', async () => {
    renderStylesheets([
      reply([inline({ media: 'print' }), inline({ media: 'all' }), link({ media: 'screen' })])
    ]);
    await settle();
    expect(rows().map((row) => field(row, 'list-row-preview'))).toEqual([
      'media: print · .a{}',
      '.a{}',
      'media: screen · s.test/plain.css'
    ]);
  });

  it('sizes inline styles only, compact, with a square-root bar', async () => {
    renderStylesheets([reply([inline({ chars: 18_600 }), inline({ chars: 186 }), link()])]);
    await settle();
    expect(rows().map((row) => field(row, 'list-row-size'))).toEqual(['18.6K', '186', undefined]);
    const widths = rows().map(
      (row) => row.querySelector<HTMLElement>('[data-fdt="list-row-size-bar"] > span')?.style.width
    );
    expect(widths).toEqual(['100%', '10%', undefined]);
  });

  it('names a miss and retries', async () => {
    const { ask } = renderStylesheets([
      { kind: 'page-unreachable', miss: 'no-receiver' },
      reply([link()])
    ]);
    await settle();
    expect(screen.getByText("Couldn't read the page's stylesheets")).toBeTruthy();
    expect(screen.getByText(PAGE_ASK_MISS_COPY['no-receiver'])).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(1);
  });

  it('says so when the page has no styles', async () => {
    renderStylesheets([reply([])]);
    await settle();
    expect(screen.getByText('No styles on this page')).toBeTruthy();
    expect(rows()).toHaveLength(0);
  });

  it('states a capped list and marks the total as a floor', async () => {
    const styles = Array.from({ length: PAGE_STYLE_LIMITS.count }, (_, index) =>
      link({ href: `https://s.test/${String(index)}.css` })
    );
    renderStylesheets([reply(styles, 4_500)]);
    await settle();
    expect(document.querySelector('[data-fdt="stylesheets-cut"]')?.textContent).toBe(
      'Showing the first 2,000 of 4,500 styles.'
    );
    expect(document.querySelector('[data-fdt="stylesheets-total"]')?.textContent).toBe(
      '2,000+ styles'
    );
    // Virtualized: only a window of rows is in the DOM.
    expect(rows()).toHaveLength(DOUBLE_WINDOW_ROWS);
  });

  it('keeps facets, query and selection through a Refresh, and says when one missed', async () => {
    vi.useFakeTimers();
    const { ask } = renderStylesheets([
      reply([link({ rocketAsync: true }), link()]),
      { kind: 'page-unreachable', miss: 'timeout' },
      reply(
        [link({ href: 'https://s.test/new.css' }), link({ rocketAsync: true }), link()],
        3,
        SNAPSHOTS[1]
      )
    ]);
    await settle();
    fireEvent.click(toggle('async'));
    type('plain');
    await settle();
    expect(rows()).toHaveLength(1);
    open('plain.css');
    const refresh = screen.getByRole('button', { name: /Refresh/ });
    fireEvent.click(refresh);
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    await settle();
    expect(document.querySelector('[data-fdt="stylesheets-refresh-miss"]')?.textContent).toBe(
      `Couldn't refresh the list: ${PAGE_ASK_MISS_COPY.timeout}`
    );
    fireEvent.click(refresh);
    await settle();
    expect(ask).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[data-fdt="stylesheets-refresh-miss"]')).toBeNull();
    expect(toggle('async').getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search stylesheets' }).value
    ).toBe('plain');
    expect(rows()).toHaveLength(1);
    // The async plain.css moved one position down: same content key, still selected.
    expect(rows()[0]?.getAttribute('data-selected')).not.toBeNull();
    expect(within(pane()).getByRole('heading', { level: 2 }).textContent).toBe('plain.css');
  });

  it('re-reads a new page load without showing the earlier list', async () => {
    const page = renderStylesheets([reply([link()]), reply([link(), link()])]);
    const { ask } = page;
    await settle();
    expect(rows()).toHaveLength(1);
    page.refresh(data({ page: 'page-2' }));
    expect(document.querySelector('[data-fdt="stylesheets-loading"]')).not.toBeNull();
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(2);
    // A payload refresh of the same load asks nothing.
    page.refresh(data({ page: 'page-2' }));
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
  });
});

describe('StylesheetsPage — chips', () => {
  it('puts Critical on the live critical style when the page still has it', async () => {
    renderStylesheets([reply([inline({ id: 'rocket-critical-css' }), link()])], {
      initial: data({ critical: true })
    });
    await settle();
    expect(rowStates()).toEqual([['critical'], []]);
  });

  it('adds one snapshot row when WP Rocket removed it after load', async () => {
    renderStylesheets([reply([link()])], { initial: data({ critical: true }) });
    await settle();
    expect(rowStates()).toEqual([['critical'], []]);
    expect(names()[0]).toBe('#rocket-critical-css');
    expect(field(rows()[0], 'list-row-preview')).toBe(CRITICAL_SNAPSHOT_NOTE);
    expect(rows()[0]?.querySelector('[data-fdt="list-row-size"]')).toBeNull();
  });

  it('shows Critical nowhere when the snapshot saw none', async () => {
    renderStylesheets([reply([inline({ id: 'rocket-critical-css' })])], {
      initial: data({ critical: false })
    });
    await settle();
    expect(rowStates()).toEqual([[]]);
  });

  it('re-classifies when a page fact flips under a payload refresh', async () => {
    const page = renderStylesheets([reply([link({ href: MINIFIED })])], {
      initial: data({ minifyCss: false })
    });
    await settle();
    expect(rowStates()).toEqual([[]]);
    page.refresh(data({ minifyCss: true }));
    await settle();
    expect(rowStates()).toEqual([['minified']]);
  });

  it('shows two chips then "+N" on a row, every chip in the detail', async () => {
    renderStylesheets([reply([link({ href: MINIFIED, rocketAsync: true, hostedFont: true })])]);
    await settle();
    expect(rowStates()).toEqual([['async', 'minified']]);
    expect(field(rows()[0], 'state-chip-overflow')).toContain('+1');
    open('style.css');
    const chips = [
      ...pane().querySelectorAll<HTMLElement>(
        '[data-fdt="style-detail-chips"] [data-fdt="state-chip"]'
      )
    ];
    expect(chips.map((chip) => chip.dataset.fdtState)).toEqual(['async', 'minified', 'font']);
    expect(chips.every((chip) => chip.dataset.fdtSource === 'wp-rocket')).toBe(true);
  });

  it('shows the source legend once while rows exist, none on an empty page', async () => {
    renderStylesheets([reply([link({ href: MINIFIED })])]);
    await settle();
    const legends = document.querySelectorAll('[data-fdt="state-source-legend"]');
    expect(legends).toHaveLength(1);
    // Every style state is WP Rocket's: the legend names only that source.
    expect(legends[0]?.textContent).toBe('WP Rocket');
    cleanup();
    renderStylesheets([reply([])]);
    await settle();
    expect(document.querySelector('[data-fdt="state-source-legend"]')).toBeNull();
  });
});

describe('StylesheetsPage — unchanged note', () => {
  /** The note's text (null while none). */
  function note(): string | null {
    return document.querySelector('[data-fdt="stylesheets-unchanged"]')?.textContent ?? null;
  }

  it('says no style shows a change, names the off features and links Detections', async () => {
    renderStylesheets([reply([link(), inline()])], { initial: data({ minifyCss: false }) });
    await settle();
    expect(note()).toContain('No stylesheet shows a WP Rocket change.');
    // No generator meta decided the rows: Self-host Google Fonts reads unknown
    // on its Detections card, so the note leaves it out.
    expect(note()).toContain(
      'Optimize CSS delivery, Minify CSS files and LazyLoad CSS backgrounds are off.'
    );
    expect(note()).not.toContain('Self-host Google Fonts');
    const detections = screen.getByRole('link', { name: 'See Detections' });
    expect(detections.getAttribute('href')).toBe('#/detections');
  });

  it('leaves once a row shows a state (a payload refresh flips a fact), and stays away on an empty page or without WP Rocket', async () => {
    const page = renderStylesheets([reply([link({ href: MINIFIED })])], {
      initial: data({ minifyCss: false })
    });
    await settle();
    expect(note()).not.toBeNull();
    page.refresh(data({ minifyCss: true }));
    await settle();
    expect(note()).toBeNull();
    cleanup();
    renderStylesheets([reply([])]);
    await settle();
    expect(note()).toBeNull();
    cleanup();
    renderStylesheets([reply([link()])], { initial: data({ wpr: false, minifyCss: false }) });
    await settle();
    expect(note()).toBeNull();
  });

  it('stays away while the list is cut (a style past the cut may show a change)', async () => {
    renderStylesheets([reply([link(), inline()], 3)], { initial: data({ minifyCss: false }) });
    await settle();
    expect(screen.getByText('Showing the first 2 of 3 styles.')).toBeTruthy();
    expect(note()).toBeNull();
  });
});

describe('StylesheetsPage — facets and search', () => {
  it('filters on every facet value, combined, and searches URLs, ids and CSS', async () => {
    vi.useFakeTimers();
    renderStylesheets([
      reply([
        inline({ id: 'wpr-usedcss', preview: 'body{margin:0}' }),
        inline({ id: 'wpr-lazyload-bg-container' }),
        link({ href: MINIFIED, rocketAsync: true }),
        link({ hostedFont: true, href: 'https://s.test/fonts.css' })
      ])
    ]);
    await settle();
    fireEvent.click(segment('inline'));
    expect(names()).toEqual(['#wpr-usedcss', '#wpr-lazyload-bg-container']);
    fireEvent.click(segment('rucss'));
    expect(names()).toEqual(['#wpr-usedcss']);
    fireEvent.click(segment('lazy-bg'));
    expect(names()).toEqual(['#wpr-lazyload-bg-container']);
    // Every choice facet back to Any (re-queried: a pick re-renders the bar).
    for (const index of [0, 1]) {
      const any = document.querySelectorAll<HTMLInputElement>(
        `[data-fdt="facet-bar"] [data-fdt-choice-value="${ANY_VALUE}"] input`
      )[index];
      if (any === undefined) throw new Error(`no Any ${String(index)}`);
      fireEvent.click(any);
    }
    expect(rows()).toHaveLength(4);
    for (const [id, name] of [
      ['async', 'style.css'],
      ['minified', 'style.css'],
      ['font', 'fonts.css']
    ] as const) {
      fireEvent.click(toggle(id));
      expect(names(), id).toEqual([name]);
      fireEvent.click(toggle(id));
    }
    type('margin');
    await settle();
    expect(names()).toEqual(['#wpr-usedcss']);
    type('fonts.css');
    await settle();
    expect(names()).toEqual(['fonts.css']);
  });
});

describe('StylesheetsPage — detail', () => {
  it('reads an inline style’s full CSS from the list’s snapshot and shows its facts', async () => {
    const css = 'a > b { content: "&" }\n.c { color: red }';
    const reads = cssReads({ 1: css });
    renderStylesheets([reply([link(), inline({ id: 'theme', chars: css.length })])], {
      seams: { readStyleChunk: reads.read }
    });
    await settle();
    open('#theme');
    expect(within(pane()).getByText('Inline style')).toBeTruthy();
    await vi.waitFor(() => {
      expect(shownCss()).toBe(css);
    });
    expect(reads.requests).toEqual([{ snapshotId: SNAPSHOTS[0], styleIndex: 1, offset: 0 }]);
    expect(pane().querySelector('[data-fdt="style-facts"]')?.textContent).toBe(
      `Size${String(css.length)} characters`
    );
    expect(pane().querySelector('[data-fdt="style-no-state"]')?.textContent).toBe(
      'No WP Rocket state on this style.'
    );
    expect(pane().querySelector('[data-fdt="style-css-plain"]')).toBeNull();
    expect(pane().querySelector('[data-fdt="style-css-cut"]')).toBeNull();
  });

  it('opens minified CSS wrapped and formatted CSS unwrapped, both capped to the view', async () => {
    const minified = `.a{${'color:red;'.repeat(30)}}`;
    const formatted = '.a {\n  color: red;\n}';
    renderStylesheets(
      [
        reply([
          inline({ id: 'min', chars: minified.length }),
          inline({ id: 'fmt', chars: formatted.length })
        ])
      ],
      { seams: { readStyleChunk: cssReads({ 0: minified, 1: formatted }).read } }
    );
    await settle();
    const wrapOf = (): string | null | undefined =>
      pane()
        .querySelector('[data-fdt="style-css"] [data-fdt-code-block-wrap]')
        ?.getAttribute('aria-pressed');
    open('#min');
    await vi.waitFor(() => {
      expect(shownCss()).toBe(minified);
    });
    expect(wrapOf()).toBe('true');
    const area = pane().querySelector<HTMLElement>('[data-fdt="style-css"] [data-fdt-code-area]');
    expect(area?.style.maxHeight).toBe(DETAIL_CODE_MAX_HEIGHT);
    open('#fmt');
    await vi.waitFor(() => {
      expect(shownCss()).toBe(formatted);
    });
    expect(wrapOf()).toBe('false');
  });

  it('formats the shown CSS on demand and back, the copy still taking the served text', async () => {
    const css = '.a{color:red;margin:0}';
    renderStylesheets([reply([inline({ id: 'theme', chars: css.length })])], {
      seams: { readStyleChunk: cssReads({ 0: css }).read }
    });
    await settle();
    open('#theme');
    await vi.waitFor(() => {
      expect(shownCss()).toBe(css);
    });
    const format = within(pane()).getByRole('button', { name: FORMAT_CSS_LABEL });
    expect(format.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(format);
    expect(format.getAttribute('aria-pressed')).toBe('true');
    expect(shownCss()).toBe('.a {\n  color:red;\n  margin:0\n}');
    fireEvent.click(format);
    expect(shownCss()).toBe(css);
  });

  it('shows a skeleton while the CSS is on its way, never an empty block', async () => {
    renderStylesheets([reply([inline({ id: 'theme' })])], {
      seams: { readStyleChunk: () => new Promise<never>(() => undefined) }
    });
    await settle();
    open('#theme');
    await settle();
    const section = pane().querySelector('[data-fdt="style-css"]');
    expect(section?.querySelector('[data-fdt="code-block"]')).toBeNull();
    expect(section?.querySelector('[data-fdt="style-css-note"]')).toBeNull();
    expect(section?.children.length).toBe(2);
  });

  it('reads a large style chunk by chunk, plain past the highlight limit and said so', async () => {
    const css = `.x{}${'a'.repeat(STYLE_SOURCE_CHUNK_CHARS + 10)}`;
    const reads = cssReads({ 0: css });
    renderStylesheets([reply([inline({ chars: css.length })])], {
      seams: { readStyleChunk: reads.read }
    });
    await settle();
    open('Inline style #1');
    await vi.waitFor(() => {
      expect(shownCss()?.length).toBe(css.length);
    });
    expect(reads.requests.map((request) => request.offset)).toEqual([0, STYLE_SOURCE_CHUNK_CHARS]);
    expect(css.length).toBeGreaterThan(HIGHLIGHT_MAX_CHARS);
    expect(pane().querySelector('[data-fdt="style-css-plain"]')?.textContent).toBe(
      STYLE_PLAIN_NOTE
    );
    // Within the render cap: shown whole, no partial note.
    expect(pane().querySelector('[data-fdt="style-css-shown-cut"]')).toBeNull();
  });

  it.each([
    ['at', HIGHLIGHT_MAX_CHARS, false],
    ['one past', HIGHLIGHT_MAX_CHARS + 1, true]
  ])('notes plain text only past the highlight limit (%s it)', async (_name, size, plain) => {
    renderStylesheets([reply([inline({ chars: size })])], {
      seams: { readStyleChunk: cssReads({ 0: 'p'.repeat(size) }).read }
    });
    await settle();
    open('Inline style #1');
    await vi.waitFor(() => {
      expect(shownCss()?.length).toBe(size);
    });
    expect(pane().querySelector('[data-fdt="style-css-plain"]') !== null).toBe(plain);
  });

  it('says the CSS was cut at the read cap', async () => {
    const reads = cssReads({ 0: 'b'.repeat(STYLE_SOURCE_MAX_CHARS + 5) });
    renderStylesheets([reply([inline({ chars: STYLE_SOURCE_MAX_CHARS + 5 })])], {
      seams: { readStyleChunk: reads.read }
    });
    await settle();
    open('Inline style #1');
    await vi.waitFor(() => {
      expect(pane().querySelector('[data-fdt="style-css-cut"]')?.textContent).toBe(
        STYLE_SOURCE_CUT_NOTE
      );
    });
    // The view renders the start only, and says so.
    expect(shownCss()?.length).toBe(STYLE_DISPLAY_MAX_CHARS);
    expect(pane().querySelector('[data-fdt="style-css-shown-cut"]')?.textContent).toBe(
      STYLE_DISPLAY_CUT_NOTE
    );
    // Copy takes everything the page kept, past the render cap.
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(within(pane()).getByRole('button', { name: 'Inline style CSS — copy' }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('b'.repeat(STYLE_SOURCE_MAX_CHARS));
    });
  });

  it.each([
    ['gone', () => Promise.resolve({ status: 'gone' }), STYLE_SOURCE_NOTES.gone],
    [
      'a refusal',
      () => Promise.resolve({ status: 'error', reason: 'invalid-request' }),
      STYLE_SOURCE_NOTES['invalid-request']
    ],
    ['no answer', () => Promise.reject(new Error('timed out')), STYLE_SOURCE_NOTES.unreachable],
    [
      'a broken answer',
      () => Promise.resolve({ status: 'ok', text: 3 }),
      STYLE_SOURCE_NOTES.unreadable
    ]
  ])('names %s in one muted line', async (_name, read, note) => {
    renderStylesheets([reply([inline({ id: 'theme' })])], { seams: { readStyleChunk: read } });
    await settle();
    open('#theme');
    await vi.waitFor(() => {
      expect(pane().querySelector('[data-fdt="style-css-note"]')?.textContent).toBe(note);
    });
    expect(pane().querySelector('[data-fdt="code-block"]')).toBeNull();
  });

  it('says an empty style holds no CSS and offers no copy', async () => {
    renderStylesheets([reply([inline({ id: 'e', preview: '', chars: 0 })])], {
      seams: { readStyleChunk: cssReads({ 0: '' }).read }
    });
    await settle();
    open('#e');
    await vi.waitFor(() => {
      expect(pane().querySelector('[data-fdt="style-css-empty"]')).not.toBeNull();
    });
    expect(within(pane()).queryByRole('button', { name: /copy/ })).toBeNull();
  });

  it('re-reads on Refresh from the new snapshot, keeping the shown CSS meanwhile', async () => {
    let release: (() => void) | undefined;
    const requests: StyleSourceRequest[] = [];
    const read = (request: StyleSourceRequest): Promise<unknown> => {
      requests.push(request);
      const first = request.snapshotId === SNAPSHOTS[0];
      const answer = styleSourceChunk(
        { text: first ? '.old{}' : '.new{}', truncated: false },
        request.offset
      );
      if (first) return Promise.resolve(answer);
      return new Promise((resolve) => {
        release = () => {
          resolve(answer);
        };
      });
    };
    renderStylesheets(
      [reply([inline({ id: 't' })]), reply([inline({ id: 't' })], 1, SNAPSHOTS[1])],
      { seams: { readStyleChunk: read } }
    );
    await settle();
    open('#t');
    await vi.waitFor(() => {
      expect(shownCss()).toBe('.old{}');
    });
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await settle();
    expect(requests.at(-1)).toEqual({ snapshotId: SNAPSHOTS[1], styleIndex: 0, offset: 0 });
    // No flash: the earlier text stays while the new read is on its way.
    expect(shownCss()).toBe('.old{}');
    release?.();
    await vi.waitFor(() => {
      expect(shownCss()).toBe('.new{}');
    });
  });

  it('stops asking for chunks once the detail closes mid-read', async () => {
    const reads = heldReads({ 0: 'c'.repeat(STYLE_SOURCE_CHUNK_CHARS * 3) });
    renderStylesheets([reply([inline({ id: 'big' })])], { seams: { readStyleChunk: reads.read } });
    await settle();
    open('#big');
    await settle();
    expect(reads.requests).toEqual([{ snapshotId: SNAPSHOTS[0], styleIndex: 0, offset: 0 }]);
    fireEvent.click(within(pane()).getByRole('button', { name: 'Close details' }));
    reads.releaseAll();
    await settle();
    // The answer in flight lands on an aborted read: no second chunk is asked.
    expect(reads.requests).toHaveLength(1);
  });

  it('asks no further chunks for styles the selection moved past', async () => {
    const big = 'd'.repeat(STYLE_SOURCE_CHUNK_CHARS * 2);
    const reads = heldReads({ 0: big, 1: big, 2: big });
    renderStylesheets([reply([inline({ id: 'a' }), inline({ id: 'b' }), inline({ id: 'c' })])], {
      seams: { readStyleChunk: reads.read }
    });
    await settle();
    open('#a');
    await settle();
    open('#b');
    await settle();
    open('#c');
    await settle();
    // Release every held chunk until the reads settle; only #c continues.
    for (let round = 0; round < 3; round++) {
      reads.releaseAll();
      await settle();
    }
    await vi.waitFor(() => {
      expect(shownCss()).toBe(big);
    });
    expect(reads.requests.map((request) => [request.styleIndex, request.offset])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [2, STYLE_SOURCE_CHUNK_CHARS]
    ]);
  });

  it('shows a link’s tile and facts, and never reads CSS for it', async () => {
    const reads = cssReads({});
    renderStylesheets(
      [
        reply([
          link({
            href: MINIFIED,
            id: 'theme-css',
            className: 'x',
            media: 'print',
            rocketAsync: true,
            minifyAttribute: true,
            hostedFont: true
          })
        ])
      ],
      { seams: { readStyleChunk: reads.read } }
    );
    await settle();
    open('style.css');
    expect(within(pane()).getByText('Stylesheet link')).toBeTruthy();
    expect(pane().querySelector('[data-fdt="source-link"]')).not.toBeNull();
    const facts = [...pane().querySelectorAll('[data-fdt="style-facts"] dt')].map(
      (term) => `${term.textContent}=${term.nextElementSibling?.textContent ?? ''}`
    );
    expect(facts).toEqual([
      'Element=#theme-css.x',
      'Media=print',
      'Async stamp=data-rocket-async="style"',
      'Minify stamp=data-minify="1"',
      'Hosted font=data-wpr-hosted-gf-parameters'
    ]);
    expect(pane().querySelector('[data-fdt="style-css"]')).toBeNull();
    await settle();
    expect(reads.read).not.toHaveBeenCalled();
  });

  it('explains the snapshot row, which has no CSS, and never asks', async () => {
    const reads = cssReads({});
    renderStylesheets([reply([link()])], {
      initial: data({ critical: true }),
      seams: { readStyleChunk: reads.read }
    });
    await settle();
    open('#rocket-critical-css');
    expect(within(pane()).getByText('Critical-path style')).toBeTruthy();
    expect(pane().querySelector('[data-fdt="style-snapshot-note"]')?.textContent).toBe(
      CRITICAL_SNAPSHOT_DETAIL
    );
    expect(within(pane()).queryByRole('button', { name: /copy/ })).toBeNull();
    await settle();
    expect(reads.read).not.toHaveBeenCalled();
  });

  it('copies a link’s URL and an inline style’s full CSS (read when copied)', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const css = `.full{}${'x'.repeat(300)}`;
    renderStylesheets([reply([link(), inline({ id: 't', chars: css.length })])], {
      seams: { readStyleChunk: cssReads({ 1: css }).read }
    });
    await settle();
    open('plain.css');
    fireEvent.click(within(pane()).getByRole('button', { name: 'Stylesheet URL — copy' }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://s.test/plain.css');
    });
    // A fresh page: the header's copy control flashes "Copied" for a while.
    cleanup();
    renderStylesheets([reply([link(), inline({ id: 't', chars: css.length })])], {
      seams: { readStyleChunk: cssReads({ 1: css }).read }
    });
    await settle();
    open('#t');
    fireEvent.click(within(pane()).getByRole('button', { name: 'Inline style CSS — copy' }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenLastCalledWith(css);
    });
  });

  it('drills in below the split width, with Back to the list', async () => {
    renderStylesheets([reply([link(), inline({ id: 't' })])], {
      width: 600,
      seams: { readStyleChunk: cssReads({ 1: '.t{}' }).read }
    });
    await settle();
    open('#t');
    const drill = document.querySelector<HTMLElement>('[data-fdt="drill-detail"]');
    if (drill === null) throw new Error('no drill');
    expect(drill.querySelector('[data-fdt="drill-position"]')?.textContent).toBe('2 of 2');
    fireEvent.click(drill.querySelector('[data-fdt="drill-back"]') as HTMLElement);
    expect(document.querySelector('[data-fdt="drill-detail"]')).toBeNull();
  });

  it('reads the CSS through the background relay against the real content-side snapshot', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<style id="relay-style">.r > .s{}${'y'.repeat(STYLE_SOURCE_CHUNK_CHARS)}</style>`
    );
    const element = document.getElementById('relay-style') as HTMLStyleElement;
    const snapshots = createStyleSnapshots();
    const snapshotId = snapshots.take([element]);
    const tab = {
      getStyleSourceChunk: (_tabId: number, request: StyleSourceRequest) =>
        Promise.resolve(snapshots.read(request))
    } as unknown as TabAsks;
    const relayed: TabRelayRequest[] = [];
    const reader = createTopFrameReader(
      {
        asks: () =>
          relayTabAsks(async (request) => {
            relayed.push(request);
            const valid = parseTabRelayRequest(request);
            return valid === null
              ? { ok: false, failure: 'invalid-request' }
              : { ok: true, answer: await valid.forward(tab) };
          }),
        inspectedTabId: () => 9
      },
      (asks, tabId, request: StyleSourceRequest) => asks.getStyleSourceChunk(tabId, request),
      { noTransport: 'no transport', noTab: 'no tab', timedOut: 'timed out' }
    );
    try {
      renderStylesheets(
        [reply([inline({ id: 'relay-style', chars: element.textContent.length })], 1, snapshotId)],
        { seams: { readStyleChunk: reader } }
      );
      await settle();
      open('#relay-style');
      await vi.waitFor(() => {
        expect(shownCss()).toBe(element.textContent);
      });
      expect(relayed).toEqual([
        { tabId: 9, ask: 'getStyleSourceChunk', payload: { snapshotId, styleIndex: 0, offset: 0 } },
        {
          tabId: 9,
          ask: 'getStyleSourceChunk',
          payload: { snapshotId, styleIndex: 0, offset: STYLE_SOURCE_CHUNK_CHARS }
        }
      ]);
    } finally {
      element.remove();
    }
  });
});
