/**
 * Render + seam tests for the shared copy control: the pure copy decision
 * core through injected clipboard/feedback, the `UX-D9` toast outcomes, the
 * welcome flash state (fake timers) and the clipboard fallback resolution.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyButton, performCopy, type ClipboardLike, type CopyOutcomeSink } from './copy-button';
import { toast, toastItems } from './toast-store';

beforeEach(() => {
  toast.clear();
});

afterEach(() => {
  cleanup();
});

describe('performCopy (pure decision core)', () => {
  /** A clipboard double that records text and resolves/rejects by config. */
  function clipboardLike(behavior: 'resolve' | 'reject'): ClipboardLike & { writes: string[] } {
    return {
      writes: [],
      writeText(text) {
        this.writes.push(text);
        return new Promise<void>((resolve, reject) => {
          if (behavior === 'resolve') resolve();
          else reject(new Error('not allowed'));
        });
      }
    };
  }

  /** A feedback double capturing outcomes through a lexical record. */
  function sink(): CopyOutcomeSink & { outcomes: Array<'copied' | 'failed'> } {
    const state: { outcomes: Array<'copied' | 'failed'> } = { outcomes: [] };
    return {
      outcomes: state.outcomes,
      copied: () => {
        state.outcomes.push('copied');
      },
      failed: () => {
        state.outcomes.push('failed');
      }
    };
  }

  it('writes the text through the clipboard and reports copied', async () => {
    const clipboard = clipboardLike('resolve');
    const outcome = sink();
    await performCopy('zip-list', clipboard, outcome);
    expect(clipboard.writes).toEqual(['zip-list']);
    expect(outcome.outcomes).toEqual(['copied']);
  });

  it('reports failed without throwing past the call when the write rejects', async () => {
    const outcome = sink();
    const result = await performCopy('report', clipboardLike('reject'), outcome);
    expect(result).toBe('failed');
    expect(outcome.outcomes).toEqual(['failed']);
  });
});

describe('CopyButton', () => {
  it('copies the payload and confirms through the toast store', async () => {
    const clipboard: ClipboardLike = { writeText: vi.fn().mockResolvedValue(undefined) };
    render(() => <CopyButton text="1,2,3" label="Exclusion list" clipboard={clipboard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Exclusion list' }));
    await vi.waitFor(() => {
      expect(toastItems()).toHaveLength(1);
    });
    expect(toastItems()[0]).toMatchObject({ tone: 'success', title: 'Exclusion list copied' });
    expect(toastItems()[0]?.title).toBe('Exclusion list copied');
  });

  it('resolves complete text on demand, reports the real wait, and prevents duplicate reads', async () => {
    let resolve: (text: string) => void = () => undefined;
    const loadText = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        })
    );
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    render(() => (
      <CopyButton text="preview..." label="Script" loadText={loadText} clipboard={clipboard} />
    ));
    const button = screen.getByRole('button', { name: 'Script' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(loadText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    resolve('complete 🛰️...');
    await vi.waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith('complete 🛰️...');
    });
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('never copies a preview after source failure, and permits a retry with an actionable remedy', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const loadText = vi
      .fn()
      .mockRejectedValueOnce(new Error('private source'))
      .mockResolvedValueOnce('full');
    render(() => (
      <CopyButton
        text="preview..."
        label="Script"
        loadText={loadText}
        sourceFailureDescription="Refresh the panel and try copying again."
        clipboard={clipboard}
      />
    ));
    const button = screen.getByRole('button', { name: 'Script' });
    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(toastItems()[0]?.description).toBe('Refresh the panel and try copying again.');
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith('full');
    });
  });

  it('aborts an outstanding source read on disposal and never writes its late result', async () => {
    let resolve: (text: string) => void = () => undefined;
    let signal: AbortSignal | undefined;
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const { unmount } = render(() => (
      <CopyButton
        text="preview"
        label="Script"
        clipboard={clipboard}
        loadText={(active) => {
          signal = active;
          return new Promise<string>((done) => {
            resolve = done;
          });
        }}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Script' }));
    unmount();
    expect(signal?.aborted).toBe(true);
    resolve('late full source');
    await Promise.resolve();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(toastItems()).toHaveLength(0);
  });

  it('renders the error toast with a remedy when the clipboard rejects', async () => {
    const clipboard: ClipboardLike = {
      writeText: vi.fn().mockRejectedValue(new Error('write blocked'))
    };
    render(() => <CopyButton text="report" label="Report" clipboard={clipboard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    await vi.waitFor(() => {
      expect(toastItems()).toHaveLength(1);
    });
    expect(toastItems()[0]).toMatchObject({ tone: 'error', title: 'Copy failed' });
    // The remedy line is the actionable UX-D1 follow-through — never silence.
    expect(toastItems()[0]?.description).toContain('Copy it from selection');
  });

  it('never leaks the platform error into UI copy', async () => {
    const clipboard: ClipboardLike = {
      writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError: super secrets'))
    };
    render(() => <CopyButton text="x" label="Value" clipboard={clipboard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Value' }));
    await vi.waitFor(() => toastItems().length > 0);
    expect(toastItems()[0]?.description).not.toContain('secrets');
  });

  it('flashes the copied state and resets after the timer (fake timers)', async () => {
    vi.useFakeTimers();
    try {
      const clipboard: ClipboardLike = { writeText: vi.fn().mockResolvedValue(undefined) };
      render(() => <CopyButton text="1" label="Report" clipboard={clipboard} />);
      fireEvent.click(screen.getByRole('button', { name: 'Report' }));
      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: 'Report' }).getAttribute('data-fdt-copied')).toBe(
          ''
        );
      });
      vi.advanceTimersByTime(1500);
      expect(screen.getByRole('button', { name: 'Report' }).hasAttribute('data-fdt-copied')).toBe(
        true
      );
      vi.advanceTimersByTime(500);
      expect(screen.getByRole('button', { name: 'Report' }).hasAttribute('data-fdt-copied')).toBe(
        false
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('is icon-only when the label is hidden, keeping an accessible name', () => {
    const clipboard: ClipboardLike = { writeText: vi.fn().mockResolvedValue(undefined) };
    render(() => <CopyButton text="1" label="Report" showLabel={false} clipboard={clipboard} />);
    expect(screen.getByRole('button', { name: 'Report — copy' }).textContent).not.toContain(
      'Report'
    );
  });

  it('renders the error toast even when the clipboard seam cannot be constructed (no dead end)', async () => {
    // The default-seam path throws synchronously inside the click (no
    // clipboard in the context — shadowed away here). The guard must convert
    // that into the same feedback as a rejected write: this is the
    // regression shape that used to escape the click handler with zero UI.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      get: () => undefined
    });
    try {
      render(() => <CopyButton text="x" label="Notice" />);
      fireEvent.click(screen.getByRole('button', { name: 'Notice' }));
      await vi.waitFor(() => {
        expect(toastItems()).toHaveLength(1);
      });
      expect(toastItems()[0]).toMatchObject({ tone: 'error', title: 'Copy failed' });
      expect(toastItems()[0]?.description).toContain('Copy it from selection');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      // Drop the shadow; happy-dom's own clipboard getter becomes visible again.
      Reflect.deleteProperty(navigator, 'clipboard');
      warn.mockRestore();
    }
  });
});
