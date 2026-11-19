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
import { createStyleSnapshots } from './style-snapshot';

/** A minimal live context whose invalidation the test triggers. */
function contextDouble(): ContentScriptContext & { invalidate: () => void } {
  const teardowns: (() => void)[] = [];
  return {
    isInvalid: false,
    onInvalidated: (teardown: () => void) => {
      teardowns.push(teardown);
      return () => undefined;
    },
    addEventListener: (target: EventTarget, type: string, handler: EventListener) => {
      target.addEventListener(type, handler);
      teardowns.push(() => {
        target.removeEventListener(type, handler);
      });
    },
    invalidate: () => {
      for (const teardown of teardowns.splice(0)) teardown();
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
    expect(reply.snapshotId).toMatch(/^[0-9a-f]{32}$/);
    expect(reply.total).toBe(2);
    expect(reply.styles.map((style) => [style.kind, style.rocketAsync])).toEqual([
      ['inline', false],
      ['link', true]
    ]);
  });

  it('reads an inline style’s CSS from the latest list, gone once a newer list replaced it', async () => {
    setupStylesheetInventory(ctx);
    const first = await sendMessage('listPageStylesheets', undefined);
    const read = { snapshotId: first.snapshotId, styleIndex: 0, offset: 0 };
    expect(await sendMessage('getStyleSourceChunk', read)).toEqual({
      status: 'ok',
      text: '.a{}',
      total: 4,
      truncated: false
    });
    const second = await sendMessage('listPageStylesheets', undefined);
    expect(second.snapshotId).not.toBe(first.snapshotId);
    expect(await sendMessage('getStyleSourceChunk', read)).toEqual({ status: 'gone' });
  });

  it('frees the snapshot on pagehide and on invalidation', async () => {
    const snapshots = createStyleSnapshots();
    setupStylesheetInventory(ctx, snapshots);
    const { snapshotId } = await sendMessage('listPageStylesheets', undefined);
    const read = { snapshotId, styleIndex: 0, offset: 0 };
    window.dispatchEvent(new Event('pagehide'));
    expect(snapshots.read(read)).toEqual({ status: 'gone' });
    const again = await sendMessage('listPageStylesheets', undefined);
    ctx.invalidate();
    expect(snapshots.read({ ...read, snapshotId: again.snapshotId })).toEqual({ status: 'gone' });
  });

  it('stops answering once the context is invalidated', async () => {
    setupStylesheetInventory(ctx);
    ctx.invalidate();
    await expect(sendMessage('listPageStylesheets', undefined)).rejects.toThrow();
    await expect(
      sendMessage('getStyleSourceChunk', { snapshotId: 'a'.repeat(32), styleIndex: 0, offset: 0 })
    ).rejects.toThrow();
  });
});
