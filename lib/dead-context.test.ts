/**
 * Dead-context teardown: the invalidated extension context's API error is
 * swallowed at debug level (never a page error), every other teardown
 * failure is surfaced as an error line, a normal cleanup just runs, and the
 * context guard routes every registration — WXT's real context included —
 * through that path while keeping removal working.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import {
  DEAD_CONTEXT_MESSAGE,
  guardInvalidationTeardown,
  isDeadContextError,
  reportTeardownFailure,
  runTeardown,
  type InvalidationHost
} from './dead-context';
import type { Logger } from './logger';

/** The exact error Chromium throws from a dead context. */
const deadContext = (): Error => new Error(`${DEAD_CONTEXT_MESSAGE}.`);

/** A logger whose debug/error mocks are standalone values. */
function fakeLogger(): { log: Logger; debug: Mock; warn: Mock; error: Mock } {
  const debug = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return { log: { debug, info: vi.fn(), warn, error }, debug, warn, error };
}

describe('isDeadContextError', () => {
  it('matches the dead-context message, with or without its period or a prefix', () => {
    expect(isDeadContextError(deadContext())).toBe(true);
    expect(isDeadContextError(new Error(DEAD_CONTEXT_MESSAGE))).toBe(true);
    expect(isDeadContextError(new TypeError(`Wrapped: ${DEAD_CONTEXT_MESSAGE}.`))).toBe(true);
  });

  it('rejects other errors and non-errors carrying the text', () => {
    expect(isDeadContextError(new Error('Could not establish connection'))).toBe(false);
    expect(isDeadContextError(`${DEAD_CONTEXT_MESSAGE}.`)).toBe(false);
    expect(isDeadContextError({ message: DEAD_CONTEXT_MESSAGE })).toBe(false);
    expect(isDeadContextError(null)).toBe(false);
    expect(isDeadContextError(undefined)).toBe(false);
  });

  it('reads a throwing message getter as not dead', () => {
    const hostile: unknown = Object.create(Error.prototype, {
      message: {
        get() {
          throw new Error('poisoned');
        }
      }
    });
    expect(isDeadContextError(hostile)).toBe(false);
  });
});

describe('reportTeardownFailure', () => {
  it('a dead context is one debug line naming the step, at any severity', () => {
    const { log, debug, warn, error } = fakeLogger();
    reportTeardownFailure(log, deadContext(), 'Stopping X failed during teardown', 'warn');
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('Stopping X failed'));
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('a real failure keeps its line and cause at the chosen level (error by default)', () => {
    const { log, warn, error } = fakeLogger();
    const cause = new Error('boom');
    reportTeardownFailure(log, cause, 'Stopping X failed during teardown', 'warn');
    expect(warn).toHaveBeenCalledWith('Stopping X failed during teardown', cause);
    reportTeardownFailure(log, cause, 'Stopping Y failed during teardown');
    expect(error).toHaveBeenCalledWith('Stopping Y failed during teardown', cause);
  });
});

describe('runTeardown', () => {
  it('runs a normal cleanup and logs nothing', () => {
    const { log, debug, error } = fakeLogger();
    const cleanup = vi.fn();
    runTeardown(cleanup, log);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(debug).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('swallows a dead-context throw at debug level', () => {
    const { log, debug, error } = fakeLogger();
    expect(() => {
      runTeardown(() => {
        throw deadContext();
      }, log);
    }).not.toThrow();
    expect(debug).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it('surfaces any other throw as an error line with its cause, without rethrowing', () => {
    const { log, debug, error } = fakeLogger();
    const cause = new Error('observer already gone');
    expect(() => {
      runTeardown(() => {
        throw cause;
      }, log);
    }).not.toThrow();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('teardown step failed'), cause);
    expect(debug).not.toHaveBeenCalled();
  });

  it('classifies an async cleanup rejection the same way (no unhandled rejection)', async () => {
    const { log, debug, error } = fakeLogger();
    const other = new Error('async failure');
    runTeardown(() => Promise.reject(deadContext()), log);
    runTeardown(() => Promise.reject(other), log);
    await vi.waitFor(() => {
      expect(debug).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledWith(expect.any(String), other);
    });
  });
});

describe('guardInvalidationTeardown', () => {
  it('routes every later registration through the dead-context-safe runner', () => {
    const { log, debug, error } = fakeLogger();
    const registered: (() => void)[] = [];
    const host: InvalidationHost = {
      onInvalidated: (cleanup) => {
        registered.push(cleanup);
        return () => undefined;
      }
    };
    guardInvalidationTeardown(host, log);
    const ran = vi.fn();
    host.onInvalidated(() => {
      throw deadContext();
    });
    host.onInvalidated(ran);
    for (const cleanup of registered) expect(cleanup).not.toThrow();
    expect(ran).toHaveBeenCalledOnce();
    expect(debug).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it("on WXT's real context: a throwing remover never escapes the abort, siblings still run", () => {
    const { log, debug } = fakeLogger();
    const ctx = new ContentScriptContext('dead-context-test');
    guardInvalidationTeardown(ctx, log);
    const sibling = vi.fn();
    // The storage-watch remover shape that broke host pages after a reload.
    ctx.onInvalidated(() => {
      throw deadContext();
    });
    ctx.onInvalidated(sibling);
    const pageErrors: unknown[] = [];
    const onError = (event: ErrorEvent): void => {
      pageErrors.push(event.error);
    };
    window.addEventListener('error', onError);
    try {
      expect(() => {
        ctx.notifyInvalidated();
      }).not.toThrow();
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(pageErrors).toEqual([]);
    expect(sibling).toHaveBeenCalledOnce();
    expect(debug).toHaveBeenCalledOnce();
  });

  it('control: unguarded, the same remover throw escapes the invalidation', () => {
    const ctx = new ContentScriptContext('dead-context-control');
    ctx.onInvalidated(() => {
      throw deadContext();
    });
    // happy-dom rethrows out of the abort; a browser reports it to the page's `error` event.
    expect(() => {
      ctx.notifyInvalidated();
    }).toThrow(DEAD_CONTEXT_MESSAGE);
  });

  it("keeps the returned removal working (WXT's own timer clears rely on it)", () => {
    const { log } = fakeLogger();
    const ctx = new ContentScriptContext('dead-context-removal-test');
    guardInvalidationTeardown(ctx, log);
    const removed = vi.fn();
    const remove = ctx.onInvalidated(removed);
    remove();
    ctx.notifyInvalidated();
    expect(removed).not.toHaveBeenCalled();
  });
});
