import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESCAN_DEBOUNCE_MS, createPageTools, viewportRect, type PageTools } from './page-tools';

/** Let pending MutationObserver callbacks run. */
const microtasks = () =>
  new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });

describe('createPageTools', () => {
  let tools: PageTools | undefined;
  let disposeRoot: (() => void) | undefined;
  let invalid = false;

  beforeEach(() => {
    vi.useFakeTimers();
    invalid = false;
    document.body.innerHTML =
      '<img data-lazy-src="/a.png"><script type="rocketlazyloadscript" id="x-js">a()</script>';
    createRoot((dispose) => {
      disposeRoot = dispose;
      tools = createPageTools({
        doc: document,
        win: window,
        host: document.createElement('div'),
        listen: () => undefined,
        isInvalid: () => invalid
      });
    });
  });

  afterEach(() => {
    tools?.dispose();
    disposeRoot?.();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('scans the page at creation', () => {
    expect(tools?.candidates().map((candidate) => candidate.lane)).toEqual(['lazyload', 'delayJs']);
  });

  it('rescans once after DOM churn settles', async () => {
    const img = document.createElement('img');
    img.setAttribute('data-lazy-src', '/b.png');
    document.body.append(img);
    await microtasks();
    expect(tools?.candidates()).toHaveLength(2);
    vi.advanceTimersByTime(RESCAN_DEBOUNCE_MS);
    expect(tools?.candidates()).toHaveLength(3);
  });

  it('stops observing once the extension context is gone', async () => {
    invalid = true;
    document.body.append(document.createElement('p'));
    await microtasks();
    invalid = false;
    const img = document.createElement('img');
    img.setAttribute('data-lazy-src', '/c.png');
    document.body.append(img);
    await microtasks();
    vi.advanceTimersByTime(RESCAN_DEBOUNCE_MS);
    expect(tools?.candidates()).toHaveLength(2);
  });

  it('cancels a pending rescan on dispose', async () => {
    document.body.append(document.createElement('img'));
    await microtasks();
    tools?.dispose();
    document.body.innerHTML = '';
    vi.advanceTimersByTime(RESCAN_DEBOUNCE_MS);
    expect(tools?.candidates()).toHaveLength(2);
  });

  it('reads the page facts', () => {
    expect(tools?.pageFacts().href).toBe(window.location.href);
    expect(typeof tools?.pageFacts().timeOrigin).toBe('number');
  });
});

describe('viewportRect', () => {
  it('is null for detached elements and elements without a box', () => {
    expect(viewportRect(document.createElement('div'))).toBeNull();
    const attached = document.createElement('div');
    document.body.append(attached);
    // happy-dom lays nothing out: a zero box reads as "renders nothing".
    expect(viewportRect(attached)).toBeNull();
    attached.remove();
  });
});
