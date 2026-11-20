/**
 * The toolbar click's decisions: the clicked tab's palette takes the
 * request, else the options page opens — never a dead click, never a
 * rejection out of the listener, never the page URL in a log line.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger';
import type { AskOutcome, ScheduleTimer } from '../../lib/messaging/bounded-ask';
import type { ToolbarClickEvent } from './toolbar-action';
import {
  PALETTE_OPEN_TIMEOUT_MS,
  clickRoute,
  handleToolbarClick,
  registerToolbarClick,
  type ToolbarClickDeps
} from './toolbar-click';

/** Chromium's no-receiver rejection, verbatim. */
const NO_RECEIVER = new Error('Could not establish connection. Receiving end does not exist.');

/** A logger recording each call as `[level, message, ...details]`. */
function recordingLog(): { log: Logger; lines: unknown[][] } {
  const lines: unknown[][] = [];
  const at =
    (level: string) =>
    (message: string, ...details: unknown[]): void => {
      lines.push([level, message, ...details]);
    };
  return {
    log: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') },
    lines
  };
}

/** Deps whose send answers as given; options opening resolves unless told. */
function deps(
  send: () => Promise<unknown>,
  openOptions: () => Promise<void> = () => Promise.resolve()
): {
  deps: ToolbarClickDeps;
  lines: unknown[][];
  sendOpen: ReturnType<typeof vi.fn<(tabId: number) => Promise<unknown>>>;
  openOptions: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  const { log, lines } = recordingLog();
  const sendOpen = vi.fn<(tabId: number) => Promise<unknown>>(send);
  const open = vi.fn<() => Promise<void>>(openOptions);
  return { deps: { sendOpen, openOptions: open, log }, lines, sendOpen, openOptions: open };
}

describe('clickRoute', () => {
  it.each<[AskOutcome<true>, ReturnType<typeof clickRoute>]>([
    [
      { kind: 'reply', reply: true },
      { kind: 'palette', unexpectedAnswer: false }
    ],
    [{ kind: 'invalid-reply' }, { kind: 'palette', unexpectedAnswer: true }],
    [{ kind: 'timeout' }, { kind: 'unanswered' }],
    [{ kind: 'no-receiver' }, { kind: 'fallback', cause: 'no receiver in the tab' }],
    [
      { kind: 'failed', cause: NO_RECEIVER },
      { kind: 'fallback', cause: NO_RECEIVER }
    ]
  ])('routes %o', (outcome, route) => {
    expect(clickRoute(outcome)).toEqual(route);
  });

  it('keeps a failed send whose cause is null a fallback (never read as "no cause")', () => {
    expect(clickRoute({ kind: 'failed', cause: null })).toEqual({ kind: 'fallback', cause: null });
  });
});

describe('handleToolbarClick', () => {
  it("asks the clicked tab's palette to open; the options page stays closed", async () => {
    const run = deps(() => Promise.resolve(true));
    await expect(handleToolbarClick({ id: 7 }, run.deps)).resolves.toBe('palette');
    expect(run.sendOpen).toHaveBeenCalledExactlyOnceWith(7);
    expect(run.openOptions).not.toHaveBeenCalled();
    expect(run.lines).toEqual([]);
  });

  it('opens the options page when the tab has no receiver, logging tab + cause only', async () => {
    const run = deps(() => Promise.reject(NO_RECEIVER));
    const tab = { id: 3, url: 'https://site.test/?token=secret' };
    await expect(handleToolbarClick(tab, run.deps)).resolves.toBe('options');
    expect(run.openOptions).toHaveBeenCalledOnce();
    expect(run.lines).toEqual([
      [
        'warn',
        'Toolbar click opens the options page: the tab cannot open the command palette',
        { tabId: 3, cause: 'no receiver in the tab' }
      ]
    ]);
    expect(JSON.stringify(run.lines)).not.toContain('secret');
  });

  it('opens the options page on a real send failure, with its cause', async () => {
    const failure = new Error('No tab with id: 3.');
    const run = deps(() => Promise.reject(failure));
    await expect(handleToolbarClick({ id: 3 }, run.deps)).resolves.toBe('options');
    expect(run.openOptions).toHaveBeenCalledOnce();
    expect(run.lines[0]?.[2]).toEqual({ tabId: 3, cause: failure });
  });

  it('opens the options page when the send throws synchronously', async () => {
    const run = deps(() => {
      throw NO_RECEIVER;
    });
    await expect(handleToolbarClick({ id: 3 }, run.deps)).resolves.toBe('options');
  });

  it.each([
    ['no tab', undefined],
    ['a tab without an id', {}],
    ['TAB_ID_NONE', { id: -1 }],
    ['a fractional id', { id: 1.5 }],
    ['a string id', { id: '4' }],
    ['an unsafe integer', { id: 2 ** 53 }]
  ])('opens the options page for %s, without sending', async (_label, tab) => {
    const run = deps(() => Promise.resolve(true));
    await expect(handleToolbarClick(tab, run.deps)).resolves.toBe('options');
    expect(run.sendOpen).not.toHaveBeenCalled();
    expect(run.openOptions).toHaveBeenCalledOnce();
    expect(run.lines[0]?.[2]).toEqual({ tabId: null, cause: 'no usable tab id' });
  });

  it('logs a refused options page at error and still resolves', async () => {
    const refusal = new Error('Could not create an options page.');
    const run = deps(
      () => Promise.reject(NO_RECEIVER),
      () => Promise.reject(refusal)
    );
    await expect(handleToolbarClick({ id: 2 }, run.deps)).resolves.toBe('options-failed');
    expect(run.lines.map(([level]) => level)).toEqual(['warn', 'error']);
    expect(run.lines[1]).toEqual([
      'error',
      'Opening the options page from the toolbar failed',
      { tabId: 2, cause: refusal }
    ]);
  });

  it('leaves a tab that never answers to its page: no options page (it may still open)', async () => {
    let fire: () => void = () => undefined;
    const delays: number[] = [];
    const schedule: ScheduleTimer = (run, ms) => {
      fire = run;
      delays.push(ms);
      return () => undefined;
    };
    const run = deps(() => new Promise<never>(() => undefined));
    const clicked = handleToolbarClick({ id: 5 }, { ...run.deps, schedule });
    fire();
    await expect(clicked).resolves.toBe('unanswered');
    expect(delays).toEqual([PALETTE_OPEN_TIMEOUT_MS]);
    expect(run.openOptions).not.toHaveBeenCalled();
    expect(run.lines).toEqual([
      ['warn', 'Toolbar click: the tab did not answer the palette request in time', { tabId: 5 }]
    ]);
  });

  it('waits 5 s for an answer on the real timer: not settled at 4.999 s, unanswered at 5 s', async () => {
    vi.useFakeTimers();
    try {
      const run = deps(() => new Promise<unknown>(() => undefined));
      let outcome: string | null = null;
      void handleToolbarClick({ id: 5 }, run.deps).then((settled) => {
        outcome = settled;
      });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(outcome).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome).toBe('unanswered');
      expect(run.openOptions).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats an unexpected answer as taken (a receiver ran), with a warning', async () => {
    const run = deps(() => Promise.resolve('yes'));
    await expect(handleToolbarClick({ id: 8 }, run.deps)).resolves.toBe('palette');
    expect(run.openOptions).not.toHaveBeenCalled();
    expect(run.lines).toEqual([
      ['warn', 'Toolbar click: the tab answered the palette request unexpectedly', { tabId: 8 }]
    ]);
  });

  it('asks again on a second click (the palette keeps an open view open)', async () => {
    const run = deps(() => Promise.resolve(true));
    await handleToolbarClick({ id: 7 }, run.deps);
    await handleToolbarClick({ id: 7 }, run.deps);
    expect(run.sendOpen.mock.calls).toEqual([[7], [7]]);
  });
});

describe('registerToolbarClick', () => {
  afterEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('refuses to register without a click event, naming the namespace this build expects', () => {
    expect(() => {
      registerToolbarClick(null);
    }).toThrow('No toolbar click event (browser.action) in this browser');
  });

  it('routes every click of the event through the decision', async () => {
    const run = deps(() => Promise.resolve(true));
    registerToolbarClick(fakeBrowser.action.onClicked, run.deps);
    await fakeBrowser.action.onClicked.trigger({ id: 12 } as Parameters<
      typeof fakeBrowser.action.onClicked.trigger
    >[0]);
    await vi.waitFor(() => {
      expect(run.sendOpen).toHaveBeenCalledExactlyOnceWith(12);
    });
  });

  it('guards the listener: a failing click is logged, never rejected out of it', async () => {
    const lines: unknown[][] = [];
    const log: Logger = {
      debug: () => undefined,
      info: () => undefined,
      // The fallback's own log line throws: the handler rejects for real.
      warn: () => {
        throw new Error('console gone');
      },
      error: (message, ...details) => {
        lines.push([message, ...details]);
      }
    };
    let listener: ((tab: { id?: number }) => void) | undefined;
    const event = {
      addListener: (callback: (tab: { id?: number }) => void) => {
        listener = callback;
      }
    } as unknown as ToolbarClickEvent;
    registerToolbarClick(event, {
      sendOpen: () => Promise.resolve(true),
      openOptions: () => Promise.resolve(),
      log
    });
    expect(() => {
      listener?.({});
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(lines).toHaveLength(1);
    });
    expect(lines[0]?.[0]).toBe('Toolbar click handling failed');
  });

  /**
   * Stand in for the platform's callback-style tab send (the messaging
   * library's transport): records `[tabId, message type]` and completes the
   * way the browser would — an answer, or `runtime.lastError` set during the
   * callback (a no-receiver send).
   *
   * @returns The sends seen, in order.
   */
  function platformTabSend(
    outcome: { answer: unknown } | { lastError: string }
  ): Array<[unknown, unknown]> {
    const sent: Array<[unknown, unknown]> = [];
    // `lastError` is read-only in the typings; the fake keeps it writable.
    const runtime = fakeBrowser.runtime as { lastError?: { message?: string } };
    const send = (
      tabId: unknown,
      message: unknown,
      _options: unknown,
      callback: (response: unknown) => void
    ): void => {
      sent.push([tabId, (message as { type?: unknown } | undefined)?.type]);
      if ('answer' in outcome) {
        callback({ res: outcome.answer });
        return;
      }
      runtime.lastError = { message: outcome.lastError };
      try {
        callback(undefined);
      } finally {
        runtime.lastError = undefined;
      }
    };
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation(send);
    return sent;
  }

  it('by default sends openCommandPalette to the clicked tab; an answer opens no options page', async () => {
    const openOptions = vi
      .spyOn(fakeBrowser.runtime, 'openOptionsPage')
      .mockResolvedValue(undefined);
    const sent = platformTabSend({ answer: true });
    const tab = await fakeBrowser.tabs.create({ url: 'https://site.test/wp' });
    registerToolbarClick(fakeBrowser.action.onClicked);
    await fakeBrowser.action.onClicked.trigger(tab);
    await vi.waitFor(() => {
      expect(sent).toEqual([[tab.id, 'openCommandPalette']]);
    });
    // The answer settles the click: give the handler its remaining turns.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openOptions).not.toHaveBeenCalled();
  });

  it('by default falls back to the real options page when the tab has no receiver', async () => {
    const openOptions = vi
      .spyOn(fakeBrowser.runtime, 'openOptionsPage')
      .mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sent = platformTabSend({ lastError: NO_RECEIVER.message });
    const tab = await fakeBrowser.tabs.create({ url: 'https://site.test/plain' });
    registerToolbarClick(fakeBrowser.action.onClicked);
    await fakeBrowser.action.onClicked.trigger(tab);
    await vi.waitFor(() => {
      expect(openOptions).toHaveBeenCalledOnce();
    });
    expect(sent).toEqual([[tab.id, 'openCommandPalette']]);
    expect(warn.mock.calls[0]?.[0]).toBe(
      '[WPR FDT] [toolbar-click] Toolbar click opens the options page: the tab cannot open the command palette'
    );
    // Classified as no receiver (the platform's message), not a send failure.
    expect(warn.mock.calls[0]?.[1]).toEqual({ tabId: tab.id, cause: 'no receiver in the tab' });
  });
});
