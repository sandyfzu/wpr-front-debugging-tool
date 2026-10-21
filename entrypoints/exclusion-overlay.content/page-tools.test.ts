import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESCAN_DEBOUNCE_MS,
  RESCAN_MAX_WAIT_MS,
  createPageTools,
  cssZoom,
  hasModal,
  readPageFacts,
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
  /** The wall clock the tools read (a test moves it). */
  let wall = 1_800_000_000_000;
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
        },
        wallNow: () => wall
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

  it('marks a back/forward cache restore, and keeps the mark through SPA moves', () => {
    // A page-transition event carrying `persisted` (the test DOM has no constructor for it).
    const pageshow = (persisted: boolean): Event =>
      Object.assign(new Event('pageshow'), { persisted });
    listeners.get('pageshow')?.(pageshow(false));
    expect(tools?.pageFacts().restored).toBeUndefined();
    listeners.get('pageshow')?.(pageshow(true));
    expect(tools?.pageFacts().restored).toBe(true);
    listeners.get('wxt:locationchange')?.(new Event('wxt:locationchange'));
    expect(tools?.pageFacts().restored).toBe(true);
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

  it('notices a modal dialog removed without closing it (framework unmount)', async () => {
    let modal = true;
    // The prototype's own method (the instance one is replaced below).
    const real = (selector: string): Element | null =>
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- the generic-string overload is the one a stand-in must forward to
      Document.prototype.querySelector.call(document, selector);
    Object.defineProperty(document, 'querySelector', {
      configurable: true,
      value: (selector: string) =>
        selector === ':modal' ? (modal ? document.body : null) : real(selector)
    });
    document.body.append(document.createElement('p'));
    await microtasks();
    expect(tools?.pageModal()).toBe(true);
    modal = false;
    document.body.lastElementChild?.remove();
    await microtasks();
    expect(tools?.pageModal()).toBe(false);
    Reflect.deleteProperty(document, 'querySelector');
  });

  it('re-reads the zoom when the page restyles its root at run time', async () => {
    Object.defineProperty(host, 'currentCSSZoom', { value: 2, configurable: true });
    document.documentElement.setAttribute('style', 'zoom: 2');
    await microtasks();
    expect(tools?.zoom()).toBe(2);
    document.documentElement.removeAttribute('style');
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
    expect(typeof tools?.pageFacts().navigationStart).toBe('number');
  });

  it('keeps the navigation start anchored at the first read (a later re-read after a sleep would shift it)', () => {
    const anchored = tools?.pageFacts().navigationStart;
    // An hour of system sleep: the wall clock jumps, the monotonic timeline does not.
    wall += 3_600_000;
    listeners.get('wxt:locationchange')?.(new Event('wxt:locationchange'));
    expect(tools?.pageFacts().navigationStart).toBe(anchored);
  });

  it('reads the response end from the navigation entry (unknown while 0 or absent)', () => {
    const entries = vi.spyOn(window.performance, 'getEntriesByType');
    try {
      entries.mockReturnValue([{ name: window.location.href, responseEnd: 120 } as never]);
      listeners.get('wxt:locationchange')?.(new Event('wxt:locationchange'));
      expect(tools?.pageFacts().responseEnd).toBe(120);
      entries.mockReturnValue([{ name: window.location.href, responseEnd: 0 } as never]);
      listeners.get('wxt:locationchange')?.(new Event('wxt:locationchange'));
      expect(tools?.pageFacts().responseEnd).toBeNull();
      entries.mockReturnValue([]);
      listeners.get('wxt:locationchange')?.(new Event('wxt:locationchange'));
      expect(tools?.pageFacts().responseEnd).toBeNull();
    } finally {
      entries.mockRestore();
    }
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

describe('readPageFacts (wall-anchored navigation start)', () => {
  /** A window whose monotonic timeline is `timelineOffsetMs` away from the wall clock. */
  const source = (sinceStart: number, responseEnd: number) => ({
    location: { href: 'https://example.com/' },
    performance: {
      now: () => sinceStart,
      getEntriesByType: () => [{ name: 'https://example.com/', responseEnd } as never]
    }
  });

  it('anchors the navigation start to the wall clock, whatever the timeline’s offset', () => {
    const facts = readPageFacts(source(1_500, 120), () => 1_800_000_000_000);
    expect(facts.navigationStart).toBe(1_800_000_000_000 - 1_500);
    expect(facts.responseEnd).toBe(120);
  });
});
