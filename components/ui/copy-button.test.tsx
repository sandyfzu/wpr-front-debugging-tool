/**
 * Render + seam tests for the shared copy control: the pure copy decision
 * core through injected clipboard/feedback, the `UX-D9` toast outcomes, the
 * welcome flash state (fake timers) and the clipboard fallback resolution.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COPIED_FLASH_MS,
  CopyButton,
  performCopy,
  type ClipboardLike,
  type CopyOutcomeSink
} from './copy-button';
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
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.querySelector('[data-fdt-spinner]')).not.toBeNull();
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(loadText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    resolve('complete 🛰️...');
    await vi.waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith('complete 🛰️...');
    });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(document.activeElement).toBe(button);
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

  it('guards repeat activation through a pending write and leaves user-moved focus alone', async () => {
    let resolve: () => void = () => undefined;
    const clipboard = {
      writeText: vi.fn(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          })
      )
    };
    render(() => (
      <>
        <CopyButton text="complete" label="Script" clipboard={clipboard} />
        <button type="button">Next action</button>
      </>
    ));
    const button = screen.getByRole('button', { name: 'Script' });
    button.focus();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-busy')).toBe('true');
    const next = screen.getByRole('button', { name: 'Next action' });
    next.focus();
    resolve();
    await vi.waitFor(() => {
      expect(button.hasAttribute('aria-busy')).toBe(false);
    });
    expect(document.activeElement).toBe(next);
    expect(toastItems()).toHaveLength(1);
  });

  it.each(['resolve', 'reject'] as const)(
    'suppresses late clipboard %s feedback after disposal',
    async (outcome) => {
      let resolve: () => void = () => undefined;
      let reject: (error: Error) => void = () => undefined;
      const clipboard = {
        writeText: vi.fn(
          () =>
            new Promise<void>((done, fail) => {
              resolve = done;
              reject = fail;
            })
        )
      };
      const { unmount } = render(() => (
        <CopyButton text="complete" label="Script" clipboard={clipboard} />
      ));
      fireEvent.click(screen.getByRole('button', { name: 'Script' }));
      unmount();
      if (outcome === 'resolve') resolve();
      else reject(new Error('late write failure'));
      await Promise.resolve();
      await Promise.resolve();
      expect(toastItems()).toHaveLength(0);
    }
  );

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

  it('lets the accessible name and the visible label differ (per-row copy actions)', () => {
    const clipboard: ClipboardLike = { writeText: vi.fn().mockResolvedValue(undefined) };
    render(() => (
      <CopyButton
        text="/p/a.js"
        label="Copy as exclusion"
        ariaLabel="Copy as exclusion: a.js (cdn.example.com)"
        clipboard={clipboard}
      />
    ));
    // The name is the override's; the visible text stays the short action.
    const button = screen.getByRole('button', {
      name: 'Copy as exclusion: a.js (cdn.example.com)'
    });
    expect(button.textContent).toContain('Copy as exclusion');
    expect(button.textContent).not.toContain('a.js');
  });

  it('gives the override priority over the icon-only name synthesis too', () => {
    const clipboard: ClipboardLike = { writeText: vi.fn().mockResolvedValue(undefined) };
    render(() => (
      <CopyButton
        text="/p/a.js"
        label="Copy as exclusion"
        ariaLabel="Copy as exclusion: a.js"
        showLabel={false}
        clipboard={clipboard}
      />
    ));
    expect(screen.getByRole('button', { name: 'Copy as exclusion: a.js' })).toBeTruthy();
  });

  it("renders 'regular-up' labels visible above the tier and named below it", () => {
    const clipboard: ClipboardLike = { writeText: vi.fn().mockResolvedValue(undefined) };
    render(() => (
      <CopyButton
        text="/p/a.js"
        label="Copy as exclusion"
        showLabel="regular-up"
        clipboard={clipboard}
      />
    ));
    const label = screen
      .getByRole('button', { name: 'Copy as exclusion' })
      .querySelector('.\\@max-regular\\:sr-only');
    expect(label).not.toBeNull();
    // The visually hidden branch still reads the label (the name follows the text).
    expect(label?.textContent).toBe('Copy as exclusion');
  });

  it('swaps the visible label to the flash wording for the flash window, then reverts', async () => {
    vi.useFakeTimers();
    try {
      const clipboard: ClipboardLike = { writeText: vi.fn().mockResolvedValue(undefined) };
      render(() => (
        <CopyButton
          text="x"
          label="Copy as exclusion"
          copiedLabel="Copied"
          ariaLabel="Copy as exclusion: a.js"
          clipboard={clipboard}
        />
      ));
      const button = screen.getByRole('button', { name: 'Copy as exclusion: a.js' });
      expect(button.textContent).toBe('Copy as exclusion');
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(0);
      expect(button.hasAttribute('data-fdt-copied')).toBe(true);
      // The wording swapped; the accessible name held still (the override set).
      expect(button.textContent).toBe('Copied');
      expect(button.getAttribute('aria-label')).toBe('Copy as exclusion: a.js');
      // The flash check carries the shared ok status color (not color-only feedback: the wording too).
      expect(button.querySelector('.text-status-ok')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(COPIED_FLASH_MS);
      expect(button.hasAttribute('data-fdt-copied')).toBe(false);
      expect(button.textContent).toBe('Copy as exclusion');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets the name follow the flash wording per state when no override holds it', async () => {
    vi.useFakeTimers();
    try {
      const clipboard: ClipboardLike = { writeText: vi.fn().mockResolvedValue(undefined) };
      render(() => (
        <CopyButton text="x" label="Copy as exclusion" copiedLabel="Copied" clipboard={clipboard} />
      ));
      // No `ariaLabel`: the accessible name follows the rendered text, so it
      // swaps to the flash wording with it (the documented pairing trap).
      const button = screen.getByRole('button', { name: 'Copy as exclusion' });
      expect(button.getAttribute('aria-label')).toBeNull();
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
      await vi.advanceTimersByTimeAsync(COPIED_FLASH_MS);
      expect(screen.getByRole('button', { name: 'Copy as exclusion' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the label text while flashed when no flash wording is given', async () => {
    vi.useFakeTimers();
    try {
      const clipboard: ClipboardLike = { writeText: vi.fn().mockResolvedValue(undefined) };
      render(() => <CopyButton text="1" label="Report" clipboard={clipboard} />);
      const button = screen.getByRole('button', { name: 'Report' });
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(0);
      expect(button.textContent).toBe('Report');
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a standing success flash when a same-window retry fails to write', async () => {
    vi.useFakeTimers();
    try {
      const writeText = vi
        .fn<() => Promise<void>>()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Document is not focused'));
      render(() => <CopyButton text="1" label="Report" clipboard={{ writeText }} />);
      const button = screen.getByRole('button', { name: 'Report' });
      // Copy 1 confirms: the ok-colored check stands for the flash window.
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(0);
      expect(button.querySelector('.text-status-ok')).not.toBeNull();
      // The guard holds only while busy, so a retry inside that window is
      // legal — and it rejects.
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(0);
      // The failure flushed the flash: no stale check beside the fresh error.
      expect(button.querySelector('.text-status-ok')).toBeNull();
      expect(button.hasAttribute('data-fdt-copied')).toBe(false);
      expect(toastItems().map((item) => item.tone)).toEqual(['success', 'error']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a standing success flash when a same-window retry fails at the source read', async () => {
    vi.useFakeTimers();
    try {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const loadText = vi
        .fn<(signal: AbortSignal) => Promise<string>>()
        .mockResolvedValueOnce('full')
        .mockRejectedValueOnce(new Error('source gone'));
      render(() => (
        <CopyButton
          text="preview…"
          label="Script"
          loadText={loadText}
          sourceFailureDescription="Refresh the panel and try copying again."
          clipboard={{ writeText }}
        />
      ));
      const button = screen.getByRole('button', { name: 'Script' });
      // The first read and write confirm: the ok-colored check stands.
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(0);
      expect(button.querySelector('.text-status-ok')).not.toBeNull();
      // A retry whose source read rejects must flush the flash the same way.
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(0);
      expect(button.querySelector('.text-status-ok')).toBeNull();
      expect(button.hasAttribute('data-fdt-copied')).toBe(false);
      expect(toastItems().at(-1)?.description).toBe('Refresh the panel and try copying again.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('toasts the copied shape the consumer words: title override and destination hint', async () => {
    const clipboard: ClipboardLike = { writeText: vi.fn().mockResolvedValue(undefined) };
    render(() => (
      <CopyButton
        text="/p/a.js"
        label="Copy as exclusion"
        ariaLabel="Copy as exclusion: a.js"
        successTitle="Exclusion copied"
        successDescription="Paste it into WP Rocket's Delay JavaScript execution → Excluded JavaScript Files."
        clipboard={clipboard}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy as exclusion: a.js' }));
    await vi.waitFor(() => {
      expect(toastItems()).toHaveLength(1);
    });
    expect(toastItems()[0]).toMatchObject({
      tone: 'success',
      title: 'Exclusion copied',
      description:
        "Paste it into WP Rocket's Delay JavaScript execution → Excluded JavaScript Files."
    });
  });

  it('toasts the consumer remedy on write failure, still never the platform error', async () => {
    const clipboard: ClipboardLike = {
      writeText: vi.fn().mockRejectedValue(new Error('Document is not focused'))
    };
    render(() => (
      <CopyButton
        text="/p/a.js"
        label="Copy as exclusion"
        ariaLabel="Copy as exclusion: a.js"
        failureDescription="Add it by hand: /p/a.js"
        clipboard={clipboard}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy as exclusion: a.js' }));
    await vi.waitFor(() => {
      expect(toastItems()).toHaveLength(1);
    });
    expect(toastItems()[0]).toMatchObject({
      tone: 'error',
      title: 'Copy failed',
      description: 'Add it by hand: /p/a.js'
    });
    expect(JSON.stringify(toastItems())).not.toContain('Document is not focused');
  });

  it('renders the consumer remedy when even the clipboard seam cannot be constructed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      get: () => undefined
    });
    try {
      render(() => (
        <CopyButton
          text="/p/a.js"
          label="Copy as exclusion"
          ariaLabel="Copy as exclusion: a.js"
          failureDescription="Add it by hand: /p/a.js"
        />
      ));
      fireEvent.click(screen.getByRole('button', { name: 'Copy as exclusion: a.js' }));
      await vi.waitFor(() => {
        expect(toastItems()).toHaveLength(1);
      });
      expect(toastItems()[0]).toMatchObject({
        tone: 'error',
        title: 'Copy failed',
        description: 'Add it by hand: /p/a.js'
      });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
      warn.mockRestore();
    }
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
