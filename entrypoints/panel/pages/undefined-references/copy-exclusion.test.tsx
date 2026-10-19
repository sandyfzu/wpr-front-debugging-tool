/**
 * The Copy-as-exclusion action, configured onto the shared copy button: the
 * pattern reaches the clipboard byte-exact, the confirmation toast names the
 * WP Rocket setting to paste it into, and every failure shape — a rejected
 * write, no clipboard in the context — ends in the error toast naming the
 * pattern, never a throw.
 */
import { fireEvent, render, screen, cleanup } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyButton, type ClipboardLike } from '../../../../components/ui/copy-button';
import { toast, toastItems } from '../../../../components/ui/toast-store';
import { copyFailedRemedy, exclusionCopyProps, COPIED_DESCRIPTION } from './copy-exclusion';

const PATTERN = '/wp-content/plugins/p/a.js';

/** The configured control under test (clipboard injected). */
function ExclusionCopy(props: { clipboard?: ClipboardLike }) {
  return (
    <CopyButton
      {...exclusionCopyProps({ pattern: PATTERN, name: 'Copy as exclusion: a.js' })}
      clipboard={props.clipboard}
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

describe('exclusionCopyProps', () => {
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
});
