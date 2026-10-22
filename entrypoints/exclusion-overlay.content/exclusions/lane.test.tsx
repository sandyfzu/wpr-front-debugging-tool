import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPIED_FLASH_MS } from '../../../components/ui/copy-flash';
import { EXCLUSION_SET_LIMITS } from '../../../lib/messaging/exclusion-session';
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import type { ExclusionSessionStatus } from '../../../lib/messaging/exclusion-session';
import type { VirtualizerFactory } from '../../../components/ui/virtual-list';
import { createOverlayController, type OverlayController } from '../controller';
import type { ExclusionSessionPort, PortOutcome } from '../session/port';
import type { ClipboardWrite, ClipboardWriter } from '../clipboard';
import { ROW_REASONS } from '../../../lib/exclusion-builder/row-reasons';
import { SET_READING_DELAY_MS } from './set-readings';
import { Lane } from './lane';
import { PASTE_COPY, appliedRowWarningNote } from '../copy';
import type { LaneKey } from './draft';

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

/**
 * A ready controller over an idle port.
 *
 * @param schedule The timers (default: none ever fires).
 */
async function readyController(
  schedule: (run: () => void, ms: number) => () => void = () => () => undefined
): Promise<OverlayController> {
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
    schedule,
    reload: vi.fn(),
    log: { warn: vi.fn() }
  });
  controller.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return controller;
}

/** Render a lane — Delay JS unless named (its clipboard and live region faked). */
function mountLane(
  controller: OverlayController,
  report?: TransformReport,
  write: ClipboardWriter = () => Promise.resolve('copied'),
  createVirtualizer: VirtualizerFactory = everyRow,
  lane: LaneKey = 'delayJs'
) {
  const [locked, setLocked] = createSignal(false);
  const announce = vi.fn<(text: string) => void>();
  const { unmount } = render(() => (
    <Lane
      lane={lane}
      controller={controller}
      report={report}
      pageCount={0}
      requestFrame={(run) => {
        run();
      }}
      locked={locked()}
      announce={announce}
      writeClipboard={write}
      createVirtualizer={createVirtualizer}
    />
  ));
  return { setLocked, announce, unmount };
}

const copyAll = (): HTMLButtonElement =>
  screen.getByRole('button', {
    name: /^Cop(y|ied) all Delay JavaScript execution exclusions$/
  });

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

  it('splits on a lone CR like a line feed (a textarea reads it as one)', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['ab'], null);
    mountLane(controller);
    input(1).setSelectionRange(1, 1);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'p\rq' } });
    input(1).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['ap', 'qb']);
    // Caret after the pasted 'q', before the kept 'b'.
    expect(document.activeElement).toBe(input(2));
    expect(input(2).selectionStart).toBe(1);
    expect(input(2).selectionEnd).toBe(1);
  });

  it('leaves a paste without a line break to the field', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', [''], null);
    mountLane(controller);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'a b' } });
    input(1).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('says so, inline and announced, when a full lane takes none of a paste', async () => {
    const controller = await readyController();
    controller.insertRows(
      'delayJs',
      Array.from({ length: EXCLUSION_SET_LIMITS.rowsPerFeature }, (_, n) => `r${String(n)}`),
      null
    );
    // Two rows rendered: the lane's 500 need not all be in the DOM.
    const firstRows: VirtualizerFactory = (options) => ({
      ...everyRow(options),
      getVirtualItems: () => everyRow(options).getVirtualItems().slice(0, 2)
    });
    const { announce } = mountLane(controller, undefined, undefined, firstRows);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'a\nb' } });
    input(1).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const words = 'Lane full: the paste was not added (500 rows max).';
    expect(screen.getByText(words)).toBeTruthy();
    expect(announce).toHaveBeenCalledWith(words);
    controller.removeRow('delayJs', controller.draft().rows.delayJs[0]?.id ?? '');
    await waitFor(() => {
      expect(screen.queryByText(words)).toBeNull();
    });
  });

  /** A multi-line paste event carrying `text`. */
  const pasteEvent = (text: string): Event => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
    return event;
  };
  const droppedWords = '1 pasted line was not added: a lane holds 500 rows at most.';

  it('keeps the paste outcome when focus reaches the pasted row a frame later', async () => {
    const controller = await readyController();
    const max = EXCLUSION_SET_LIMITS.rowsPerFeature;
    controller.insertRows(
      'delayJs',
      Array.from({ length: max - 1 }, (_, n) => `r${String(n)}`),
      null
    );
    // The pasted row lands off-screen: rendered only once the list scrolls.
    const [shown, setShown] = createSignal(1);
    const scrolled: VirtualizerFactory = (options) => ({
      ...everyRow(options),
      getVirtualItems: () => everyRow(options).getVirtualItems().slice(0, shown())
    });
    const frames: (() => void)[] = [];
    const announce = vi.fn<(text: string) => void>();
    render(() => (
      <Lane
        lane="delayJs"
        controller={controller}
        report={undefined}
        pageCount={0}
        requestFrame={(run) => {
          frames.push(run);
        }}
        locked={false}
        announce={announce}
        writeClipboard={() => Promise.resolve('copied')}
        createVirtualizer={scrolled}
      />
    ));
    input(1).focus();
    input(1).setSelectionRange(2, 2);
    input(1).dispatchEvent(pasteEvent('x\ny \nz'));
    expect(screen.getByText(droppedWords)).toBeTruthy();
    setShown(max);
    for (const run of frames.splice(0)) run();
    expect(document.activeElement).toBe(input(2));
    // Leaving the pasted row commits it (trimmed): not a lane edit either.
    input(1).focus();
    expect(controller.draft().rows.delayJs[1]?.text).toBe('y');
    expect(screen.getByText(droppedWords)).toBeTruthy();
    expect(announce).toHaveBeenCalledWith(droppedWords);
    // The next edit in the lane clears it.
    fireEvent.input(input(1), { target: { value: 'r0xx' } });
    await waitFor(() => {
      expect(screen.queryByText(droppedWords)).toBeNull();
    });
  });

  it('says what a long paste left out once its slices landed, and nothing after unmount', async () => {
    const timers: (() => void)[] = [];
    const schedule = (run: () => void): (() => void) => {
      timers.push(run);
      return () => undefined;
    };
    const controller = await readyController(schedule);
    controller.insertRows('delayJs', ['x'], null);
    const { announce, unmount } = mountLane(controller);
    const max = EXCLUSION_SET_LIMITS.rowsPerFeature;
    const lines = Array.from({ length: max + 2 }, (_, n) => `l${String(n)}`).join('\n');
    input(1).dispatchEvent(pasteEvent(`\n${lines}`));
    // Nothing landed yet: the lane holds its row, editing waits.
    expect(controller.draft().rows.delayJs).toHaveLength(1);
    expect(controller.editable()).toBe(false);
    while (timers.length > 0) timers.shift()?.();
    const words = '3 pasted lines were not added: a lane holds 500 rows at most.';
    await waitFor(() => {
      expect(screen.getByText(words)).toBeTruthy();
    });
    expect(controller.draft().rows.delayJs).toHaveLength(max);
    expect(announce).toHaveBeenCalledWith(words);
    unmount();
    // A long paste settling after its lane left says nothing.
    const other = await readyController(schedule);
    other.insertRows('delayJs', ['x'], null);
    const second = mountLane(other);
    input(1).dispatchEvent(pasteEvent(`\n${lines}`));
    expect(other.editable()).toBe(false);
    second.unmount();
    while (timers.length > 0) timers.shift()?.();
    await waitFor(() => {
      expect(other.draft().rows.delayJs).toHaveLength(max);
    });
    expect(second.announce).not.toHaveBeenCalled();
  });

  it('says typing and a second paste wait while a long paste lands, announcing it once', async () => {
    const timers: (() => void)[] = [];
    const controller = await readyController((run) => {
      timers.push(run);
      return () => undefined;
    });
    controller.insertRows('delayJs', ['x', 'y'], null);
    const { setLocked, announce } = mountLane(controller);
    const lines = Array.from({ length: 100 }, (_, n) => `l${String(n)}`).join('\n');
    input(1).dispatchEvent(pasteEvent(`\n${lines}`));
    // The overlay locks the rows while the paste holds the draft.
    setLocked(!controller.editable());
    expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('true');
    // Moves and shortcuts are not edits: nothing said.
    fireEvent.keyDown(input(2), { key: 'ArrowLeft' });
    fireEvent.keyDown(input(2), { key: 'c', ctrlKey: true });
    expect(screen.queryByText(PASTE_COPY.held)).toBeNull();
    fireEvent.keyDown(input(2), { key: 'z' });
    const second = pasteEvent('p\nq');
    input(2).dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
    fireEvent.keyDown(input(2), { key: 'Backspace' });
    expect(screen.getByText(PASTE_COPY.held)).toBeTruthy();
    expect(announce.mock.calls.filter(([text]) => text === PASTE_COPY.held)).toHaveLength(1);
    while (timers.length > 0) timers.shift()?.();
    await waitFor(() => {
      expect(controller.pasting()).toBe(false);
    });
    setLocked(!controller.editable());
    expect(screen.queryByText(PASTE_COPY.held)).toBeNull();
    expect(screen.getByRole('region').getAttribute('aria-busy')).toBeNull();
    // Only the first paste landed; the second one's lines are nowhere.
    expect(controller.draft().rows.delayJs.map((row) => row.text)).not.toContain('p');
    expect(controller.draft().rows.delayJs).toHaveLength(102);
  });

  it('says nothing about a paste hold while the lane is locked for another reason', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['x'], null);
    const { setLocked, announce } = mountLane(controller);
    setLocked(true);
    fireEvent.keyDown(input(1), { key: 'z' });
    input(1).dispatchEvent(pasteEvent('p\nq'));
    expect(screen.queryByText(PASTE_COPY.held)).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it('splits the row on a trailing line feed too (the field would drop it)', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['ab'], null);
    mountLane(controller);
    input(1).setSelectionRange(1, 1);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'foo\n' } });
    input(1).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['afoo', 'b']);
  });

  it('notes a row with invisible characters WP Rocket keeps, without blocking it', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['\u00a0', 'gtag'], null);
    mountLane(controller);
    const note = screen.getByText(/^This row has invisible characters WP Rocket keeps/);
    // The note's text element carries the id (the merged slot's Undo stays out of the description).
    expect(input(1).getAttribute('aria-describedby')).toBe(note.id);
    expect(input(1).getAttribute('aria-invalid')).toBe('false');
    expect(input(2).getAttribute('aria-describedby')).toBeNull();
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
    // Spelled without `+`: Delay JS reads every `+` as a literal one.
    controller.insertRows('delayJs', ['(a{1,}){1,}$'], null);
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
    // WCAG 2.5.3: the visible "Copied" is part of the accessible name.
    expect(copyAll().textContent).toBe('Copied');
    expect(copyAll().getAttribute('aria-label')).toBe(
      'Copied all Delay JavaScript execution exclusions'
    );
    await vi.advanceTimersByTimeAsync(COPIED_FLASH_MS);
    expect(copyAll().textContent).toBe('Copy all');
    expect(copyAll().getAttribute('aria-label')).toBe(
      'Copy all Delay JavaScript execution exclusions'
    );
  });

  it('copies the rows as WP Rocket stores them: sanitized, wildcards rewritten, one copy each', async () => {
    const controller = await readyController();
    vi.useFakeTimers();
    controller.insertRows('delayJs', ['x%41y.js', 'a*', 'a.*', '<b></b>', '('], null);
    const write = vi.fn<ClipboardWriter>(() => Promise.resolve('copied'));
    const { announce } = mountLane(controller, undefined, write);
    fireEvent.click(copyAll());
    await vi.advanceTimersByTimeAsync(0);
    expect(write.mock.calls[0]?.[0]).toBe('xy.js\na(.*)');
    expect(announce).toHaveBeenCalledWith('Copied 2 exclusions');
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
    // Sighted users see the reason too, until the lane changes.
    const reason = (): HTMLElement | null => document.querySelector('.xo-copy-line');
    expect(reason()?.textContent).toMatch(/^Nothing to copy yet/);
    controller.insertRows('delayJs', ['gtag'], null);
    await waitFor(() => {
      expect(reason()).toBeNull();
    });
  });

  it('drops the failure line once the lane rows change', async () => {
    const controller = await readyController();
    const [id] = controller.insertRows('delayJs', ['gtag'], null);
    mountLane(controller, undefined, () => Promise.resolve('failed'));
    fireEvent.click(copyAll());
    await waitFor(() => {
      expect(screen.getByText(/^Copy failed/)).toBeTruthy();
    });
    controller.editRow('delayJs', id ?? '', 'gtag2');
    await waitFor(() => {
      expect(screen.queryByText(/^Copy failed/)).toBeNull();
    });
  });

  it('neither announces nor arms the flash once unmounted mid-copy', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['gtag'], null);
    let finish: (outcome: ClipboardWrite) => void = () => undefined;
    const { announce, unmount } = mountLane(
      controller,
      undefined,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    fireEvent.click(copyAll());
    const timers = vi.spyOn(globalThis, 'setTimeout');
    unmount();
    finish('copied');
    await new Promise((resolve) => {
      queueMicrotask(() => {
        resolve(undefined);
      });
    });
    expect(announce).not.toHaveBeenCalled();
    expect(timers).not.toHaveBeenCalled();
    timers.mockRestore();
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

describe('Lane stored-form notes', () => {
  afterEach(cleanup);

  /** Type into a row, then leave it for the copy-all control. */
  function typeAndLeave(row: HTMLInputElement, text: string): void {
    row.focus();
    fireEvent.input(row, { target: { value: text } });
    copyAll().focus();
  }

  const undo = (n: number): HTMLButtonElement =>
    screen.getByRole('button', {
      name: `Undo change to Delay JavaScript execution row ${String(n)}`
    });

  it('notes the stored form on leaving a row; Undo restores the typed text, focused', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', [''], null);
    mountLane(controller);
    typeAndLeave(input(1), 'jquery-*.js');
    expect(input(1).value).toBe('jquery-(.*).js');
    const note = document.getElementById(input(1).getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe(
      'WP Rocket stores this as jquery-(.*).js (you typed jquery-*.js).'
    );
    expect([...(note?.querySelectorAll('code') ?? [])].map((code) => code.textContent)).toEqual([
      'jquery-(.*).js',
      'jquery-*.js'
    ]);
    // Never color alone: the note is words; Undo comes right after the row's own controls.
    const row = input(1).closest('[data-row-id]');
    const controls = [...(row?.querySelectorAll('input, button') ?? [])];
    expect(controls.at(-1)).toBe(undo(1));
    expect(undo(1).textContent).toBe('Undo');
    fireEvent.click(undo(1));
    expect(input(1).value).toBe('jquery-*.js');
    expect(document.activeElement).toBe(input(1));
    expect(input(1).selectionStart).toBe('jquery-*.js'.length);
    expect(input(1).getAttribute('aria-describedby')).toBeNull();
    // Leaving again converts again, with the same note.
    copyAll().focus();
    expect(input(1).value).toBe('jquery-(.*).js');
    expect(undo(1)).toBeTruthy();
  });

  it('merges the commit note with the invisible-characters note into one slot', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', [''], null);
    mountLane(controller);
    typeAndLeave(input(1), ' a* ');
    const row = input(1).closest('[data-row-id]');
    expect(row?.querySelectorAll('.xo-row-note')).toHaveLength(1);
    const note = document.getElementById(input(1).getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toMatch(
      /^WP Rocket stores this as .*\. This row has invisible characters/
    );
  });

  it('keeps notes across a remount (virtual rows unmount on scroll)', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', [''], null);
    const first = mountLane(controller);
    typeAndLeave(input(1), 'a*');
    first.unmount();
    mountLane(controller);
    expect(undo(1)).toBeTruthy();
  });

  it('lists a removed duplicate with its reason; Restore puts it back for editing', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['gtag', ''], null);
    const { announce } = mountLane(controller);
    typeAndLeave(input(2), 'gtag ');
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['gtag']);
    const removed = screen.getByRole('list', { name: 'Delay JavaScript execution rows removed' });
    expect(removed.textContent).toContain('Removed gtag : WP Rocket drops a copy of row 1.');
    // The lane itself announces nothing about commits (the mode does, once).
    expect(announce).not.toHaveBeenCalled();
    const restore = screen.getByRole('button', {
      name: 'Restore removed Delay JavaScript execution row 2'
    });
    // Label in name (WCAG 2.5.3): the visible word starts the accessible name.
    expect(restore.textContent).toBe('Restore');
    fireEvent.click(restore);
    expect(input(2).value).toBe('gtag ');
    expect(document.activeElement).toBe(input(2));
    expect(screen.queryByRole('list', { name: /rows removed$/ })).toBeNull();
  });

  it("lands focus on Restore when it was heading to the removed row's own control", async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['gtag', 'gtag'], null);
    const [id = ''] = controller.insertRows('delayJs', [''], null);
    mountLane(controller);
    fireEvent.input(input(2), { target: { value: '0' } });
    const removeButton = screen.getByRole('button', {
      name: 'Remove Delay JavaScript execution row 2'
    });
    fireEvent.blur(input(2), { relatedTarget: removeButton });
    expect(controller.draft().rows.delayJs.some((row) => row.id === id)).toBe(false);
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Restore removed Delay JavaScript execution row 2'
    );
  });

  it('lists three removals and counts the rest; a paste batch gets its summary', async () => {
    const controller = await readyController();
    const [id = ''] = controller.insertRows('delayJs', [''], null);
    mountLane(controller);
    controller.pasteRows('delayJs', id, '0\n0\n<b></b>\n0\n0\nx*', { start: 0, end: 0 });
    copyAll().focus();
    // The caret row (`x*`) commits on its own afterwards: the paste's summary stays.
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['x(.*)']);
    expect(
      screen.getByText('5 pasted rows removed: WP Rocket drops them when saving.')
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Restore removed/ })).toHaveLength(3);
    expect(screen.getByText('2 more rows removed.')).toBeTruthy();
  });

  it('holds Undo while the editor is locked, and drops it on the next edit in the lane', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['', 'other'], null);
    const { setLocked } = mountLane(controller);
    typeAndLeave(input(1), 'a*');
    setLocked(true);
    expect(undo(1).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(undo(1));
    expect(input(1).value).toBe('a(.*)');
    setLocked(false);
    fireEvent.input(input(2), { target: { value: 'other2' } });
    expect(screen.queryByRole('button', { name: /^Undo change/ })).toBeNull();
    // The note itself stays (it is still true).
    expect(input(1).getAttribute('aria-describedby')).not.toBeNull();
  });

  it('keeps Undo after Shift+Tab back into the row and Tab out again', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', [''], null);
    mountLane(controller);
    typeAndLeave(input(1), 'a*');
    input(1).focus();
    screen.getByRole('button', { name: 'Remove Delay JavaScript execution row 1' }).focus();
    expect(undo(1)).toBeTruthy();
  });

  it('keeps Undo when arrows pass through the converted row', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['', 'b'], null);
    mountLane(controller);
    input(1).focus();
    fireEvent.input(input(1), { target: { value: 'a*' } });
    fireEvent.keyDown(input(1), { key: 'ArrowDown' });
    fireEvent.keyDown(input(2), { key: 'ArrowUp' });
    fireEvent.keyDown(input(1), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(input(2));
    expect(undo(1)).toBeTruthy();
  });

  it('points every aria-describedby at an element, ids unique', async () => {
    const controller = await readyController();
    const [id = ''] = controller.insertRows('delayJs', [''], null);
    mountLane(controller);
    controller.pasteRows('delayJs', id, ' a* \n b*\n(\nc', { start: 0, end: 0 });
    copyAll().focus();
    for (const element of document.querySelectorAll('[aria-describedby]'))
      for (const ref of (element.getAttribute('aria-describedby') ?? '').split(' '))
        expect(document.getElementById(ref), ref).not.toBeNull();
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads the copied row and the Restore place from the lane as it is now', async () => {
    const controller = await readyController();
    const [id = ''] = controller.insertRows('delayJs', [''], null);
    controller.insertRows('delayJs', ['x'], null);
    mountLane(controller);
    // [x(typed), x, z, last, x(kept)]: both typed copies leave; `x` is row 3.
    controller.pasteRows('delayJs', id, 'x\nx\nz\nlast', { start: 0, end: 0 });
    copyAll().focus();
    const removedList = (): HTMLElement =>
      screen.getByRole('list', { name: 'Delay JavaScript execution rows removed' });
    expect(removedList().textContent).toContain('a copy of row 3');
    // Both copies would go back at row 1 now (the first is still out).
    const restores = screen.getAllByRole('button', {
      name: 'Restore removed Delay JavaScript execution row 1'
    });
    expect(restores).toHaveLength(2);
    fireEvent.click(restores[0] as HTMLButtonElement);
    // The restored `x` is row 1 now: the other copy names it, and goes back after it.
    expect(removedList().textContent).toContain('a copy of row 1');
    expect(
      screen.getByRole('button', { name: 'Restore removed Delay JavaScript execution row 2' })
    ).toBeTruthy();
  });
});

describe('Lane counts, hints and copy forms (K.5a.2)', () => {
  afterEach(cleanup);

  const DEFER_REPORT: TransformReport = {
    feature: 'defer_all_js',
    featureWide: false,
    candidates: 9,
    rewritten: 2,
    regionRemovals: 0,
    matchedRows: [],
    unmatchedRows: [],
    undetermined: 4,
    inlineUndetermined: 3,
    approximate: 1,
    rowCountsBestEffort: true
  };

  it('shows the count with each caveat, the inline-jQuery line once, and the limit hint', async () => {
    mountLane(await readyController(), DEFER_REPORT, undefined, undefined, 'deferJs');
    expect(screen.getByText('2 of 9 deferred and wrapped scripts restored')).toBeTruthy();
    expect(screen.getByText(/^1 left as served/)).toBeTruthy();
    expect(screen.getByText(/^1 matched against a rebuilt tag/)).toBeTruthy();
    expect(
      screen.getAllByText(
        'Whether inline jQuery stays wrapped depends on your existing Defer JS exclusions.'
      )
    ).toHaveLength(1);
    expect(screen.getByText(/^Row counts are best effort/)).toBeTruthy();
    expect(
      screen.getByText(
        /^WP Rocket’s remote exclusion lists and any custom code filters aren’t read here/
      )
    ).toBeTruthy();
  });

  it('shows no caveat for an exact count, and no limit hint outside Defer JS', async () => {
    mountLane(await readyController(), {
      feature: 'delay_js',
      featureWide: false,
      candidates: 3,
      rewritten: 1,
      regionRemovals: 0,
      matchedRows: [],
      unmatchedRows: []
    });
    expect(screen.getByText('1 of 3 delayed scripts restored')).toBeTruthy();
    expect(document.querySelector('.xo-lane-caveat')).toBeNull();
    expect(screen.queryByText(/remote exclusion lists/)).toBeNull();
  });

  it('notes re-keying while the lazy-render lane holds rows, never for blank ones', async () => {
    const controller = await readyController();
    const [id = ''] = controller.insertRows('lazyRender', [''], null);
    mountLane(controller, undefined, undefined, undefined, 'lazyRender');
    expect(screen.queryByText(/^Excluding an element re-keys/)).toBeNull();
    controller.editRow('lazyRender', id, 'id="footer"');
    expect(screen.getByText(/^Excluding an element re-keys/)).toBeTruthy();
  });

  it('warns on a whitespace-only lazy-render row, in the one note slot, without blocking it', async () => {
    const controller = await readyController();
    const [id = ''] = controller.insertRows('lazyRender', [''], null);
    mountLane(controller, undefined, undefined, undefined, 'lazyRender');
    controller.editRow('lazyRender', id, '   ');
    const field = screen.getByRole('textbox', { name: 'Automatic Lazy Rendering row 1' });
    const note = document.getElementById(field.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe(
      'Row is only whitespace — it matches nearly every element (any opening tag holding it). It is left out here: a blank row is an unfinished edit.'
    );
    expect(field.getAttribute('aria-invalid')).toBe('false');
  });

  it('copies the lazy-render rows as a rocket_lrc_exclusions filter, announced as one', async () => {
    const controller = await readyController();
    controller.insertRows('lazyRender', ['id="footer"', "it's"], null);
    const write = vi.fn<ClipboardWriter>(() => Promise.resolve('copied'));
    const { announce } = mountLane(controller, undefined, write, undefined, 'lazyRender');
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy all Automatic Lazy Rendering exclusions' })
    );
    await waitFor(() => {
      expect(announce).toHaveBeenCalledWith(
        'Copied 2 exclusions as a rocket_lrc_exclusions filter'
      );
    });
    expect(write.mock.calls[0]?.[0]).toBe(
      [
        "add_filter( 'rocket_lrc_exclusions', function ( $exclusions ) {",
        '\treturn array_merge( (array) $exclusions, [',
        '\t\t\'id="footer"\',',
        "\t\t'it\\'s',",
        '\t] );',
        '} );'
      ].join('\n')
    );
  });

  it('copies a row still being typed in its stored form (Copy all activated without focus leaving it)', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['', '(?+1)(x)'], null);
    const write = vi.fn<ClipboardWriter>(() => Promise.resolve('copied'));
    mountLane(controller, undefined, write);
    input(1).focus();
    fireEvent.input(input(1), { target: { value: ' jquery-*.js ' } });
    // A click that does not move focus (assistive tech, scripted activation).
    fireEvent.click(copyAll());
    await waitFor(() => {
      expect(write).toHaveBeenCalled();
    });
    // Stored form, and the unverified row copied as kept.
    expect(write.mock.calls[0]?.[0]).toBe('jquery-(.*).js\n(?+1)(x)');
    expect(input(1).value).toBe('jquery-(.*).js');
  });

  it('explains instead of copying when every row is blank', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', [''], null);
    const write = vi.fn<ClipboardWriter>(() => Promise.resolve('copied'));
    const { announce } = mountLane(controller, undefined, write);
    fireEvent.input(input(1), { target: { value: '   ' } });
    fireEvent.click(copyAll());
    expect(write).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(
      'Nothing to copy yet: add an exclusion to this lane first.'
    );
  });
});

describe('Lane page-wide state (K.5b; a warning since K.5c)', () => {
  /** A ready controller whose set readings run at once (their pause elapsed). */
  const readingController = (): Promise<OverlayController> =>
    readyController((run, ms) => {
      if (ms === SET_READING_DELAY_MS) run();
      return () => undefined;
    });

  afterEach(cleanup);

  const deferInput = (n: number): HTMLInputElement =>
    screen.getByRole('textbox', {
      name: new RegExp(`^Load JavaScript deferred row ${String(n)}$`)
    });
  const pageOff = (): HTMLElement | null => document.querySelector('[data-page-off]');
  const UNKNOWN = 'WP Rocket may defer no script on this page with these rows — not checked here.';

  it('names the row behind a page-off above the rows; Go to focuses it', async () => {
    const controller = await readingController();
    controller.insertRows('deferJs', ['jquery', '.*'], null);
    mountLane(controller, undefined, undefined, undefined, 'deferJs');
    const message = pageOff();
    expect(message).not.toBeNull();
    // Above the rows, a group named by its lead.
    expect(
      message?.compareDocumentPosition(deferInput(1)) === Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(true);
    expect(screen.getByRole('group', { name: /^WP Rocket defers no script on this page/ })).toBe(
      message
    );
    expect(message?.textContent).toBe(
      'WP Rocket defers no script on this page because of this row:Go to row 2.*Apply still runs and previews the page as WP Rocket serves it, with no script deferred. Edit or remove it to defer scripts again.'
    );
    // The row keeps its own words as a warning in its note slot (no repeat of
    // the page-wide consequence), and is not invalid: Apply runs.
    expect(deferInput(2).getAttribute('aria-invalid')).toBe('false');
    const rowNote = document.getElementById(deferInput(2).getAttribute('aria-describedby') ?? '');
    expect(rowNote?.textContent).toBe(appliedRowWarningNote(ROW_REASONS.joinedPageOff));
    expect(rowNote?.closest('.xo-row-note')?.getAttribute('data-tone')).toBe('warn');
    expect(ROW_REASONS.joinedPageOff).not.toMatch(/every script|defer no script/);
    fireEvent.click(screen.getByRole('button', { name: 'Go to row 2' }));
    expect(document.activeElement).toBe(deferInput(2));
  });

  it('names an unverified row behind a page-off, with a blank row counted in its position', async () => {
    const controller = await readingController();
    controller.insertRows('deferJs', ['a\\.js', '', '\\p{L}\\Qab'], null);
    mountLane(controller, undefined, undefined, undefined, 'deferJs');
    expect(screen.getByRole('button', { name: 'Go to row 3' })).toBeTruthy();
    expect(pageOff()?.querySelector('code')?.textContent).toBe('\\p{L}\\Qab');
    expect(deferInput(3).getAttribute('aria-invalid')).toBe('false');
  });

  it('never blocks: an apply goes out with the message shown', async () => {
    const controller = await readingController();
    controller.insertRows('deferJs', ['.*'], null);
    mountLane(controller, undefined, undefined, undefined, 'deferJs');
    expect(controller.invalidCount()).toBe(0);
    controller.apply();
    // The apply is in flight (no fix-rows notice); the message is no focus target.
    expect(controller.state()).toMatchObject({ phase: 'ready', pending: 'apply' });
    expect(pageOff()?.hasAttribute('tabindex')).toBe(false);
    expect(document.activeElement).not.toBe(pageOff());
  });

  it('leaves once the row behind it is fixed', async () => {
    const controller = await readingController();
    controller.insertRows('deferJs', ['.*'], null);
    mountLane(controller, undefined, undefined, undefined, 'deferJs');
    expect(pageOff()).not.toBeNull();
    fireEvent.input(deferInput(1), { target: { value: 'jquery' } });
    expect(pageOff()).toBeNull();
  });

  it('names three rows and counts the rest, plural words', async () => {
    const controller = await readingController();
    controller.insertRows('deferJs', ["(?'n'a)", "(?'n'b)", "(?'n'c)", "(?'n'd)"], null);
    mountLane(controller, undefined, undefined, undefined, 'deferJs');
    expect(pageOff()?.querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByText(/because of these rows:$/)).toBeTruthy();
    expect(screen.getByText('And 1 more row.')).toBeTruthy();
    expect(screen.getByText(/Edit or remove them to defer scripts again\.$/)).toBeTruthy();
  });

  it('carries the applied page-off into the counts, naming the rows by position (K.5c)', async () => {
    const report: TransformReport = {
      feature: 'defer_all_js',
      featureWide: false,
      candidates: 4,
      rewritten: 4,
      regionRemovals: 0,
      matchedRows: [],
      unmatchedRows: [],
      pageState: 'off',
      pageOffRows: ['.*']
    };
    const controller = await readingController();
    controller.insertRows('deferJs', ['jquery', '.*'], null);
    mountLane(controller, report, undefined, undefined, 'deferJs');
    expect(screen.getByText('4 of 4 deferred and wrapped scripts restored')).toBeTruthy();
    expect(
      screen.getByText(
        'WP Rocket defers no script on this page because of row 2, so every deferred script is restored.'
      )
    ).toBeTruthy();
    // No row was matched: no row badge claims a count.
    expect(screen.queryByText(/^No match$/)).toBeNull();
  });

  it('shows no page message for a joined-only row problem, nor for a page that is on', async () => {
    const controller = await readingController();
    controller.insertRows('deferJs', ['(?-i)zzz', 'A.JS'], null);
    mountLane(controller, undefined, undefined, undefined, 'deferJs');
    expect(pageOff()).toBeNull();
    expect(deferInput(1).getAttribute('aria-invalid')).toBe('true');
    fireEvent.input(deferInput(1), { target: { value: 'zzz' } });
    expect(pageOff()).toBeNull();
    expect(screen.queryByText(UNKNOWN)).toBeNull();
  });

  it('notes an unchecked page state without blocking, never while the feature is disabled', async () => {
    const controller = await readingController();
    controller.insertRows('deferJs', ['\\p{L}'], null);
    mountLane(controller, undefined, undefined, undefined, 'deferJs');
    expect(screen.getByText(UNKNOWN)).toBeTruthy();
    expect(controller.invalidCount()).toBe(0);
    expect(pageOff()).toBeNull();
    fireEvent.click(
      screen.getByRole('switch', { name: 'Disable feature: Load JavaScript deferred on this page' })
    );
    expect(screen.queryByText(UNKNOWN)).toBeNull();
  });

  it('qualifies the applied counts when the report could not check the page — once', async () => {
    const report: TransformReport = {
      feature: 'defer_all_js',
      featureWide: false,
      candidates: 4,
      rewritten: 1,
      regionRemovals: 0,
      matchedRows: [],
      unmatchedRows: [],
      pageState: 'unknown'
    };
    const caveat = /^These counts assume WP Rocket defers scripts on this page/;
    const controller = await readingController();
    const [row = ''] = controller.insertRows('deferJs', ['zzz'], null);
    mountLane(controller, report, undefined, undefined, 'deferJs');
    expect(screen.getByText(caveat)).toBeTruthy();
    // The rows as they are now aren't checked either: the lane note says it, the caveat steps back.
    controller.editRow('deferJs', row, '\\p{L}');
    expect(screen.getByText(UNKNOWN)).toBeTruthy();
    expect(screen.queryByText(caveat)).toBeNull();
  });
});

describe('Lane rows matching everything (K.5c)', () => {
  afterEach(cleanup);

  it('warns in the row note slot, never as a problem, and names the row in the counts', async () => {
    const controller = await readyController();
    controller.insertRows('delayJs', ['ok', '(?a)'], null);
    const report: TransformReport = {
      feature: 'delay_js',
      featureWide: false,
      candidates: 5,
      rewritten: 5,
      regionRemovals: 0,
      matchedRows: [{ row: '(?a)', rowKind: 'pattern', matches: 5 }],
      unmatchedRows: ['ok'],
      matchAllRows: ['(?a)']
    };
    mountLane(controller, report);
    expect(input(2).getAttribute('aria-invalid')).toBe('false');
    const note = document.getElementById(input(2).getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe(appliedRowWarningNote(ROW_REASONS.matchAll));
    expect(note?.closest('.xo-row-note')?.getAttribute('data-tone')).toBe('warn');
    expect(controller.invalidCount()).toBe(0);
    expect(
      screen.getByText(
        'Row 2 matches everything: WP Rocket excludes all delayed scripts with it, and so does this preview.'
      )
    ).toBeTruthy();
    // Edited away, the applied row is named by its text, as code.
    controller.editRow('delayJs', controller.draft().rows.delayJs[1]?.id ?? '', 'x');
    const caveat = screen.getByText(/matches everything/);
    expect(caveat.querySelector('code')?.textContent).toBe('(?a)');
  });
});
