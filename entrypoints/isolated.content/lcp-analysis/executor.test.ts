/**
 * The page's LCP analysis over a fake observer: one buffered observer,
 * taken at once (or at its first delivery / after the wait) and always
 * disconnected; facts deduplicated, bounded and sanitized; elements
 * described without markup; the resource matched on the full URL;
 * `unsupported` without the entry type; the highlight only when asked and
 * possible.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleTimer } from '../../../lib/messaging/bounded-ask';
import { LCP_ANALYSIS_LIMITS } from '../../../lib/messaging/lcp-analysis';
import { LCP_BUFFER_WAIT_MS } from '../../../lib/lcp-analysis/deadlines';
import {
  analyseLcp,
  candidateFacts,
  describeElement,
  lcpResource,
  navigationTiming,
  takeLcpEntries,
  type LcpAnalysisDeps,
  type LcpEntryLike,
  type ObserverClass
} from './executor';

/** How the fake observer hands its buffered entries over. */
type Delivery = 'sync' | 'async' | 'never' | 'throws';

/** A fake observer class recording its instances' calls. */
function observerClass(
  entries: readonly unknown[],
  delivery: Delivery,
  types = ['largest-contentful-paint']
) {
  const log: string[] = [];
  class FakeObserver {
    static readonly supportedEntryTypes = types;
    private pending: unknown[] = [];
    constructor(private readonly callback: (list: { getEntries(): readonly unknown[] }) => void) {}
    observe(options: { type: string; buffered: boolean }): void {
      log.push(`observe:${options.type}:${String(options.buffered)}`);
      if (delivery === 'throws') throw new TypeError('unsupported type');
      if (delivery === 'sync') this.pending = [...entries];
      if (delivery === 'async') {
        queueMicrotask(() => {
          this.callback({ getEntries: () => entries });
        });
      }
    }
    takeRecords(): unknown[] {
      const taken = this.pending;
      this.pending = [];
      return taken;
    }
    disconnect(): void {
      log.push('disconnect');
    }
  }
  return { Observer: FakeObserver as ObserverClass, log };
}

/** A timer seam the test fires by hand. */
function manualTimer(): { schedule: ScheduleTimer; fire: () => void; armed: number[] } {
  const armed: number[] = [];
  let run: (() => void) | null = null;
  return {
    schedule: (callback, ms) => {
      armed.push(ms);
      run = callback;
      return () => {
        run = null;
      };
    },
    fire: () => run?.(),
    armed
  };
}

/** An LCP entry. */
function entry(fields: Partial<LcpEntryLike> = {}): LcpEntryLike {
  return {
    startTime: 900,
    renderTime: 900,
    loadTime: 800,
    size: 1000,
    url: '',
    element: null,
    ...fields
  };
}

/** A timeline with these navigation and resource entries. */
function timeline(navigation: unknown[], resources: unknown[]): LcpAnalysisDeps['performance'] {
  return {
    getEntriesByType: ((type: string) =>
      type === 'navigation' ? navigation : type === 'resource' ? resources : []) as never
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('describeElement', () => {
  it('names the tag, id and first ten classes, capped — never the markup', () => {
    const img = document.createElement('img');
    img.id = 'hero';
    img.className = Array.from({ length: 12 }, (_, index) => `c${String(index)}`).join(' ');
    img.setAttribute('onerror', 'steal()');
    expect(describeElement(img)).toEqual({
      tag: 'img',
      id: 'hero',
      classes: Array.from({ length: 10 }, (_, index) => `c${String(index)}`)
    });
    img.id = 'x'.repeat(LCP_ANALYSIS_LIMITS.namePoints + 1);
    expect(describeElement(img).id).toBe(`${'x'.repeat(LCP_ANALYSIS_LIMITS.namePoints)}…`);
  });
});

describe('candidateFacts', () => {
  it('sanitizes timings to finite non-negative numbers and caps the URL', () => {
    const facts = candidateFacts(
      entry({ startTime: NaN, renderTime: -1, loadTime: Infinity, size: 5, url: 'u'.repeat(5000) })
    );
    expect(facts).toMatchObject({
      startTime: 0,
      renderTime: 0,
      loadTime: 0,
      size: 5,
      element: null
    });
    expect(facts.url).toBe(`${'u'.repeat(LCP_ANALYSIS_LIMITS.urlPoints)}…`);
  });

  it('reads a missing URL as text', () => {
    expect(candidateFacts(entry({ url: undefined as unknown as string })).url).toBe('');
  });
});

describe('lcpResource', () => {
  it('matches the first entry by the full URL', () => {
    const performance = timeline(
      [],
      [
        { name: 'https://a.test/other.jpg', startTime: 1, requestStart: 1, responseEnd: 1 },
        { name: 'https://a.test/hero.jpg', startTime: 10, requestStart: 0, responseEnd: 30 },
        { name: 'https://a.test/hero.jpg', startTime: 99, requestStart: 99, responseEnd: 99 }
      ]
    );
    expect(lcpResource('https://a.test/hero.jpg', performance)).toEqual({
      name: 'https://a.test/hero.jpg',
      startTime: 10,
      requestStart: 0,
      responseEnd: 30
    });
  });

  it('has none for text or an unknown URL', () => {
    const getEntriesByType = vi.fn(() => []);
    expect(lcpResource('', { getEntriesByType })).toBeNull();
    expect(getEntriesByType).not.toHaveBeenCalled();
    expect(lcpResource('https://a.test/x.jpg', timeline([], []))).toBeNull();
  });
});

describe('takeLcpEntries', () => {
  it('takes entries handed over on observe, then disconnects at once', async () => {
    const { Observer, log } = observerClass([entry()], 'sync');
    const timer = manualTimer();
    await expect(takeLcpEntries(Observer, timer.schedule)).resolves.toHaveLength(1);
    expect(log).toEqual(['observe:largest-contentful-paint:true', 'disconnect']);
    expect(timer.armed).toEqual([]);
  });

  it('waits for a later delivery, then disconnects', async () => {
    const { Observer, log } = observerClass([entry(), entry({ startTime: 1 })], 'async');
    const timer = manualTimer();
    await expect(takeLcpEntries(Observer, timer.schedule)).resolves.toHaveLength(2);
    expect(timer.armed).toEqual([LCP_BUFFER_WAIT_MS]);
    expect(log.at(-1)).toBe('disconnect');
  });

  it('answers nothing after the wait when no entry exists, disconnected', async () => {
    const { Observer, log } = observerClass([], 'never');
    const timer = manualTimer();
    const taken = takeLcpEntries(Observer, timer.schedule);
    timer.fire();
    await expect(taken).resolves.toEqual([]);
    expect(log.at(-1)).toBe('disconnect');
  });

  it('answers nothing when the engine refuses the observer', async () => {
    const { Observer, log } = observerClass([entry()], 'throws');
    await expect(takeLcpEntries(Observer, manualTimer().schedule)).resolves.toEqual([]);
    expect(log.at(-1)).toBe('disconnect');
    // A constructor the engine refuses outright (`new` on it throws).
    const Throwing = function refusedObserver(): never {
      throw new Error('no observer');
    } as unknown as ObserverClass;
    await expect(takeLcpEntries(Throwing, manualTimer().schedule)).resolves.toEqual([]);
  });
});

describe('analyseLcp', () => {
  /** Deps over the given observer class and timeline. */
  function deps(Observer: ObserverClass | undefined, performance = timeline([], [])) {
    return {
      Observer,
      performance,
      highlight: vi.fn((element: Element) => Promise.resolve(element.isConnected)),
      schedule: manualTimer().schedule
    };
  }

  it('is unsupported without an observer or without the entry type', async () => {
    await expect(analyseLcp({ highlight: false }, deps(undefined))).resolves.toEqual({
      kind: 'unsupported'
    });
    const { Observer } = observerClass([], 'sync', ['paint']);
    await expect(analyseLcp({ highlight: false }, deps(Observer))).resolves.toEqual({
      kind: 'unsupported'
    });
  });

  it('answers deduplicated facts, the navigation and the LCP resource', async () => {
    const img = document.createElement('img');
    document.body.append(img);
    const url = 'https://a.test/hero.jpg';
    const { Observer } = observerClass(
      [
        entry({ startTime: 300 }),
        entry({ startTime: 300, size: 2 }),
        entry({ startTime: 900, url, element: img })
      ],
      'sync'
    );
    const performance = timeline(
      [{ responseStart: 120, activationStart: 30 }],
      [{ name: url, startTime: 200, requestStart: 210, responseEnd: 500 }]
    );
    const d = deps(Observer, performance);
    const reply = await analyseLcp({ highlight: false }, d);
    expect(reply).toEqual({
      kind: 'measured',
      navigation: { responseStart: 120, activationStart: 30 },
      candidates: [
        candidateFacts(entry({ startTime: 300, size: 2 })),
        candidateFacts(entry({ startTime: 900, url, element: img }))
      ],
      resource: { name: url, startTime: 200, requestStart: 210, responseEnd: 500 },
      highlight: 'off'
    });
    expect(d.highlight).not.toHaveBeenCalled();
  });

  it('reads the activation offset as 0 where the engine has none (or a bad one)', () => {
    expect(navigationTiming(timeline([{ responseStart: 50 }], []))).toEqual({
      responseStart: 50,
      activationStart: 0
    });
    expect(navigationTiming(timeline([{ responseStart: 50, activationStart: -3 }], []))).toEqual({
      responseStart: 50,
      activationStart: 0
    });
    expect(navigationTiming(timeline([], []))).toBeNull();
  });

  it('keeps the latest candidates past the cap (the LCP stays last)', async () => {
    const entries = Array.from({ length: LCP_ANALYSIS_LIMITS.candidates + 5 }, (_, index) =>
      entry({ startTime: index + 1 })
    );
    const { Observer } = observerClass(entries, 'sync');
    const reply = await analyseLcp({ highlight: false }, deps(Observer));
    if (reply.kind !== 'measured') throw new Error('not measured');
    expect(reply.candidates).toHaveLength(LCP_ANALYSIS_LIMITS.candidates);
    expect(reply.candidates.at(-1)?.startTime).toBe(LCP_ANALYSIS_LIMITS.candidates + 5);
  });

  it('answers no candidate, no navigation and no resource on an empty page', async () => {
    const { Observer } = observerClass([], 'never');
    const timer = manualTimer();
    const replying = analyseLcp(
      { highlight: true },
      { ...deps(Observer), schedule: timer.schedule }
    );
    timer.fire();
    await expect(replying).resolves.toEqual({
      kind: 'measured',
      navigation: null,
      candidates: [],
      resource: null,
      highlight: 'unavailable'
    });
  });

  it('frames the LCP element only when asked and still on the page', async () => {
    const img = document.createElement('img');
    document.body.append(img);
    const { Observer } = observerClass([entry({ element: img })], 'sync');
    const d = deps(Observer);
    await expect(analyseLcp({ highlight: true }, d)).resolves.toMatchObject({ highlight: 'shown' });
    expect(d.highlight).toHaveBeenCalledWith(img);

    img.remove();
    const gone = deps(observerClass([entry({ element: img })], 'sync').Observer);
    await expect(analyseLcp({ highlight: true }, gone)).resolves.toMatchObject({
      highlight: 'unavailable'
    });
    expect(gone.highlight).not.toHaveBeenCalled();
  });

  it('reads a highlighter failure as unavailable', async () => {
    const img = document.createElement('img');
    document.body.append(img);
    const { Observer } = observerClass([entry({ element: img })], 'sync');
    const refusing = { ...deps(Observer), highlight: () => Promise.resolve(false) };
    await expect(analyseLcp({ highlight: true }, refusing)).resolves.toMatchObject({
      highlight: 'unavailable'
    });
    const throwing = { ...deps(Observer), highlight: () => Promise.reject(new Error('x')) };
    await expect(analyseLcp({ highlight: true }, throwing)).resolves.toMatchObject({
      highlight: 'unavailable'
    });
  });
});
