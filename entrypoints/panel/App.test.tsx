/**
 * The panel shell's render tests: boot states render as real states
 * (skeleton → page body), the error branch renders its retry (and a retry
 * click recovers), the header nav is registry-driven (five navigable rows,
 * the reserved Diagnoser row disabled with its explaining trigger), route
 * switching swaps the body for the registry row's own page (exactly one h1
 * in the document at any time), and a route change resets the search store.
 * The stores are injected; no messaging API is touched here.
 */
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FdtData } from '../../lib/wp-rocket/types';
import { PanelApp } from './App';
import { createSearchStore, type SearchStore } from './state/search';
import { createFdtDataStore, type FdtDataStore } from './state/use-fdt-data';
import { makeFdtData } from './state/fixtures';

/** One page load's worth of valid data. */
const pageData = (): FdtData => makeFdtData({ allScriptsLoaded: false });

/** The shell under test, with a controlled request world for one render. */
interface ShellParts {
  /** Submits the pending `request`'s payload (resolves the flight). */
  settle: (payload: unknown) => void;
  /** Rejects the pending request's flight. */
  fail: (cause: unknown) => void;
  /** Request invocations so far (each flight asks exactly once). */
  requests: () => number;
  search: SearchStore;
  data: FdtDataStore;
}

/**
 * Build the store pair the shell consumes: a never-resolving request by
 * default (tests settle or reject it explicitly), a real search store, and
 * a fixed inspected tab.
 */
function makeShell(): ShellParts {
  let settle!: (payload: unknown) => void;
  let failFlight!: (cause: unknown) => void;
  let requestCount = 0;
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
    receive: () => () => undefined,
    search,
    reload: vi.fn(),
    now: () => 1727000000000
  });
  return {
    settle: (payload) => {
      settle(payload);
    },
    fail: (cause) => {
      failFlight(cause);
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
  it('renders the fetching skeleton first, then the page body on settle', async () => {
    const shell = makeShell();
    render(() => <PanelApp search={shell.search} data={shell.data} />);
    expect(screen.getByText('Loading page data')).toBeTruthy();
    expect(document.querySelector('[data-fdt-page="fetching"]')).not.toBeNull();

    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Detections' })).toBeTruthy();
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
    for (const label of [
      'Detections',
      'JavaScript',
      'Lazyload',
      'Preloaded Resources',
      'Undefined References'
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
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
    expect(screen.getByText('Loading page data')).toBeTruthy();
    shell.settle(pageData());
    await waitFor(() => {
      expect(screen.getByText('Detections loaded')).toBeTruthy();
    });
  });
});
