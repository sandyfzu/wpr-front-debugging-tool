/**
 * The Exclusions panel's add wiring: an add from the page list and a pick
 * on the page each announce what the add did — "Added …" and every refusal
 * (a full lane here), word for word — over a real controller.
 */
import { createRoot, createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VirtualizerFactory } from '../../../components/ui/virtual-list';
import type { ExclusionSessionStatus } from '../../../lib/messaging/exclusion-session';
import { createOverlayController, type OverlayController } from '../controller';
import type { OverlayModeContext, PickEvents } from '../modes';
import type { PageTools } from '../page-tools';
import type { ExclusionSessionPort, PortOutcome } from '../session/port';
import { ExclusionsConfig } from './mode';
import type { PageCandidate } from './page-scan';

afterEach(cleanup);

/** A port reply. */
const reply = <T,>(value: T): Promise<PortOutcome<T>> =>
  Promise.resolve({ kind: 'reply', reply: value });

/** A ready controller over an idle session (no saved set). */
async function readyController(): Promise<OverlayController> {
  const port = {
    status: vi.fn(() => reply<ExclusionSessionStatus>({ state: 'inactive' })),
    savedSet: vi.fn(() => reply({ set: null })),
    apply: vi.fn(() => reply({ outcome: 'applying' as const })),
    stop: vi.fn(() => reply<ExclusionSessionStatus>({ state: 'inactive' })),
    save: vi.fn(() => reply({ outcome: 'saved' as const })),
    onStatus: vi.fn(() => () => undefined)
  } satisfies ExclusionSessionPort;
  const controller = createRoot(() =>
    createOverlayController({
      port,
      pageFacts: () => ({
        href: 'https://example.com/',
        documentUrl: null,
        navigationStart: 0,
        responseEnd: null
      }),
      now: () => 1,
      clock: () => 1,
      schedule: () => () => undefined,
      reload: vi.fn(),
      log: { warn: vi.fn() }
    })
  );
  controller.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return controller;
}

/** Renders the first rows only (happy-dom has no layout; a full lane stays cheap). */
const firstRows: VirtualizerFactory = (options) => ({
  getVirtualItems: () =>
    Array.from({ length: Math.min(options.count, 5) }, (_, index) => ({
      key: options.getItemKey?.(index) ?? index,
      index,
      start: index * 37,
      end: (index + 1) * 37,
      size: 37,
      lane: 0
    })),
  getTotalSize: () => options.count * 37,
  measureElement: () => undefined
});

/** The page's one pickable element: a lazily rendered section. */
const CANDIDATE: PageCandidate = {
  lane: 'lazyRender',
  row: 'alr-candidate',
  subject: 'alr-candidate',
  key: 'k1',
  element: document.createElement('div')
};

/** Page tools whose scan found {@link CANDIDATE}. */
function pageTools(): PageTools {
  const [candidates] = createSignal<readonly PageCandidate[]>([CANDIDATE]);
  return {
    candidates,
    pageFacts: () => ({
      href: 'https://example.com/',
      documentUrl: null,
      navigationStart: 0,
      responseEnd: null
    }),
    pointPick: () => null,
    scanned: () => true,
    candidatesCapped: () => false,
    pageModal: () => false,
    pageTopLayerOpened: () => 0,
    zoom: () => 1,
    frames: () => [],
    refreshModal: () => undefined,
    rescan: () => undefined,
    dispose: () => undefined
  };
}

/** The panel over `controller`, its announcements and pick requests recorded. */
function renderPanel(controller: OverlayController) {
  const announce = vi.fn<(text: string) => void>();
  const picks: PickEvents[] = [];
  const context: OverlayModeContext = {
    controller,
    page: pageTools(),
    panelOpen: () => true,
    requestFrame: (run) => {
      run();
    },
    createVirtualizer: firstRows,
    pick: (_returnTo, events) => picks.push(events),
    highlight: () => undefined,
    announce
  };
  render(() => <ExclusionsConfig context={context} />);
  return { announce, picks };
}

/** The lane's row cap's announcement for {@link CANDIDATE} (the exact words). */
const FULL_LANE = 'alr-candidate not added: Automatic Lazy Rendering holds 500 rows at most';

/** Fill the Automatic Lazy Rendering lane to its row cap. */
function fillLane(controller: OverlayController): void {
  const rows = Array.from({ length: 500 }, (_, n) => `row-${String(n)}`);
  expect(controller.insertRows('lazyRender', rows, null)).toHaveLength(500);
}

/** Open "On this page" and press the candidate's Add button. */
function addFromList(): void {
  fireEvent.click(screen.getByRole('button', { name: /^On this page/ }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Add alr-candidate to Automatic Lazy Rendering' })
  );
}

describe('the Exclusions panel announces every add', () => {
  it('from the page list: added', async () => {
    const controller = await readyController();
    const { announce } = renderPanel(controller);
    addFromList();
    expect(announce).toHaveBeenLastCalledWith('Added alr-candidate to Automatic Lazy Rendering');
    expect(controller.draft().rows.lazyRender.map((row) => row.text)).toEqual(['alr-candidate']);
  });

  it('from the page list: a full lane says why nothing was added', async () => {
    const controller = await readyController();
    fillLane(controller);
    const { announce } = renderPanel(controller);
    announce.mockClear();
    addFromList();
    expect(announce).toHaveBeenLastCalledWith(FULL_LANE);
    expect(controller.draft().rows.lazyRender).toHaveLength(500);
  });

  it('from a pick on the page: a full lane says why nothing was added', async () => {
    const controller = await readyController();
    fillLane(controller);
    const { announce, picks } = renderPanel(controller);
    announce.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Pick on page' }));
    expect(picks).toHaveLength(1);
    picks[0]?.onPick({ candidate: CANDIDATE, element: CANDIDATE.element });
    expect(announce).toHaveBeenLastCalledWith(FULL_LANE);
  });
});
