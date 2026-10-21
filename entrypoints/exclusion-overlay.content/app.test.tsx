import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExclusionSessionStatus } from '../../lib/messaging/exclusion-session';
import type { ExclusionSet } from '../../lib/exclusion-builder/set';
import { activeRecord, validSet } from '../../lib/messaging/exclusion-session.fixtures';
import { OverlayApp } from './app';
import { createOverlayController } from './controller';
import { createElementKeys, scanPage, type PageCandidate } from './exclusions/page-scan';
import type { PageTools, PointedPick } from './page-tools';
import type { PickerEvents } from './picker';
import type { ExclusionSessionPort, PortOutcome } from './session/port';
import type { VirtualizerFactory } from '../../components/ui/virtual-list';
import type { OverlayPresentation } from '../../lib/exclusion-session/overlay-reopen';
import type { OverlayMode, OverlayModeContext } from './modes';

/**
 * A virtualizer that renders every row (happy-dom lays nothing out, so the
 * library's window would be empty).
 */
const everyRow: VirtualizerFactory = (options) => ({
  getVirtualItems: () =>
    Array.from({ length: options.count }, (_, index) => ({
      key: options.getItemKey?.(index) ?? index,
      index,
      start: index * 37,
      end: (index + 1) * 37,
      size: 37,
      lane: 0
    })),
  getTotalSize: () => options.count * 37,
  measureElement: () => undefined,
  scrollToIndex: () => undefined
});

const reply = <T,>(value: T): Promise<PortOutcome<T>> =>
  Promise.resolve({ kind: 'reply', reply: value });

/** A port answering one status and saved set; `savedSet` may fail once. */
function port(
  status: ExclusionSessionStatus,
  options: { failFirstLoad?: boolean; saved?: ExclusionSet | null } = {}
): ExclusionSessionPort {
  let failed = options.failFirstLoad !== true;
  return {
    status: vi.fn(() => reply(status)),
    savedSet: vi.fn(() => {
      if (!failed) {
        failed = true;
        return Promise.resolve({ kind: 'problem', problem: 'timeout' } as const);
      }
      return reply({ set: options.saved ?? null });
    }),
    apply: vi.fn(() => reply({ outcome: 'applying' as const })),
    stop: vi.fn(() => reply<ExclusionSessionStatus>({ state: 'inactive' })),
    save: vi.fn(() => reply({ outcome: 'saved' as const })),
    onStatus: () => () => undefined
  };
}

/** Candidates of a small WP Rocket-shaped page. */
function pageCandidates(): readonly PageCandidate[] {
  const doc = new DOMParser().parseFromString(
    '<!doctype html><body><script type="rocketlazyloadscript" data-rocket-src="/wp-content/a.js"></script><img data-lazy-src="/wp-content/hero.jpg"></body>',
    'text/html'
  );
  return scanPage(doc, 'https://example.com/', createElementKeys());
}

/** A page frame with a box (happy-dom lays nothing out). */
const frame = document.createElement('iframe');
document.body.append(frame);
frame.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 150 }) as DOMRect;

/** Page tools with controllable signals. */
function pageTools() {
  const [candidates] = createSignal(pageCandidates());
  const [pageFacts] = createSignal({
    href: 'https://example.com/',
    documentUrl: 'https://example.com/',
    timeOrigin: 0
  });
  const [pageModal, setPageModal] = createSignal(false);
  // What a fresh `:modal` read would answer (lets a test go stale).
  let modalNow = false;
  const [pageTopLayerOpened] = createSignal(0);
  const [zoom] = createSignal(1);
  const [candidatesCapped] = createSignal(false);
  const [scanned] = createSignal(true);
  const tools: PageTools = {
    candidates,
    candidatesCapped,
    scanned,
    pageModal,
    pageTopLayerOpened,
    zoom,
    pageFacts,
    pointPick: () => null,
    refreshModal: () => {
      setPageModal(modalNow);
    },
    frames: () => [frame],
    rescan: vi.fn(),
    dispose: vi.fn()
  };
  return {
    tools,
    setPageModal,
    setModalNow: (value: boolean) => {
      modalNow = value;
    }
  };
}

/** Render the overlay over a port, started (a re-open when `presentation` is given). */
function mount(
  sessionPort: ExclusionSessionPort,
  presentation: OverlayPresentation | null = null,
  mode?: OverlayMode
) {
  const onClose = vi.fn();
  const onPresented = vi.fn();
  const reload = vi.fn();
  const timers: (() => void)[] = [];
  let picker: PickerEvents<PointedPick> | null = null;
  const stopPicker = vi.fn();
  let setPageModal: (value: boolean) => void = () => undefined;
  let setModalNow: (value: boolean) => void = () => undefined;
  const result = render(() => {
    const page = pageTools();
    setPageModal = page.setPageModal;
    setModalNow = page.setModalNow;
    const controller = createOverlayController({
      port: sessionPort,
      pageFacts: page.tools.pageFacts,
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
        page={page.tools}
        origin="https://example.com"
        requestFrame={(run) => {
          run();
        }}
        listen={() => undefined}
        onClose={onClose}
        presentation={presentation}
        onPresented={onPresented}
        mode={mode}
        startPicking={(events) => {
          picker = events;
          return stopPicker;
        }}
        isInvalid={() => false}
        createVirtualizer={everyRow}
      />
    );
  });
  return {
    ...result,
    onClose,
    onPresented,
    reload,
    stopPicker,
    picker: () => picker,
    setPageModal: (value: boolean) => {
      setPageModal(value);
    },
    setModalNow: (value: boolean) => {
      setModalNow(value);
    },
    fireTimers: () => {
      timers.splice(0).forEach((run) => {
        run();
      });
    }
  };
}

/** The overlay's root layer. */
function layerOf(container: HTMLElement): Element {
  const layer = container.querySelector('.xo-layer');
  if (layer === null) throw new Error('no layer');
  return layer;
}

describe('OverlayApp', () => {
  afterEach(cleanup);

  it('shows the loading status, then the empty editor with its guidance and every lane', async () => {
    mount(port({ state: 'inactive' }));
    // Changed in audit round 1: a status region with words (was aria-busy +
    // aria-label on a plain div, which axe flags).
    expect(screen.getByText('Loading the session').closest('[role="status"]')).not.toBeNull();
    await screen.findByText(
      'Pick elements or write rows, then apply: the page reloads with the exclusions rendered for real.'
    );
    for (const lane of [
      'Delay JavaScript execution',
      'Load JavaScript deferred',
      'Automatic Lazy Rendering',
      'LazyLoad for images'
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: lane })).toBeTruthy();
    }
    expect(screen.getByRole('heading', { level: 1, name: 'Exclusion builder' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
  });

  it('names a failed load and retries it, focus landing on the heading', async () => {
    const sessionPort = port({ state: 'inactive' }, { failFirstLoad: true });
    const savedSet = vi.spyOn(sessionPort, 'savedSet');
    mount(sessionPort);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { level: 2, name: 'Delay JavaScript execution' });
    expect(savedSet).toHaveBeenCalledTimes(2);
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it('offers Stop for an active session; Reset only once the draft differs', async () => {
    mount(port(activeRecord()));
    await screen.findByRole('button', { name: /Stop/ });
    const reset = screen.getByRole('button', { name: /Reset/ });
    expect(reset.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('switch', { name: /Disable feature: Delay JavaScript/ }));
    expect(reset.getAttribute('aria-disabled')).toBeNull();
  });

  it('holds Apply with aria-disabled while applying, so focus stays on it', async () => {
    const sessionPort = port({ state: 'inactive' });
    vi.spyOn(sessionPort, 'apply').mockImplementation(() => new Promise(() => undefined));
    mount(sessionPort);
    const apply = await screen.findByRole('button', { name: /^Apply$/ });
    apply.focus();
    fireEvent.click(apply);
    await screen.findByRole('button', { name: /Applying/ });
    expect(apply.hasAttribute('disabled')).toBe(false);
    expect(apply.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(apply);
  });

  it('collapses to the pill on Escape and reopens from it', async () => {
    const { container } = mount(port({ state: 'inactive' }));
    await screen.findByRole('heading', { level: 2, name: 'LazyLoad for images' });
    fireEvent.keyDown(layerOf(container), { key: 'Escape' });
    const pill = await screen.findByRole('button', { name: /open the exclusion builder/i });
    expect(pill.textContent).toMatch(/^Exclusions/);
    expect(container.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('false');
    fireEvent.click(pill);
    await waitFor(() => {
      expect(container.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('true');
    });
  });

  it('reports folding, unfolding and closing (the next page follows suit)', async () => {
    const { container, onPresented } = mount(port({ state: 'inactive' }));
    await screen.findByRole('heading', { level: 2, name: 'LazyLoad for images' });
    expect(onPresented).not.toHaveBeenCalled();
    fireEvent.keyDown(layerOf(container), { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: /open the exclusion builder/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close the exclusion builder' }));
    expect(onPresented.mock.calls).toEqual([[false], [true], [false]]);
  });

  it('re-tries a focus move that does not take (a panel still hidden for a frame)', async () => {
    const { container } = mount(port({ state: 'inactive' }));
    await screen.findByRole('heading', { level: 2, name: 'LazyLoad for images' });
    fireEvent.keyDown(layerOf(container), { key: 'Escape' });
    const pill = await screen.findByRole('button', { name: /open the exclusion builder/i });
    const heading = screen.getByRole('heading', { level: 1 });
    // The first focus call is refused, the way a still-hidden element refuses it.
    const realFocus = heading.focus.bind(heading);
    let refused = 0;
    const spy = vi.spyOn(heading, 'focus').mockImplementation((options?: FocusOptions) => {
      if (refused === 0) {
        refused += 1;
        return;
      }
      realFocus(options);
    });
    try {
      fireEvent.click(pill);
      await waitFor(() => {
        expect(document.activeElement).toBe(heading);
      });
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('an explicit open lands focus on the heading', async () => {
    mount(port({ state: 'inactive' }));
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('Exclusion builder');
    });
  });

  it('a folded re-open starts as the pill and leaves the page’s focus alone', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    try {
      const { container, onPresented } = mount(port(activeRecord()), 'folded');
      await screen.findByRole('button', { name: /open the exclusion builder/i });
      expect(container.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('false');
      expect(document.activeElement).toBe(outside);
      expect(onPresented).not.toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });

  it('an open re-open shows the panel without taking focus', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    try {
      const { container } = mount(port(activeRecord()), 'open');
      await screen.findByRole('heading', { level: 2, name: 'LazyLoad for images' });
      expect(container.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('true');
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  it('renders a plugged-in mode’s config and results panels through the shell services', async () => {
    let captured: OverlayModeContext | null = null;
    const shell = (): OverlayModeContext => {
      if (captured === null) throw new Error('the mode was not rendered');
      return captured;
    };
    const picked: string[] = [];
    const mode: OverlayMode = {
      id: 'probe',
      label: 'Probe tool',
      Config: (props) => {
        // eslint-disable-next-line solid/reactivity -- capturing the fixed context object
        captured = props.context;
        return <p>Probe config</p>;
      },
      Results: () => <p>Probe results</p>
    };
    const { container, picker } = mount(port({ state: 'inactive' }), null, mode);
    await screen.findByText('Probe config');
    expect(screen.getByText('Probe results')).toBeTruthy();
    // No Exclusions panel: the shell renders only the active mode.
    expect(screen.queryByRole('button', { name: 'Pick on page' })).toBeNull();
    // The shell services: highlight, announce, pick.
    const element = document.createElement('div');
    document.body.append(element);
    element.getBoundingClientRect = () =>
      ({ left: 5, top: 50, width: 40, height: 30, x: 5, y: 50 }) as DOMRect;
    shell().highlight({ element, label: 'Probe lane', subject: 'probe subject' });
    await screen.findByText('Probe lane');
    shell().highlight(null);
    element.remove();
    shell().announce('Probe announced');
    await screen.findByText('Probe announced');
    shell().pick(undefined, {
      label: () => 'Probe lane',
      onPick: (pick) => {
        picked.push(pick.candidate.subject);
      }
    });
    expect(screen.getByRole('group', { name: 'Picking on the page' })).toBeTruthy();
    const img = document.createElement('img');
    picker()?.pick(
      { element: img, candidate: { lane: 'lazyload', row: 'x.jpg', subject: 'x.jpg' } },
      img
    );
    expect(picked).toEqual(['x.jpg']);
    expect(screen.queryByRole('group', { name: 'Picking on the page' })).toBeNull();
    // The pill carries the mode's name.
    fireEvent.keyDown(layerOf(container), { key: 'Escape' });
    const pill = await screen.findByRole('button', { name: /open the exclusion builder/i });
    expect(pill.textContent).toMatch(/^Probe tool/);
  });

  it('picks through the picker: a miss explains itself, a hit adds the row and ends picking', async () => {
    const { picker, stopPicker } = mount(port({ state: 'inactive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pick on page' }));
    expect(screen.getByRole('group', { name: 'Picking on the page' })).toBeTruthy();
    picker()?.pick(null, document.createElement('iframe'));
    expect(screen.getByText(/Frames can’t be picked/)).toBeTruthy();
    picker()?.pick(null, document.createElement('p'));
    expect(screen.getByText(/Nothing to exclude there/)).toBeTruthy();
    const img = document.createElement('img');
    picker()?.hover({
      element: img,
      candidate: { lane: 'lazyload', row: 'wp-content/hero.jpg', subject: 'hero.jpg' }
    });
    picker()?.pick(
      {
        element: img,
        candidate: { lane: 'lazyload', row: 'wp-content/hero.jpg', subject: 'hero.jpg' }
      },
      img
    );
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Picking on the page' })).toBeNull();
    });
    expect(stopPicker).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: 'LazyLoad for images row 1' })).toBeTruthy();
  });

  it('keeps Tab on the picking bar and cancels back to Pick on page', async () => {
    const { picker } = mount(port({ state: 'inactive' }));
    const pick = await screen.findByRole('button', { name: 'Pick on page' });
    fireEvent.click(pick);
    picker()?.tab(false);
    expect(document.activeElement?.textContent).toBe('Cancel');
    picker()?.cancel();
    await waitFor(() => {
      expect(document.activeElement).toBe(pick);
    });
  });

  it('adds from the page list without moving focus, then shows the row on a second press', async () => {
    mount(port({ state: 'inactive' }));
    fireEvent.click(await screen.findByRole('button', { name: /On this page/ }));
    const add = screen.getByRole('button', { name: 'Add hero.jpg to LazyLoad for images' });
    add.focus();
    fireEvent.click(add);
    expect(screen.getByRole('textbox', { name: 'LazyLoad for images row 1' })).toBeTruthy();
    const added = screen.getByRole('button', {
      name: /^Added: hero\.jpg is in LazyLoad for images/
    });
    expect(added.textContent).toContain('Added');
    fireEvent.click(added);
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-label')).toBe('LazyLoad for images row 1');
    });
  });

  it('folds into a paused pill while the page shows a modal dialog, and comes back', async () => {
    const { container, setPageModal } = mount(port({ state: 'inactive' }));
    await screen.findByRole('heading', { level: 2, name: 'LazyLoad for images' });
    setPageModal(true);
    expect(await screen.findByText('Paused: page dialog open')).toBeTruthy();
    setPageModal(false);
    await waitFor(() => {
      expect(container.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('true');
    });
  });

  it('dismisses a notice from its corner control, focus landing on the heading', async () => {
    const saved = { ...validSet(), rows: { ...validSet().rows, deferJs: ['('] } };
    mount(port({ state: 'inactive' }, { saved }));
    fireEvent.click(await screen.findByRole('button', { name: /^Apply$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Dismiss: Fix 1 row/ }));
    await waitFor(() => {
      expect(screen.queryByText(/Fix 1 row/)).toBeNull();
    });
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it('closes on request', async () => {
    const { onClose } = mount(port({ state: 'inactive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close the exclusion builder' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('after an overdue reload, hands the editor back with Reload and Stop', async () => {
    const sessionPort = port({ state: 'inactive' });
    const { reload, fireTimers } = mount(sessionPort);
    fireEvent.click(await screen.findByRole('button', { name: /^Apply$/ }));
    await screen.findByText('Reloading with your exclusions');
    vi.spyOn(sessionPort, 'status').mockResolvedValueOnce({ kind: 'reply', reply: activeRecord() });
    fireTimers();
    await screen.findByText('The page didn’t reload');
    // The notice's Reload (the armed banner offers one too).
    const button = screen.getAllByRole('button', { name: 'Reload page' }).at(-1);
    if (button === undefined) throw new Error('no reload');
    expect(screen.getByRole('button', { name: /Stop/ })).toBeTruthy();
    fireEvent.click(button);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('guards page frames while picking: input there is explained, never sent into the frame', async () => {
    const { container } = mount(port({ state: 'inactive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pick on page' }));
    const guard = container.querySelector<HTMLElement>('.xo-frame-guard');
    expect(guard?.style.width).toBe('300px');
    if (guard === null) throw new Error('no guard');
    fireEvent.click(guard);
    expect(screen.getByText(/Frames can’t be picked/)).toBeTruthy();
  });

  it('moves focus to the heading when Stop removes the focused button', async () => {
    mount(port(activeRecord()));
    const stop = await screen.findByRole('button', { name: /Stop/ });
    stop.focus();
    fireEvent.click(stop);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement?.tagName).toBe('H1');
    });
  });

  it('moves focus to the heading when an accepted apply removes the footer', async () => {
    mount(port({ state: 'inactive' }));
    const apply = await screen.findByRole('button', { name: /^Apply$/ });
    apply.focus();
    fireEvent.click(apply);
    await screen.findByText('Reloading with your exclusions');
    await waitFor(() => {
      expect(document.activeElement?.tagName).toBe('H1');
    });
  });

  it('re-checks the page modal on reopen, and focuses the panel when a modal goes away', async () => {
    const { container, setPageModal, setModalNow } = mount(port({ state: 'inactive' }));
    await screen.findByRole('heading', { level: 2, name: 'LazyLoad for images' });
    setPageModal(true);
    // The dialog is gone, but nothing told the tools (stale signal).
    setModalNow(false);
    fireEvent.click(await screen.findByRole('button', { name: /open the exclusion builder/i }));
    await waitFor(() => {
      expect(container.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('true');
    });
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it('cancels picking with Escape pressed on the picking bar itself', async () => {
    mount(port({ state: 'inactive' }));
    const pick = await screen.findByRole('button', { name: 'Pick on page' });
    fireEvent.click(pick);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.keyDown(cancel, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Picking on the page' })).toBeNull();
    });
    // Only the picking ends: the panel stays open.
    expect(document.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('true');
  });
});
