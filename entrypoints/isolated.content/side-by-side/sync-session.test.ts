/**
 * The scroll-sync session's DOM wiring over hand-built frame/window stubs:
 * a same-origin pair syncs, a half that navigates cross-origin is flagged
 * blocked at its frame's load (no scroll needed) without any teardown
 * throwing, and stop removes every listener and silences queued bursts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompareSide } from '../../../lib/side-by-side/scroll-sync';
import type { Logger } from '../../../lib/logger';
import { createScrollSyncSession, type ScrollSyncSession } from './sync-session';

/** The cross-origin refusal a WindowProxy raises on any non-allowlisted access. */
const securityError = (): DOMException => new DOMException('Blocked a frame', 'SecurityError');

/** A frame document whose scrolling element carries settable scroll facts. */
interface FakeDocument {
  scrollingElement: { scrollTop: number; scrollHeight: number; clientHeight: number };
  documentElement: unknown;
}

/** A frame window: records scroll listeners and turns hostile once cross-origin. */
class FakeWindow {
  crossOrigin = false;
  readonly listeners = new Set<(event: Event) => void>();
  readonly doc: FakeDocument;
  readonly applied: number[] = [];

  /** @param range The document's scroll range (`scrollHeight − clientHeight`). */
  constructor(range: number) {
    this.doc = {
      scrollingElement: { scrollTop: 0, scrollHeight: range + 100, clientHeight: 100 },
      documentElement: null
    };
  }

  /** The document, or a SecurityError once cross-origin. */
  get document(): FakeDocument {
    if (this.crossOrigin) throw securityError();
    return this.doc;
  }

  /** Record a listener (refused once cross-origin, like the real proxy). */
  addEventListener(_type: string, listener: (event: Event) => void): void {
    if (this.crossOrigin) throw securityError();
    this.listeners.add(listener);
  }

  /** Drop a listener (refused once cross-origin, like the real proxy). */
  removeEventListener(_type: string, listener: (event: Event) => void): void {
    if (this.crossOrigin) throw securityError();
    this.listeners.delete(listener);
  }

  /** Record the applied position and move the document there. */
  scrollTo(options: { top: number }): void {
    if (this.crossOrigin) throw securityError();
    this.applied.push(options.top);
    this.doc.scrollingElement.scrollTop = options.top;
  }

  /** A user scroll of the frame's own document to `y`. */
  userScroll(y: number): void {
    this.doc.scrollingElement.scrollTop = y;
    for (const listener of this.listeners) listener({ target: this.doc } as unknown as Event);
  }
}

/** An iframe element stand-in: a real EventTarget (its `load`) with a swappable window. */
class FakeFrame extends EventTarget {
  /** @param contentWindow The frame's current window (null before a browsing context exists). */
  constructor(public contentWindow: FakeWindow | null) {
    super();
  }
}

/** Animation frames queued by the session's clock, flushed by hand. */
let frameQueue: (() => void)[] = [];

/** Run queued animation frames (and the ones they queue) until none remain. */
function flushFrames(): void {
  while (frameQueue.length > 0) {
    const batch = frameQueue;
    frameQueue = [];
    for (const callback of batch) callback();
  }
}

/** A session over two fake halves, plus its observers. */
function setup(): {
  session: ScrollSyncSession;
  frames: Record<CompareSide, FakeFrame>;
  windows: Record<CompareSide, FakeWindow>;
  blocked: CompareSide[];
  debug: ReturnType<typeof vi.fn>;
} {
  const windows = { cached: new FakeWindow(1000), bypassed: new FakeWindow(2000) };
  const frames = {
    cached: new FakeFrame(windows.cached),
    bypassed: new FakeFrame(windows.bypassed)
  };
  const blocked: CompareSide[] = [];
  const debug = vi.fn();
  const log: Logger = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const session = createScrollSyncSession({
    frames: () => frames as unknown as Record<CompareSide, HTMLIFrameElement>,
    onHalfBlocked: (side) => {
      blocked.push(side);
    },
    log
  });
  return { session, frames, windows, blocked, debug };
}

beforeEach(() => {
  frameQueue = [];
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    frameQueue.push(callback);
    return frameQueue.length;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createScrollSyncSession', () => {
  it('mirrors a same-origin scroll onto the other half by relative position', () => {
    const { session, windows } = setup();
    session.start();
    windows.cached.userScroll(500); // half of the cached range
    flushFrames();
    expect(windows.bypassed.applied).toEqual([1000]); // half of the bypassed range
  });

  it('keeps syncing after a same-origin reload re-adopts the half', () => {
    const { session, frames, windows } = setup();
    session.start();
    frames.cached.dispatchEvent(new Event('load'));
    expect(windows.cached.listeners.size).toBe(1); // replaced, never stacked
    windows.cached.userScroll(250);
    flushFrames();
    expect(windows.bypassed.applied).toEqual([500]);
  });

  it('flags a half that went cross-origin at its load, without throwing', () => {
    const { session, frames, windows, blocked, debug } = setup();
    session.start();
    windows.bypassed.crossOrigin = true;
    expect(() => frames.bypassed.dispatchEvent(new Event('load'))).not.toThrow();
    expect(blocked).toEqual(['bypassed']);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('bypassed half went cross-origin'));
    // The re-adopt stays armed: a later load (still cross-origin) neither throws nor re-reports.
    expect(() => frames.bypassed.dispatchEvent(new Event('load'))).not.toThrow();
    expect(blocked).toEqual(['bypassed']);
  });

  it('flags a half that is cross-origin at start', () => {
    const { session, windows, blocked } = setup();
    windows.cached.crossOrigin = true;
    session.start();
    expect(blocked).toEqual(['cached']);
  });

  it('adopts a frame without a window once it loads', () => {
    const { session, frames, windows } = setup();
    const late = windows.cached;
    frames.cached.contentWindow = null;
    session.start();
    frames.cached.contentWindow = late;
    frames.cached.dispatchEvent(new Event('load'));
    late.userScroll(1000);
    flushFrames();
    expect(windows.bypassed.applied).toEqual([2000]);
  });

  it('stops cleanly even over a cross-origin half, and ignores later loads', () => {
    const { session, frames, windows, blocked } = setup();
    session.start();
    windows.cached.userScroll(500); // burst queued, not yet run
    windows.bypassed.crossOrigin = true;
    expect(() => {
      session.stop();
    }).not.toThrow();
    expect(windows.cached.listeners.size).toBe(0);
    flushFrames();
    expect(windows.bypassed.applied).toEqual([]); // the queued burst died with the driver
    frames.bypassed.dispatchEvent(new Event('load'));
    expect(blocked).toEqual([]); // the load listener is gone
  });

  it('re-reports a blocked half on a fresh start', () => {
    const { session, windows, blocked } = setup();
    windows.cached.crossOrigin = true;
    session.start();
    session.stop();
    session.start();
    expect(blocked).toEqual(['cached', 'cached']);
  });
});
