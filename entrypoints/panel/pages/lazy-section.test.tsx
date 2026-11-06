/**
 * Lazily loaded page sections: the skeleton until the chunk lands, the
 * loaded section with the page's props, one fetch per document (a later
 * show renders at once), the early fetch, the failed state and its retry on
 * the next show.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Component } from 'solid-js';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazySection, SECTION_LOAD_FAILED_COPY } from './lazy-section';

afterEach(() => {
  cleanup();
});

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

/** The section's props in these tests. */
interface Props {
  readonly word: string;
}

/** A loader the test resolves or rejects by hand. */
function manualLoader() {
  let resolve: (body: Component<Props>) => void = () => undefined;
  let reject: (cause: unknown) => void = () => undefined;
  const load = vi.fn(
    () =>
      new Promise<Component<Props>>((done, fail) => {
        resolve = done;
        reject = fail;
      })
  );
  return {
    load,
    resolve: (body: Component<Props>) => {
      resolve(body);
    },
    reject: (cause: unknown) => {
      reject(cause);
    }
  };
}

/** The loaded section: echoes its prop. */
const Loaded: Component<Props> = (props) => <p>Section {props.word}</p>;

describe('lazySection', () => {
  it('shows skeleton rows until the chunk lands, then the section with live props', async () => {
    const loader = manualLoader();
    const Section = lazySection('Test', loader.load, { prefetch: null });
    const [word, setWord] = createSignal('one');
    render(() => <Section word={word()} />);
    expect(document.querySelector('[data-fdt-section-chunk-loading]')).not.toBeNull();
    loader.resolve(Loaded);
    await settle();
    expect(screen.getByText('Section one')).toBeTruthy();
    expect(document.querySelector('[data-fdt-section-chunk-loading]')).toBeNull();
    setWord('two');
    expect(screen.getByText('Section two')).toBeTruthy();
  });

  it('fetches once per document: a later show renders at once', async () => {
    const loader = manualLoader();
    const Section = lazySection('Test', loader.load, { prefetch: null });
    render(() => <Section word="a" />);
    render(() => <Section word="b" />); // a second mount while the fetch is in the air
    loader.resolve(Loaded);
    await settle();
    cleanup();
    render(() => <Section word="c" />);
    expect(screen.getByText('Section c')).toBeTruthy();
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  it('fetches early when the scheduler runs', async () => {
    const loader = manualLoader();
    let early: () => void = () => undefined;
    const Section = lazySection('Test', loader.load, {
      prefetch: (fetch) => {
        early = fetch;
      }
    });
    expect(loader.load).not.toHaveBeenCalled();
    early();
    loader.resolve(Loaded);
    await settle();
    render(() => <Section word="now" />);
    expect(screen.getByText('Section now')).toBeTruthy();
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  it('names a failed load with the panel reload as its remedy, and fetches again on the next show', async () => {
    const loader = manualLoader();
    const reloadPanel = vi.fn();
    const Section = lazySection('Test', loader.load, { reloadPanel, prefetch: null });
    render(() => <Section word="x" />);
    loader.reject(new Error('Failed to fetch dynamically imported module'));
    await settle();
    expect(screen.getByText(SECTION_LOAD_FAILED_COPY)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload panel' }));
    expect(reloadPanel).toHaveBeenCalledTimes(1);
    cleanup();
    render(() => <Section word="x" />);
    expect(loader.load).toHaveBeenCalledTimes(2);
  });
});
