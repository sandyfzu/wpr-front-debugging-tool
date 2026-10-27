/**
 * The compare overlay under the on-page UI gate, driven through the real
 * gated-surface machine and the real restore record helpers: a gate-off
 * boot consumes the record and opens nothing (and a later gate-on does not
 * resurrect it), a gate-on boot honors the record / auto-flow, a live off
 * closes + unmounts and a live on re-opens only what was up.
 */
import { describe, expect, it, vi } from 'vitest';
import { createGatedSurface } from '../../../lib/page-ui/gated-surface';
import { createOverlayGate } from './page-ui-gate';
import { SBS_OPEN_STATE_KEY, markOverlayOpen, type OpenStateWindow } from './session-open';

const PAGE = 'https://site.test/page';

/** A map-backed `sessionStorage` window. */
function storageWindow(): { win: OpenStateWindow; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    win: {
      sessionStorage: {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
          data.set(key, value);
        },
        removeItem: (key) => {
          data.delete(key);
        }
      }
    }
  };
}

/** The overlay's seams as fakes, wired into a machine. */
function harness(options: { autoFlow?: boolean; open?: () => Promise<void> } = {}) {
  const { win, data } = storageWindow();
  const state = { open: false, opening: false };
  const open = vi.fn(
    options.open ??
      (() => {
        state.open = true;
        return Promise.resolve();
      })
  );
  const close = vi.fn(() => {
    state.open = false;
  });
  const unmount = vi.fn();
  const error = vi.fn();
  const gate = createOverlayGate({
    win,
    href: () => PAGE,
    autoFlowPage: () => options.autoFlow ?? false,
    isOpen: () => state.open,
    opening: () => state.opening,
    open,
    close,
    unmount,
    isInvalid: () => false,
    log: { error }
  });
  const surface = createGatedSurface(gate, { error });
  const boot = (): void => {
    gate.consumeRestore();
    surface.pageReady();
  };
  return { win, data, state, open, close, unmount, error, surface, boot };
}

describe('boot', () => {
  it('a gate-off boot clears the restore record and opens nothing — a later gate-on does not resurrect it', () => {
    const h = harness();
    markOverlayOpen(h.win, PAGE);
    h.boot();
    h.surface.gate(false);
    expect(h.data.has(SBS_OPEN_STATE_KEY)).toBe(false);
    expect(h.open).not.toHaveBeenCalled();
    h.surface.gate(true);
    expect(h.open).not.toHaveBeenCalled();
  });

  it('a gate-off boot on the auto-flow page opens nothing', () => {
    const h = harness({ autoFlow: true });
    h.boot();
    h.surface.gate(false);
    expect(h.open).not.toHaveBeenCalled();
  });

  it('a gate-on boot restores a matching record', () => {
    const h = harness();
    markOverlayOpen(h.win, PAGE);
    h.surface.gate(true);
    h.boot();
    expect(h.open).toHaveBeenCalledTimes(1);
  });

  it('a gate-on boot on the auto-flow page opens', () => {
    const h = harness({ autoFlow: true });
    h.boot();
    h.surface.gate(true);
    expect(h.open).toHaveBeenCalledTimes(1);
  });

  it('a gate-on boot with no record on a regular page opens nothing', () => {
    const h = harness();
    markOverlayOpen(h.win, 'https://site.test/other');
    h.boot();
    h.surface.gate(true);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.data.has(SBS_OPEN_STATE_KEY)).toBe(false);
  });
});

describe('live', () => {
  it('gate off closes and unmounts an open overlay; gate on re-opens it', () => {
    const h = harness({ autoFlow: true });
    h.boot();
    h.surface.gate(true);
    expect(h.state.open).toBe(true);
    h.surface.gate(false);
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.unmount).toHaveBeenCalledTimes(1);
    h.surface.gate(true);
    expect(h.open).toHaveBeenCalledTimes(2);
  });

  it('re-opens an overlay that was still opening when the gate closed', () => {
    const h = harness();
    h.boot();
    h.surface.gate(true);
    h.state.opening = true;
    h.surface.gate(false);
    expect(h.close).not.toHaveBeenCalled();
    expect(h.unmount).toHaveBeenCalledTimes(1);
    h.state.opening = false;
    h.surface.gate(true);
    expect(h.open).toHaveBeenCalledTimes(1);
  });

  it('keeps a closed overlay closed across gate off → on (the boot reasons are spent)', () => {
    const h = harness({ autoFlow: true });
    h.boot();
    h.surface.gate(true);
    h.state.open = false; // the user closed it
    h.surface.gate(false);
    expect(h.close).not.toHaveBeenCalled();
    h.surface.gate(true);
    expect(h.open).toHaveBeenCalledTimes(1);
  });

  it('logs an open that rejects instead of leaving it unhandled', async () => {
    const h = harness({ autoFlow: true, open: () => Promise.reject(new Error('broke')) });
    h.boot();
    h.surface.gate(true);
    await vi.waitFor(() => {
      expect(h.error).toHaveBeenCalledTimes(1);
    });
  });
});
