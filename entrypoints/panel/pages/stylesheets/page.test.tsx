/**
 * The Stylesheets page over the shell's stores with an injected page ask:
 * every state (loading, failed + Retry, no styles, populated, capped,
 * refreshing, a refresh that missed), the rows' chips (Critical on the live
 * style or on one snapshot row, never both; the three link states), the filters over every
 * chip, search, a Refresh and a payload refresh keeping the chip and query,
 * and a new page load re-reading without showing the earlier list.
 */
import { cleanup, fireEvent, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_STYLE_LIMITS } from '../../../../lib/messaging/page-styles';
import type {
  PageStylesheetEntry,
  PageStylesheetsReply
} from '../../../../lib/messaging/page-stylesheets';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { makeFdtData } from '../../state/fixtures';
import { SEARCH_DEBOUNCE_MS } from '../../state/search';
import { PAGE_ASK_MISS_COPY } from '../page-ask-miss';
import { DOUBLE_WINDOW_ROWS, renderPage } from '../resource-list/page-harness';
import { StylesheetsPage, STYLESHEETS_SUBTITLE } from './page';
import { CRITICAL_SNAPSHOT_NOTE, type StylesheetsOutcome } from './style-view';

/** A minified per-file URL. */
const MINIFIED = 'https://s.test/wp-content/cache/min/1/wp-content/themes/a/style.css';

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
function reply(styles: PageStylesheetEntry[], total = styles.length): StylesheetsOutcome {
  return { kind: 'reply', reply: { styles, total } satisfies PageStylesheetsReply };
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

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

/** Render the page with a queue of answers (the last one repeats). */
function renderStylesheets(answers: StylesheetsOutcome[], initial: FdtData = data()) {
  const queue = [...answers];
  const ask = vi.fn((): Promise<StylesheetsOutcome> => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === undefined) throw new Error('renderStylesheets: no answer queued');
    return Promise.resolve(next);
  });
  const harness = renderPage(
    (props) => (
      <StylesheetsPage listStylesheets={ask} createVirtualizer={props.createVirtualizer} />
    ),
    initial
  );
  return { ...harness, ask };
}

/** The rendered rows. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-fdt="stylesheet-row"]')];
}

/** The state ids of each rendered row, in order. */
function rowStates(): string[][] {
  return rows().map((row) =>
    [...row.querySelectorAll('[data-fdt="state-chip"]')].map(
      (chip) => chip.getAttribute('data-fdt-state') ?? ''
    )
  );
}

/** A filter chip. */
function chip(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-fdt-filter-chip="${id}"]`);
  if (element === null) throw new Error(`no ${id} chip`);
  return element;
}

/** Type into the page's search field and let the store commit (fake timers). */
function type(text: string): void {
  fireEvent.input(screen.getByRole('searchbox', { name: 'Search stylesheets' }), {
    target: { value: text }
  });
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('StylesheetsPage — states', () => {
  it('loads first, then lists the page’s styles under its title', async () => {
    renderStylesheets([reply([link(), inline({ id: 'theme' })])]);
    expect(screen.getByRole('heading', { level: 1, name: 'Stylesheets' })).toBeTruthy();
    expect(screen.getByText(STYLESHEETS_SUBTITLE)).toBeTruthy();
    expect(document.querySelector('[data-fdt="stylesheets-loading"]')).not.toBeNull();
    await settle();
    expect(document.querySelector('[data-fdt="stylesheets-loading"]')).toBeNull();
    expect(rows()).toHaveLength(2);
    expect(document.querySelector('[data-fdt="stylesheets-total"]')?.textContent).toBe('2 styles');
    expect(rows()[1]?.querySelector('[data-fdt="style-identity"]')?.textContent).toBe('#theme');
    expect(rows()[1]?.querySelector('[data-fdt="style-preview"]')?.textContent).toBe('.a{}');
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

  it('keeps the list (chip and query too) through a Refresh, and says when one missed', async () => {
    vi.useFakeTimers();
    const { ask } = renderStylesheets([
      reply([link({ rocketAsync: true }), link()]),
      { kind: 'page-unreachable', miss: 'timeout' },
      reply([link({ rocketAsync: true }), link(), link({ rocketAsync: true })])
    ]);
    await settle();
    fireEvent.click(chip('async'));
    type('plain');
    await settle();
    expect(rows()).toHaveLength(1);
    const refresh = screen.getByRole('button', { name: /Refresh/ });
    fireEvent.click(refresh);
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    await settle();
    expect(document.querySelector('[data-fdt="stylesheets-refresh-miss"]')?.textContent).toBe(
      `Couldn't refresh the list: ${PAGE_ASK_MISS_COPY.timeout}`
    );
    expect(chip('async').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(refresh);
    await settle();
    expect(ask).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[data-fdt="stylesheets-refresh-miss"]')).toBeNull();
    expect(chip('async').getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search stylesheets' }).value
    ).toBe('plain');
    // The query "plain" over Async: the async plain.css rows of the new list.
    expect(rows()).toHaveLength(2);
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
    renderStylesheets(
      [reply([inline({ id: 'rocket-critical-css' }), link()])],
      data({ critical: true })
    );
    await settle();
    expect(rowStates()).toEqual([['critical'], []]);
    expect(document.querySelector('[data-fdt="style-snapshot-note"]')).toBeNull();
  });

  it('adds one snapshot row when WP Rocket removed it after load', async () => {
    renderStylesheets([reply([link()])], data({ critical: true }));
    await settle();
    expect(rowStates()).toEqual([['critical'], []]);
    expect(rows()[0]?.querySelector('[data-fdt="style-snapshot-note"]')?.textContent).toBe(
      CRITICAL_SNAPSHOT_NOTE
    );
    expect(rows()[0]?.querySelector('[data-fdt="style-preview"]')).toBeNull();
  });

  it('shows Critical nowhere when the snapshot saw none', async () => {
    renderStylesheets([reply([inline({ id: 'rocket-critical-css' })])], data({ critical: false }));
    await settle();
    expect(rowStates()).toEqual([[]]);
  });

  it('re-classifies when a page fact flips under a payload refresh', async () => {
    const page = renderStylesheets([reply([link({ href: MINIFIED })])], data({ minifyCss: false }));
    await settle();
    expect(rowStates()).toEqual([[]]);
    page.refresh(data({ minifyCss: true }));
    await settle();
    expect(rowStates()).toEqual([['minified']]);
  });

  it('shows every state a link can carry (three: no "+N" is reachable on a real row)', async () => {
    renderStylesheets(
      [reply([link({ href: MINIFIED, rocketAsync: true, hostedFont: true })])],
      data()
    );
    await settle();
    expect(rowStates()).toEqual([['async', 'minified', 'font']]);
    expect(document.querySelector('[data-fdt="state-chip-overflow"]')).toBeNull();
    // Each is WP Rocket's, shown by its rocket.
    const chips = [...document.querySelectorAll<HTMLElement>('[data-fdt="state-chip"]')];
    expect(chips.map((state) => state.dataset.fdtSource)).toEqual([
      'wp-rocket',
      'wp-rocket',
      'wp-rocket'
    ]);
    expect(chips.every((state) => state.querySelector('svg.lucide-rocket') !== null)).toBe(true);
  });

  it('shows the source legend once while rows exist, none on an empty page', async () => {
    renderStylesheets([reply([link({ href: MINIFIED })])], data());
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

describe('StylesheetsPage — filters and search', () => {
  it('filters on every chip and searches URLs, ids and CSS', async () => {
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
    const counts: Record<string, number> = {
      critical: 0,
      rucss: 1,
      'lazy-bg': 1,
      async: 1,
      minified: 1,
      font: 1,
      inline: 2,
      external: 2
    };
    for (const [id, count] of Object.entries(counts)) {
      fireEvent.click(chip(id));
      if (count === 0) continue;
      expect(rows(), id).toHaveLength(count);
    }
    fireEvent.click(chip('all'));
    type('margin');
    await settle();
    expect(
      rows().map((row) => row.querySelector('[data-fdt="style-identity"]')?.textContent)
    ).toEqual(['#wpr-usedcss']);
  });
});
