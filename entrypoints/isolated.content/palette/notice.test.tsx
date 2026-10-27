/**
 * The page notice: the dismiss countdown (elapses unheld, holds while the
 * reader is on the notice, a release restarts the full countdown, cancel
 * stops it for good) and the view (an empty live region filled on the next
 * frame, the close control, hold reports from pointer and focus).
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoticeView, createDismissTimer, type DismissTimerDeps, type PageNotice } from './notice';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Timer seams over the fake clock. */
function fakeTimers(): DismissTimerDeps {
  return {
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (id) => {
      window.clearTimeout(id);
    }
  };
}

describe('createDismissTimer', () => {
  it('elapses after the countdown when nobody holds it', () => {
    vi.useFakeTimers();
    const onElapsed = vi.fn();
    const timer = createDismissTimer(fakeTimers(), 1000, onElapsed);
    timer.restart();
    vi.advanceTimersByTime(999);
    expect(onElapsed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it('holds while held and restarts the full countdown on release', () => {
    vi.useFakeTimers();
    const onElapsed = vi.fn();
    const timer = createDismissTimer(fakeTimers(), 1000, onElapsed);
    timer.restart();
    vi.advanceTimersByTime(900);
    timer.hold(true);
    vi.advanceTimersByTime(5000);
    expect(onElapsed).not.toHaveBeenCalled();
    // A restart while held (a newer notice) waits for the release too.
    timer.restart();
    vi.advanceTimersByTime(5000);
    expect(onElapsed).not.toHaveBeenCalled();
    timer.hold(false);
    vi.advanceTimersByTime(999);
    expect(onElapsed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it('restarts from zero on a newer notice', () => {
    vi.useFakeTimers();
    const onElapsed = vi.fn();
    const timer = createDismissTimer(fakeTimers(), 1000, onElapsed);
    timer.restart();
    vi.advanceTimersByTime(800);
    timer.restart();
    vi.advanceTimersByTime(800);
    expect(onElapsed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it('stops for good on cancel', () => {
    vi.useFakeTimers();
    const onElapsed = vi.fn();
    const timer = createDismissTimer(fakeTimers(), 1000, onElapsed);
    timer.restart();
    timer.cancel();
    vi.advanceTimersByTime(5000);
    expect(onElapsed).not.toHaveBeenCalled();
  });
});

/** Render the view with a manual frame queue. */
function renderNotice(notice: PageNotice) {
  const frames: Array<() => void> = [];
  const onDismiss = vi.fn();
  const onHold = vi.fn();
  const registerLayer = vi.fn();
  const [current, setCurrent] = createSignal(notice);
  render(() => (
    <NoticeView
      notice={current}
      onDismiss={onDismiss}
      onHold={onHold}
      registerLayer={registerLayer}
      requestFrame={(run) => frames.push(run)}
    />
  ));
  const flushFrames = (): void => {
    for (const run of frames.splice(0)) run();
  };
  return { onDismiss, onHold, registerLayer, flushFrames, setCurrent };
}

const NOTICE: PageNotice = { title: 'On-page UI is off', body: 'Right-click to turn it back on.' };

describe('NoticeView', () => {
  it('renders an empty polite region first and fills it on the next frame', () => {
    const view = renderNotice(NOTICE);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    view.flushFrames();
    expect(region.textContent).toContain(NOTICE.title);
    expect(region.textContent).toContain(NOTICE.body);
    expect(view.registerLayer).toHaveBeenCalledTimes(1);
  });

  it('swaps the text in place for a newer notice', () => {
    const view = renderNotice(NOTICE);
    view.flushFrames();
    view.setCurrent({ title: 'Exclusion Builder', body: 'This page is not an HTML page.' });
    expect(screen.getByRole('status').textContent).toContain('This page is not an HTML page.');
  });

  it('dismisses from its named close control', () => {
    const view = renderNotice(NOTICE);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(view.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('reports the hold while the pointer or focus is on it', () => {
    const view = renderNotice(NOTICE);
    const notice = document.querySelector<HTMLElement>('[data-fdt="page-notice"]');
    if (notice === null) throw new Error('notice not rendered');
    fireEvent.pointerEnter(notice);
    expect(view.onHold).toHaveBeenLastCalledWith(true);
    const close = screen.getByRole('button', { name: 'Dismiss notice' });
    fireEvent.focusIn(close);
    fireEvent.pointerLeave(notice);
    // Focus still inside: held.
    expect(view.onHold).toHaveBeenLastCalledWith(true);
    fireEvent.focusOut(close, { relatedTarget: document.body });
    expect(view.onHold).toHaveBeenLastCalledWith(false);
  });
});
