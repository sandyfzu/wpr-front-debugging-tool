/**
 * Render tests for the Headers & Cookies page, state by state: the full
 * inventory (sections, hints, per-row copy), the empty-headers state with and
 * without cookies, the older payload without a cookie capture, the empty
 * cookie capture, the two honest timestamps (fetch vs capture), the
 * no-cookie-value-in-the-DOM guarantee, refresh stability, the store wiring
 * (fetch stamp held across a refresh with a NEW payload, the aging clock's
 * lifetime), the find bar driving the page through the shared store (its
 * query filters, its cursor marks, its cancel clears), and the filter states
 * (debounce commitment, scaffold-only view under a stale query).
 *
 * The list renders through a virtualizer double serving every row (happy-dom
 * has no layout); virtualization itself is the browser tier's.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  VirtualItem,
  VirtualizerFactory,
  VirtualListOptions
} from '../../../../components/ui/virtual-list';
import type { FdtData, PageHeaders } from '../../../../lib/wp-rocket/types';
import type { DataState } from '../../state/fdt-state-machine';
import type { SearchStore } from '../../state/search';
import { makeFdtData } from '../../state/fixtures';
import { FdtDataContext, SearchContext, type FdtDataStore } from '../../state/use-fdt-data';
import { REDACTED } from '../../../../lib/redaction/rule';
import { redactPageHeaders } from '../../../../lib/redaction/headers';
import { PLANTED, PLANTED_RAW_HEADERS } from '../../../../lib/redaction/planted-secrets.fixtures';
import { CURRENT_MATCH_ROW } from '../current-match';
import {
  HeadersCookiesPage,
  HeadersCookiesView,
  inspectedReloadAction,
  SEARCH_LABEL,
  SEARCH_PLACEHOLDER,
  SPA_NOTE
} from './page';
import { WITHHELD_LEGEND, WITHHELD_NOTE } from '../withheld-value';
import { SEARCH_DEBOUNCE_MS, createSearchStore } from '../../state/search';

/** A cookie value that must never reach the DOM or the clipboard. */
const SECRET = 'S3CRET-SESSION-VALUE';

/** The fixed wall clock the tests read against (ms). */
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);

/** A capture with caching evidence, an unrelated row, a cookie-carrying row and a valueless one. */
const HEADERS: PageHeaders = [
  { name: 'Server', value: 'nginx' },
  { name: 'cache-control', value: 'no-store' },
  { name: 'age', value: '30' },
  { name: 'set-cookie', value: `sid=${SECRET}; Path=/; HttpOnly` },
  { name: 'x-empty' }
];

/** The scroll orders the double received, in order (the find-scroll pins' read). */
const landed: number[] = [];

/**
 * A virtualizer double: every row, stacked at a fixed pitch, live over
 * `count`. Items are reused per index, like the real adapter's reconciled
 * store, so a data refresh does not remount rows. `scrollToIndex` records
 * its orders, so the find's scroll pins read the real mapped target.
 */
const everyRow: VirtualizerFactory = (options: VirtualListOptions) => {
  const cache: VirtualItem[] = [];
  const item = (index: number): VirtualItem =>
    (cache[index] ??= {
      key: index,
      index,
      start: index * 40,
      end: index * 40 + 40,
      size: 40,
      lane: 0
    });
  return {
    getVirtualItems: (): VirtualItem[] =>
      Array.from({ length: options.count }, (_, index) => item(index)),
    getTotalSize: () => options.count * 40,
    measureElement: () => undefined,
    scrollToIndex: (index) => {
      landed.push(index);
    }
  };
};

/** Render the view for a payload, over its own (or the given) search store. */
function renderView(
  data: FdtData,
  fetchedAt: number | null = NOW - 120_000,
  store: SearchStore = createSearchStore()
): void {
  render(() => (
    <HeadersCookiesView
      data={data}
      search={store}
      fetchedAt={fetchedAt}
      now={NOW}
      createVirtualizer={everyRow}
    />
  ));
}

/** The level-2 section headings, in order. */
function sectionNames(): string[] {
  return screen
    .queryAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent.replace(/\s+/g, ' ').trim());
}

/** The page's filter field. */
function field(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: SEARCH_LABEL });
}

/** The status line's current text. */
function status(): string | null {
  return document.querySelector('[data-fdt="headers-results-status"]')?.textContent ?? null;
}

/** Type into the filter field and commit the store's debounce (fake timers). */
function typeAndCommit(raw: string): void {
  fireEvent.input(field(), { target: { value: raw } });
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
}

let writes: string[];

beforeEach(() => {
  writes = [];
  landed.length = 0; // each test reads only its own scroll orders
  // The copy controls resolve `navigator.clipboard` at click time.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        writes.push(text);
        return Promise.resolve();
      }
    }
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.useRealTimers();
});

describe('HeadersCookiesView — populated', () => {
  it('renders the frame: one h1, the subtitle, the fetched line with the SPA note', () => {
    renderView(makeFdtData({ pageHeaders: HEADERS }));
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'Headers & Cookies'
    ]);
    expect(document.querySelector('[data-fdt-page="headers-cookies"]')).not.toBeNull();
    const line = document.querySelector('[data-fdt="headers-fetched"]');
    expect(line?.textContent).toContain('Fetched 2 min ago');
    expect(line?.textContent).toContain(SPA_NOTE);
  });

  it('groups caching evidence first, counted, with the hint copy under each value', () => {
    renderView(makeFdtData({ pageHeaders: HEADERS }));
    expect(sectionNames()).toEqual(['Caching evidence 2 headers', 'Other headers 3 headers']);
    const list = screen.getByRole('list', { name: 'Response headers and cookies' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('aria-posinset'))).toEqual(
      items.map((_, index) => String(index + 1))
    );
    expect(items.every((item) => item.getAttribute('aria-setsize') === String(items.length))).toBe(
      true
    );
    const terms = [...list.querySelectorAll('[data-fdt-key-value-term]')].map((t) => t.textContent);
    expect(terms).toEqual(['cache-control', 'age', 'Server', 'set-cookie', 'x-empty']);
    expect(list.textContent).toContain(
      'Instructs receivers not to cache anything — a likely reason no request ever hit a cache.'
    );
    expect(list.textContent).toContain('(no value)');
  });

  it('copies one header as "name: value" from its always-visible control', async () => {
    renderView(makeFdtData({ pageHeaders: HEADERS }));
    fireEvent.click(screen.getByRole('button', { name: 'age header — copy' }));
    await waitFor(() => {
      expect(writes).toEqual(['age: 30']);
    });
    fireEvent.click(screen.getByRole('button', { name: 'x-empty header — copy' }));
    await waitFor(() => {
      expect(writes).toEqual(['age: 30', 'x-empty:']);
    });
  });

  it('copies the whole capture from the page action', async () => {
    renderView(makeFdtData({ pageHeaders: HEADERS }));
    fireEvent.click(screen.getByRole('button', { name: /All headers/ }));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]?.split('\n')).toEqual([
      'cache-control: no-store',
      'age: 30',
      'Server: nginx',
      `set-cookie: sid=${REDACTED}`,
      'x-empty:'
    ]);
  });

  it('renders a capture-withheld list exactly like the same list unflagged, secret-free', async () => {
    renderView(makeFdtData({ pageHeaders: PLANTED_RAW_HEADERS }));
    const unflagged = document.body.textContent;
    cleanup();
    renderView(makeFdtData({ pageHeaders: redactPageHeaders(PLANTED_RAW_HEADERS) }));
    expect(document.body.textContent).toBe(unflagged);
    expect(document.body.innerHTML).not.toContain(PLANTED);
    expect(document.querySelectorAll('[data-fdt-redacted]')).toHaveLength(8);
    expect(document.querySelectorAll('[data-fdt="withheld-legend"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /All headers/ }));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]).toContain(`Set-Cookie: wordpress_logged_in_ab=${REDACTED}`);
    expect(writes[0]).not.toContain(PLANTED);
  });

  it('never puts a secret in the DOM or on the clipboard', async () => {
    const secrets: PageHeaders = [
      ...HEADERS,
      { name: 'Set-Cookie', value: 'NAMELESSSECRETTOKEN' },
      { name: 'Set-Cookie', value: 'TOKSECRET; Path=/' },
      { name: 'Authorization', value: 'Bearer AUTHSECRET' },
      { name: 'x-wp-nonce', value: 'NONCESECRET' }
    ];
    renderView(
      makeFdtData({ pageHeaders: secrets, cookies: { names: ['sid'], capturedAt: NOW - 5_000 } })
    );
    const leaks = [SECRET, 'NAMELESSSECRETTOKEN', 'TOKSECRET', 'AUTHSECRET', 'NONCESECRET'];
    for (const leak of leaks) expect(document.body.innerHTML).not.toContain(leak);
    // The withheld values say so, visibly distinct from real values.
    // The visible marker (the reason rides the sr-only tail and the title).
    const redacted = [...document.querySelectorAll('[data-fdt-redacted]')].map((n) =>
      n.textContent.replace(` — ${WITHHELD_NOTE}`, '')
    );
    expect(redacted).toEqual([`sid=${REDACTED}`, REDACTED, REDACTED, REDACTED, REDACTED]);
    fireEvent.click(screen.getByRole('button', { name: 'Authorization header — copy' }));
    fireEvent.click(screen.getByRole('button', { name: /All headers/ }));
    await waitFor(() => {
      expect(writes).toHaveLength(2);
    });
    expect(writes[0]).toBe(`Authorization: ${REDACTED}`);
    for (const leak of leaks) expect(writes.join('\n')).not.toContain(leak);
  });

  it('lists cookie names under their limits, stamped "Captured …"', () => {
    renderView(
      makeFdtData({
        pageHeaders: HEADERS,
        cookies: { names: ['wordpress_test_cookie', 'wpr_x'], capturedAt: NOW - 42_000 }
      })
    );
    expect(sectionNames()).toEqual([
      'Caching evidence 2 headers',
      'Other headers 3 headers',
      'Cookies 2 cookies'
    ]);
    const list = screen.getByRole('list');
    expect(list.textContent).toContain('wordpress_test_cookie');
    expect(list.textContent).toContain('Names only — values are never captured.');
    expect(list.textContent).toContain('HttpOnly cookies are invisible to page scripts');
    expect(screen.getByText('Captured 42 s ago')).toBeTruthy();
    // The header side keeps its own, different stamp.
    expect(screen.getByText('Fetched 2 min ago')).toBeTruthy();
  });

  it('opens the absolute UTC instant from a stamp, on keyboard focus', async () => {
    renderView(makeFdtData({ pageHeaders: HEADERS }));
    const trigger = screen.getByRole('button', { name: 'Fetched 2 min ago' });
    expect(trigger.querySelector('time')?.getAttribute('datetime')).toBe(
      new Date(NOW - 120_000).toISOString()
    );
    fireEvent.focus(trigger);
    await waitFor(() => {
      expect(screen.getByRole('tooltip').textContent).toBe('Fetched at 2026-10-14 11:58:00 UTC');
    });
  });

  it('shows no stamp at all for an instant that names no real time', () => {
    renderView(
      makeFdtData({ pageHeaders: HEADERS, cookies: { names: ['a'], capturedAt: Number.NaN } }),
      -9e15
    );
    expect(screen.queryByText(/^Fetched/)).toBeNull();
    expect(screen.queryByText(/^Captured/)).toBeNull();
    expect(document.querySelector('[data-fdt="headers-fetched"]')?.textContent).toBe(SPA_NOTE);
  });

  it('drops the fetched stamp, keeping the SPA note, when the fetch instant is unknown', () => {
    renderView(makeFdtData({ pageHeaders: HEADERS }), null);
    const line = document.querySelector('[data-fdt="headers-fetched"]');
    expect(line?.textContent).toBe(SPA_NOTE);
  });
});

describe('HeadersCookiesView — rows', () => {
  it('marks a withheld value with a lock, its reason on hover and for screen readers', () => {
    renderView(makeFdtData({ pageHeaders: [{ name: 'Authorization', value: 'Bearer x' }] }));
    const row = screen
      .getByRole('button', { name: 'Authorization header — copy' })
      .closest('[role="listitem"]');
    const marker = row?.querySelector('[data-fdt-redacted]');
    expect(marker?.textContent).toBe(`${REDACTED} — ${WITHHELD_NOTE}`);
    expect(marker?.getAttribute('title')).toBe(WITHHELD_NOTE);
    expect(marker?.querySelector('svg')).not.toBeNull();
    expect(row?.textContent).not.toContain('Bearer x');
  });

  it('shows the withheld legend once when (and only when) a value is withheld', () => {
    renderView(
      makeFdtData({
        pageHeaders: [
          { name: 'Authorization', value: 'Bearer x' },
          { name: 'Cookie', value: 'a=b' }
        ]
      })
    );
    expect(document.querySelectorAll('[data-fdt="withheld-legend"]')).toHaveLength(1);
    expect(screen.getByText(WITHHELD_LEGEND)).toBeTruthy();
    cleanup();
    renderView(makeFdtData({ pageHeaders: HEADERS.filter((row) => row.name !== 'set-cookie') }));
    expect(document.querySelector('[data-fdt="withheld-legend"]')).toBeNull();
  });

  it('names same-name copy controls apart and titles every icon-only control', () => {
    renderView(
      makeFdtData({
        pageHeaders: [
          { name: 'link', value: '<a>' },
          { name: 'Link', value: '<b>' }
        ]
      })
    );
    const first = screen.getByRole('button', { name: 'link header (1 of 2) — copy' });
    expect(screen.getByRole('button', { name: 'Link header (2 of 2) — copy' })).toBeTruthy();
    expect(first.parentElement?.getAttribute('title')).toBe('Copy link header (1 of 2)');
  });

  it('stamps the cookie heading in the plain form (title + sr text, no floating UI)', () => {
    renderView(
      makeFdtData({ pageHeaders: HEADERS, cookies: { names: ['a'], capturedAt: NOW - 42_000 } })
    );
    const time = document.querySelector('[role="list"] time');
    expect(time?.getAttribute('title')).toBe('Captured at 2026-10-14 11:59:18 UTC');
    expect(time?.textContent).toBe('Captured 42 s ago (2026-10-14 11:59:18 UTC)');
    expect(time?.closest('button')).toBeNull();
  });

  it('shows a stamp of the epoch (0) — a real instant, not "no stamp"', () => {
    render(() => (
      <HeadersCookiesView
        data={makeFdtData({ pageHeaders: HEADERS })}
        search={createSearchStore()}
        fetchedAt={0}
        now={NOW}
        createVirtualizer={everyRow}
      />
    ));
    expect(document.querySelector('[data-fdt="headers-fetched"]')?.textContent).toMatch(
      /^Fetched \d+ d ago/
    );
  });

  it('notes a capture the producer bounded, and nothing for a complete one', () => {
    renderView(makeFdtData({ pageHeaders: HEADERS, pageHeadersTruncated: true }));
    expect(document.querySelector('[data-fdt="headers-truncated"]')?.textContent).toBe(
      'Some headers were clipped.'
    );
    cleanup();
    renderView(makeFdtData({ pageHeaders: HEADERS }));
    expect(document.querySelector('[data-fdt="headers-truncated"]')).toBeNull();
  });

  it('draws the scroll-edge hairline only once the list has scrolled', () => {
    renderView(makeFdtData({ pageHeaders: HEADERS }));
    const list = screen.getByRole('list');
    expect(list.className).toContain('border-transparent');
    list.scrollTop = 40;
    fireEvent.scroll(list);
    expect(list.className).toContain('border-line-2');
    list.scrollTop = 0;
    fireEvent.scroll(list);
    expect(list.className).toContain('border-transparent');
  });
});

describe('HeadersCookiesView — degraded payloads', () => {
  it('offers the inspected-page reload from the empty state, when the context can', () => {
    const reload = vi.fn();
    render(() => (
      <HeadersCookiesView
        data={makeFdtData({ pageHeaders: null })}
        search={createSearchStore()}
        fetchedAt={NOW}
        now={NOW}
        createVirtualizer={everyRow}
        reloadInspectedPage={reload}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Reload inspected page' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('hides the reload where the context cannot reload, and centres a lone empty state', () => {
    renderView(makeFdtData({ pageHeaders: null }));
    expect(screen.queryByRole('button', { name: 'Reload inspected page' })).toBeNull();
    const state = document.querySelector('[data-fdt="empty-state"]');
    expect(state?.className).toContain('items-center');
  });

  it('aligns the empty state as a lead block beside the cookie list', () => {
    renderView(makeFdtData({ pageHeaders: null, cookies: { names: ['a'], capturedAt: NOW } }));
    const state = document.querySelector('[data-fdt="empty-state"]');
    expect(state?.className).toContain('items-start');
    expect(state?.className).not.toContain('items-center');
  });

  it.each([
    ['null', null],
    ['empty', []]
  ] as const)('renders the empty state for %s headers and still lists cookies', (_l, headers) => {
    renderView(makeFdtData({ pageHeaders: headers, cookies: { names: ['a'], capturedAt: NOW } }));
    expect(screen.getByText('No response headers captured')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /All headers/ })).toBeNull();
    expect(document.querySelector('[data-fdt="headers-fetched"]')).toBeNull();
    expect(sectionNames()).toEqual(['Cookies 1 cookie']);
  });

  it('renders the empty state alone when neither headers nor cookies exist', () => {
    renderView(makeFdtData({ pageHeaders: null }));
    expect(screen.getByText('No response headers captured')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('omits the cookie section and its heading for a payload without the capture', () => {
    const data = makeFdtData({ pageHeaders: HEADERS });
    expect('cookies' in data).toBe(false);
    renderView(data);
    expect(sectionNames()).toEqual(['Caching evidence 2 headers', 'Other headers 3 headers']);
    expect(screen.queryByText(/Names only/)).toBeNull();
  });

  it('says no cookies are readable when the capture read none', () => {
    renderView(makeFdtData({ pageHeaders: HEADERS, cookies: { names: [], capturedAt: NOW } }));
    expect(sectionNames()).toContain('Cookies 0 cookies');
    expect(screen.getByText('No cookies are readable by page scripts.')).toBeTruthy();
  });

  it('notes the absence of caching evidence in a capture without any', () => {
    renderView(makeFdtData({ pageHeaders: [{ name: 'Server', value: 'nginx' }] }));
    expect(sectionNames()).toEqual(['Caching evidence 0 headers', 'Other headers 1 header']);
    expect(screen.getByText(/No caching-relevant headers in this response/)).toBeTruthy();
  });
});

describe('HeadersCookiesView — refresh', () => {
  it('keeps row nodes (and focus) when a refresh re-delivers the same shape', () => {
    const [data, setData] = createSignal(makeFdtData({ pageHeaders: HEADERS }));
    render(() => (
      <HeadersCookiesView
        data={data()}
        search={createSearchStore()}
        fetchedAt={NOW}
        now={NOW}
        createVirtualizer={everyRow}
      />
    ));
    const button = screen.getByRole('button', { name: 'age header — copy' });
    button.focus();
    setData(makeFdtData({ pageHeaders: HEADERS.map((row) => ({ ...row })) }));
    expect(button.isConnected).toBe(true);
    expect(document.activeElement).toBe(button);
    // A changed value updates in place.
    setData(
      makeFdtData({
        pageHeaders: HEADERS.map((row) => (row.name === 'age' ? { ...row, value: '31' } : row))
      })
    );
    expect(button.isConnected).toBe(true);
    expect(screen.getByText('31')).toBeTruthy();
  });
});

describe('HeadersCookiesView — the name filter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  it('renders the filter between the meta lines and the list, no chip group', () => {
    renderView(makeFdtData({ pageHeaders: HEADERS, cookies: { names: ['a'], capturedAt: NOW } }));
    expect(field().placeholder).toBe(SEARCH_PLACEHOLDER);
    expect(screen.queryByRole('group')).toBeNull();
    // The field sits after the fetched line and before the list.
    const fetched = document.querySelector('[data-fdt="headers-fetched"]');
    const list = screen.getByRole('list', { name: 'Response headers and cookies' });
    if (!(fetched instanceof HTMLElement)) throw new Error('the fetched line did not render');
    expect(
      fetched.compareDocumentPosition(field()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(field().compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The "All headers" action (frame header) precedes the fetched line.
    const all = screen.getByRole('button', { name: /All headers/ });
    expect(all.compareDocumentPosition(fetched) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('narrows by name across sections, badges restated, positions over the filtered set', () => {
    renderView(
      makeFdtData({ pageHeaders: HEADERS, cookies: { names: ['age_cookie'], capturedAt: NOW } })
    );
    typeAndCommit('age');
    expect(sectionNames()).toEqual(['Caching evidence 1 header', 'Cookies 1 cookie']);
    const list = screen.getByRole('list');
    const items = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.getAttribute('data-fdt-inventory-row') !== 'section');
    expect(items).toHaveLength(2);
    // Positions keep counting the section bands (the unfiltered page's
    // semantics — the set is the whole flattened filtered list).
    expect(items.map((item) => item.getAttribute('aria-posinset'))).toEqual(['2', '4']);
    expect(items.every((item) => item.getAttribute('aria-setsize') === '4')).toBe(true);
  });

  it('never searches a value: a value-naming query lands on the filtered-empty view', () => {
    renderView(makeFdtData({ pageHeaders: HEADERS }));
    typeAndCommit('nginx');
    expect(screen.getByText('No matches')).toBeTruthy();
    expect(screen.getByText('Nothing matches "nginx".')).toBeTruthy();
    // The withheld secret is no search path either.
    typeAndCommit('S3CRET');
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('the way back clears the field, restores the list and keeps focus there', () => {
    renderView(makeFdtData({ pageHeaders: HEADERS }));
    typeAndCommit('nginx');
    // The keyboard way: focused, then activated — the focus hand-off reads it.
    const clear = screen.getByRole('button', { name: 'Clear search' });
    clear.focus();
    fireEvent.click(clear);
    expect(field().value).toBe('');
    expect(screen.getByRole('button', { name: 'age header — copy' })).toBeTruthy();
    expect(document.activeElement).toBe(field());
  });

  it('Esc in the field clears it and restores the full list', () => {
    renderView(makeFdtData({ pageHeaders: HEADERS }));
    typeAndCommit('age');
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(field().value).toBe('');
    expect(sectionNames()).toEqual(['Caching evidence 2 headers', 'Other headers 3 headers']);
    expect(status()).toBe('Showing all 5 entries');
  });

  it('commits on the debounce, never per keystroke', () => {
    renderView(makeFdtData({ pageHeaders: HEADERS }));
    const live = (): string | null =>
      document.querySelector('[data-fdt="headers-results-status"]')?.getAttribute('aria-live') ??
      null;
    const liveAtMount = live();
    fireEvent.input(field(), { target: { value: 'age' } });
    // Before the quiet period elapses: the echo shows, nothing else moved —
    // the count line, its live switch and the list are untouched.
    expect(field().value).toBe('age');
    expect(status()).toBe('Showing all 5 entries');
    expect(live()).toBe(liveAtMount);
    expect(sectionNames()).toEqual(['Caching evidence 2 headers', 'Other headers 3 headers']);
    // The quiet period elapses: the query commits and the list narrows.
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(status()).toBe('Showing 1 of 5 entries');
  });

  it('a stale query over a scaffold-only list renders the scaffold, never No matches', () => {
    const [data, setData] = createSignal(
      makeFdtData({ pageHeaders: HEADERS, cookies: { names: ['a'], capturedAt: NOW } })
    );
    const store = createSearchStore();
    render(() => (
      <HeadersCookiesView
        data={data()}
        search={store}
        fetchedAt={NOW}
        now={NOW}
        createVirtualizer={everyRow}
      />
    ));
    typeAndCommit('age');
    // The refresh lands an all-empty payload (no headers, zero cookie
    // names): the live query has no searchable rows left to hide, so the
    // filter does not apply and the scaffold (section + note) renders.
    setData(makeFdtData({ pageHeaders: null, cookies: { names: [], capturedAt: NOW } }));
    expect(screen.getByText('No response headers captured')).toBeTruthy();
    expect(screen.getByText('No cookies are readable by page scripts.')).toBeTruthy();
    expect(screen.queryByText('No matches')).toBeNull();
    // The live query is reported honestly over the scaffold-only list: the
    // store's find count is 0 (nothing searchable remains to hide).
    expect(store.matchCount()).toBe(0);
    // The way back is not needed: no field exists to clear.
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('announces the committed count and stays quiet through a refresh', () => {
    const [data, setData] = createSignal(makeFdtData({ pageHeaders: HEADERS }));
    render(() => (
      <HeadersCookiesView
        data={data()}
        search={createSearchStore()}
        fetchedAt={NOW}
        now={NOW}
        createVirtualizer={everyRow}
      />
    ));
    const region = (): Element | null =>
      document.querySelector('[data-fdt="headers-results-status"]');
    expect(status()).toBe('Showing all 5 entries');
    typeAndCommit('age');
    expect(status()).toBe('Showing 1 of 5 entries');
    expect(region()?.getAttribute('aria-live')).toBe('polite');
    // A data refresh keeps the text true and mutes the announcement.
    setData(makeFdtData({ pageHeaders: HEADERS.map((row) => ({ ...row })) }));
    expect(status()).toBe('Showing 1 of 5 entries');
    expect(region()?.getAttribute('aria-live')).toBe('off');
    // The filtered state survives the refresh; a new commit announces again.
    expect(field().value).toBe('age');
    typeAndCommit('cache');
    expect(status()).toBe('Showing 1 of 5 entries');
    expect(region()?.getAttribute('aria-live')).toBe('polite');
  });

  it('presents each verdict hint with its evidence tone on the icon', () => {
    renderView(
      makeFdtData({
        pageHeaders: [
          { name: 'x-cache', value: 'HIT from cdn-1' },
          { name: 'cache-control', value: 'no-store' },
          { name: 'via', value: '1.1 squid-3' }
        ]
      })
    );
    // The hint line's leading icon is the tone carrier: the shared status
    // vocabulary's class on the row's one toned svg — decorative (hidden
    // from the accessibility tree; the wording states the verdict).
    const iconOf = (name: string): string | null =>
      screen
        .getByRole('button', { name })
        .closest('[role="listitem"]')
        ?.querySelector('svg[class*="text-status-"]')
        ?.getAttribute('class') ?? null;
    expect(iconOf('x-cache header — copy')).toContain('text-status-ok');
    expect(iconOf('cache-control header — copy')).toContain('text-status-warn');
    expect(iconOf('via header — copy')).toContain('text-status-info');
    // The icon is decorative: hidden from the accessibility tree — the
    // wording, not the color or the shape alone, states the verdict.
    expect(
      screen
        .getByRole('button', { name: 'x-cache header — copy' })
        .closest('[role="listitem"]')
        ?.querySelector('svg[class*="text-status-"]')
        ?.getAttribute('aria-hidden')
    ).toBe('true');
  });

  it('the withheld legend is stable page meta: present with the capture, unmoved by the filter', () => {
    renderView(makeFdtData({ pageHeaders: HEADERS }));
    expect(document.querySelectorAll('[data-fdt="withheld-legend"]')).toHaveLength(1);
    typeAndCommit('age');
    expect(document.querySelectorAll('[data-fdt="withheld-legend"]')).toHaveLength(1);
  });
});

describe('HeadersCookiesPage — store wiring', () => {
  /** A store double over a settable machine state. */
  function storeOf(initial: DataState): { store: FdtDataStore; set: (s: DataState) => void } {
    const [state, set] = createSignal<DataState>(initial);
    return {
      store: { state, start: vi.fn(), stop: vi.fn(), retry: vi.fn(), reload: vi.fn() },
      set
    };
  }

  /** Render the page under the shell's two contexts, over one real search store. */
  function renderPage(
    initial: DataState,
    search: SearchStore = createSearchStore()
  ): { set: (s: DataState) => void; search: SearchStore; unmount: () => void } {
    const { store, set } = storeOf(initial);
    const renderer = render(() => (
      <SearchContext.Provider value={search}>
        <FdtDataContext.Provider value={store}>
          <HeadersCookiesPage createVirtualizer={everyRow} />
        </FdtDataContext.Provider>
      </SearchContext.Provider>
    ));
    return { set, search, unmount: renderer.unmount };
  }

  it('shows the fetch stamp, holds it across a refresh, ticks, and stops its clock on unmount', () => {
    vi.useFakeTimers({ now: NOW });
    const data = makeFdtData({ pageHeaders: HEADERS });
    const { set, unmount } = renderPage({ status: 'ready', data, fetchedAt: NOW });
    expect(screen.getByText('Fetched just now')).toBeTruthy();
    // A committed query first: a refresh must keep the field and the query.
    typeAndCommit('age');
    expect(status()).toBe('Showing 1 of 5 entries');
    const fetchedLine = document.querySelector('[data-fdt="headers-fetched"]');
    if (!(fetchedLine instanceof HTMLElement)) throw new Error('the fetched line did not render');
    // A soft refresh keeps the fetch instant of the data still on screen.
    set({ status: 'refreshing', data, requestedAt: NOW + 60_000 });
    vi.advanceTimersByTime(120_000);
    expect(screen.getByText('Fetched 2 min ago')).toBeTruthy();
    // A new fetch re-stamps and delivers a NEW payload object: the page
    // keeps its fetched-line node, the field, and the committed query — the
    // announcement mutes (aria-live off) while its text stays true.
    set({
      status: 'ready',
      data: makeFdtData({ pageHeaders: HEADERS.map((row) => ({ ...row })) }),
      fetchedAt: NOW + 120_000
    });
    expect(screen.getByText('Fetched just now')).toBeTruthy();
    expect(document.querySelector('[data-fdt="headers-fetched"]')).toBe(fetchedLine);
    expect(field().value).toBe('age');
    expect(status()).toBe('Showing 1 of 5 entries');
    expect(
      document.querySelector('[data-fdt="headers-results-status"]')?.getAttribute('aria-live')
    ).toBe('off');
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the panel-wide find bar drives this page: its query filters, its cursor marks, its cancel clears', () => {
    vi.useFakeTimers({ now: NOW });
    const { search, set } = renderPage({
      status: 'ready',
      data: makeFdtData({ pageHeaders: HEADERS }),
      fetchedAt: NOW
    });
    // A blank find at mount is not a scroll order: the list holds still
    // until a find event happens.
    expect(landed).toEqual([]);
    // The find bar's stream (perform over the shared store) filters the
    // page: the field echoes the foreign query, the list narrows, and the
    // page reports the match count the cursor wraps over.
    search.perform('a');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(field().value).toBe('a');
    expect(status()).toBe('Showing 2 of 5 entries');
    // The cursor names the first matching row; a step moves the marker on
    // (wrap included — two matches: cache-control, then age).
    const marked = (): string | null =>
      document
        .querySelector('[data-fdt-inventory-row][aria-current="true"]')
        ?.querySelector('[data-fdt-key-value-term]')?.textContent ?? null;
    expect(marked()).toBe('cache-control');
    // The find's scroll lands the marked row's rendered position — the
    // match-table mapping (the cursor's match index sits at its row among
    // the section scaffolding), never a naive cursor→row read. The virtual
    // row wrapper owns the index.
    const markedIndex = (): number => {
      const wrapper = document
        .querySelector('[data-fdt-page] [aria-current="true"]')
        ?.closest<HTMLElement>('[data-index]');
      if (!(wrapper instanceof HTMLElement)) throw new Error('the marked row did not render');
      return Number(wrapper.dataset.index);
    };
    expect(landed).toEqual([markedIndex()]);
    search.advance(1);
    expect(marked()).toBe('age');
    expect(landed[landed.length - 1]).toBe(markedIndex());
    search.advance(1);
    expect(marked()).toBe('cache-control');
    // A refresh re-delivers the payload (a NEW object) under the live find:
    // the marker re-derives through the re-derived match table and the list
    // never re-scrolls — the find's scroll obeys find events only.
    const scrollsAtFind = landed.length;
    set({
      status: 'ready',
      data: makeFdtData({ pageHeaders: HEADERS.map((row) => ({ ...row })) }),
      fetchedAt: NOW + 120_000
    });
    expect(marked()).toBe('cache-control');
    expect(field().value).toBe('a');
    expect(status()).toBe('Showing 2 of 5 entries');
    expect(landed.length).toBe(scrollsAtFind);
    // Cancel ends the find: the marker goes, the field empties, the list
    // restores.
    search.cancel();
    expect(document.querySelector('[data-fdt-inventory-row][aria-current="true"]')).toBeNull();
    expect(field().value).toBe('');
    expect(status()).toBe('Showing all 5 entries');
  });

  it('the find names a cookie row too: the marker lands on a matched cookie name', () => {
    vi.useFakeTimers({ now: NOW });
    const { search } = renderPage({
      status: 'ready',
      data: makeFdtData({
        pageHeaders: HEADERS,
        cookies: { names: ['fdt_filter_alpha'], capturedAt: NOW }
      }),
      fetchedAt: NOW
    });
    // The term names only the cookie (no header name contains it): the
    // marker must land on the cookie row itself — the shared shape and
    // `aria-current`, never a header-only affordance.
    search.perform('filter');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(status()).toBe('Showing 1 of 6 entries');
    const row = document.querySelector('[data-fdt-inventory-row="cookie"][aria-current="true"]');
    if (!(row instanceof HTMLElement)) throw new Error('the cookie match did not render');
    expect(row.className).toContain(CURRENT_MATCH_ROW);
    // A cookie row's name is its whole visible text (the icon is decorative).
    expect(row.textContent).toBe('fdt_filter_alpha');
  });

  it('renders nothing outside the loaded states', () => {
    renderPage({ status: 'fetching' });
    expect(document.querySelector('[data-fdt-page]')).toBeNull();
  });
});

describe('inspectedReloadAction', () => {
  it('is absent outside a DevTools window', () => {
    expect(inspectedReloadAction({})).toBeUndefined();
    expect(inspectedReloadAction({ devtools: { inspectedWindow: {} } })).toBeUndefined();
  });

  it('reloads and confirms, or tells the user the remedy on a failure', async () => {
    const { toastItems: toasts } = await import('../../../../components/ui/toast-store');
    const reload = vi.fn();
    inspectedReloadAction({ devtools: { inspectedWindow: { reload } } })?.();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toasts().at(-1)?.title).toBe(
      'Reloading the page — the panel refreshes when it reports back'
    );
    inspectedReloadAction({
      devtools: {
        inspectedWindow: {
          reload: () => {
            throw new Error('Extension context invalidated.');
          }
        }
      }
    })?.();
    expect(toasts().at(-1)).toMatchObject({
      title: 'Reload failed',
      description: 'Reload the inspected page from its own tab.'
    });
  });
});
