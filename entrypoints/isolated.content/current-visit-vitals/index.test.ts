/**
 * The module's wiring over the fake browser: the engine's entry types pick
 * the first-hidden source (Chromium's `visibility-state` entries → no
 * `visibilitychange` listener; Firefox → the tracker), the channel answers
 * the collector's read, a persisted `pageshow` (back/forward-cache restore)
 * starts a new visit (tracker included) while a plain one does not, a
 * sub-frame installs nothing, and the context's end stops the observer, the
 * tracker, the `pageshow` listener and the handler.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../../../lib/messaging/index';
import { setupCurrentVisitVitals } from '.';

/** Chromium's entry types (with `visibility-state`). */
const CHROMIUM_TYPES = [
  'largest-contentful-paint',
  'layout-shift',
  'event',
  'first-input',
  'paint',
  'visibility-state'
];

/** Firefox's entry types (no `visibility-state`). */
const FIREFOX_TYPES = CHROMIUM_TYPES.filter((type) => type !== 'visibility-state');

/**
 * A minimal live context whose invalidation the test triggers: teardowns
 * run and its signal aborts, as WXT's context does.
 *
 * @returns The context plus `invalidate`.
 */
function contextDouble(): ContentScriptContext & { invalidate: () => void } {
  const teardowns: (() => void)[] = [];
  const controller = new AbortController();
  return {
    signal: controller.signal,
    onInvalidated: (teardown: () => void) => {
      teardowns.push(teardown);
      return () => undefined;
    },
    invalidate: () => {
      controller.abort();
      for (const teardown of teardowns.splice(0)) teardown();
    }
  } as unknown as ContentScriptContext & { invalidate: () => void };
}

/** Globals replaced by the current test, restored after it. */
const replaced = new Map<string, PropertyDescriptor | undefined>();

/**
 * Replace one global for this test (not `vi.stubGlobal`: unstubbing all
 * would also drop the fake browser the test setup stubbed).
 *
 * @param name The global's name.
 * @param value Its value for this test.
 */
function setGlobal(name: string, value: unknown): void {
  if (!replaced.has(name)) replaced.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/**
 * Install a fake `PerformanceObserver` (and interaction-id-carrying event
 * timing) on the global, recording what the module does with it.
 *
 * @param types The engine's supported entry types.
 * @returns The observed types and the disconnect count.
 */
function stubObserver(types: readonly string[]): { observed: string[]; disconnects: () => number } {
  const observed: string[] = [];
  let disconnects = 0;
  class FakeObserver {
    static readonly supportedEntryTypes = types;
    observe(options: { type: string }): void {
      observed.push(options.type);
    }
    takeRecords(): readonly unknown[] {
      return [];
    }
    disconnect(): void {
      disconnects += 1;
    }
  }
  setGlobal('PerformanceObserver', FakeObserver);
  setGlobal('PerformanceEventTiming', { prototype: { interactionId: 0 } });
  return { observed, disconnects: () => disconnects };
}

/**
 * The `visibilitychange` registrations the module made.
 *
 * @param calls The `document.addEventListener` spy's calls.
 * @returns Each registration's options.
 */
function visibilityListeners(calls: readonly (readonly unknown[])[]): AddEventListenerOptions[] {
  return calls
    .filter((call) => call[0] === 'visibilitychange')
    .map((call) => call[2] as AddEventListenerOptions);
}

let ctx: ReturnType<typeof contextDouble>;

beforeEach(() => {
  fakeBrowser.reset();
  ctx = contextDouble();
});

afterEach(() => {
  ctx.invalidate();
  for (const [name, descriptor] of replaced) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  replaced.clear();
  vi.restoreAllMocks();
});

describe('setupCurrentVisitVitals', () => {
  it('installs no visibilitychange tracker where the engine has visibility-state entries', async () => {
    const { observed } = stubObserver(CHROMIUM_TYPES);
    const listen = vi.spyOn(document, 'addEventListener');
    setupCurrentVisitVitals(ctx);
    expect(visibilityListeners(listen.mock.calls)).toEqual([]);
    expect(observed).toEqual(['largest-contentful-paint', 'layout-shift', 'event', 'first-input']);
    await expect(sendMessage('getCurrentVisitVitals', undefined)).resolves.toMatchObject({
      input: { supported: { lcp: true, cls: true, inp: true }, lcpEntries: [] },
      capped: false
    });
  });

  it('installs the tracker where the engine has none, and the read carries its first hide', async () => {
    stubObserver(FIREFOX_TYPES);
    const listen = vi.spyOn(document, 'addEventListener');
    setupCurrentVisitVitals(ctx);
    expect(visibilityListeners(listen.mock.calls)).toHaveLength(1);
    await expect(sendMessage('getCurrentVisitVitals', undefined)).resolves.toMatchObject({
      input: { firstHiddenTime: null }
    });

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const hide = new Event('visibilitychange');
    document.dispatchEvent(hide);
    visibility.mockReturnValue('visible');
    const reply = await sendMessage('getCurrentVisitVitals', undefined);
    expect(reply.input.firstHiddenTime).toBe(hide.timeStamp);
  });

  /** Fire a `pageshow` with this persistence and time stamp. */
  function pageshow(persisted: boolean, timeStamp: number): void {
    const event = new Event('pageshow');
    Object.defineProperties(event, {
      persisted: { value: persisted },
      timeStamp: { value: timeStamp }
    });
    window.dispatchEvent(event);
  }

  it('starts a new visit on a back/forward-cache restore only, tracker included', async () => {
    stubObserver(FIREFOX_TYPES);
    setupCurrentVisitVitals(ctx);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockReturnValue('visible');
    pageshow(false, 4000);
    const before = await sendMessage('getCurrentVisitVitals', undefined);
    expect(before.input.restoredAt).toBeUndefined();
    expect(before.input.firstHiddenTime).not.toBeNull();
    pageshow(true, 4000);
    const after = await sendMessage('getCurrentVisitVitals', undefined);
    expect(after.input).toMatchObject({ restoredAt: 4000, firstHiddenTime: null });
  });

  it('answers without an observer (engine has none): every metric unsupported', async () => {
    setGlobal('PerformanceObserver', undefined);
    setupCurrentVisitVitals(ctx);
    await expect(sendMessage('getCurrentVisitVitals', undefined)).resolves.toMatchObject({
      input: { supported: { lcp: false, cls: false, inp: false } }
    });
  });

  it('installs nothing in a sub-frame', async () => {
    const { observed } = stubObserver(FIREFOX_TYPES);
    vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window);
    const listen = vi.spyOn(document, 'addEventListener');
    setupCurrentVisitVitals(ctx);
    expect(observed).toEqual([]);
    expect(visibilityListeners(listen.mock.calls)).toEqual([]);
    await expect(sendMessage('getCurrentVisitVitals', undefined)).rejects.toThrow();
  });

  it('stops the observer, the tracker and the handler once the context ends', async () => {
    const { disconnects } = stubObserver(FIREFOX_TYPES);
    const listen = vi.spyOn(document, 'addEventListener');
    const listenWindow = vi.spyOn(window, 'addEventListener');
    setupCurrentVisitVitals(ctx);
    const [options] = visibilityListeners(listen.mock.calls);
    const [pageshowOptions] = listenWindow.mock.calls
      .filter((call) => call[0] === 'pageshow')
      .map((call) => call[2] as AddEventListenerOptions);
    expect(options?.signal?.aborted).toBe(false);
    expect(pageshowOptions).toMatchObject({ capture: true, passive: true });
    expect(pageshowOptions?.signal?.aborted).toBe(false);
    ctx.invalidate();
    expect(disconnects()).toBe(1);
    expect(options?.signal?.aborted).toBe(true);
    expect(pageshowOptions?.signal?.aborted).toBe(true);
    await expect(sendMessage('getCurrentVisitVitals', undefined)).rejects.toThrow();
  });
});
