import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExclusionSessionStatus } from '../../lib/messaging/exclusion-session';
import { activeRecord } from '../../lib/messaging/exclusion-session.fixtures';
import { OverlayApp } from './app';
import { createOverlayController } from './controller';
import type { PageTools } from './page-tools';
import type { ExclusionSessionPort, PortOutcome } from './session/port';

const reply = <T,>(value: T): Promise<PortOutcome<T>> =>
  Promise.resolve({ kind: 'reply', reply: value });

/** A port answering one status; `savedSet` may fail once. */
function port(status: ExclusionSessionStatus, failFirstLoad = false): ExclusionSessionPort {
  let failed = !failFirstLoad;
  return {
    status: vi.fn(() => reply(status)),
    savedSet: vi.fn(() => {
      if (!failed) {
        failed = true;
        return Promise.resolve({ kind: 'problem', problem: 'timeout' } as const);
      }
      return reply({ set: null });
    }),
    apply: vi.fn(() => reply({ outcome: 'applying' as const })),
    stop: vi.fn(() => reply<ExclusionSessionStatus>({ state: 'inactive' })),
    save: vi.fn(() => reply({ outcome: 'saved' as const })),
    onStatus: () => () => undefined
  };
}

/** Page tools over an empty page. */
function pageTools(): PageTools {
  const [candidates] = createSignal([]);
  const [pageFacts] = createSignal({
    href: 'https://example.com/',
    documentUrl: 'https://example.com/',
    timeOrigin: 0
  });
  return { candidates, pageFacts, pointPick: () => null, rescan: vi.fn(), dispose: vi.fn() };
}

/** Render the overlay over a port, started. */
function mount(sessionPort: ExclusionSessionPort) {
  const onClose = vi.fn();
  const reload = vi.fn();
  const timers: (() => void)[] = [];
  const result = render(() => {
    const page = pageTools();
    const controller = createOverlayController({
      port: sessionPort,
      pageFacts: page.pageFacts,
      now: () => 1,
      schedule: (run) => {
        timers.push(run);
        return () => undefined;
      },
      reload,
      log: { warn: vi.fn() }
    });
    controller.start();
    return (
      <OverlayApp
        controller={controller}
        page={page}
        origin="https://example.com"
        requestFrame={(run) => {
          run();
        }}
        listen={() => undefined}
        onClose={onClose}
        scrollPage={vi.fn()}
        isInvalid={() => false}
      />
    );
  });
  return {
    ...result,
    onClose,
    reload,
    fireTimers: () => {
      timers.splice(0).forEach((run) => {
        run();
      });
    }
  };
}

describe('OverlayApp', () => {
  afterEach(cleanup);

  it('shows the loading skeleton, then the empty editor with every lane', async () => {
    mount(port({ state: 'inactive' }));
    expect(screen.getByLabelText('Loading the session')).toBeTruthy();
    await screen.findByText(
      'Pick elements or write rows, then apply: the page reloads with the exclusions rendered for real.'
    );
    for (const lane of [
      'Delay JavaScript execution',
      'Load JavaScript deferred',
      'Automatic lazy rendering',
      'Image LazyLoad'
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: lane })).toBeTruthy();
    }
    expect(screen.getByRole('heading', { level: 1, name: 'Exclusion builder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Apply/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
  });

  it('names a failed load and retries it', async () => {
    const sessionPort = port({ state: 'inactive' }, true);
    const savedSet = vi.spyOn(sessionPort, 'savedSet');
    mount(sessionPort);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { level: 2, name: 'Delay JavaScript execution' });
    expect(savedSet).toHaveBeenCalledTimes(2);
  });

  it('offers Stop and Reset for an active session', async () => {
    mount(port(activeRecord()));
    await screen.findByRole('button', { name: /Stop/ });
    expect(screen.getByRole('button', { name: /Reset/ })).toBeTruthy();
  });

  it('collapses to the pill on Escape and reopens from it', async () => {
    const { container } = mount(port({ state: 'inactive' }));
    await screen.findByRole('heading', { level: 2, name: 'Image LazyLoad' });
    const layer = container.querySelector('.xo-layer');
    if (layer === null) throw new Error('no layer');
    fireEvent.keyDown(layer, { key: 'Escape' });
    const pill = await screen.findByRole('button', { name: /Open the exclusion builder/ });
    expect(container.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('false');
    fireEvent.click(pill);
    await waitFor(() => {
      expect(container.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('true');
    });
  });

  it('enters picking, and Escape leaves it', async () => {
    const { container } = mount(port({ state: 'inactive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pick on page' }));
    expect(screen.getByRole('application')).toBeTruthy();
    const layer = container.querySelector('.xo-layer');
    if (layer === null) throw new Error('no layer');
    fireEvent.keyDown(layer, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('application')).toBeNull();
    });
  });

  it('closes on request', async () => {
    const { onClose } = mount(port({ state: 'inactive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close the exclusion builder' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('waits on the reload after an accepted apply, then offers a working manual reload', async () => {
    const { reload, fireTimers } = mount(port({ state: 'inactive' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Apply$/ }));
    await screen.findByText('Reloading with your exclusions');
    fireTimers();
    const button = await screen.findByRole('button', { name: 'Reload page' });
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
