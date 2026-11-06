/**
 * The module's wiring over the fake browser: the channel answers a fresh
 * live read, and the context's end removes the handler.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendMessage } from '../../../lib/messaging/index';
import { setupScriptRuntime } from '.';

/** A minimal live context whose invalidation the test triggers. */
function contextDouble(): ContentScriptContext & { invalidate: () => void } {
  const teardowns: (() => void)[] = [];
  return {
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
  ctx = contextDouble();
});

afterEach(() => {
  ctx.invalidate();
  document.body.innerHTML = '';
});

describe('setupScriptRuntime', () => {
  it('answers each ask with a fresh read of the live DOM', async () => {
    setupScriptRuntime(ctx);
    document.body.innerHTML = '<script id="a"></script>';
    await expect(sendMessage('getScriptRuntimeStatuses', undefined)).resolves.toMatchObject({
      total: 1,
      scripts: [{ id: 'a' }]
    });
    document.body.innerHTML += '<script id="b"></script>';
    await expect(sendMessage('getScriptRuntimeStatuses', undefined)).resolves.toMatchObject({
      total: 2
    });
  });

  it('stops answering once the context ends', async () => {
    setupScriptRuntime(ctx);
    ctx.invalidate();
    await expect(sendMessage('getScriptRuntimeStatuses', undefined)).rejects.toThrow();
  });
});
