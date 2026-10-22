/**
 * The Copy report button: always labelled, the check flash and its reset
 * after {@link COPIED_FLASH_MS}, no flash on failure, clicks ignored while a
 * copy is in flight, and no timer armed by a copy that settles after unmount.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CopyReportOutcome } from '../../report/copy-report';
import { makeFdtData } from '../../state/fixtures';
import { COPIED_FLASH_MS } from '../../../../components/ui/copy-flash';
import { CopyReportButton } from './copy-report-button';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The button element. */
function button(): HTMLElement {
  return screen.getByRole('button', { name: 'Copy report' });
}

/** Whether the confirmation flash is up. */
function flashing(): boolean {
  return button().hasAttribute('data-fdt-copied');
}

/** A copy seam the test settles by hand. */
function deferredCopy(): {
  copy: ReturnType<typeof vi.fn<(data: unknown) => Promise<CopyReportOutcome>>>;
  settle: (outcome: CopyReportOutcome) => Promise<void>;
} {
  let resolve: ((outcome: CopyReportOutcome) => void) | undefined;
  const copy = vi.fn(
    () =>
      new Promise<CopyReportOutcome>((done) => {
        resolve = done;
      })
  );
  return {
    copy,
    settle: async (outcome) => {
      resolve?.(outcome);
      await Promise.resolve();
      await Promise.resolve();
    }
  };
}

describe('CopyReportButton', () => {
  it('always shows its label (never icon-only)', () => {
    render(() => <CopyReportButton data={makeFdtData()} copy={() => Promise.resolve('copied')} />);
    const label = [...button().childNodes].find((node) => node.textContent === 'Copy report');
    expect(label).toBeDefined();
    expect(button().querySelector('.sr-only')).toBeNull();
  });

  it('flashes the check after a copy and resets after the flash window', async () => {
    vi.useFakeTimers();
    const run = deferredCopy();
    render(() => <CopyReportButton data={makeFdtData()} copy={run.copy} />);
    fireEvent.click(button());
    await run.settle('copied');
    expect(flashing()).toBe(true);
    vi.advanceTimersByTime(COPIED_FLASH_MS - 1);
    expect(flashing()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(flashing()).toBe(false);
  });

  it('does not flash after a failed copy', async () => {
    const run = deferredCopy();
    render(() => <CopyReportButton data={makeFdtData()} copy={run.copy} />);
    fireEvent.click(button());
    await run.settle('failed');
    expect(flashing()).toBe(false);
  });

  it('ignores clicks while a copy is in flight, then accepts the next one', async () => {
    const run = deferredCopy();
    const data = makeFdtData();
    render(() => <CopyReportButton data={data} copy={run.copy} />);
    fireEvent.click(button());
    fireEvent.click(button());
    fireEvent.click(button());
    expect(run.copy).toHaveBeenCalledTimes(1);
    expect(run.copy).toHaveBeenCalledWith(data);
    await run.settle('copied');
    fireEvent.click(button());
    expect(run.copy).toHaveBeenCalledTimes(2);
  });

  it('survives a seam that rejects, and stays usable', async () => {
    const copy = vi.fn(() => Promise.reject(new Error('boom')));
    render(() => <CopyReportButton data={makeFdtData()} copy={copy} />);
    fireEvent.click(button());
    await Promise.resolve();
    await Promise.resolve();
    expect(flashing()).toBe(false);
    fireEvent.click(button());
    expect(copy).toHaveBeenCalledTimes(2);
  });

  it('arms no timer when the copy settles after unmount', async () => {
    vi.useFakeTimers();
    const run = deferredCopy();
    const view = render(() => <CopyReportButton data={makeFdtData()} copy={run.copy} />);
    fireEvent.click(button());
    view.unmount();
    await run.settle('copied');
    expect(vi.getTimerCount()).toBe(0);
  });
});
