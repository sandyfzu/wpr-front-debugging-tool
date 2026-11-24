/**
 * The gated-surface machine: boot needs both the page's boot moment and a
 * known gate (either order), a gate-off boot spends the boot (a later
 * gate-on resumes, never boots), live off/on stop and resume exactly once
 * per change, hooks read the new phase, a throwing hook is contained — and
 * the follower composition end to end.
 */
import { describe, expect, it, vi } from 'vitest';
import { createGatedSurface, followGatedSurface, type GatedSurfaceHooks } from './gated-surface';
import type { PageUiGateSource } from './gate-follower';

/** Hooks recording their calls (and the phase each one saw). */
function hooks() {
  const calls: string[] = [];
  let surface: { running(): boolean } | null = null;
  const value: GatedSurfaceHooks = {
    start: (cause) => {
      calls.push(`start:${cause}:${String(surface?.running())}`);
    },
    stop: () => {
      calls.push(`stop:${String(surface?.running())}`);
    }
  };
  return {
    value,
    calls,
    bind: (bound: { running(): boolean }) => {
      surface = bound;
    }
  };
}

/** A machine with recorded hooks. */
function machine() {
  const h = hooks();
  const error = vi.fn();
  const surface = createGatedSurface(h.value, { error });
  h.bind(surface);
  return { surface, calls: h.calls, error };
}

describe('createGatedSurface — boot', () => {
  it('waits for both the page and the gate (gate first)', () => {
    const m = machine();
    m.surface.gate(true);
    expect(m.calls).toEqual([]);
    expect(m.surface.phase()).toBe('waiting');
    m.surface.pageReady();
    expect(m.calls).toEqual(['start:boot:true']);
    expect(m.surface.running()).toBe(true);
  });

  it('waits for both the page and the gate (page first)', () => {
    const m = machine();
    m.surface.pageReady();
    expect(m.calls).toEqual([]);
    m.surface.gate(true);
    expect(m.calls).toEqual(['start:boot:true']);
  });

  it('a gate-off boot mounts nothing and spends the boot: gate-on resumes, never boots', () => {
    const m = machine();
    m.surface.pageReady();
    m.surface.gate(false);
    expect(m.calls).toEqual([]);
    expect(m.surface.phase()).toBe('stopped');
    m.surface.gate(true);
    expect(m.calls).toEqual(['start:resume:true']);
  });

  it('the latest gate value before the page is ready decides the boot', () => {
    const m = machine();
    m.surface.gate(true);
    m.surface.gate(false);
    m.surface.pageReady();
    expect(m.calls).toEqual([]);
    expect(m.surface.phase()).toBe('stopped');
  });

  it('a repeated page-ready signal boots once', () => {
    const m = machine();
    m.surface.gate(true);
    m.surface.pageReady();
    m.surface.pageReady();
    expect(m.calls).toEqual(['start:boot:true']);
  });
});

describe('createGatedSurface — live', () => {
  it('stops on off and resumes on on, once per change; hooks see the new phase', () => {
    const m = machine();
    m.surface.pageReady();
    m.surface.gate(true);
    m.surface.gate(false);
    m.surface.gate(false);
    m.surface.gate(true);
    m.surface.gate(true);
    expect(m.calls).toEqual(['start:boot:true', 'stop:false', 'start:resume:true']);
  });

  it('contains a throwing hook; the phase follows the gate regardless', () => {
    const error = vi.fn();
    const surface = createGatedSurface(
      {
        start: () => {
          throw new Error('mount broke');
        },
        stop: () => {
          throw new Error('unmount broke');
        }
      },
      { error }
    );
    surface.pageReady();
    expect(() => {
      surface.gate(true);
    }).not.toThrow();
    expect(surface.running()).toBe(true);
    surface.gate(false);
    expect(surface.phase()).toBe('stopped');
    expect(error).toHaveBeenCalledTimes(2);
  });
});

describe('followGatedSurface', () => {
  it('boots from the gate read and follows live writes', async () => {
    const watched: { listener: ((enabled: boolean) => void) | null } = { listener: null };
    const source: PageUiGateSource = {
      watch: (onChange) => {
        watched.listener = onChange;
        return () => undefined;
      },
      read: () => Promise.resolve(true)
    };
    const h = hooks();
    const surface = followGatedSurface(
      {
        source,
        isInvalid: () => false,
        onInvalidated: () => undefined,
        log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
      },
      h.value
    );
    h.bind(surface);
    surface.pageReady();
    await vi.waitFor(() => {
      expect(h.calls).toEqual(['start:boot:true']);
    });
    watched.listener?.(false);
    expect(h.calls).toEqual(['start:boot:true', 'stop:false']);
  });
});
