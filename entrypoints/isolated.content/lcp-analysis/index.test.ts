/**
 * The module's wiring over the fake browser: the channel answers with the
 * executor over the global `PerformanceObserver` (stubbed: absent →
 * `unsupported`; present → measured), a malformed request is refused, and
 * the context's end removes the handler.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendMessage } from '../../../lib/messaging/index';
import { setupLcpAnalysis } from '.';

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
/** The platform observer, restored after each test (only it is stubbed). */
const platformObserver = (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver;

/** Replace the platform observer for one test. */
function stubObserver(value: unknown): void {
  (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = value;
}

beforeEach(() => {
  fakeBrowser.reset();
  ctx = contextDouble();
});

afterEach(() => {
  ctx.invalidate();
  stubObserver(platformObserver);
});

describe('setupLcpAnalysis', () => {
  it('answers over the channel with the platform observer', async () => {
    stubObserver(undefined);
    setupLcpAnalysis(ctx);
    await expect(sendMessage('runLcpAnalysis', { highlight: true })).resolves.toEqual({
      kind: 'unsupported'
    });
  });

  it('measures through a platform observer that hands entries over at once', async () => {
    class Observer {
      static readonly supportedEntryTypes = ['largest-contentful-paint'];
      observe(): void {
        // Buffered entries: none on this page.
      }
      takeRecords(): unknown[] {
        return [{ startTime: 5, renderTime: 5, loadTime: 0, size: 9, url: '', element: null }];
      }
      disconnect(): void {
        // Nothing held.
      }
    }
    stubObserver(Observer);
    setupLcpAnalysis(ctx);
    await expect(sendMessage('runLcpAnalysis', { highlight: true })).resolves.toMatchObject({
      kind: 'measured',
      candidates: [{ startTime: 5, element: null }],
      highlight: 'unavailable'
    });
  });

  it('refuses a malformed request', async () => {
    setupLcpAnalysis(ctx);
    await expect(sendMessage('runLcpAnalysis', { highlight: 1 } as never)).rejects.toThrow(
      'malformed'
    );
  });

  it('stops answering once the context ends', async () => {
    setupLcpAnalysis(ctx);
    ctx.invalidate();
    await expect(sendMessage('runLcpAnalysis', { highlight: false })).rejects.toThrow();
  });
});
