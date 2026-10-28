/**
 * The shared uncaught-error reporter's guarantees: real details instead of
 * event wrappers, attribution by runtime URL (our bundles' `filename` /
 * rejection stacks), foreign-source events skipped without a guess (and
 * never intercepted — their native reporting stays), claimed events
 * cancelled so the browser's native record cannot double the entry, and
 * hostile cross-world payloads (throwing getters) degrading to one plain
 * line instead of breaking the last-line listener itself.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  RESIZE_OBSERVER_LOOP_MESSAGE,
  isOwnScriptSource,
  isResizeObserverLoopNotice,
  onUncaughtError,
  onUnhandledRejection,
  type UncaughtErrorListenerOptions
} from './uncaught-errors';
import type { Logger } from './logger';

const PREFIX = 'chrome-extension://test-id/';
/** Our bundle's script URL as an error event would carry it. */
const OWN_SOURCE = `${PREFIX}content-scripts/isolated.js`;

/**
 * A Logger whose mocks are captured as standalone values: assertions read the
 * mocks directly instead of referencing methods off the object.
 */
function fakeLogger(): { log: Logger; error: Mock; warn: Mock } {
  const error = vi.fn();
  const warn = vi.fn();
  return { log: { debug: vi.fn(), info: vi.fn(), warn, error }, error, warn };
}

/** The first call's first argument of a mock, typed loose for assertions. */
function firstArg(mock: Mock): unknown {
  return mock.mock.calls[0]?.[0];
}

/**
 * An error whose named property getter throws `throws`, mimicking a hostile
 * cross-world payload: extends `Error.prototype` so `instanceof` holds.
 */
function poisonedError(
  property: 'message' | 'stack',
  throws: unknown = `poisoned ${property}`
): Error {
  const poisoned: unknown = Object.create(Error.prototype, {
    [property]: {
      get() {
        throw throws;
      }
    }
  });
  return poisoned as Error;
}

describe('isOwnScriptSource', () => {
  it('matches only filenames under the runtime URL prefix', () => {
    expect(isOwnScriptSource(PREFIX, OWN_SOURCE)).toBe(true);
    expect(isOwnScriptSource(PREFIX, 'https://page.test/script.js')).toBe(false);
    expect(isOwnScriptSource(PREFIX, '')).toBe(false);
    expect(isOwnScriptSource(PREFIX, undefined)).toBe(false);
  });
});

describe('isResizeObserverLoopNotice', () => {
  it('matches exactly the browser notice: its message and no thrown value', () => {
    expect(isResizeObserverLoopNotice({ message: RESIZE_OBSERVER_LOOP_MESSAGE, error: null })).toBe(
      true
    );
    expect(
      isResizeObserverLoopNotice({ message: RESIZE_OBSERVER_LOOP_MESSAGE, error: undefined })
    ).toBe(true);
  });

  it('a thrown value or any other message stays an error', () => {
    expect(
      isResizeObserverLoopNotice({
        message: RESIZE_OBSERVER_LOOP_MESSAGE,
        error: new Error(RESIZE_OBSERVER_LOOP_MESSAGE)
      })
    ).toBe(false);
    expect(
      isResizeObserverLoopNotice({ message: RESIZE_OBSERVER_LOOP_MESSAGE, error: 'thrown text' })
    ).toBe(false);
    expect(isResizeObserverLoopNotice({ message: 'ResizeObserver loop', error: null })).toBe(false);
    expect(
      isResizeObserverLoopNotice({ message: ` ${RESIZE_OBSERVER_LOOP_MESSAGE}`, error: null })
    ).toBe(false);
  });
});

describe('onUncaughtError', () => {
  const listen = (log: Logger): UncaughtErrorListenerOptions => ({ log, ownPrefix: PREFIX });

  it('reports our errors with real details: message, location, cause, and its stack', () => {
    const { log, error } = fakeLogger();
    const cause = new Error('the actual failure');
    onUncaughtError(listen(log))(
      new ErrorEvent('error', {
        filename: OWN_SOURCE,
        lineno: 12,
        colno: 3,
        message: 'the actual failure',
        error: cause,
        cancelable: true
      })
    );
    expect(error).toHaveBeenCalledTimes(1);
    const [line, details, passedCause, stack] = error.mock.calls[0] as unknown as [
      string,
      { source: string; line: number; column: number },
      Error,
      string
    ];
    expect(line).toContain('the actual failure');
    expect(details).toEqual({ source: OWN_SOURCE, line: 12, column: 3 });
    expect(passedCause).toBe(cause);
    expect(stack).toBe(cause.stack);
  });

  it('claiming our error cancels the native record (one entry per failure)', () => {
    const { log, error } = fakeLogger();
    const event = new ErrorEvent('error', {
      filename: OWN_SOURCE,
      message: 'ours',
      error: new Error('ours'),
      cancelable: true
    });
    onUncaughtError(listen(log))(event);
    expect(error).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('nothing renders for host-page errors: no claim, no noise, no interception', () => {
    const { log, error, warn } = fakeLogger();
    const listener = onUncaughtError(listen(log));
    const foreign = new ErrorEvent('error', {
      filename: 'https://page.test/broken-embed.js',
      message: 'their failure',
      error: new Error('their failure'),
      cancelable: true
    });
    listener(foreign);
    listener(new ErrorEvent('error', { message: 'Script error.' }));
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    // The page's own reporting is untouched: no preventDefault on its events.
    expect(foreign.defaultPrevented).toBe(false);
  });

  it('a poisoned stack getter degrades the detail, never the claim', () => {
    const { log, error } = fakeLogger();
    const cause = poisonedError('stack');
    const event = new ErrorEvent('error', {
      filename: OWN_SOURCE,
      message: 'ours',
      error: cause,
      cancelable: true
    });
    onUncaughtError(listen(log))(event);
    expect(event.defaultPrevented).toBe(true);
    const [line, , passedCause, stack] = error.mock.calls[0] as unknown as [
      string,
      unknown,
      Error,
      string | undefined
    ];
    // The summary is the cause's own String form (empty message → 'Error');
    // the poisoned stack path degrades the detail, never the claim.
    expect(line).toBe('Uncaught error: Error');
    expect(passedCause).toBe(cause);
    expect(stack).toBeUndefined();
  });

  it('a poisoned message getter reports the failure of the report, not a throw', () => {
    const { log, error } = fakeLogger();
    const event = new ErrorEvent('error', {
      filename: OWN_SOURCE,
      message: 'ours',
      error: poisonedError('message'),
      cancelable: true
    });
    expect(() => {
      onUncaughtError(listen(log))(event);
    }).not.toThrow();
    expect(event.defaultPrevented).toBe(true);
    expect(String(firstArg(error))).toContain('report failed');
  });

  it('a non-Error failure escaping the report still renders as text', () => {
    const { log, error } = fakeLogger();
    onUncaughtError({ log })(
      new ErrorEvent('error', {
        filename: OWN_SOURCE,
        message: 'ours',
        error: poisonedError('message', 'plain thrown value'),
        cancelable: true
      })
    );
    expect(String(firstArg(error))).toContain('plain thrown value');
  });

  it('cross-origin style events (no cause) fall back to the event message', () => {
    const { log, error } = fakeLogger();
    onUncaughtError({ log })(
      new ErrorEvent('error', { filename: OWN_SOURCE, message: 'Script error.' })
    );
    expect(String(firstArg(error))).toContain('Script error.');
  });

  it('a claimable event that carries no name at all reports unknown', () => {
    const { log, error } = fakeLogger();
    onUncaughtError({ log })(new ErrorEvent('error', { filename: OWN_SOURCE, cancelable: true }));
    expect(String(firstArg(error))).toBe('Uncaught error: unknown error');
  });
});

describe('onUnhandledRejection', () => {
  /**
   * A PromiseRejectionEvent stand-in (the test environment lacks the class)
   * that records whether the listener claimed the event's reporting.
   */
  function rejectionEvent(reason: unknown): { event: PromiseRejectionEvent; preventDefault: Mock } {
    const preventDefault = vi.fn();
    return {
      event: { reason, preventDefault } as unknown as PromiseRejectionEvent,
      preventDefault
    };
  }

  it('reports our rejections with the reason and its stack, skips foreign ones', () => {
    const { log, error } = fakeLogger();
    const listener = onUnhandledRejection({ log, ownPrefix: PREFIX });
    const ours = new Error('rejected work');
    ours.stack = `Error: rejected work\n    at ${OWN_SOURCE}:9:1`;
    const oursEvent = rejectionEvent(ours);
    listener(oursEvent.event);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(firstArg(error))).toContain('rejected work');
    expect(error.mock.calls[0]?.[1]).toBe(ours);
    expect(error.mock.calls[0]?.[2]).toBe(ours.stack);
    // Claiming the rejection cancels the native "Uncaught (in promise)" record.
    expect(oursEvent.preventDefault).toHaveBeenCalledTimes(1);

    const foreign = new Error('page promise');
    const foreignEvent = rejectionEvent(foreign);
    listener(foreignEvent.event);
    const stringEvent = rejectionEvent('plain string');
    listener(stringEvent.event);
    expect(error).toHaveBeenCalledTimes(1);
    // Foreign rejections keep their native reporting untouched.
    expect(foreignEvent.preventDefault).not.toHaveBeenCalled();
    expect(stringEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('a poisoned stack getter reads as foreign and is never claimed', () => {
    const { log, error } = fakeLogger();
    const hostiles = rejectionEvent(poisonedError('stack'));
    onUnhandledRejection({ log, ownPrefix: PREFIX })(hostiles.event);
    expect(error).not.toHaveBeenCalled();
    expect(hostiles.preventDefault).not.toHaveBeenCalled();
  });

  it('without a prefix (worker scope) everything in scope is claimed', () => {
    const { log, error } = fakeLogger();
    const stringEvent = rejectionEvent('anything');
    onUnhandledRejection({ log })(stringEvent.event);
    expect(error).toHaveBeenCalledTimes(1);
    expect(stringEvent.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('hostile worker payloads degrade to one plain line, not a throw', () => {
    const { log, error } = fakeLogger();
    const listener = onUnhandledRejection({ log });

    // Throwing stack getter: the read degrades to undefined; the claim still
    // happens (worker scope claims all), named by the reason's String form
    // and carrying no stack detail.
    const stackSwallowed = rejectionEvent(poisonedError('stack'));
    expect(() => {
      listener(stackSwallowed.event);
    }).not.toThrow();
    expect(stackSwallowed.preventDefault).toHaveBeenCalledTimes(1);
    let [line] = error.mock.calls[0] as unknown as [string];
    expect(line).toBe('Unhandled promise rejection: Error');
    expect((error.mock.calls[0] as unknown[])[1]).toBe(stackSwallowed.event.reason);

    // Throwing message getter after the claim: the guarded fallback reports
    // the report's own failure.
    const claimSwallowed = rejectionEvent(poisonedError('message'));
    expect(() => {
      listener(claimSwallowed.event);
    }).not.toThrow();
    expect(claimSwallowed.preventDefault).toHaveBeenCalledTimes(1);
    [line] = error.mock.calls[1] as unknown as [string];
    expect(line).toContain('report failed');
  });

  it('a non-Error failure escaping a rejection report still renders as text', () => {
    const { log, error } = fakeLogger();
    const swallowed = rejectionEvent(poisonedError('message', 'plain thrown value'));
    expect(() => {
      onUnhandledRejection({ log })(swallowed.event);
    }).not.toThrow();
    expect(swallowed.preventDefault).toHaveBeenCalledTimes(1);
    expect(String(firstArg(error))).toContain('plain thrown value');
  });
});

describe('onUncaughtError — resize-observer loop notice', () => {
  /** The notice as browsers fire it: message only, no source, no error object. */
  const notice = (): ErrorEvent =>
    new ErrorEvent('error', { message: RESIZE_OBSERVER_LOOP_MESSAGE, cancelable: false });

  it('is never reported as an error: one debug line per listener, then silence', () => {
    const debug = vi.fn();
    const error = vi.fn();
    const listener = onUncaughtError({ log: { debug, info: vi.fn(), warn: vi.fn(), error } });
    const first = notice();
    const preventDefault = vi.spyOn(first, 'preventDefault');
    listener(first);
    listener(notice());
    listener(notice());
    expect(error).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    expect(String(debug.mock.calls[0]?.[0])).toContain('Resize observer');
    // Not claimed: the browser's own handling of the notice stays as it was.
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('each listener logs its own first notice', () => {
    const debug = vi.fn();
    const log: Logger = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    onUncaughtError({ log })(notice());
    onUncaughtError({ log })(notice());
    expect(debug).toHaveBeenCalledTimes(2);
  });

  it('an own script throwing that text is still reported', () => {
    const { log, error } = fakeLogger();
    onUncaughtError({ log })(
      new ErrorEvent('error', {
        filename: OWN_SOURCE,
        message: RESIZE_OBSERVER_LOOP_MESSAGE,
        error: new Error(RESIZE_OBSERVER_LOOP_MESSAGE)
      })
    );
    expect(String(firstArg(error))).toBe(`Uncaught error: ${RESIZE_OBSERVER_LOOP_MESSAGE}`);
  });

  it('a sourced listener still skips the notice as foreign before matching it', () => {
    const debug = vi.fn();
    const error = vi.fn();
    const log: Logger = { debug, info: vi.fn(), warn: vi.fn(), error };
    onUncaughtError({ log, ownPrefix: PREFIX })(notice());
    expect(error).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });
});
