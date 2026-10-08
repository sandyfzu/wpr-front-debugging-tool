/**
 * The shared uncaught-error reporter's guarantees: real details instead of
 * event wrappers, attribution by runtime URL (our bundles' `filename` /
 * rejection stacks), foreign-source events skipped without a guess, and the
 * service-worker mode (no prefix) that claims everything in its scope.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  isOwnRejectionSource,
  isOwnScriptSource,
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

describe('isOwnScriptSource', () => {
  it('matches only filenames under the runtime URL prefix', () => {
    expect(isOwnScriptSource(PREFIX, OWN_SOURCE)).toBe(true);
    expect(isOwnScriptSource(PREFIX, 'https://page.test/script.js')).toBe(false);
    expect(isOwnScriptSource(PREFIX, '')).toBe(false);
    expect(isOwnScriptSource(PREFIX, undefined)).toBe(false);
  });
});

describe('isOwnRejectionSource', () => {
  it('attributes rejections by the stack naming our scripts, never by guess', () => {
    const ours = new Error('boom');
    ours.stack = `Error: boom\n    at ${OWN_SOURCE}:12:3`;
    expect(isOwnRejectionSource(PREFIX, ours)).toBe(true);
    expect(isOwnRejectionSource(PREFIX, new Error('no stack source'))).toBe(false);
    expect(isOwnRejectionSource(PREFIX, 'string rejection')).toBe(false);
  });
});

describe('onUncaughtError', () => {
  const listen = (log: Logger): UncaughtErrorListenerOptions => ({ log, ownPrefix: PREFIX });

  it('reports our errors with real details: message in the line, cause as a detail', () => {
    const { log, error } = fakeLogger();
    const cause = new Error('the actual failure');
    onUncaughtError(listen(log))(
      new ErrorEvent('error', {
        filename: OWN_SOURCE,
        lineno: 12,
        colno: 3,
        message: 'the actual failure',
        error: cause
      })
    );
    expect(error).toHaveBeenCalledTimes(1);
    const [line, details, passedCause] = error.mock.calls[0] as unknown as [
      string,
      { source: string; line: number; column: number },
      Error
    ];
    expect(line).toContain('the actual failure');
    expect(details).toEqual({ source: OWN_SOURCE, line: 12, column: 3 });
    expect(passedCause).toBe(cause);
  });

  it('nothing renders for host-page errors: no claim, no noise', () => {
    const { log, error, warn } = fakeLogger();
    const listener = onUncaughtError(listen(log));
    listener(
      new ErrorEvent('error', {
        filename: 'https://page.test/broken-embed.js',
        message: 'their failure',
        error: new Error('their failure')
      })
    );
    listener(new ErrorEvent('error', { message: 'Script error.' }));
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('cross-origin style events (no cause) fall back to the event message', () => {
    const { log, error } = fakeLogger();
    onUncaughtError({ log })(
      new ErrorEvent('error', { filename: OWN_SOURCE, message: 'Script error.' })
    );
    expect(String(firstArg(error))).toContain('Script error.');
  });
});

describe('onUnhandledRejection', () => {
  it('reports our rejections with the reason itself, skips foreign ones', () => {
    const { log, error } = fakeLogger();
    const listener = onUnhandledRejection({ log, ownPrefix: PREFIX });
    const ours = new Error('rejected work');
    ours.stack = `Error: rejected work\n    at ${OWN_SOURCE}:9:1`;
    listener({ reason: ours } as PromiseRejectionEvent);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(firstArg(error))).toContain('rejected work');
    expect(error.mock.calls[0]?.[1]).toBe(ours);

    const foreign = new Error('page promise');
    listener({ reason: foreign } as PromiseRejectionEvent);
    listener({ reason: 'plain string' } as PromiseRejectionEvent);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('without a prefix (worker scope) everything in scope is claimed', () => {
    const { log, error } = fakeLogger();
    onUnhandledRejection({ log })({ reason: 'anything' } as PromiseRejectionEvent);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
