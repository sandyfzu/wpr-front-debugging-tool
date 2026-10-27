/**
 * The palette's background asks: both answer only a top-frame http(s)
 * sender and act on that sender's own tab — a sub-frame, a tabless sender
 * or a non-web page is refused before anything is injected or opened; the
 * view load injects the built view script into that tab's top frame and
 * rejects (logged) when the injection fails; the builder open passes the
 * opener's outcome through.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  COMMAND_PALETTE_VIEW_SCRIPT,
  answerBuilderOpenOnSenderTab,
  answerPaletteViewLoad
} from './command-palette';

/** A top-frame page sender on tab 7. */
const PAGE = { tab: { id: 7 }, frameId: 0, url: 'https://example.com/a?b=1' } as const;

/** Senders that must be refused. */
const REFUSED = [
  ['a sub-frame', { ...PAGE, frameId: 2 }],
  ['a tabless sender (an extension page)', { id: 'ext', url: 'chrome-extension://x/panel.html' }],
  ['a non-web page', { ...PAGE, url: 'chrome://settings' }],
  ['no sender', undefined]
] as const;

describe('answerPaletteViewLoad', () => {
  it('injects the view script into the sender tab’s top frame', async () => {
    const inject = vi.fn(() => Promise.resolve());
    await expect(answerPaletteViewLoad(PAGE, inject)).resolves.toBe(true);
    expect(inject).toHaveBeenCalledWith(7, [COMMAND_PALETTE_VIEW_SCRIPT]);
    expect(COMMAND_PALETTE_VIEW_SCRIPT).toBe('/content-scripts/command-palette.js');
  });

  it.each(REFUSED)('refuses %s without injecting', async (_label, sender) => {
    const inject = vi.fn(() => Promise.resolve());
    await expect(answerPaletteViewLoad(sender, inject)).rejects.toThrow(
      'only a top-frame page may load the view'
    );
    expect(inject).not.toHaveBeenCalled();
  });

  it('rejects with the injection’s own failure (logged)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cause = new Error('Cannot access contents of the page');
    await expect(answerPaletteViewLoad(PAGE, () => Promise.reject(cause))).rejects.toBe(cause);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe('answerBuilderOpenOnSenderTab', () => {
  it('opens the builder on the sender’s own tab and passes the outcome through', async () => {
    const open = vi.fn(() => Promise.resolve('revealed' as const));
    await expect(answerBuilderOpenOnSenderTab(PAGE, open)).resolves.toBe('revealed');
    expect(open).toHaveBeenCalledWith(7);
  });

  it.each(REFUSED)('refuses %s without opening anything', async (_label, sender) => {
    const open = vi.fn(() => Promise.resolve('injected' as const));
    await expect(answerBuilderOpenOnSenderTab(sender, open)).rejects.toThrow(
      'only a top-frame page may open the builder'
    );
    expect(open).not.toHaveBeenCalled();
  });
});
