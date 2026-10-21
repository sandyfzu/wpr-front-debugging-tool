import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import type { ExclusionSessionStatus } from '../../../lib/messaging/exclusion-session';
import type { VirtualizerFactory } from '../../../components/ui/virtual-list';
import { createOverlayController, type OverlayController } from '../controller';
import type { ExclusionSessionPort, PortOutcome } from '../session/port';
import { Lane } from './lane';

/** Renders every row (happy-dom has no layout). */
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
  measureElement: () => undefined
});

const reply = <T,>(value: T): Promise<PortOutcome<T>> =>
  Promise.resolve({ kind: 'reply', reply: value });

/** A ready controller over an idle port. */
async function readyController(): Promise<OverlayController> {
  const port: ExclusionSessionPort = {
    status: () => reply<ExclusionSessionStatus>({ state: 'inactive' }),
    savedSet: () => reply({ set: null }),
    apply: () => new Promise(() => undefined),
    stop: () => reply<ExclusionSessionStatus>({ state: 'inactive' }),
    save: () => reply({ outcome: 'saved' as const }),
    onStatus: () => () => undefined
  };
  const controller = createOverlayController({
    port,
    pageFacts: () => ({ href: 'https://example.com/', documentUrl: null, timeOrigin: 0 }),
    now: () => 1,
    schedule: () => () => undefined,
    reload: vi.fn(),
    log: { warn: vi.fn() }
  });
  controller.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return controller;
}

/** Render the Delay JS lane. */
function mountLane(controller: OverlayController, report?: TransformReport) {
  const [locked, setLocked] = createSignal(false);
  render(() => (
    <Lane
      lane="delayJs"
      controller={controller}
      report={report}
      pageCount={0}
      requestFrame={(run) => {
        run();
      }}
      locked={locked()}
      createVirtualizer={everyRow}
    />
  ));
  return { setLocked };
}

const input = (n: number): HTMLInputElement =>
  screen.getByRole('textbox', {
    name: new RegExp(`^Delay JavaScript execution row ${String(n)}$`)
  });

describe('Lane', () => {
  afterEach(cleanup);

  it('says the feature is absent from the page when it has no rows', async () => {
    mountLane(await readyController());
    expect(screen.getByText('No delayed scripts on this page.')).toBeTruthy();
  });

  it('adds a row and focuses it; Enter adds below, Backspace on empty removes', async () => {
    const controller = await readyController();
    mountLane(controller);
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    expect(document.activeElement).toBe(input(1));
    fireEvent.input(input(1), { target: { value: 'gtag' } });
    fireEvent.keyDown(input(1), { key: 'Enter' });
    expect(document.activeElement).toBe(input(2));
    fireEvent.keyDown(input(2), { key: 'Backspace' });
    await waitFor(() => {
      expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['gtag']);
    });
    expect(document.activeElement).toBe(input(1));
  });

  it('moves with the arrows, accumulating fast presses', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['a', 'b', 'c'], null);
    mountLane(controller);
    input(1).focus();
    fireEvent.keyDown(input(1), { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement ?? input(1), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(input(3));
    fireEvent.keyDown(input(3), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(input(2));
  });

  it('splits a multi-line paste into rows', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', [''], null);
    mountLane(controller);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'a\nb\nc' } });
    input(1).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['a', 'b', 'c']);
  });

  it("pastes lines at the caret, keeping the row's text", async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['gtag'], null);
    mountLane(controller);
    input(1).setSelectionRange(1, 3);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'a\nb' } });
    input(1).dispatchEvent(event);
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['ga', 'bg']);
    expect(document.activeElement).toBe(input(2));
  });

  it('ignores editing keys and pastes while locked', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', [''], null);
    const { setLocked } = mountLane(controller);
    setLocked(true);
    fireEvent.keyDown(input(1), { key: 'Enter' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'a\nb' } });
    input(1).dispatchEvent(event);
    expect(controller.draft().rows.delayJs).toHaveLength(1);
  });

  it('marks a problem row, rendering quoted patterns as code', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['(a+)+$'], null);
    mountLane(controller);
    expect(input(1).getAttribute('aria-invalid')).toBe('true');
    const problem = document.getElementById(input(1).getAttribute('aria-describedby') ?? '');
    expect(problem?.querySelector('code')).not.toBeNull();
    expect(problem?.textContent).not.toContain('`');
  });

  it('shows match counts in one aligned column, with the lane count', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['gtag', 'nothing', 'new'], null);
    mountLane(controller, {
      feature: 'delay_js',
      featureWide: false,
      candidates: 4,
      rewritten: 2,
      regionRemovals: 0,
      matchedRows: [{ row: 'gtag', rowKind: 'pattern', matches: 2 }],
      unmatchedRows: ['nothing']
    });
    expect(screen.getByText('2 of 4 delayed scripts restored')).toBeTruthy();
    expect(screen.getByText('2 matches')).toBeTruthy();
    expect(screen.getByText('No match')).toBeTruthy();
    // The unknown row keeps an empty badge slot (aligned inputs).
    expect(document.querySelectorAll('.xo-match')).toHaveLength(3);
  });

  it('toggles the feature-wide disable and says rows are unused', async () => {
    const controller = await readyController();
    mountLane(controller);
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Disable feature: Delay JavaScript execution on this page'
      })
    );
    expect(controller.draft().disable.delayJs).toBe(true);
    expect(screen.getByText(/rows are not used/)).toBeTruthy();
  });

  it('forgets an arrow target it never reached, so the next move starts from the focused row', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['a', 'b', 'c', 'd'], null);
    // Renders rows 1-2 only: row 3 never appears (a far jump that never lands).
    const twoRows: VirtualizerFactory = (options) => ({
      ...everyRow(options),
      getVirtualItems: () => everyRow(options).getVirtualItems().slice(0, 2)
    });
    render(() => (
      <Lane
        lane="delayJs"
        controller={controller}
        report={undefined}
        pageCount={0}
        requestFrame={(run) => {
          run();
        }}
        locked={false}
        createVirtualizer={twoRows}
      />
    ));
    input(2).focus();
    fireEvent.keyDown(input(2), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(input(2));
    // Up from the row that still has focus (a stale target would aim at row 2).
    fireEvent.keyDown(input(2), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(input(1));
  });

  it('drops a pending arrow target when focus lands on a row another way', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['a', 'b', 'c', 'd'], null);
    const twoRows: VirtualizerFactory = (options) => ({
      ...everyRow(options),
      getVirtualItems: () => everyRow(options).getVirtualItems().slice(0, 2)
    });
    render(() => (
      <Lane
        lane="delayJs"
        controller={controller}
        report={undefined}
        pageCount={0}
        // Frames never run: the move to row 3 stays pending.
        requestFrame={() => undefined}
        locked={false}
        createVirtualizer={twoRows}
      />
    ));
    input(2).focus();
    fireEvent.keyDown(input(2), { key: 'ArrowDown' });
    // A click/Tab onto row 1 ends the pending move...
    input(1).focus();
    // ...so Down goes from row 1 (a kept target would aim at row 4).
    fireEvent.keyDown(input(1), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(input(2));
  });
});
