/**
 * The shell's keyboard layer render tests: the palette's visible trigger
 * beside the brand mark with its expanded state, the palette mounting only
 * while the store is open (field autofocused, registry rows rendered, the
 * export row honestly gated), a page row closing AND swapping the route, the
 * reload action driving a second request flight through the data store, the
 * shortcuts overlay listing the table and closing through Escape, `?` typed
 * in the palette field staying a query, caret moves re-arming the Enter
 * highlight, Tab dismissing instead of wiping the query, the open-time
 * snapshot holding against a mid-open data settle, and the shortcuts-row
 * swap landing one dialog with focus restored to the real trigger.
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

  it('a caret move does not strand the Enter arm (ArrowLeft re-arms the top row)', async () => {
    bootShellWithData();
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    const field = await paletteField();
    fireEvent.input(field, { target: { value: 'lazyload' } });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Lazyload/ })).toBeTruthy();
    });
    // The library's input keydown clears the highlight key on caret moves
    // without changing the ranked list — the guard's post-key arm restores it.
    fireEvent.keyDown(field, { key: 'ArrowLeft', bubbles: true, cancelable: true });
    await waitFor(() => {
      expect(field.getAttribute('aria-activedescendant')).not.toBeNull();
    });
    // …and Enter after the caret move runs the armed row (the arm's purpose).
    fireEvent.keyDown(field, { key: 'Enter', bubbles: true, cancelable: true });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Lazyload' })).toBeTruthy();
    });
  });

  it('Tab inside the field dismisses the palette (the trap cannot complete it otherwise)', async () => {
    bootShellWithData();
    const trigger = screen.getByRole('button', { name: 'Command palette' });
    trigger.focus(); // A real click focuses the button (happy-dom does not).
    fireEvent.click(trigger);
    const field = await paletteField();
    fireEvent.input(field, { target: { value: 'det' } });
    await paletteField();
    // The pre-existing library behavior wiped the query and left the list
    // rendered under a closed `aria-expanded`; the intercept dismisses instead.
    fireEvent.keyDown(field, { key: 'Tab', bubbles: true, cancelable: true });
    await waitFor(() => {
      expect(document.querySelector('[data-fdt="palette-input"]')).toBeNull();
    });
    // Focus followed the overlay's restore contract — back to the trigger.
    expect(document.activeElement).toBe(trigger);
  });

  it('holds the open-time snapshot: a mid-open data settle never churns the rows', async () => {
    let settle!: (payload: unknown) => void;
    // The route is pinned explicitly: leftover hashes from earlier tests
    // would steer the settled body somewhere else than this test's probe.
    window.location.hash = '#/detections';
    window.dispatchEvent(new Event('hashchange'));
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
    render(() => <PanelApp data={data} />); // boot flight in the air
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    const field = await paletteField();
    // The export row reads its open-time store state: unset at this open.
    const exportRow = screen.getByRole('option', { name: /Export JSON/ });
    expect(exportRow.getAttribute('aria-disabled')).toBe('true');

    // The mid-open settle does NOT reassemble: the snapshot holds — the row
    // stays at its open-time gate (and the combobox collection never churns
    // the highlight away). (The shell's page body is aria-hidden under the
    // open modal by design, so the settle is asserted through the store and
    // the row — the queryable surfaces — not through the page's heading.)
    settle(makeFdtData());
    await waitFor(() => {
      expect(data.state().status).toBe('ready');
    });
    expect(exportRow.getAttribute('aria-disabled')).toBe('true');

    // No churn: the same row nodes, same count — the collection did not
    // rebuild over the settle (the snapshot's purpose). The arm survives by
    // the guard's re-arm (pinned by the caret-move test; its exact tick
    // timing under a same-tick rebuild is not a render-assertable contract).
    expect(document.querySelectorAll('[data-fdt="palette-command"]').length).toBe(11);
    expect(document.body.contains(exportRow)).toBe(true);

    // The same open keeps its snapshot; the next open re-assembles fresh —
    // and with data loaded, the export row is enabled there.
    fireEvent.keyDown(field, { key: 'Tab', bubbles: true, cancelable: true }); // close
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Detections' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    await paletteField();
    expect(screen.getByRole('option', { name: /Export JSON/ }).getAttribute('aria-disabled')).toBe(
      'false'
    );
  });

  it('the palette run-flip lands one dialog, focus restored to the trigger (the shortcuts row)', async () => {
    // The "Show keyboard shortcuts" row: the palette closes (capturing the
    // settled trigger as the restore point), the shortcuts dialog takes over
    // — exactly one dialog exists, and Esc restores to the real trigger.
    bootShellWithData();
    const trigger = screen.getByRole('button', { name: 'Command palette' });
    trigger.focus(); // A real click focuses the button (happy-dom does not).
    fireEvent.click(trigger);
    const field = await paletteField();
    fireEvent.input(field, { target: { value: 'shortcuts' } });
    await waitFor(() => {
      expect(field.getAttribute('aria-activedescendant')).not.toBeNull();
      expect(screen.getByRole('option', { name: /Show keyboard shortcuts/ })).toBeTruthy();
    });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    });
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });
});

describe('focus on route switch', () => {
  it('a palette open from a focused strip anchor restores to it on close', async () => {
    // The overlay store restores whatever held focus at open — the strip's
    // link (a real focusable in the shell, not a test fake) is a legitimate
    // opener: focus it, open through the global key, close, land back.
    bootShellWithData();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Not detected' })).toBeTruthy();
    });
    const anchor = screen.getByRole('link', { name: 'Not detected' });
    anchor.focus();
    expect(document.activeElement).toBe(anchor);
    fireEvent.keyDown(document.body, {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    await paletteField();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(document.querySelector('[data-fdt="palette-input"]')).toBeNull();
    });
    expect(document.activeElement).toBe(anchor);
  });

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
