import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPIED_FLASH_MS } from '../../../components/ui/copy-flash';
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import type { ExclusionSessionStatus } from '../../../lib/messaging/exclusion-session';
import type { VirtualizerFactory } from '../../../components/ui/virtual-list';
import { createOverlayController, type OverlayController } from '../controller';
import type { ExclusionSessionPort, PortOutcome } from '../session/port';
import type { ClipboardWrite, ClipboardWriter } from '../clipboard';
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
    pageFacts: () => ({
      href: 'https://example.com/',
      documentUrl: null,
      navigationStart: 0,
      responseEnd: null
    }),
    now: () => 1,
    schedule: () => () => undefined,
    reload: vi.fn(),
    log: { warn: vi.fn() }
  });
  controller.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return controller;
}

/** Render the Delay JS lane (its clipboard and live region faked). */
function mountLane(
  controller: OverlayController,
  report?: TransformReport,
  write: ClipboardWriter = () => Promise.resolve('copied')
) {
  const [locked, setLocked] = createSignal(false);
  const announce = vi.fn<(text: string) => void>();
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
      announce={announce}
      writeClipboard={write}
      createVirtualizer={everyRow}
    />
  ));
  return { setLocked, announce };
}

const copyAll = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Copy all Delay JavaScript execution exclusions' });

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

  it("keeps a row's surrounding whitespace while typing, trims it when focus leaves the row", async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['', 'other'], null);
    mountLane(controller);
    input(1).focus();
    fireEvent.input(input(1), { target: { value: ' gtag ' } });
    expect(input(1).value).toBe(' gtag ');
    // The window losing focus blurs the row but keeps it the active element:
    // the user is still typing there, so nothing is trimmed.
    input(1).dispatchEvent(new FocusEvent('blur'));
    expect(controller.draft().rows.delayJs[0]?.text).toBe(' gtag ');
    input(2).focus();
    expect(controller.draft().rows.delayJs[0]?.text).toBe('gtag');
    expect(input(1).value).toBe('gtag');
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
        announce={vi.fn()}
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
        announce={vi.fn()}
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

describe('Lane copy-all', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('copies the lane as the settings field takes it: trimmed, one per line, blanks left out', async () => {
    const controller = await readyController();
    vi.useFakeTimers();
    controller.insertRows('delayJs', [' gtag ', '', '\tjquery\\.min\\.js', 'a b'], null);
    const write = vi.fn<ClipboardWriter>(() => Promise.resolve('copied'));
    const { announce } = mountLane(controller, undefined, write);
    expect(copyAll().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(copyAll());
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe('gtag\njquery\\.min\\.js\na b');
    expect(announce).toHaveBeenCalledWith('Copied 3 exclusions');
    expect(copyAll().textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(COPIED_FLASH_MS);
    expect(copyAll().textContent).toBe('Copy all');
  });

  it('stays focusable but inert on an empty lane, and says why', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['   '], null);
    const write = vi.fn<ClipboardWriter>(() => Promise.resolve('copied'));
    const { announce } = mountLane(controller, undefined, write);
    expect(copyAll().getAttribute('aria-disabled')).toBe('true');
    expect(copyAll().getAttribute('title')).toMatch(/Nothing to copy/);
    const hint = document.getElementById(copyAll().getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toMatch(/Nothing to copy/);
    fireEvent.click(copyAll());
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(
      'Nothing to copy yet: add an exclusion to this lane first.'
    );
  });

  it('shows and announces a refused copy until the next attempt', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['gtag'], null);
    let answer: ClipboardWrite = 'failed';
    const { announce } = mountLane(controller, undefined, () => Promise.resolve(answer));
    expect(copyAll().getAttribute('title')).toMatch(/one per line/);
    fireEvent.click(copyAll());
    await waitFor(() => {
      expect(screen.getByText(/^Copy failed: this page refused clipboard access/)).toBeTruthy();
    });
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^Copy failed/));
    answer = 'copied';
    fireEvent.click(copyAll());
    await waitFor(() => {
      expect(screen.queryByText(/^Copy failed/)).toBeNull();
    });
    expect(announce).toHaveBeenLastCalledWith('Copied 1 exclusion');
  });

  it('ignores clicks while a copy is in flight, and reads a rejecting writer as a failure', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['gtag'], null);
    let reject: (cause: Error) => void = () => undefined;
    const write = vi.fn<ClipboardWriter>(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    );
    const { announce } = mountLane(controller, undefined, write);
    fireEvent.click(copyAll());
    expect(copyAll().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(copyAll());
    expect(write).toHaveBeenCalledTimes(1);
    reject(new Error('broken writer'));
    await waitFor(() => {
      expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^Copy failed/));
    });
    expect(copyAll().getAttribute('aria-busy')).toBeNull();
  });

  it('copies while the editor is locked (copying never edits)', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['gtag'], null);
    const write = vi.fn<ClipboardWriter>(() => Promise.resolve('copied'));
    const { setLocked } = mountLane(controller, undefined, write);
    setLocked(true);
    fireEvent.click(copyAll());
    await waitFor(() => {
      expect(write).toHaveBeenCalledWith('gtag', expect.any(HTMLElement));
    });
  });
});
