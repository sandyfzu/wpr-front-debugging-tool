/**
 * The module's wiring over the fake browser: the stylesheet ask answers
 * read-only from the top frame, and the handler goes with the context.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendMessage } from '../../../lib/messaging/index';
import { parsePageStylesheetsReply } from '../../../lib/messaging/page-stylesheets';
import { setupStylesheetInventory } from '.';

/** A minimal live context whose invalidation the test triggers. */
function contextDouble(): ContentScriptContext & { invalidate: () => void } {
  const teardowns: (() => void)[] = [];
  return {
    isInvalid: false,
    onInvalidated: (teardown: () => void) => {
      teardowns.push(teardown);
      return () => undefined;
    },
    invalidate: () => {
      for (const teardown of teardowns) teardown();
    }
  } as unknown as ContentScriptContext & { invalidate: () => void };
}

let ctx: ReturnType<typeof contextDouble>;

beforeEach(() => {
  fakeBrowser.reset();
  document.head.innerHTML =
    '<style id="theme">.a{}</style><link rel="preload" as="style" data-rocket-async="style" href="/a.css">';
  ctx = contextDouble();
});

afterEach(() => {
  ctx.invalidate();
  document.head.innerHTML = '';
});

describe('setupStylesheetInventory', () => {
  it('answers the stylesheet inventory, read-only, in the panel guard’s shape', async () => {
    setupStylesheetInventory(ctx);
    const before = document.head.innerHTML;
    const reply = await sendMessage('listPageStylesheets', undefined);
    expect(document.head.innerHTML).toBe(before);
    expect(parsePageStylesheetsReply(reply)).toEqual(reply);
    expect(reply.total).toBe(2);
    expect(reply.styles.map((style) => [style.kind, style.rocketAsync])).toEqual([
      ['inline', false],
      ['link', true]
    ]);
  });

  it('stops answering once the context is invalidated', async () => {
    setupStylesheetInventory(ctx);
    ctx.invalidate();
    await expect(sendMessage('listPageStylesheets', undefined)).rejects.toThrow();
  });
});
