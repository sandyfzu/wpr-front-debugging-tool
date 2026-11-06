/**
 * The shared top-frame injection answer: only a top-frame http(s) sender is
 * answered, on its own tab, aimed at the sending document when the browser
 * names it (else the tab's top frame); a refusal names the ask's row and
 * reason and injects nothing; an injection failure is logged with the ask's
 * subject and rejects with the scripting API's own error. The production
 * injector maps the target onto `scripting.executeScript`.
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Logger } from '../../lib/logger';
import {
  answerTopFrameInjection,
  injectAtTarget,
  type InjectScripts,
  type TopFrameInjectionAsk
} from './top-frame-injection';

/** A top-frame page sender on tab 7. */
const PAGE = { tab: { id: 7 }, frameId: 0, url: 'https://example.com/a' } as const;

/** Senders that must be refused. */
const REFUSED = [
  ['a sub-frame', { ...PAGE, frameId: 2 }],
  ['a tabless sender (an extension page)', { id: 'ext', url: 'chrome-extension://x/panel.html' }],
  ['a non-web page', { ...PAGE, url: 'chrome://settings' }],
  ['no sender', undefined]
] as const;

/**
 * An ask whose logger records errors.
 *
 * @returns The ask and its `error` spy.
 */
function askDouble(): {
  ask: TopFrameInjectionAsk;
  error: Mock<Logger['error']>;
} {
  const error = vi.fn<Logger['error']>();
  const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error };
  return {
    ask: {
      row: 'loadThing',
      refusal: 'only a top-frame page may load the thing',
      what: 'the thing',
      files: ['/thing.js', '/thing-2.js'],
      log
    },
    error
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('answerTopFrameInjection', () => {
  it('injects the ask’s files into the sender tab’s top frame when no document is named', async () => {
    const { ask } = askDouble();
    const inject = vi.fn<InjectScripts>(() => Promise.resolve());
    await expect(answerTopFrameInjection(PAGE, ask, inject)).resolves.toBe(true);
    expect(inject).toHaveBeenCalledExactlyOnceWith({ tabId: 7, documentId: null }, [
      '/thing.js',
      '/thing-2.js'
    ]);
  });

  it('aims the injection at the sending document when the browser names it', async () => {
    const { ask } = askDouble();
    const inject = vi.fn<InjectScripts>(() => Promise.resolve());
    await answerTopFrameInjection({ ...PAGE, documentId: 'DOC-1' }, ask, inject);
    expect(inject).toHaveBeenCalledWith({ tabId: 7, documentId: 'DOC-1' }, ask.files);
  });

  it.each(REFUSED)(
    'refuses %s with the row and reason, injecting nothing',
    async (_label, sender) => {
      const { ask, error } = askDouble();
      const inject = vi.fn<InjectScripts>(() => Promise.resolve());
      await expect(answerTopFrameInjection(sender, ask, inject)).rejects.toThrow(
        'loadThing: only a top-frame page may load the thing'
      );
      expect(inject).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    }
  );

  it('logs a failed injection with its subject and tab, then rejects with the same error', async () => {
    const { ask, error } = askDouble();
    const cause = new Error('Cannot access contents of the page');
    await expect(answerTopFrameInjection(PAGE, ask, () => Promise.reject(cause))).rejects.toBe(
      cause
    );
    expect(error).toHaveBeenCalledExactlyOnceWith('Injecting the thing failed', {
      tabId: 7,
      cause: 'Cannot access contents of the page'
    });
  });

  it('logs a non-Error rejection as it is', async () => {
    const { ask, error } = askDouble();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection is the case under test
    await expect(answerTopFrameInjection(PAGE, ask, () => Promise.reject('gone'))).rejects.toBe(
      'gone'
    );
    expect(error).toHaveBeenCalledWith('Injecting the thing failed', { tabId: 7, cause: 'gone' });
  });
});

describe('injectAtTarget', () => {
  it('targets the named document only', async () => {
    const execute = vi.spyOn(browser.scripting, 'executeScript').mockResolvedValue([] as never);
    const files = ['/thing.js'];
    await injectAtTarget({ tabId: 3, documentId: 'DOC-9' }, files);
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      target: { tabId: 3, documentIds: ['DOC-9'] },
      files: ['/thing.js']
    });
    // The API gets its own copy of the list.
    expect(execute.mock.calls[0]?.[0].files).not.toBe(files);
  });

  it('targets the tab’s top frame when no document is named', async () => {
    const execute = vi.spyOn(browser.scripting, 'executeScript').mockResolvedValue([] as never);
    await injectAtTarget({ tabId: 3, documentId: null }, ['/thing.js']);
    expect(execute).toHaveBeenCalledWith({
      target: { tabId: 3, frameIds: [0] },
      files: ['/thing.js']
    });
  });

  it('rejects as the scripting API does', async () => {
    const cause = new Error('No tab with id: 3');
    vi.spyOn(browser.scripting, 'executeScript').mockRejectedValue(cause);
    await expect(injectAtTarget({ tabId: 3, documentId: null }, ['/thing.js'])).rejects.toBe(cause);
  });
});
