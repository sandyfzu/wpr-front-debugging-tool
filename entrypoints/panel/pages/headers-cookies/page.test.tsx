/**
 * Render tests for the Headers & Cookies page, state by state: the full
 * inventory (sections, hints, per-row copy), the empty-headers state with and
 * without cookies, the older payload without a cookie capture, the empty
 * cookie capture, the two honest timestamps (fetch vs capture), the
 * no-cookie-value-in-the-DOM guarantee, refresh stability, and the store
 * wiring (fetch stamp held across a refresh, the aging clock's lifetime).
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
import { makeFdtData } from '../../state/fixtures';
import { FdtDataContext, type FdtDataStore } from '../../state/use-fdt-data';
import { REDACTED } from '../../../../lib/panel/redaction';
import {
  HeadersCookiesPage,
  HeadersCookiesView,
  inspectedReloadAction,
  SPA_NOTE,
  WITHHELD_NOTE
} from './page';

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

/**
 * A virtualizer double: every row, stacked at a fixed pitch, live over
 * `count`. Items are reused per index, like the real adapter's reconciled
 * store, so a data refresh does not remount rows.
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
    measureElement: () => undefined
  };
};

/** Render the view for a payload. */
function renderView(data: FdtData, fetchedAt: number | null = NOW - 120_000): void {
  render(() => (
    <HeadersCookiesView data={data} fetchedAt={fetchedAt} now={NOW} createVirtualizer={everyRow} />
  ));
}

/** The level-2 section headings, in order. */
function sectionNames(): string[] {
  return screen
    .queryAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent.replace(/\s+/g, ' ').trim());
}

let writes: string[];

beforeEach(() => {
  writes = [];
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
    const redacted = [...document.querySelectorAll('[data-fdt-redacted]')].map(
      (n) => n.textContent
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
  it('explains a withheld value under it, with a lock, in the row', () => {
    renderView(makeFdtData({ pageHeaders: [{ name: 'Authorization', value: 'Bearer x' }] }));
    const row = screen
      .getByRole('button', { name: 'Authorization header — copy' })
      .closest('[role="listitem"]');
    expect(row?.textContent).toContain(REDACTED);
    expect(row?.textContent).toContain(WITHHELD_NOTE);
    expect(row?.querySelector('svg.lucide-lock, svg')).not.toBeNull();
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
        fetchedAt={0}
        now={NOW}
        createVirtualizer={everyRow}
      />
    ));
    expect(document.querySelector('[data-fdt="headers-fetched"]')?.textContent).toMatch(
      /^Fetched \d+ d ago/
    );
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
      <HeadersCookiesView data={data()} fetchedAt={NOW} now={NOW} createVirtualizer={everyRow} />
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

describe('HeadersCookiesPage — store wiring', () => {
  /** A store double over a settable machine state. */
  function storeOf(initial: DataState): { store: FdtDataStore; set: (s: DataState) => void } {
    const [state, set] = createSignal<DataState>(initial);
    return {
      store: { state, start: vi.fn(), stop: vi.fn(), retry: vi.fn(), reload: vi.fn() },
      set
    };
  }

  it('shows the fetch stamp, holds it across a refresh, ticks, and stops its clock on unmount', () => {
    vi.useFakeTimers({ now: NOW });
    const data = makeFdtData({ pageHeaders: HEADERS });
    const { store, set } = storeOf({ status: 'ready', data, fetchedAt: NOW });
    const { unmount } = render(() => (
      <FdtDataContext.Provider value={store}>
        <HeadersCookiesPage />
      </FdtDataContext.Provider>
    ));
    expect(screen.getByText('Fetched just now')).toBeTruthy();
    // A soft refresh keeps the fetch instant of the data still on screen.
    set({ status: 'refreshing', data, requestedAt: NOW + 60_000 });
    vi.advanceTimersByTime(120_000);
    expect(screen.getByText('Fetched 2 min ago')).toBeTruthy();
    // A new fetch re-stamps.
    set({ status: 'ready', data, fetchedAt: NOW + 120_000 });
    expect(screen.getByText('Fetched just now')).toBeTruthy();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders nothing outside the loaded states', () => {
    const { store } = storeOf({ status: 'fetching' });
    render(() => (
      <FdtDataContext.Provider value={store}>
        <HeadersCookiesPage />
      </FdtDataContext.Provider>
    ));
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
    expect(toasts().at(-1)?.title).toBe('Reloading the inspected page');
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
