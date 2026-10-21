/**
 * The panel shell's render tests: boot states render as real states
 * (skeleton → page body), the error branch renders its retry (and a retry
 * click recovers), the header nav is registry-driven (five navigable rows,
 * the reserved Diagnoser row disabled with its explaining trigger), route
 * switching swaps the body for the registry row's own page (exactly one h1
 * in the document at any time) and resets the search store; a soft refresh
 * preserves the mounted page (node identity, scroll, focus, route) while the
 * data swaps, unmount cancels the search flow, and a page body that throws
 * meets the crash boundary's actionable reload. The stores are injected; no
 * messaging API is touched here.
 */
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FdtData } from '../../lib/wp-rocket/types';
import { PanelApp } from './App';
import { createSearchStore, type SearchStore } from './state/search';
import { createFdtDataStore, type FdtDataStore } from './state/use-fdt-data';
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
function makeShell(): ShellParts {
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
      const expected = ['undefined-references', 'diagnoser'].includes(id)
        ? 'max-w-4xl'
        : 'max-w-7xl';
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
      expect(placeholders).toHaveLength(3);
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

  it('ends the status strip with the exclusion builder entry, even before page data', async () => {
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
      />
    ));
    const strip = screen.getByRole('contentinfo', { name: 'Page status' });
    const control = await waitFor(() => {
      const found = strip.querySelector('[data-fdt="builder-entry"]');
      if (found === null) throw new Error('no builder entry');
      return found;
    });
    expect(strip.lastElementChild).toBe(control);
    expect(askStatus).toHaveBeenCalledWith(77);
    await waitFor(() => {
      expect(control.textContent).toContain('Off');
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

  it('renders the reserved Diagnoser row disabled (explained, never dead)', () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    const reserved = screen.getByRole('button', { name: 'Diagnoser' });
    expect(reserved.getAttribute('disabled')).not.toBeNull();
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

describe('the status bar in the shell', () => {
  it('mounts the strip as the shell edge outside the content region, honest at boot', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    // The strip exists inside the shell, outside the scrolling content
    // region, and claims nothing before data settles.
    const bar = document.querySelector('[data-fdt="panel-status-bar"]') as HTMLElement;
    const shellRoot = document.querySelector('[data-fdt="panel-shell"]') as HTMLElement;
    const content = document.querySelector('[data-fdt="panel-content"]') as HTMLElement;
    expect(shellRoot.contains(bar)).toBe(true);
    expect(content.contains(bar)).toBe(false);
    expect(screen.queryByText('Not detected')).toBeNull();
    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Not detected' })).toBeTruthy();
    });
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
