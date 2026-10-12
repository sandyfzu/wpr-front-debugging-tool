/**
 * The continuity flag's contract, over a map-backed `sessionStorage` seam:
 * the open write, the closed clear, and the boot consume — matched URLs
 * restore, real navigations and every forged value do not, the consumed
 * flag stays consumed, broken storage degrades. The host page can write
 * tab sessionStorage too: the forged rows pin that boundary's inertness.
 */
import { describe, expect, it } from 'vitest';
import {
  SBS_OPEN_STATE_KEY,
  consumeBootOpenState,
  markOverlayClosed,
  markOverlayOpen,
  type OpenStateStorage,
  type OpenStateWindow
} from './session-open';

/** A working window over a map-backed `sessionStorage` — like the real one, string-typed. */
function freshWindow(): {
  win: OpenStateWindow;
  seam: OpenStateStorage & { data: Map<string, string | null> };
} {
  const data = new Map<string, string | null>();
  const seam: OpenStateStorage = {
    getItem: (key: string): string | null => data.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      data.set(key, value);
    },
    removeItem: (key: string): void => {
      data.delete(key);
    }
  };
  return { win: { sessionStorage: seam }, seam: { data, ...seam } };
}

/** A window whose `sessionStorage` is unreachable — the broken-host life event. */
function brokenWindow(): OpenStateWindow {
  return {
    sessionStorage: {
      getItem: () => {
        throw new Error('storage unreachable');
      },
      setItem: () => {
        throw new Error('storage unreachable');
      },
      removeItem: () => {
        throw new Error('storage unreachable');
      }
    }
  };
}

describe('overlay continuity flag', () => {
  it('a same-URL boot restores; a real navigation never does', () => {
    const { win, seam } = freshWindow();
    markOverlayOpen(win, 'https://site.dev/page?a=1');
    expect(consumeBootOpenState(win, 'https://site.dev/page?a=1')).toBe(true);
    // Consumed either way: the mismatching boot cannot open.
    expect(consumeBootOpenState(win, 'https://site.dev/other')).toBe(false);
    expect(seam.data.get(SBS_OPEN_STATE_KEY)).toBeUndefined();
  });

  it('the strict URL identity holds: fragment and query changes do not restore', () => {
    const { win } = freshWindow();
    markOverlayOpen(win, 'https://site.dev/page?a=1');
    expect(consumeBootOpenState(win, 'https://site.dev/page?a=1#anchor')).toBe(false);
    expect(consumeBootOpenState(win, 'https://site.dev/page?a=2')).toBe(false);
  });

  it('a forged value is inert unless it equals the boot href exactly', () => {
    const { win, seam } = freshWindow();
    // The boundary a host page can also write: every shape that fails the
    // exact-URL compare is consumed and does nothing, whatever it contains.
    const forged: string[] = ['', '   ', 'javascript:alert(1)', `x:${'a'.repeat(10_000)}`];
    for (const value of forged) {
      seam.data.set(SBS_OPEN_STATE_KEY, value);
      expect(consumeBootOpenState(win, 'https://site.dev/page')).toBe(false);
    }
    // The single forgeable value re-opens the overlay's own flow on that page.
    seam.data.set(SBS_OPEN_STATE_KEY, 'https://site.dev/page');
    expect(consumeBootOpenState(win, 'https://site.dev/page')).toBe(true);
  });

  it('consume is once-only: a matching boot leaves nothing for a second identical boot', () => {
    const { win } = freshWindow();
    markOverlayOpen(win, 'https://site.dev/page');
    expect(consumeBootOpenState(win, 'https://site.dev/page')).toBe(true);
    expect(consumeBootOpenState(win, 'https://site.dev/page')).toBe(false);
  });

  it('the closed clear removes the record again', () => {
    const { win, seam } = freshWindow();
    markOverlayOpen(win, 'https://site.dev/page');
    markOverlayClosed(win);
    expect(consumeBootOpenState(win, 'https://site.dev/page')).toBe(false);
    expect(seam.data.get(SBS_OPEN_STATE_KEY)).toBeUndefined();
  });

  it('a flag-less boot consumes nothing and restores nothing', () => {
    const { win, seam } = freshWindow();
    expect(consumeBootOpenState(win, 'https://site.dev/page')).toBe(false);
    expect(seam.data.get(SBS_OPEN_STATE_KEY)).toBeUndefined();
  });

  it('broken storage degrades: writing is a no-op and boot restores nothing', () => {
    const win = brokenWindow();
    expect(() => {
      markOverlayOpen(win, 'https://site.dev/page');
    }).not.toThrow();
    expect(() => {
      markOverlayClosed(win);
    }).not.toThrow();
    expect(consumeBootOpenState(win, 'https://site.dev/page')).toBe(false);
  });
});
