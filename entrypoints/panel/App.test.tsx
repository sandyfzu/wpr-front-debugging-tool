/**
 * The panel shell's render tests: boot states render as real states
 * (skeleton → page body), the error branch renders its retry (and a retry
 * click recovers), the header nav is registry-driven (every row a link), route
 * switching swaps the body for the registry row's own page (exactly one h1
 * in the document at any time) and resets the search store; a soft refresh
 * preserves the mounted page (node identity, scroll, focus, route) while the
 * data swaps, the Detections layout choice outlives route and ready-branch
 * remounts, the detail presence reaches page bodies and resets per route,
 * unmount cancels the search flow, and a page body that throws meets the
 * crash boundary's actionable reload. The stores are injected; no
 * messaging API is touched here.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FdtData } from '../../lib/wp-rocket/types';
import { toast, toastItems } from '../../components/ui/toast-store';
import type { Appearance } from '../../utils/theme';
import { PanelApp } from './App';
import { APPEARANCE_FAILURE_TITLE, APPEARANCE_SAVE_NOTE } from './appearance-write';
import { createSearchStore, type SearchStore } from './state/search';
import { useDetailPresence, type DetailPresenceStore } from './state/detail-presence';
import {
  NO_PAGE_TRANSPORT_REASON,
  createFdtDataStore,
  type FdtDataStore
} from './state/use-fdt-data';
import { DATA_UNAVAILABLE_TITLE } from './data-unavailable';
import type { PanelReceivers } from './state/edges';
import { makeFdtData, makeHardReloadBudget } from './state/fixtures';
import { PAGES } from './pages';
import { ROUTE_IDS } from './routes';

/** One page load's worth of valid data. */
const pageData = (): FdtData => makeFdtData({ allScriptsLoaded: false });

/** The shell under test, with a controlled request world for one render. */
interface ShellParts {
  /** Submits the pending `request`'s payload (resolves the flight). */
  settle: (payload: unknown) => void;
  /** Rejects the pending request's flight. */
  fail: (cause: unknown) => void;
  /** Deliver the in-tab reload notification to the registered receivers. */
  deliverReload: () => void;
  /** Deliver one push payload to the registered receivers (tab-scoped in). */
  deliver: (channel: 'onAllScriptsLoaded' | 'onUndefinedReferences', payload: unknown) => void;
  /** Request invocations so far (each flight asks exactly once). */
  requests: () => number;
  search: SearchStore;
  data: FdtDataStore;
}

/**
 * Build the store pair the shell consumes: a never-resolving request by
 * default (tests settle or reject it explicitly), a real search store, and
 * a fixed inspected tab; the registered receivers are captured so tests can
 * deliver events exactly like the transport does.
 */
function makeShell(canRequest = true): ShellParts {
  let settle!: (payload: unknown) => void;
  let failFlight!: (cause: unknown) => void;
  let requestCount = 0;
  let receivers: PanelReceivers | null = null;
  const search = createSearchStore();
  const data = createFdtDataStore({
    inspectedTabId: () => 77,
    request: () => {
      requestCount += 1;
      return new Promise<unknown>((resolve, reject) => {
        settle = resolve;
        failFlight = reject;
      });
    },
    receive: (registered: PanelReceivers) => {
      receivers = registered;
      return () => {
        receivers = null;
      };
    },
    search,
    reload: vi.fn(),
    canRequest: () => canRequest,
    hardReloadBudget: makeHardReloadBudget(),
    now: () => 1727000000000
  });
  return {
    settle: (payload) => {
      settle(payload);
    },
    fail: (cause) => {
      failFlight(cause);
    },
    deliverReload: () => {
      if (receivers === null) throw new Error('shell receivers are not registered');
      receivers.onPanelReload(77);
    },
    deliver: (channel, payload) => {
      if (receivers === null) throw new Error('shell receivers are not registered');
      (receivers[channel] as (value: unknown, tabId: number) => void)(payload, 77);
    },
    search,
    data,
    requests: () => requestCount
  };
}

/** Walk the shell to a route the way any anchor or deep link would. */
function hashTo(id: string): void {
  window.location.hash = `#/${id}`;
  window.dispatchEvent(new Event('hashchange'));
}

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('PanelApp boot states', () => {
  it.each(ROUTE_IDS)(
    'keeps %s on its canvas through loading, error, retry and ready',
    async (id) => {
      hashTo(id);
      const shell = makeShell();
      render(() => <PanelApp search={shell.search} data={shell.data} />);
      const expected = id === 'undefined-references' ? 'max-w-4xl' : 'max-w-7xl';
      /** Assert the width policy without relying on layout unavailable in happy-dom. */
      const assertCanvas = (): void => {
        const body = document.querySelector('[data-fdt="panel-content"] [data-fdt="page-body"]');
        expect(body?.classList).toContain(expected);
        expect(body?.classList).toContain('mx-auto');
        expect(body?.classList).toContain('p-3');
      };
      assertCanvas();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { name: 'Loading page data' })).toBeTruthy();
      const placeholders = document.querySelectorAll(
        '[data-fdt-page="fetching"] [data-fdt="skeleton"]'
      );
      // Three page bars everywhere; Detections adds its overview's four tile placeholders.
      const overview = document.querySelector(
        '[data-fdt-page="fetching"] [data-fdt="detections-overview-skeleton"]'
      );
      expect(overview !== null).toBe(id === 'detections');
      expect(placeholders).toHaveLength(id === 'detections' ? 7 : 3);
      expect(overview?.querySelectorAll('[data-fdt="skeleton"]').length ?? 0).toBe(
        id === 'detections' ? 4 : 0
      );
      for (const placeholder of placeholders) {
        if (!placeholder.classList.contains('w-full'))
          expect(placeholder.classList).toContain('max-w-full');
      }
      shell.fail(new Error('Could not establish connection. Receiving end does not exist.'));
      await waitFor(() => {
        expect(screen.getByText("Couldn't load page data")).toBeTruthy();
      });
      assertCanvas();
      expect(screen.getAllByRole('heading')).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 1, name: "Couldn't load page data" })
      ).toBeTruthy();
      shell.data.retry();
      assertCanvas();
      expect(screen.getAllByRole('heading')).toHaveLength(1);
      expect(screen.getByRole('heading', { name: 'Loading page data' })).toBeTruthy();
      shell.settle(pageData());
      await waitFor(() => {
        expect(document.querySelector(`[data-fdt-page="${id}"] h1`)).not.toBeNull();
      });
      assertCanvas();
    }
  );

  it('renders the explicit unavailable view (no retry, no request) when tabs cannot be messaged', () => {
    const shell = makeShell(false);
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    const view = document.querySelector('[data-fdt="data-unavailable"]');
    expect(view).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: DATA_UNAVAILABLE_TITLE })).toBeTruthy();
    expect(view?.textContent).toContain(NO_PAGE_TRANSPORT_REASON);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText("Couldn't load page data")).toBeNull();
    expect(document.querySelector('[data-fdt="error-state"]')).toBeNull();
    expect(document.querySelector('[data-fdt="panel-status"]')?.textContent).toBe(
      DATA_UNAVAILABLE_TITLE
    );
    expect(shell.requests()).toBe(0);
    hashTo('javascript');
    expect(document.querySelector('[data-fdt="data-unavailable"]')).not.toBeNull();
  });

  it('updates the loading and error canvas when the route changes before data arrives', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    const loading = document.querySelector('[data-fdt-page="fetching"]');
    hashTo('undefined-references');
    expect(loading?.querySelector('[data-fdt="page-body"]')?.classList).toContain('max-w-4xl');
    expect(document.querySelector('[data-fdt-page="fetching"]')).toBe(loading);
    shell.fail(new Error('Could not establish connection. Receiving end does not exist.'));
    await waitFor(() => {
      expect(screen.getByText("Couldn't load page data")).toBeTruthy();
    });
    hashTo('javascript');
    expect(document.querySelector('[data-fdt="page-body"]')?.classList).toContain('max-w-7xl');
  });

  it('renders the fetching skeleton first, then the page body on settle', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Loading page data' })).toBeTruthy();
    expect(document.querySelector('[data-fdt-page="fetching"]')).not.toBeNull();

    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Detections' })).toBeTruthy();
    });
  });

  it('holds the exclusion builder entry in the top bar controls, even before page data', async () => {
    const shell = makeShell();
    const askStatus = vi.fn(() =>
      Promise.resolve({ kind: 'reply', reply: { state: 'inactive' } } as const)
    );
    render(() => (
      <PanelApp
        search={shell.search}
        data={shell.data}
        builderEntry={{
          inspectedTabId: () => 77,
          askStatus,
          open: () => Promise.resolve({ kind: 'reply', reply: 'injected' } as const),
          listen: () => () => undefined
        }}
        // A full-width shell: the labeled entry sits inline (a folded bar
        // keeps a quiet entry in its "⋯" menu).
        observeShellWidth={(_element, onWidth) => {
          onWidth(1100);
          return () => undefined;
        }}
      />
    ));
    const bar = screen.getByRole('banner', { name: 'Page status' });
    const control = await waitFor(() => {
      const found = bar.querySelector('[data-fdt="builder-entry"]');
      if (found === null) throw new Error('no builder entry');
      return found;
    });
    // Among the bar's trailing controls (the end slot), never an answer.
    expect(control.closest('[data-fdt-app-bar-slot]')?.getAttribute('data-fdt-app-bar-slot')).toBe(
      'end'
    );
    expect(askStatus).toHaveBeenCalledWith(77);
    // The answer reached it: the quiet "Off" rides the title (no badge).
    await waitFor(() => {
      expect(control.getAttribute('title')).toBe('No exclusions applied in this tab.');
    });
  });

  it('keeps exactly one h1 in the document per page body', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });
  });

  it('renders the actionable error state and recovers through its retry', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    shell.fail(new Error('Could not establish connection. Receiving end does not exist.'));
    await waitFor(() => {
      expect(screen.getByText("Couldn't load page data")).toBeTruthy();
      expect(screen.getByText(/no data source reachable/)).toBeTruthy();
    });
    expect(shell.requests()).toBe(1);

    shell.data.retry();
    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Detections' })).toBeTruthy();
    });
    expect(shell.requests()).toBe(2);
  });
});

describe('PanelApp shell structure', () => {
  it('renders every nav row and pins the ready route with aria-current', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Detections' })).toBeTruthy();
    });
    // The Undefined References row answers its state before the page data
    // settles (the fixture never loads scripts, so the row is "Monitoring"
    // by design) — its name carries the suffix.
    for (const label of ['Detections', 'JavaScript', 'Lazyload', 'Preloaded Resources']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: /Undefined References/ })).toBeTruthy();
    // Anchors stay real links (hash form); the ready route pins itself.
    expect(screen.getByRole('link', { name: 'Detections' }).getAttribute('href')).toBe(
      '#/detections'
    );
    expect(screen.getByRole('link', { name: 'Detections' }).getAttribute('aria-current')).toBe(
      'page'
    );
    hashTo('javascript');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'JavaScript' })).toBeTruthy();
    });
    expect(
      screen.getByRole('link', { name: 'Detections' }).getAttribute('aria-current')
    ).toBeNull();
    expect(screen.getByRole('link', { name: 'JavaScript' }).getAttribute('aria-current')).toBe(
      'page'
    );
  });

  it('keeps the rail geometry (header column with its right edge) at every width', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Detections' })).toBeTruthy();
    });
    // The shell is the brand-over-rail column beside the content region —
    // the only geometry, at every window size (the top-bar form is retired;
    // its redesign is a later phase's work).
    const header = document.querySelector('[data-fdt="panel-header"]') as HTMLElement;
    expect(header.className).toContain('flex-col'); // the rail column
    expect(header.className).toContain('border-r'); // the rail's edge
    const nav = document.querySelector('[data-fdt="panel-nav"]') as HTMLElement;
    expect(nav.className).toContain('flex-col');
    const shellRoot = document.querySelector('[data-fdt="panel-shell"]') as HTMLElement;
    expect(shellRoot.className).toContain('flex'); // header and content share the row
    // No container-query variants survive in any shell class.
    for (const element of [header, nav, shellRoot]) {
      expect(element.className).not.toContain('@min-');
    }
  });

  it('swaps the page body per route (and only ever one h1)', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Detections' })).toBeTruthy();
    });
    hashTo('javascript');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'JavaScript' })).toBeTruthy();
    });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('resets the search store when the route changes', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Detections' })).toBeTruthy();
    });
    shell.search.setMatchCount(3);
    shell.search.advance(1);
    shell.search.advance(1);
    expect(shell.search.cursor()).toBe(2);
    hashTo('lazyload');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Lazyload' })).toBeTruthy();
    });
    expect(shell.search.matchCount()).toBe(0);
    expect(shell.search.cursor()).toBe(0);
    expect(shell.search.query()).toBe('');
  });

  it('announces state machine transitions through the live region', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    const region = document.querySelector('[data-fdt="panel-status"]');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.textContent).toBe('Loading page data');
    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getByText('Detections loaded')).toBeTruthy();
    });
  });
});

describe('the top bar in the shell', () => {
  it('mounts the bar above the rail-and-content row, outside the content region, honest at boot', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    // The bar exists inside the shell, outside the scrolling content
    // region, above the nav + content row, and claims nothing before data.
    const bar = document.querySelector('[data-fdt="panel-top-bar"]') as HTMLElement;
    const shellRoot = document.querySelector('[data-fdt="panel-shell"]') as HTMLElement;
    const content = document.querySelector('[data-fdt="panel-content"]') as HTMLElement;
    const nav = document.querySelector('[data-fdt="panel-header"]') as HTMLElement;
    expect(shellRoot.contains(bar)).toBe(true);
    expect(content.contains(bar)).toBe(false);
    expect(bar.parentElement?.getAttribute('data-fdt')).toBe('panel-stack');
    expect(bar.parentElement?.firstElementChild).toBe(bar);
    expect(bar.nextElementSibling?.contains(nav)).toBe(true);
    expect(bar.nextElementSibling?.contains(content)).toBe(true);
    // Both chrome bands keep their paint priority over the content (UX-D15).
    for (const band of [bar, nav]) {
      expect(band.classList).toContain('relative');
      expect(band.classList).toContain('z-10');
    }
    // Nothing renders below the content row (no footer landmark).
    expect(screen.queryByRole('contentinfo')).toBeNull();
    // One banner: the bar (the nav column is not a landmark of its own).
    expect(screen.getAllByRole('banner')).toEqual([bar]);
    expect(screen.queryByText('Not detected')).toBeNull();
    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Not detected' })).toBeTruthy();
    });
  });

  it('folds the bar from the measured shell width (never the viewport)', async () => {
    const shell = makeShell();
    let report: ((width: number) => void) | undefined;
    const observed: HTMLElement[] = [];
    render(() => (
      <PanelApp
        search={shell.search}
        data={shell.data}
        observeShellWidth={(element, onWidth) => {
          observed.push(element);
          report = onWidth;
          return () => undefined;
        }}
      />
    ));
    expect(observed.map((element) => element.dataset.fdt)).toEqual(['panel-shell']);
    report?.(1100);
    expect(screen.queryByRole('button', { name: /^More:/ })).toBeNull();
    expect(screen.getByText('WPR FDT').className).not.toContain('sr-only');
    report?.(420);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^More:/ })).toBeTruthy();
    });
    expect(screen.getByText('WPR FDT').className).toContain('sr-only');
  });

  it('shows the inspected address the shell reads on each settle', async () => {
    const shell = makeShell();
    const readPageUrl = vi.fn(() => Promise.resolve('https://example.com/blog/'));
    render(() => (
      <PanelApp
        search={shell.search}
        data={shell.data}
        readPageUrl={readPageUrl}
        observeShellWidth={(_element, onWidth) => {
          onWidth(1100);
          return () => undefined;
        }}
      />
    ));
    shell.settle(pageData());
    await waitFor(() => {
      expect(document.querySelector('[data-fdt="top-bar-address"]')?.textContent).toBe(
        'example.com/blog/'
      );
    });
    expect(readPageUrl).toHaveBeenCalledTimes(1);
  });
});

describe('the sidebar in the shell', () => {
  /** Mount the shell at a fixed width with a boot pin and a traced writer. */
  function mountAt(width: number, navPin?: 'auto' | 'labeled' | 'rail') {
    const shell = makeShell();
    const writeNavPin = vi.fn(() => Promise.resolve());
    render(() => (
      <PanelApp
        search={shell.search}
        data={shell.data}
        navPin={navPin}
        writeNavPin={writeNavPin}
        observeShellWidth={(_element, onWidth) => {
          onWidth(width);
          return () => undefined;
        }}
      />
    ));
    shell.settle(pageData());
    return { writeNavPin };
  }

  /** The nav column's rendered form. */
  const form = (): string | null | undefined =>
    document.querySelector('[data-fdt="panel-header"]')?.getAttribute('data-fdt-nav-form');

  it('is labeled on a wide panel without a pin, the rail on a narrow one', () => {
    mountAt(1280);
    expect(form()).toBe('labeled');
    cleanup();
    mountAt(900);
    expect(form()).toBe('rail');
  });

  it('renders the boot pin from the first frame (no fold flash)', () => {
    mountAt(1280, 'rail');
    expect(form()).toBe('rail');
    cleanup();
    mountAt(900, 'labeled');
    expect(form()).toBe('labeled');
  });

  it('writes the toggled pin through the injected writer', () => {
    const { writeNavPin } = mountAt(1280);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(form()).toBe('rail');
    expect(writeNavPin).toHaveBeenCalledWith('rail');
  });

  it('folds while a page holds a detail open', async () => {
    const shell = makeShell();
    const originalBody = PAGES['detections'];
    let presence: DetailPresenceStore | undefined;
    PAGES['detections'] = (): JSX.Element => {
      presence = useDetailPresence();
      return <h1>Probe</h1>;
    };
    try {
      render(() => (
        <PanelApp
          search={shell.search}
          data={shell.data}
          observeShellWidth={(_element, onWidth) => {
            onWidth(1280);
            return () => undefined;
          }}
        />
      ));
      shell.settle(pageData());
      await waitFor(() => {
        expect(presence).toBeDefined();
      });
      expect(form()).toBe('labeled');
      const claim = (presence as DetailPresenceStore).claim();
      claim.set(true);
      expect(form()).toBe('rail');
      claim.release();
      expect(form()).toBe('labeled');
    } finally {
      PAGES['detections'] = originalBody;
      cleanup();
    }
  });
});

describe('the appearance menu in the top bar', () => {
  afterEach(() => {
    toast.clear();
    vi.restoreAllMocks();
  });

  /**
   * Render the shell at a width with an appearance value and writer.
   *
   * @param width The measured shell width.
   * @param write The writer double.
   * @returns The value setter.
   */
  function renderWithAppearance(
    width: number,
    write: (next: Appearance) => Promise<void> = () => Promise.resolve()
  ): (next: Appearance) => void {
    const shell = makeShell();
    const [appearance, setAppearance] = createSignal<Appearance>('dark');
    render(() => (
      <PanelApp
        search={shell.search}
        data={shell.data}
        appearance={appearance}
        writeAppearance={write}
        observeShellWidth={(_element, onWidth) => {
          onWidth(width);
          return () => undefined;
        }}
      />
    ));
    return setAppearance;
  }

  /** Open the menu and pick a row by its name. */
  async function pick(name: string): Promise<void> {
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Appearance: / }));
    const menu = await screen.findByRole('menu');
    fireEvent.pointerUp(within(menu).getByRole('menuitemradio', { name }), { button: 0 });
  }

  it.each([1100, 420])(
    'sits in the end slot right before "⋯" at %ipx, showing the stored choice',
    (width) => {
      const setAppearance = renderWithAppearance(width);
      const control = document.querySelector('[data-fdt="appearance-menu"]') as HTMLElement;
      expect(control.closest('[data-fdt-app-bar-slot="end"]')).toBeTruthy();
      expect(control.nextElementSibling?.getAttribute('data-fdt')).toBe('top-bar-menu-box');
      expect(screen.getByRole('button', { name: 'Appearance: Dark' })).toBeTruthy();
      setAppearance('light');
      expect(screen.getByRole('button', { name: 'Appearance: Light' })).toBeTruthy();
    }
  );

  it('renders no appearance menu without a stored value to show', () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    expect(document.querySelector('[data-fdt="appearance-menu"]')).toBeNull();
  });

  it('writes a pick through the surface writer, quietly', async () => {
    const write = vi.fn(() => Promise.resolve());
    renderWithAppearance(1100, write);
    await pick('Light');
    expect(write.mock.calls).toEqual([['light']]);
    await Promise.resolve();
    expect(toastItems()).toEqual([]);
  });

  it('answers a failed write with the remedy toast and keeps the shown choice', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const write = vi.fn(() => Promise.reject(new Error('Extension context invalidated')));
    renderWithAppearance(1100, write);
    await pick('System');
    await waitFor(() => {
      expect(toastItems().map((item) => [item.tone, item.title, item.description])).toEqual([
        ['error', APPEARANCE_FAILURE_TITLE, APPEARANCE_SAVE_NOTE]
      ]);
    });
    // Nothing stored, nothing moved: the control still names the stored choice.
    expect(screen.getByRole('button', { name: 'Appearance: Dark' })).toBeTruthy();
  });
});

describe('soft refresh preservation (the render-level contract)', () => {
  it('replaces only the data: the page node, scroll, focus and route stay put', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Detections' })).toBeTruthy();
    });

    // Driver-side state the swap must not disturb: scroll on the content
    // region, focus on a nav link that is not the active route, and the
    // active route's aria-current.
    const content = document.querySelector('[data-fdt="panel-content"]') as HTMLElement;
    content.scrollTop = 40;
    const javascriptLink = screen.getByRole('link', { name: 'JavaScript' });
    javascriptLink.focus();
    const activePage = screen.getByRole('link', { name: 'Detections' });
    expect(activePage.getAttribute('aria-current')).toBe('page');
    const body = document.querySelector('[data-fdt-page="detections"]');
    expect(body).not.toBeNull();

    // The soft refresh: notify (ready → refreshing) → the fresh page load.
    shell.deliverReload();
    expect(shell.requests()).toBe(2);
    shell.settle(makeFdtData({ allScriptsLoaded: true }));
    await waitFor(() => {
      expect(screen.getByText('Detections loaded')).toBeTruthy();
    });

    // The very same DOM nodes — the body was not rebuilt, only re-fed:
    expect(document.querySelector('[data-fdt-page="detections"]')).toBe(body);
    expect(screen.getByRole('heading', { level: 1, name: 'Detections' })).toBeTruthy();
    // ...and the driver-side state survives the ready→refreshing→ready trip:
    expect(content.scrollTop).toBe(40);
    expect(document.activeElement).toBe(javascriptLink);
    expect(activePage.getAttribute('aria-current')).toBe('page');
  });
});

describe('the Detections layout choice (shell-owned)', () => {
  /** The Detections grid's current layout hook (`undefined` when unmounted). */
  const gridLayout = (): string | undefined =>
    document.querySelector<HTMLElement>('[data-fdt="detections-grid"]')?.dataset.fdtLayout;

  it('survives a route round-trip and a ready → error → fetching → ready remount', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    shell.settle(pageData());
    await waitFor(() => {
      expect(gridLayout()).toBe('adaptive');
    });
    fireEvent.click(screen.getByText('List'));
    expect(gridLayout()).toBe('list');

    // The route body unmounts and remounts.
    hashTo('javascript');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'JavaScript' })).toBeTruthy();
    });
    hashTo('detections');
    await waitFor(() => {
      expect(gridLayout()).toBe('list');
    });

    // A failed soft refresh leaves the ready branch; the retry's fetch and
    // settle mount a fresh one, which must read the same shell store.
    shell.deliverReload();
    shell.fail(new Error('Could not establish connection. Receiving end does not exist.'));
    await waitFor(() => {
      expect(screen.getByText("Couldn't load page data")).toBeTruthy();
    });
    expect(gridLayout()).toBeUndefined();
    shell.data.retry();
    expect(document.querySelector('[data-fdt-page="fetching"]')).not.toBeNull();
    shell.settle(pageData());
    await waitFor(() => {
      expect(gridLayout()).toBe('list');
    });
  });
});

describe('the detail presence (shell-owned)', () => {
  it('reaches page bodies and resets when the route changes', async () => {
    const shell = makeShell();
    const originalBody = PAGES['detections'];
    let presence: DetailPresenceStore | undefined;
    PAGES['detections'] = (): JSX.Element => {
      presence = useDetailPresence();
      return <h1>Probe</h1>;
    };
    try {
      render(() => <PanelApp search={shell.search} data={shell.data} />);
      shell.settle(pageData());
      await waitFor(() => {
        expect(presence).toBeDefined();
      });
      const store = presence as DetailPresenceStore;
      expect(store.detailOpen()).toBe(false);
      store.claim().set(true);
      expect(store.detailOpen()).toBe(true);
      hashTo('javascript');
      expect(store.detailOpen()).toBe(false);
    } finally {
      PAGES['detections'] = originalBody;
      cleanup();
    }
  });
});

describe('unmount + crash boundaries', () => {
  it('cancels the search flow at unmount (no pending commit survives)', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Detections' })).toBeTruthy();
    });
    shell.search.setMatchCount(3);
    shell.search.advance(1);
    shell.search.advance(1);
    shell.search.perform('wp rocket');
    // Unmount without a route change: the route-reset effect cannot have
    // run, so the cleanup wiring is the only channel that can clear.
    cleanup();
    expect(shell.search.cursor()).toBe(0);
    expect(shell.search.matchCount()).toBe(0);
    expect(shell.search.query()).toBe('');
  });

  it('answers a page body that throws with an actionable reload (never a bare message)', async () => {
    const shell = makeShell();
    const reload = vi.fn();
    const originalBody = PAGES['detections'];
    PAGES['detections'] = (): never => {
      throw new Error('boom — a body bug');
    };
    try {
      render(() => <PanelApp search={shell.search} data={shell.data} reload={reload} />);
      shell.settle(pageData());
      await waitFor(() => {
        expect(screen.getByText('The panel came apart')).toBeTruthy();
      });
      // The card explains the recovery, not the raw failure:
      expect(screen.getAllByRole('heading')).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: 'The panel came apart' })).toBeTruthy();
      expect(screen.getByText(/Reloading the panel restores it/)).toBeTruthy();
      expect(screen.queryByText('boom — a body bug')).toBeNull();
      expect(document.querySelector('[data-fdt="page-body"]')?.classList).toContain('max-w-7xl');
      hashTo('undefined-references');
      expect(document.querySelector('[data-fdt="page-body"]')?.classList).toContain('max-w-4xl');
      // The retry affordance reloads the whole panel document:
      screen.getByRole('button', { name: 'Retry' }).click();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      PAGES['detections'] = originalBody;
      cleanup();
    }
  });
});
