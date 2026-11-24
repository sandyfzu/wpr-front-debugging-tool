/**
 * The gate follower over a fake source: arm-first ordering (a write during
 * the boot read wins, never lost), dedupe, storage failure paths (a
 * rejected read is retried once, then waits for the next write; a throwing
 * watch still boots from the read), a throwing consumer contained, invalidation (unwatch, late
 * deliveries dropped) — and the real item end to end (missing/corrupt →
 * default on).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_UI_GATE_KEY } from '../storage/page-ui-gate';
import {
  PAGE_UI_GATE_SOURCE,
  PAGE_UI_OFF_REASON,
  endWhenPageUiOff,
  followPageUiGate,
  pageUiGateDeps,
  type PageUiGateFollowerDeps,
  type PageUiGateSource
} from './gate-follower';

/** Let pending promise reactions run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** A controllable source + host. */
function harness(options: { watchThrows?: boolean } = {}) {
  let listener: ((enabled: boolean) => void) | null = null;
  let resolveRead: (enabled: boolean) => void = () => undefined;
  let rejectRead: (cause: Error) => void = () => undefined;
  const read = new Promise<boolean>((resolve, reject) => {
    resolveRead = resolve;
    rejectRead = reject;
  });
  const unwatch = vi.fn();
  const cleanups: Array<() => void> = [];
  let invalid = false;
  const warn = vi.fn();
  const error = vi.fn();
  const source: PageUiGateSource = {
    watch: (onChange) => {
      if (options.watchThrows === true) throw new Error('watch refused');
      listener = onChange;
      return unwatch;
    },
    read: () => read
  };
  const deps: PageUiGateFollowerDeps = {
    source,
    isInvalid: () => invalid,
    onInvalidated: (cleanup) => {
      cleanups.push(cleanup);
    },
    log: { debug: vi.fn(), warn, error }
  };
  return {
    deps,
    unwatch,
    warn,
    error,
    write: (enabled: boolean) => listener?.(enabled),
    resolveRead,
    rejectRead,
    invalidate: () => {
      invalid = true;
      for (const cleanup of cleanups) cleanup();
    }
  };
}

describe('followPageUiGate', () => {
  it('arms the watch before reading and applies the boot read', async () => {
    const h = harness();
    const watch = vi.spyOn(h.deps.source, 'watch');
    const read = vi.spyOn(h.deps.source, 'read');
    const apply = vi.fn();
    const follower = followPageUiGate(h.deps, apply);
    expect(watch.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0] ?? 0);
    expect(follower.current()).toBeNull();
    h.resolveRead(false);
    await settle();
    expect(apply).toHaveBeenCalledWith(false);
    expect(follower.current()).toBe(false);
  });

  it('lets a write landing during the read win; the stale read is dropped', async () => {
    const h = harness();
    const apply = vi.fn();
    followPageUiGate(h.deps, apply);
    h.write(false);
    h.resolveRead(true);
    await settle();
    expect(apply.mock.calls).toEqual([[false]]);
  });

  it('applies changes only (same-value rewrites are skipped)', async () => {
    const h = harness();
    const apply = vi.fn();
    followPageUiGate(h.deps, apply);
    h.resolveRead(true);
    await settle();
    h.write(true);
    h.write(false);
    h.write(false);
    h.write(true);
    expect(apply.mock.calls).toEqual([[true], [false], [true]]);
  });

  it('waits for the next write when the boot read rejects (nothing applied on a guess)', async () => {
    const h = harness();
    const apply = vi.fn();
    const follower = followPageUiGate(h.deps, apply);
    h.rejectRead(new Error('storage down'));
    await settle();
    expect(apply).not.toHaveBeenCalled();
    expect(follower.current()).toBeNull();
    expect(h.warn).toHaveBeenCalledTimes(1);
    h.write(true);
    expect(apply).toHaveBeenCalledWith(true);
  });

  it('stays silent about a read rejected by a dead context', async () => {
    const h = harness();
    followPageUiGate(h.deps, vi.fn());
    h.invalidate();
    h.rejectRead(new Error('Extension context invalidated.'));
    await settle();
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('still boots from the read when the watch cannot be armed', async () => {
    const h = harness({ watchThrows: true });
    const apply = vi.fn();
    followPageUiGate(h.deps, apply);
    expect(h.error).toHaveBeenCalledTimes(1);
    h.resolveRead(true);
    await settle();
    expect(apply).toHaveBeenCalledWith(true);
    // Teardown with no watch armed is a no-op.
    h.invalidate();
  });

  it('contains a throwing consumer and keeps following', async () => {
    const h = harness();
    const apply = vi.fn((enabled: boolean) => {
      if (!enabled) throw new Error('consumer broke');
    });
    const follower = followPageUiGate(h.deps, apply);
    h.resolveRead(true);
    await settle();
    expect(() => h.write(false)).not.toThrow();
    expect(h.error).toHaveBeenCalledTimes(1);
    expect(follower.current()).toBe(false);
    h.write(true);
    expect(apply).toHaveBeenLastCalledWith(true);
  });

  it('unwatches on invalidation and drops every later delivery', async () => {
    const h = harness();
    const apply = vi.fn();
    followPageUiGate(h.deps, apply);
    h.invalidate();
    expect(h.unwatch).toHaveBeenCalledTimes(1);
    h.write(false);
    h.resolveRead(true);
    await settle();
    expect(apply).not.toHaveBeenCalled();
  });

  it('logs a throwing unwatch during teardown', () => {
    const h = harness();
    h.unwatch.mockImplementation(() => {
      throw new Error('gone');
    });
    followPageUiGate(h.deps, vi.fn());
    expect(() => {
      h.invalidate();
    }).not.toThrow();
    expect(h.warn).toHaveBeenCalledTimes(1);
  });

  it('a dead-context unwatch after an extension reload is debug only, never a warning', () => {
    const h = harness();
    h.unwatch.mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    followPageUiGate(h.deps, vi.fn());
    expect(() => {
      h.invalidate();
    }).not.toThrow();
    expect(h.warn).not.toHaveBeenCalled();
    expect(h.deps.log.debug).toHaveBeenCalledTimes(1);
  });
});

/** A host whose reads answer from a script, in order (one entry per read). */
function scriptedReads(answers: ReadonlyArray<boolean | Error>) {
  let index = 0;
  let listener: ((enabled: boolean) => void) | null = null;
  const read = vi.fn(() => {
    const answer = answers[index];
    index += 1;
    if (answer === undefined) return new Promise<boolean>(() => undefined);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
  const warn = vi.fn();
  const deps: PageUiGateFollowerDeps = {
    source: {
      watch: (onChange) => {
        listener = onChange;
        return () => undefined;
      },
      read
    },
    isInvalid: () => false,
    onInvalidated: () => undefined,
    log: { debug: vi.fn(), warn, error: vi.fn() }
  };
  return { deps, read, warn, write: (enabled: boolean) => listener?.(enabled) };
}

describe('followPageUiGate — read retry', () => {
  it('retries a rejected boot read once and applies its answer', async () => {
    const h = scriptedReads([new Error('blip'), true]);
    const apply = vi.fn();
    followPageUiGate(h.deps, apply);
    await settle();
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledWith(true);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('gives up after the second rejection (one warn, nothing applied)', async () => {
    const h = scriptedReads([new Error('down'), new Error('still down')]);
    const apply = vi.fn();
    followPageUiGate(h.deps, apply);
    await settle();
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(apply).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledTimes(1);
  });

  it('does not retry once a write decided the gate', async () => {
    const h = scriptedReads([new Error('blip'), true]);
    const apply = vi.fn();
    followPageUiGate(h.deps, apply);
    h.write(false);
    await settle();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls).toEqual([[false]]);
  });
});

describe('pageUiGateDeps', () => {
  it('binds the real source, the context liveness and teardown, and the logger', () => {
    const cleanups: Array<() => void> = [];
    const ctx = {
      isInvalid: false,
      onInvalidated: (cleanup: () => void) => {
        cleanups.push(cleanup);
        return () => undefined;
      }
    };
    const log = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const deps = pageUiGateDeps(ctx, log);
    expect(deps.source).toBe(PAGE_UI_GATE_SOURCE);
    expect(deps.log).toBe(log);
    expect(deps.isInvalid()).toBe(false);
    ctx.isInvalid = true;
    expect(deps.isInvalid()).toBe(true);
    const cleanup = vi.fn();
    deps.onInvalidated(cleanup);
    expect(cleanups).toEqual([cleanup]);
  });
});

describe('endWhenPageUiOff', () => {
  it('ends the instance once on the first off value (the boot read)', async () => {
    const h = harness();
    const end = vi.fn();
    endWhenPageUiOff(h.deps, end);
    h.resolveRead(false);
    await settle();
    h.write(true);
    h.write(false);
    expect(end.mock.calls).toEqual([[PAGE_UI_OFF_REASON]]);
  });

  it('keeps the instance while on and ends it on a later off write', async () => {
    const h = harness();
    const end = vi.fn();
    endWhenPageUiOff(h.deps, end);
    h.resolveRead(true);
    await settle();
    expect(end).not.toHaveBeenCalled();
    h.write(false);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('ends on an off write racing the boot read (the read is dropped)', async () => {
    const h = harness();
    const end = vi.fn();
    endWhenPageUiOff(h.deps, end);
    h.write(false);
    h.resolveRead(true);
    await settle();
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe('PAGE_UI_GATE_SOURCE (the real item)', () => {
  const SYNC_KEY = PAGE_UI_GATE_KEY.replace(/^sync:/, '');

  beforeEach(() => {
    fakeBrowser.reset();
  });

  /** Follow the real item with a live host. */
  function follow(apply: (enabled: boolean) => void) {
    return followPageUiGate(
      {
        source: PAGE_UI_GATE_SOURCE,
        isInvalid: () => false,
        onInvalidated: () => undefined,
        log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
      },
      apply
    );
  }

  it('reads a missing key as on', async () => {
    const apply = vi.fn();
    follow(apply);
    await vi.waitFor(() => {
      expect(apply).toHaveBeenCalledWith(true);
    });
  });

  it('reads a corrupt value as on and follows a real off write', async () => {
    await fakeBrowser.storage.sync.set({ [SYNC_KEY]: 'off' });
    const apply = vi.fn();
    follow(apply);
    await vi.waitFor(() => {
      expect(apply).toHaveBeenCalledWith(true);
    });
    await fakeBrowser.storage.sync.set({ [SYNC_KEY]: false });
    await vi.waitFor(() => {
      expect(apply).toHaveBeenLastCalledWith(false);
    });
  });
});
