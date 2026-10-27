import { createSignal } from 'solid-js';
import { readFileSync } from 'node:fs';
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
import { parseRules, type CssRule } from '../../assets/css/css-rules.fixtures';

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
function pageTools(modalAtStart = false) {
  const [candidates] = createSignal(pageCandidates());
  const [pageFacts] = createSignal({
    href: 'https://example.com/',
    documentUrl: 'https://example.com/',
    navigationStart: 0,
    responseEnd: null
  });
  const [pageModal, setPageModal] = createSignal(modalAtStart);
  // What a fresh `:modal` read would answer (lets a test go stale).
  let modalNow = modalAtStart;
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
  mode?: OverlayMode,
  modalAtStart = false,
  /** Run frame requests on a later task, like a browser (default: at once). */
  laterFrames = false
) {
  let reveal: (() => void) | null = null;
  const onClose = vi.fn();
  const onPresented = vi.fn();
  const reload = vi.fn();
  const timers: (() => void)[] = [];
  let picker: PickerEvents<PointedPick> | null = null;
  const stopPicker = vi.fn();
  let setPageModal: (value: boolean) => void = () => undefined;
  let setModalNow: (value: boolean) => void = () => undefined;
  let made: ReturnType<typeof createOverlayController> | null = null;
  const result = render(() => {
    const page = pageTools(modalAtStart);
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
    made = controller;
    return (
      <OverlayApp
        controller={controller}
        page={page.tools}
        origin="https://example.com"
        requestFrame={(run) => {
          if (laterFrames) setTimeout(run, 0);
          else run();
        }}
        listen={() => undefined}
        onClose={onClose}
        presentation={presentation}
        onPresented={onPresented}
        mode={mode}
        onRevealReady={(registered) => {
          reveal = registered;
        }}
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
    reveal: () => {
      if (reveal === null) throw new Error('the overlay registered no reveal');
      reveal();
    },
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
    },
    controller: () => {
      if (made === null) throw new Error('the overlay made no controller');
      return made;
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

  it('applies a long paste once it lands when the row is left for Apply meanwhile', async () => {
    const sessionPort = port({ state: 'inactive' }, { saved: validSet() });
    const applied = vi.spyOn(sessionPort, 'apply');
    const { fireTimers } = mount(sessionPort);
    const row = await screen.findByRole('textbox', { name: 'Delay JavaScript execution row 2' });
    if (!(row instanceof HTMLInputElement)) throw new Error('the row is no input');
    row.focus();
    row.setSelectionRange(2, 2);
    const lines = Array.from({ length: 200 }, (_, n) => `p${String(n)}.js`).join('\n');
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => `\n${lines}` } });
    row.dispatchEvent(paste);
    // The paste is landing: Apply waits for it rather than looking unavailable.
    const apply = screen.getByRole('button', { name: /^Apply$/ });
    expect(apply.getAttribute('aria-disabled')).toBeNull();
    row.blur();
    fireEvent.click(apply);
    expect(applied).not.toHaveBeenCalled();
    // The paste's slices (each one schedules the next), then the held
    // actions' own task, scheduled once the landing settled.
    for (let slice = 0; slice < 10; slice++) {
      fireTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await waitFor(() => {
      expect(applied).toHaveBeenCalledTimes(1);
    });
    const [set] = applied.mock.calls[0] ?? [];
    const pasted = lines.split('\n');
    // The row's text around the caret is kept: before it, then after the last line.
    expect(set?.rows.delayJs).toEqual([
      'jquery\\.min\\.js',
      'gt',
      ...pasted.slice(0, -1),
      `${pasted.at(-1) ?? ''}ag`
    ]);
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

  it('an explicit open never takes focus back from a UI that claimed it in its first frames', async () => {
    const other = document.createElement('button');
    document.body.append(other);
    try {
      mount(port({ state: 'inactive' }), null, undefined, false, true);
      // Another UI (a palette) claims focus before the overlay's first frame.
      other.focus();
      await screen.findByRole('heading', { level: 2, name: 'LazyLoad for images' });
      // Past every frame a focus move would take.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(document.activeElement).toBe(other);
    } finally {
      other.remove();
    }
  });

  it('an explicit open never takes focus from the command palette focused before it mounted', async () => {
    // The palette's shadow host holds focus while the overlay host renders.
    const palette = document.createElement('wpr-fdt-command-palette');
    palette.tabIndex = 0;
    document.body.append(palette);
    palette.focus();
    try {
      mount(port({ state: 'inactive' }), null, undefined, false, true);
      await screen.findByRole('heading', { level: 2, name: 'LazyLoad for images' });
      // Past every frame a focus move would take.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(document.activeElement).toBe(palette);
    } finally {
      palette.remove();
    }
  });

  it('an explicit open takes focus from another extension surface that keeps no dialog open', async () => {
    // The detection strip's host held focus (e.g. the palette returned it there).
    const strip = document.createElement('wpr-fdt-inspector');
    strip.tabIndex = 0;
    document.body.append(strip);
    strip.focus();
    try {
      mount(port({ state: 'inactive' }), null, undefined, false, true);
      await waitFor(() => {
        expect(document.activeElement?.textContent).toBe('Exclusion builder');
      });
    } finally {
      strip.remove();
    }
  });

  it('an explicit open still takes over a page control focused before it mounted', async () => {
    const control = document.createElement('button');
    document.body.append(control);
    control.focus();
    try {
      mount(port({ state: 'inactive' }), null, undefined, false, true);
      await waitFor(() => {
        expect(document.activeElement?.textContent).toBe('Exclusion builder');
      });
    } finally {
      control.remove();
    }
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

  it('an explicit open under a page modal comes back open, focused, when the modal closes', async () => {
    const { container, setPageModal, setModalNow } = mount(
      port({ state: 'inactive' }),
      null,
      undefined,
      true,
      true
    );
    expect(await screen.findByText('Paused: page dialog open')).toBeTruthy();
    expect(container.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('false');
    setModalNow(false);
    setPageModal(false);
    await waitFor(() => {
      expect(container.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('true');
    });
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('Exclusion builder');
    });
  });

  it('a re-open under a page modal comes back as it was meant to, never taking focus', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    try {
      const open = mount(port(activeRecord()), 'open', undefined, true, true);
      await open.findByText('Paused: page dialog open');
      open.setModalNow(false);
      open.setPageModal(false);
      await waitFor(() => {
        expect(open.container.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('true');
      });
      // Past every frame a focus move would take.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(document.activeElement).toBe(outside);
      cleanup();
      const folded = mount(port(activeRecord()), 'folded', undefined, true, true);
      await folded.findByText('Paused: page dialog open');
      folded.setModalNow(false);
      folded.setPageModal(false);
      await folded.findByRole('button', { name: /open the exclusion builder/i });
      expect(folded.container.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('false');
    } finally {
      outside.remove();
    }
  });

  it('reveals itself on request: unfolds, ends picking, focuses the heading, reports open', async () => {
    const { container, reveal, onPresented } = mount(port({ state: 'inactive' }), 'folded');
    await screen.findByRole('button', { name: /open the exclusion builder/i });
    reveal();
    await waitFor(() => {
      expect(container.querySelector('.xo-panel')?.getAttribute('data-open')).toBe('true');
    });
    expect(document.activeElement?.textContent).toBe('Exclusion builder');
    expect(onPresented).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Pick on page' }));
    expect(screen.getByRole('group', { name: 'Picking on the page' })).toBeTruthy();
    reveal();
    expect(screen.queryByRole('group', { name: 'Picking on the page' })).toBeNull();
  });

  it('dismisses a notice from its corner control, focus landing on the heading', async () => {
    // A backtracking risk blocks (a row matching everything would only warn).
    const saved = { ...validSet(), rows: { ...validSet().rows, deferJs: ['(a+)+$'] } };
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

describe('stored-form announcements', () => {
  afterEach(cleanup);

  it('announces what a commit changed, by row; a typed-row draft opens converted', async () => {
    const saved: ExclusionSet = {
      ...validSet(),
      rows: { ...validSet().rows, delayJs: ['jquery-*.js'] }
    };
    mount(port({ state: 'inactive' }, { saved }));
    await screen.findByText(
      'Delay JavaScript execution row 1: WP Rocket stores it as jquery-(.*).js.'
    );
    expect(
      screen.getByRole('button', { name: 'Undo change to Delay JavaScript execution row 1' })
    ).toBeTruthy();
    // A row left as typed is no news: the region keeps its text.
    const row = screen.getByRole('textbox', { name: 'LazyLoad for images row 1' });
    row.focus();
    row.blur();
    expect(
      screen.getByText('Delay JavaScript execution row 1: WP Rocket stores it as jquery-(.*).js.')
    ).toBeTruthy();
  });
});

describe('a draft over the set cap', () => {
  afterEach(cleanup);

  /** Valid rows, each under the row cap, together over the set's 65,536 characters. */
  const overCap = Array.from({ length: 45 }, (_, n) => `p${String(n)}-${'a'.repeat(1500)}.jpg`);
  const footer = (container: HTMLElement): string =>
    container.querySelector('.xo-footer-status')?.textContent ?? '';
  const status = (container: HTMLElement): string =>
    container.querySelector('.xo-sr-only[role="status"]')?.textContent ?? '';

  it('says it is not kept — over unapplied edits and rows to fix — and announces it once', async () => {
    // An active session: the added rows are edits not applied yet.
    const view = mount(port(activeRecord()), null, undefined, false, true);
    await screen.findByRole('button', { name: /Stop/ });
    const controller = view.controller();
    controller.insertRows('lazyload', overCap, null);
    view.fireTimers();
    await waitFor(() => {
      expect(controller.saveState()).toEqual({ kind: 'not-saved', reason: 'too-large' });
    });
    // Valid and unapplied: the cap is the line, not "Edits not applied yet".
    expect(controller.invalidCount()).toBe(0);
    expect(controller.dirty()).toBe(true);
    expect(footer(view.container)).toMatch(/^Draft not saved: it is over 65,536 characters/);
    await waitFor(() => {
      expect(status(view.container)).toBe(footer(view.container));
    });
    // A row to fix as well: the cap still leads (the row shows its own problem).
    controller.insertRows('lazyload', ['b'.repeat(2049)], null);
    view.fireTimers();
    await waitFor(() => {
      expect(controller.invalidCount()).toBe(1);
    });
    expect(footer(view.container)).toMatch(/^Draft not saved: it is over/);
    // Still over the cap: not announced again (a new announcement clears the region first).
    expect(status(view.container)).toMatch(/^Draft not saved: it is over/);
    // Back under the cap: the other lines return.
    for (const row of controller.draft().rows.lazyload.slice(0, 40)) {
      controller.removeRow('lazyload', row.id);
    }
    view.fireTimers();
    await waitFor(() => {
      expect(footer(view.container)).toBe('1 row needs fixing');
    });
  });
});

/**
 * Properties whose later declaration changes an asserted property's used
 * value: its longhands (a later `background-color` beats `background`) and
 * the shorthands that reset it (a later `border` beats `border-color`).
 */
const OVERRIDERS: Record<string, RegExp> = {
  background: /^(all|background-.+)$/,
  'background-color': /^(all|background)$/,
  'border-color':
    /^(all|border|border-(top|right|bottom|left|block|inline)(-(start|end))?(-color)?)$/,
  'border-top-color':
    /^(all|border|border-top|border-color|border-block|border-block-start(-color)?)$/,
  color: /^all$/,
  transform: /^(all|rotate|scale|translate)$/,
  transition: /^(all|transition-.+)$/,
  'transition-duration': /^(all|transition)$/,
  'transition-property': /^(all|transition)$/
};

/**
 * The declarations a stylesheet's rules give one selector, later rules
 * overriding earlier ones. Shorthand-aware: a later declaration that changes
 * an earlier one's value (see {@link OVERRIDERS}) replaces that entry with an
 * `overridden by …` marker, so an assertion on the shorthand fails.
 *
 * @param css The stylesheet text.
 * @param selector The selector, exactly as written in the sheet.
 * @param within Only rules inside this at-rule prelude (default: any).
 * @returns Property → value, as the cascade leaves them in source order.
 */
function cascaded(css: string, selector: string, within?: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const rule of parseRules(css)) {
    if (rule.selector !== selector) continue;
    if (within !== undefined && !rule.within.includes(within)) continue;
    for (const [property, value] of rule.declarations) {
      for (const earlier of declarations.keys()) {
        if (OVERRIDERS[earlier]?.test(property) === true) {
          declarations.set(earlier, `overridden by ${property}: ${value}`);
        }
      }
      declarations.set(property, value);
    }
  }
  return declarations;
}

/**
 * A selector's specificity as one comparable number (ids, then classes /
 * attributes / pseudo-classes, then types). `:where()` counts zero;
 * `:not()`/`:is()` count their argument — enough for this sheet's selectors.
 *
 * @param selector One complex selector.
 * @returns `ids * 10_000 + classes * 100 + types`.
 */
function specificity(selector: string): number {
  let text = selector;
  // Drop `:where(…)` (innermost first, so nesting unwinds), then unwrap `:not/:is(…)`.
  while (/:where\([^()]*\)/.test(text)) text = text.replace(/:where\([^()]*\)/g, '');
  while (/:(not|is)\(([^()]*)\)/.test(text)) text = text.replace(/:(not|is)\(([^()]*)\)/g, ' $2');
  text = text.replace(/\[[^\]]*\]/g, '.attr');
  const ids = (text.match(/#[\w-]+/g) ?? []).length;
  const classes = (text.match(/(\.[\w-]+|:(?!:)[\w-]+)/g) ?? []).length;
  const types = (text.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return ids * 10_000 + classes * 100 + types;
}

/**
 * The rule whose declaration wins one property on a live element: every
 * sheet rule matching it (at-rule conditions assumed true — any context
 * that could override counts), ranked by specificity then source order.
 *
 * @param rules The sheet's rules ({@link parseRules}).
 * @param element The element as mounted.
 * @param property The property asked for; its overriders (see
 *   {@link OVERRIDERS}) compete with it.
 * @returns The winning selector, the property it set and its value, or null.
 */
function winning(
  rules: CssRule[],
  element: Element,
  property: string
): { selector: string; property: string; value: string } | null {
  let best: { rank: [number, number]; selector: string; property: string; value: string } | null =
    null;
  for (const rule of rules) {
    // Pseudo-elements never style the element itself.
    if (rule.selector.includes('::') || !element.matches(rule.selector)) continue;
    for (const [declared, value] of rule.declarations) {
      if (declared !== property && OVERRIDERS[property]?.test(declared) !== true) continue;
      const rank: [number, number] = [specificity(rule.selector), rule.order];
      if (
        best === null ||
        rank[0] > best.rank[0] ||
        (rank[0] === best.rank[0] && rank[1] >= best.rank[1])
      ) {
        best = { rank, selector: rule.selector, property: declared, value };
      }
    }
  }
  return best === null
    ? null
    : { selector: best.selector, property: best.property, value: best.value };
}

describe('the "On this page" toggle', () => {
  afterEach(cleanup);

  /** The toolbar toggle, once the session is ready. */
  const toggle = (): Promise<HTMLElement> => screen.findByRole('button', { name: /^On this page/ });

  /** The toggle's turning chevron. */
  const chevronOf = (button: HTMLElement): Element | null => button.querySelector('.xo-chevron');

  it('reads closed: not expanded, no dangling aria-controls, a resting chevron, no list', async () => {
    mount(port({ state: 'inactive' }));
    const button = await toggle();
    expect(button.classList.contains('xo-disclosure')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.hasAttribute('aria-controls')).toBe(false);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    const chevron = chevronOf(button);
    expect(chevron?.tagName.toLowerCase()).toBe('svg');
    expect(chevron?.getAttribute('aria-hidden')).toBe('true');
    // The chevron trails the label and count.
    expect(button.lastElementChild).toBe(chevron);
    expect(document.getElementById('xo-candidates')).toBeNull();
  });

  it('opens and closes in place: aria-controls resolves while open, focus stays on the toggle', async () => {
    mount(port({ state: 'inactive' }));
    const button = await toggle();
    button.focus();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const controls = button.getAttribute('aria-controls');
    expect(controls).toBe('xo-candidates');
    const list = document.getElementById(controls ?? '');
    expect(list?.querySelector('[role="list"]')).not.toBeNull();
    expect(chevronOf(button)).not.toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.hasAttribute('aria-controls')).toBe(false);
    expect(document.getElementById('xo-candidates')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('reads disabled while closed and not ready: a press keeps it closed', async () => {
    mount(port({ state: 'inactive' }));
    const button = await toggle();
    fireEvent.click(screen.getByRole('button', { name: /^Apply$/ }));
    await screen.findByText('Reloading with your exclusions');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.hasAttribute('aria-controls')).toBe(false);
  });

  it('reads disabled while open and not ready: still expanded, its target still there', async () => {
    mount(port({ state: 'inactive' }));
    const button = await toggle();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: /^Apply$/ }));
    await screen.findByText('Reloading with your exclusions');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-controls') ?? '')).not.toBeNull();
  });

  it('styles the open state from aria-expanded: a fill plus a turned chevron, on motion tokens', () => {
    // happy-dom applies no shadow stylesheet, so the CSS contract is read as
    // text: each declaration as the cascade leaves it for the selector.
    const css = readFileSync(`${import.meta.dirname}/overlay.css`, 'utf8');
    const open = cascaded(css, ".xo-disclosure[aria-expanded='true']");
    expect(open.get('background')).toBe('var(--accent-strong)');
    expect(open.get('border-color')).toBe('var(--accent-strong)');
    expect(open.get('color')).toBe('var(--on-accent)');
    expect(cascaded(css, '.xo-chevron').get('transition')).toBe(
      'transform var(--motion-fast) var(--ease-standard)'
    );
    expect(cascaded(css, ".xo-disclosure[aria-expanded='true'] .xo-chevron").get('transform')).toBe(
      'rotate(180deg)'
    );
    // A held toggle keeps its look under the pointer, open or closed.
    expect(css).toContain(
      ".xo-disclosure[aria-expanded='true']:not([aria-disabled='true']):hover {"
    );
    expect(css).toContain(".xo-button:not(:where([aria-disabled='true'])):hover {");
  });

  it('wins its look on the live element: no other rule, longhand or stronger selector overrides it', async () => {
    const rules = parseRules(readFileSync(`${import.meta.dirname}/overlay.css`, 'utf8'));
    mount(port({ state: 'inactive' }));
    const button = await toggle();
    const chevron = chevronOf(button);
    if (chevron === null) throw new Error('the toggle has no chevron');
    // Closed: the plain button look, a chevron at rest.
    expect(winning(rules, button, 'background-color')).toEqual({
      selector: '.xo-button',
      property: 'background',
      value: 'var(--surface-2)'
    });
    expect(winning(rules, chevron, 'transform')).toBeNull();
    fireEvent.click(button);
    const open = ".xo-disclosure[aria-expanded='true']";
    expect(winning(rules, button, 'background-color')).toEqual({
      selector: open,
      property: 'background',
      value: 'var(--accent-strong)'
    });
    expect(winning(rules, button, 'border-top-color')).toEqual({
      selector: open,
      property: 'border-color',
      value: 'var(--accent-strong)'
    });
    expect(winning(rules, button, 'color')).toEqual({
      selector: open,
      property: 'color',
      value: 'var(--on-accent)'
    });
    expect(winning(rules, chevron, 'transform')).toEqual({
      selector: `${open} .xo-chevron`,
      property: 'transform',
      value: 'rotate(180deg)'
    });
    for (const longhand of ['transition-property', 'transition-duration']) {
      expect(winning(rules, chevron, longhand)).toEqual({
        selector: '.xo-chevron',
        property: 'transition',
        value: 'transform var(--motion-fast) var(--ease-standard)'
      });
    }
  });

  it('reads a later longhand as overriding an asserted shorthand', () => {
    const css =
      '.a { background: red; transition: x 1s; } .a { background-color: blue; } .b { border: 0; }';
    expect(cascaded(css, '.a').get('background')).toBe('overridden by background-color: blue');
    expect(cascaded(css, '.a').get('transition')).toBe('x 1s');
    const later = `${css} .a { transition-property: y; }`;
    expect(cascaded(later, '.a').get('transition')).toBe('overridden by transition-property: y');
    expect(specificity(".x:not(:where([a='1'])):hover")).toBe(200);
    expect(specificity(".x[a='1']:not([b='1']):hover")).toBe(400);
    expect(specificity('.l :where(button, input)')).toBe(100);
  });

  it('turns the chevron instantly under reduced motion: the token sheet collapses it', () => {
    const styles = readFileSync(`${import.meta.dirname}/styles.css`, 'utf8');
    const tokensImport = styles.indexOf("@import '../../assets/css/tokens.css';");
    // The tokens (with the reduced-motion reset) load into the same shadow root, first.
    expect(tokensImport).toBeGreaterThanOrEqual(0);
    expect(tokensImport).toBeLessThan(styles.indexOf("@import './overlay.css';"));
    const tokens = readFileSync(`${import.meta.dirname}/../../assets/css/tokens.css`, 'utf8');
    const reset = cascaded(tokens, '*', '@media (prefers-reduced-motion: reduce)');
    expect(reset.get('transition-duration')).toBe('0.01ms !important');
    // Nothing in the overlay re-enables motion for reduced-motion users.
    expect(readFileSync(`${import.meta.dirname}/overlay.css`, 'utf8')).not.toContain(
      'prefers-reduced-motion'
    );
  });
});

describe('held controls under the pointer', () => {
  afterEach(cleanup);

  /** Hover rules that never change a held control's look, with why. */
  const HOVER_EXEMPT = new Set([
    // A list row, never held itself (its add button is, and is guarded).
    '.xo-candidate:hover',
    // A text field: a locked row is read-only, never aria-disabled.
    '.xo-row-input:hover',
    // Restates the copied colour over the ghost hover — the resting look.
    '.xo-lane-copy[data-copied]:hover'
  ]);

  /** The sheet's hover rules. */
  const hoverRules = (): CssRule[] =>
    parseRules(readFileSync(`${import.meta.dirname}/overlay.css`, 'utf8')).filter((rule) =>
      rule.selector.includes(':hover')
    );

  it('guards every control hover rule against aria-disabled (or names why not)', () => {
    const unguarded = hoverRules()
      .map((rule) => rule.selector)
      .filter(
        (selector) =>
          !HOVER_EXEMPT.has(selector) &&
          !selector.includes(":not(:where([aria-disabled='true']))") &&
          !selector.includes(":not([aria-disabled='true'])")
      );
    expect(unguarded).toEqual([]);
    expect(hoverRules().length).toBeGreaterThan(HOVER_EXEMPT.size);
  });

  it('a held control of every kind matches no hover rule', async () => {
    const { container } = mount(port({ state: 'inactive' }));
    fireEvent.click(await screen.findByRole('button', { name: /^On this page/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Apply$/ }));
    await screen.findByText('Reloading with your exclusions');
    // The kinds a reload hides rather than holds (the footer's Apply, row
    // and dock icon buttons, chips) join as held twins inside the layer.
    const layer = container.querySelector('.xo-layer');
    if (layer === null) throw new Error('the overlay layer is not mounted');
    for (const twin of [
      '<button class="xo-button" data-variant="primary" aria-disabled="true"></button>',
      '<button class="xo-icon-button" aria-disabled="true"></button>',
      '<button class="xo-chip" aria-pressed="false" aria-disabled="true"></button>'
    ]) {
      layer.insertAdjacentHTML('beforeend', twin);
    }
    const held = [...container.querySelectorAll("[aria-disabled='true']")];
    const kinds = new Set(
      held.map(
        (element) =>
          [...element.classList].filter((name) => name !== 'xo-button').join('.') ||
          `xo-button:${element.getAttribute('data-variant') ?? 'plain'}`
      )
    );
    // Every control kind, live where the reload holds it.
    for (const kind of [
      'xo-button:primary',
      'xo-button:ghost',
      'xo-button:plain',
      'xo-disclosure',
      'xo-lane-copy',
      'xo-candidate-add',
      'xo-switch',
      'xo-icon-button',
      'xo-chip'
    ]) {
      expect(kinds, kind).toContain(kind);
    }
    const hits = held.flatMap((element) =>
      hoverRules()
        .filter((rule) => element.matches(rule.selector.replaceAll(':hover', '')))
        .map((rule) => `${element.className} ← ${rule.selector}`)
    );
    expect(hits).toEqual([]);
  });
});
