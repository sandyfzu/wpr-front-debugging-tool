import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESCAN_DEBOUNCE_MS,
  RESCAN_MAX_WAIT_MS,
  createPageTools,
  cssZoom,
  hasModal,
  viewportRect,
  type PageTools
} from './page-tools';

/** Let pending MutationObserver callbacks run. */
const microtasks = () =>
  new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });

describe('createPageTools', () => {
  let tools: PageTools | undefined;
  let disposeRoot: (() => void) | undefined;
  let invalid = false;
  /** The listeners the tools registered, by event type. */
  let listeners: Map<string, (event: Event) => void>;
  let host: HTMLElement;

  beforeEach(() => {
    listeners = new Map();
    host = document.createElement('div');
    vi.useFakeTimers();
    invalid = false;
    document.body.innerHTML =
      '<img data-lazy-src="/a.png"><script type="rocketlazyloadscript" id="x-js">a()</script>';
    createRoot((dispose) => {
      disposeRoot = dispose;
      tools = createPageTools({
        doc: document,
        win: window,
        host,
        listen: (_target, type, handler) => {
          listeners.set(type, handler);
        },
        isInvalid: () => invalid,
        later: (run) => {
          setTimeout(run, 0);
        }
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

  it('rescans under churn that never goes quiet, at least every max wait', async () => {
    for (let elapsed = 0; elapsed <= RESCAN_MAX_WAIT_MS; elapsed += 100) {
      const img = document.createElement('img');
      img.setAttribute('data-lazy-src', `/n${String(elapsed)}.png`);
      document.body.append(img);
      await microtasks();
      vi.advanceTimersByTime(100);
    }
    expect(tools?.candidates().length).toBeGreaterThan(2);
  });

  it('follows SPA address changes', () => {
    history.pushState({}, '', '/spa-route');
    listeners.get('wxt:locationchange')?.(new Event('wxt:locationchange'));
    expect(tools?.pageFacts().href).toContain('/spa-route');
    history.pushState({}, '', '/');
  });

  it('notices page dialogs and popovers, ignoring its own host', () => {
    const toggle = (target: EventTarget, newState: string): Event => {
      const event = new Event('toggle');
      Object.defineProperty(event, 'target', { value: target });
      Object.defineProperty(event, 'newState', { value: newState });
      return event;
    };
    listeners.get('toggle')?.(toggle(document.body, 'open'));
    expect(tools?.pageTopLayerOpened()).toBe(1);
    listeners.get('toggle')?.(toggle(host, 'open'));
    listeners.get('toggle')?.(toggle(document.body, 'closed'));
    expect(tools?.pageTopLayerOpened()).toBe(1);
    expect(tools?.pageModal()).toBe(false);
  });

  it('re-reads the zoom on resize', () => {
    Object.defineProperty(host, 'currentCSSZoom', { value: 1.5, configurable: true });
    listeners.get('resize')?.(new Event('resize'));
    expect(tools?.zoom()).toBe(1.5);
  });

  it('picks through layers: an image under a caption is still found', () => {
    const img = document.querySelector('img');
    const caption = document.createElement('div');
    if (img === null) throw new Error('fixture');
    Object.defineProperty(document, 'elementsFromPoint', {
      value: () => [host, caption, img],
      configurable: true
    });
    expect(tools?.pointPick(1, 1)?.element).toBe(img);
    Object.defineProperty(document, 'elementsFromPoint', {
      value: () => [caption],
      configurable: true
    });
    expect(tools?.pointPick(1, 1)).toBeNull();
  });

  it('lists the page frames', () => {
    document.body.append(document.createElement('iframe'));
    expect(tools?.frames()).toHaveLength(1);
  });

  it('reports a capped scan', () => {
    expect(tools?.candidatesCapped()).toBe(false);
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

describe('hasModal / cssZoom', () => {
  it('reads a modal dialog through :modal, none where the engine lacks it', () => {
    const doc = { querySelector: vi.fn(() => document.body) } as unknown as Document;
    expect(hasModal(doc)).toBe(true);
    const old = {
      querySelector: () => {
        throw new SyntaxError(':modal');
      }
    } as unknown as Document;
    expect(hasModal(old)).toBe(false);
  });

  it('reads currentCSSZoom, 1 when absent or junk', () => {
    const el = document.createElement('div');
    expect(cssZoom(el)).toBe(1);
    Object.defineProperty(el, 'currentCSSZoom', { value: 2 });
    expect(cssZoom(el)).toBe(2);
    const junk = document.createElement('div');
    Object.defineProperty(junk, 'currentCSSZoom', { value: 0 });
    expect(cssZoom(junk)).toBe(1);
  });
});
