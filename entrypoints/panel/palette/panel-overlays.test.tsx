/**
 * The shell's keyboard layer render tests: the palette's visible trigger
 * beside the brand mark with its expanded state, the palette mounting only
 * while the store is open (field autofocused, registry rows rendered, the
 * export row honestly gated), a page row closing AND swapping the route, the
 * reload action driving a second request flight through the data store, the
 * shortcuts overlay listing the table and closing through Escape, `?` typed
 * in the palette field staying a query, and every route change landing
 * focus on the body's own h1 (skeleton bodies skip the move by rule).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFdtData } from '../state/fixtures';
import { createFdtDataStore } from '../state/use-fdt-data';
import { createSearchStore } from '../state/search';
import { PanelApp } from '../App';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

/** One settled boot: the store's flight resolves with real page data. */
function bootShellWithData(): { data: ReturnType<typeof createFdtDataStore> } {
  const data = createFdtDataStore({
    inspectedTabId: () => 42,
    request: () => Promise.resolve(makeFdtData()),
    receive: () => () => undefined,
    search: createSearchStore(),
    reload: vi.fn(),
    now: () => 1727000000000
  });
  render(() => <PanelApp data={data} />);
  return { data };
}

/** Walk to a route the way any anchor or deep link would. */
function hashTo(id: string): void {
  window.location.hash = `#/${id}`;
  window.dispatchEvent(new Event('hashchange'));
}

/** The palette field, once the dialog mounted and armed the field focus. */
async function paletteField(): Promise<HTMLInputElement> {
  await waitFor(() => {
    expect(document.querySelector('[data-fdt="palette-input"]')).not.toBeNull();
    expect(document.activeElement?.getAttribute('role')).toBe('combobox');
  });
  return document.querySelector('[data-fdt="palette-input"]') as HTMLInputElement;
}

describe('the keyboard overlays in the shell', () => {
  it('mounts the palette through the trigger, with registry rows and honest gates', async () => {
    bootShellWithData();
    const trigger = screen.getByRole('button', { name: 'Command palette' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(trigger);
    await paletteField();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // Pages and actions render; the reserved row explains itself; the export
    // row is enabled (the boot data settled).
    expect(screen.getByRole('option', { name: /Detections/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Export JSON/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Diagnoser/ }).getAttribute('aria-disabled')).toBe(
      'true'
    );
  });

  it('running a page row closes the palette and swaps the route body', async () => {
    bootShellWithData();
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    const field = await paletteField();
    fireEvent.input(field, { target: { value: 'lazyload' } });
    await waitFor(() => {
      // The arm matters as much as the render: Enter runs the current highlight.
      expect(field.getAttribute('aria-activedescendant')).not.toBeNull();
      expect(screen.getByRole('option', { name: /Lazyload/ })).toBeTruthy();
    });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Lazyload' })).toBeTruthy();
    });
    // The palette is gone; focus followed the destination heading.
    expect(document.querySelector('[data-fdt="palette-input"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Lazyload');
  });

  it('the reload action drives a second request flight through the data store', async () => {
    let requests = 0;
    let settle!: (payload: unknown) => void;
    const request = () =>
      new Promise<unknown>((resolve) => {
        requests += 1;
        settle = resolve;
      });
    const data = createFdtDataStore({
      inspectedTabId: () => 42,
      request,
      receive: () => () => undefined,
      search: createSearchStore(),
      reload: vi.fn(),
      now: () => 1727000000000
    });
    render(() => <PanelApp data={data} />);
    await waitFor(() => {
      expect(requests).toBe(1);
    });
    settle(makeFdtData()); // the boot flight lands
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Detections' })).toBeTruthy();
    });

    // Open the palette, run Reload data — a refresh flight fires anew.
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    const field = await paletteField();
    fireEvent.input(field, { target: { value: 'reload' } });
    await waitFor(() => {
      expect(field.getAttribute('aria-activedescendant')).not.toBeNull();
      expect(screen.getByRole('option', { name: /Reload data/ })).toBeTruthy();
    });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => {
      expect(requests).toBe(2);
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull(); // the palette closed
  });

  it('lists the shortcuts table and closes through Escape', async () => {
    bootShellWithData();
    // The body is not editable: the keystroke toggles the overlay.
    fireEvent.keyDown(document.body, { key: '?', bubbles: true, cancelable: true });
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    });
    // Three of the table's rows (the palette key, the find row, the
    // appearance cycle row the cross-persona trip names).
    expect(screen.getByText('Open or close the command palette')).toBeTruthy();
    expect(screen.getByText('Find in the panel')).toBeTruthy();
    expect(screen.getByText('Cycle appearance (system → dark → light)')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    });
  });

  it('a question mark typed in the palette field stays a query', async () => {
    bootShellWithData();
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    const field = await paletteField();
    fireEvent.keyDown(field, { key: '?', bubbles: true, cancelable: true });
    // No second dialog opened; the field keeps focus (the `?` is a query).
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    expect(document.activeElement?.getAttribute('role')).toBe('combobox');
  });
});

describe('focus on route switch', () => {
  it("lands on the route body's h1 after a nav click (announced by the heading)", async () => {
    bootShellWithData();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Detections' })).toBeTruthy();
    });
    expect(screen.getByRole('heading', { name: 'Detections' }).getAttribute('tabindex')).toBe('-1');
    screen.getByRole('link', { name: 'JavaScript' }).click();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'JavaScript' })).toBeTruthy();
    });
    expect(document.activeElement?.textContent).toBe('JavaScript');
  });

  it('skips the move on the skeleton body (no heading — focus stays put)', () => {
    let settle!: (payload: unknown) => void;
    const data = createFdtDataStore({
      inspectedTabId: () => 42,
      request: () =>
        new Promise<unknown>((resolve) => {
          settle = resolve;
        }),
      receive: () => () => undefined,
      search: createSearchStore(),
      reload: vi.fn(),
      now: () => 1727000000000
    });
    render(() => <PanelApp data={data} />);
    expect(document.querySelector('[data-fdt-page="fetching"]')).not.toBeNull();
    hashTo('javascript');
    // The route change ran; the body still has no heading — the move skipped.
    expect(document.querySelector('[data-fdt-page] h1')).toBeNull();
    expect(document.activeElement).toBe(document.body);
    settle(makeFdtData());
  });
});
