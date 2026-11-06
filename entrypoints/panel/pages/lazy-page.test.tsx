/**
 * Lazily loaded page bodies: loading frame, the loaded body, one fetch per
 * document, the idle-time early fetch, focus handed to the page's heading,
 * the failed state.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Component } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazyPage, PAGE_LOAD_FAILED_COPY } from './lazy-page';

afterEach(() => {
  cleanup();
});

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

/** A loader the test resolves or rejects by hand. */
function manualLoader() {
  let resolve: (body: Component) => void = () => undefined;
  let reject: (cause: unknown) => void = () => undefined;
  const load = vi.fn(
    () =>
      new Promise<Component>((done, fail) => {
        resolve = done;
        reject = fail;
      })
  );
  return {
    load,
    resolve: (body: Component) => {
      resolve(body);
    },
    reject: (cause: unknown) => {
      reject(cause);
    }
  };
}

describe('lazyPage', () => {
  it('shows the route’s titled loading frame until the module lands, then the page', async () => {
    const loader = manualLoader();
    const Body = lazyPage('beacon-tester', loader.load, { prefetch: null });
    render(() => <Body />);
    expect(document.querySelector('[data-fdt-page-chunk-loading]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Beacon Tester' })).toBeTruthy();
    loader.resolve(() => <p>Loaded page</p>);
    await settle();
    expect(screen.getByText('Loaded page')).toBeTruthy();
    expect(document.querySelector('[data-fdt-page-chunk-loading]')).toBeNull();
  });

  it('fetches once per document: a later visit renders the loaded body at once', async () => {
    const loader = manualLoader();
    const Body = lazyPage('beacon-tester', loader.load, { prefetch: null });
    render(() => <Body />);
    render(() => <Body />); // a second mount while the first fetch is in the air
    loader.resolve(() => <p>Loaded page</p>);
    await settle();
    cleanup();
    render(() => <Body />);
    expect(screen.getByText('Loaded page')).toBeTruthy();
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  it('names a failed load with the panel reload as its remedy, and fetches again on the next visit', async () => {
    const loader = manualLoader();
    const reloadPanel = vi.fn();
    const Body = lazyPage('beacon-tester', loader.load, { reloadPanel, prefetch: null });
    render(() => <Body />);
    loader.reject(new Error('Failed to fetch dynamically imported module'));
    await settle();
    expect(screen.getByText(PAGE_LOAD_FAILED_COPY)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload panel' }));
    expect(reloadPanel).toHaveBeenCalledTimes(1);
    cleanup();
    render(() => <Body />);
    expect(loader.load).toHaveBeenCalledTimes(2);
  });

  it('fetches early when the scheduler runs, so the first visit renders the page at once', async () => {
    const loader = manualLoader();
    let early: () => void = () => undefined;
    const Body = lazyPage('beacon-tester', loader.load, {
      prefetch: (fetch) => {
        early = fetch;
      }
    });
    expect(loader.load).not.toHaveBeenCalled();
    early();
    expect(loader.load).toHaveBeenCalledTimes(1);
    loader.resolve(() => <p>Loaded page</p>);
    await settle();
    render(() => <Body />);
    expect(screen.getByText('Loaded page')).toBeTruthy();
    expect(document.querySelector('[data-fdt-page-chunk-loading]')).toBeNull();
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  it('lets a visit fetch again after a failed early fetch', async () => {
    const loader = manualLoader();
    let early: () => void = () => undefined;
    const Body = lazyPage('beacon-tester', loader.load, {
      prefetch: (fetch) => {
        early = fetch;
      }
    });
    early();
    loader.reject(new Error('offline'));
    await settle();
    render(() => <Body />);
    expect(loader.load).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-fdt-page-chunk-loading]')).not.toBeNull();
  });

  it('hands the loading heading’s focus to the page’s own heading', async () => {
    const loader = manualLoader();
    const Body = lazyPage('beacon-tester', loader.load, { prefetch: null });
    render(() => <Body />);
    screen.getByRole('heading', { level: 1 }).focus();
    loader.resolve(() => (
      <section data-fdt-page="beacon-tester">
        <h1 tabIndex={-1}>Real page</h1>
      </section>
    ));
    await settle();
    expect(document.activeElement?.textContent).toBe('Real page');
  });

  it('leaves focus alone when it was elsewhere', async () => {
    const loader = manualLoader();
    const Body = lazyPage('beacon-tester', loader.load, { prefetch: null });
    render(() => (
      <>
        <button type="button">Elsewhere</button>
        <Body />
      </>
    ));
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    loader.resolve(() => (
      <section data-fdt-page="beacon-tester">
        <h1 tabIndex={-1}>Real page</h1>
      </section>
    ));
    await settle();
    expect(document.activeElement?.textContent).toBe('Elsewhere');
  });
});
