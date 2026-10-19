/**
 * The Copy-as-exclusion action, rendered from its vocabulary: the pattern
 * reaches the clipboard byte-exact, the confirmation toast names the WP
 * Rocket setting to paste it into, and every failure shape — a rejected
 * write, no clipboard in the context — ends in the error toast naming the
 * pattern, never a throw. While the original-host resolution runs, the
 * control waits (announced, activation suppressed) with the resolution hint.
 */
import { fireEvent, render, screen, cleanup } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import type { ClipboardLike } from '../../../../components/ui/copy-button';
import { toast, toastItems } from '../../../../components/ui/toast-store';
import { copyFailedRemedy, ExclusionCopyButton, COPIED_DESCRIPTION } from './copy-exclusion';

const PATTERN = '/wp-content/plugins/p/a.js';

/** The configured control under test (clipboard injected, pattern static). */
function ExclusionCopy(props: { clipboard?: ClipboardLike; pending?: () => boolean }) {
  return (
    <ExclusionCopyButton
      pattern={() => PATTERN}
      pending={props.pending ?? (() => false)}
      name="Copy as exclusion: a.js"
      clipboard={props.clipboard}
      class="shrink-0"
    />
  );
}

beforeEach(() => {
  toast.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  toast.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ExclusionCopyButton', () => {
  it('copies the pattern verbatim and toasts the setting to paste it into', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    render(() => <ExclusionCopy clipboard={{ writeText }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as exclusion: a.js' }));
    await vi.waitFor(() => {
      expect(toastItems()).toHaveLength(1);
    });
    expect(writeText).toHaveBeenCalledWith(PATTERN);
    expect(toastItems()[0]).toMatchObject({
      tone: 'success',
      title: 'Exclusion copied',
      description: COPIED_DESCRIPTION
    });
  });

  it('toasts the pattern to add by hand when the clipboard rejects the write', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('Document is not focused.')));
    render(() => <ExclusionCopy clipboard={{ writeText }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as exclusion: a.js' }));
    await vi.waitFor(() => {
      expect(toastItems()).toHaveLength(1);
    });
    expect(toastItems()[0]).toMatchObject({
      tone: 'error',
      title: 'Copy failed',
      description: copyFailedRemedy(PATTERN)
    });
    // The platform's error text never reaches the UI copy.
    expect(JSON.stringify(toastItems())).not.toContain('Document is not focused');
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('toasts the remedy when no clipboard exists in this context (same feedback shape)', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      get: () => undefined
    });
    try {
      render(() => <ExclusionCopy />);
      fireEvent.click(screen.getByRole('button', { name: 'Copy as exclusion: a.js' }));
      await vi.waitFor(() => {
        expect(toastItems()).toHaveLength(1);
      });
      expect(toastItems()[0]).toMatchObject({
        tone: 'error',
        title: 'Copy failed',
        description: copyFailedRemedy(PATTERN)
      });
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('while pending: the resolution hint replaces the hover hint, then drops', () => {
    const [pending, setPending] = createSignal(true);
    render(() => <ExclusionCopy pending={pending} />);
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: a.js' });
    expect(copy.getAttribute('title')).toBe('Resolving the script’s original path…');
    expect(copy.getAttribute('aria-busy')).toBe('true');
    expect(copy.getAttribute('aria-disabled')).toBe('true');
    setPending(false);
    expect(copy.getAttribute('title')).toBe(
      'Copy an exclusion for this script, to exclude it from Delay JavaScript execution'
    );
    expect(copy.hasAttribute('aria-busy')).toBe(false);
  });
});
