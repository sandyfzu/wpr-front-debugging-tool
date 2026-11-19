/**
 * The nav column: the form the width/pin/detail rule picks (rendered, not
 * only computed), the automatic fold while a detail is open, the pinned
 * forms, the toggle's presence (from the top bar threshold) and its write.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavPin } from '../../../lib/panel/nav-mode';
import type { RouteId } from '../routes';
import {
  createDetailPresence,
  DetailPresenceContext,
  type DetailPresenceStore
} from '../state/detail-presence';
import { createNavPinState, type NavPinState } from './nav-pin';
import { NAV_TOGGLE_LABELS, Sidebar } from './sidebar';

afterEach(() => {
  cleanup();
});

/** Render the column over driveable width/pin/presence. */
function renderSidebar(options: { width: number; pin?: NavPin }) {
  const [width, setWidth] = createSignal(options.width);
  const write = vi.fn<(pin: NavPin) => Promise<void>>(() => Promise.resolve());
  let presence: DetailPresenceStore | undefined;
  let pin: NavPinState | undefined;
  render(() => {
    const [route] = createSignal<RouteId>('javascript');
    presence = createDetailPresence(route);
    pin = createNavPinState(options.pin ?? 'auto', write);
    return (
      <DetailPresenceContext.Provider value={presence}>
        <Sidebar route={route} data={() => null} width={width} pin={pin} />
      </DetailPresenceContext.Provider>
    );
  });
  if (presence === undefined || pin === undefined) throw new Error('sidebar not built');
  return { setWidth, write, presence, pin };
}

/** The column's rendered form. */
function form(): string | null {
  return (
    document.querySelector('[data-fdt="panel-header"]')?.getAttribute('data-fdt-nav-form') ?? null
  );
}

/** The toggle button, or null when absent. */
function toggleButton(): HTMLButtonElement | null {
  return document.querySelector('[data-fdt="panel-nav-toggle-block"] button');
}

describe('Sidebar form', () => {
  it('follows the width rule on auto: rail below 1080, labeled from it', () => {
    const { setWidth } = renderSidebar({ width: 0 });
    expect(form()).toBe('rail');
    setWidth(1079);
    expect(form()).toBe('rail');
    setWidth(1080);
    expect(form()).toBe('labeled');
    const column = document.querySelector('[data-fdt="panel-header"]') as HTMLElement;
    expect(column.className).toContain('w-52');
    expect(screen.getByRole('navigation').getAttribute('data-fdt-nav-form')).toBe('labeled');
    setWidth(420);
    expect(form()).toBe('rail');
    expect(column.className).toContain('w-13');
  });

  it('folds to the rail while a detail is open and unfolds when it closes', () => {
    const { presence } = renderSidebar({ width: 1280 });
    expect(form()).toBe('labeled');
    const claim = presence.claim();
    claim.set(true);
    expect(form()).toBe('rail');
    claim.set(false);
    expect(form()).toBe('labeled');
    claim.set(true);
    claim.release();
    expect(form()).toBe('labeled');
  });

  it('holds a pinned labeled form over the fold down to 760, the rail below', () => {
    const { setWidth, presence } = renderSidebar({ width: 900, pin: 'labeled' });
    expect(form()).toBe('labeled');
    presence.claim().set(true);
    expect(form()).toBe('labeled');
    setWidth(760);
    expect(form()).toBe('labeled');
    setWidth(759);
    expect(form()).toBe('rail');
  });

  it('holds a pinned rail at every width', () => {
    const { setWidth } = renderSidebar({ width: 1600, pin: 'rail' });
    expect(form()).toBe('rail');
    setWidth(4000);
    expect(form()).toBe('rail');
  });
});

describe('Sidebar toggle', () => {
  it('is absent below the top bar threshold (every pin renders the rail there)', () => {
    const { setWidth } = renderSidebar({ width: 759, pin: 'labeled' });
    expect(toggleButton()).toBeNull();
    setWidth(760);
    expect(toggleButton()).not.toBeNull();
  });

  it('collapses a wide sidebar (pins the rail) and expands it back to auto', () => {
    const { write, pin } = renderSidebar({ width: 1280 });
    const collapse = screen.getByRole('button', { name: NAV_TOGGLE_LABELS.labeled });
    expect(collapse.textContent).toBe('Collapse sidebar');
    fireEvent.click(collapse);
    expect(form()).toBe('rail');
    expect(pin.pin()).toBe('rail');
    expect(write).toHaveBeenLastCalledWith('rail');
    // The rail's toggle is an icon square named by its action.
    const expand = screen.getByRole('button', { name: NAV_TOGGLE_LABELS.rail });
    expect(expand.textContent).toBe('');
    fireEvent.click(expand);
    expect(form()).toBe('labeled');
    expect(pin.pin()).toBe('auto');
    expect(write).toHaveBeenLastCalledWith('auto');
  });

  it('expands a mid-width rail by pinning labeled, collapses back to auto', () => {
    const { pin } = renderSidebar({ width: 900 });
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(form()).toBe('labeled');
    expect(pin.pin()).toBe('labeled');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(form()).toBe('rail');
    expect(pin.pin()).toBe('auto');
  });

  it('keeps focus on the toggle across the form swap, both ways', () => {
    const { setWidth } = renderSidebar({ width: 1280 });
    screen.getByRole('button', { name: 'Collapse sidebar' }).focus();
    fireEvent.click(document.activeElement as HTMLElement);
    expect(form()).toBe('rail');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand sidebar' }));
    fireEvent.click(document.activeElement as HTMLElement);
    expect(form()).toBe('labeled');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Collapse sidebar' }));
    // A width-driven swap carries it too.
    setWidth(900);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand sidebar' }));
  });

  it('expands over an open detail by pinning labeled', () => {
    const { presence, pin } = renderSidebar({ width: 1280 });
    presence.claim().set(true);
    expect(form()).toBe('rail');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(form()).toBe('labeled');
    expect(pin.pin()).toBe('labeled');
  });
});

describe('Sidebar outside the shell', () => {
  it('throws without the detail-presence provider (a wiring bug, never a guess)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      createRoot(() =>
        render(() => (
          <Sidebar
            route={() => 'detections'}
            data={() => null}
            width={() => 1280}
            pin={createNavPinState('auto', () => Promise.resolve())}
          />
        ))
      )
    ).toThrow(/useDetailPresence/);
    error.mockRestore();
  });
});
