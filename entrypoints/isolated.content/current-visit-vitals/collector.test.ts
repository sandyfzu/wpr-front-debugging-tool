/**
 * The vitals collector over a fake observer: only supported types are
 * observed (buffered; interactions from 16 ms, first input too), entries
 * are copied to plain numbers (no element kept), interactions keep their
 * longest event, pending records count at a read, the lists are bounded
 * keeping what each metric needs (latest LCP candidates, CLS folded exactly,
 * slowest interactions counted), a restore starts a new visit,
 * visibility/activation/FCP are read from the
 * timeline (Chromium: entries; elsewhere: the tracker), observer failures
 * are reported, and stopping disconnects.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_VISIT_LIMITS,
  parseCurrentVisitVitalsReply
} from '../../../lib/messaging/current-visit-vitals';
import { reduceCls, reduceCurrentVisit } from '../../../lib/web-vitals/current-visit';
import {
  EVENT_DURATION_THRESHOLD_MS,
  RECENT_DROPS,
  createVitalsCollector,
  type VitalsCollectorDeps,
  type VitalsObserverClass
} from './collector';

/** Every entry type Chromium supports that the collector cares about. */
const CHROMIUM_TYPES = [
  'event',
  'first-input',
  'largest-contentful-paint',
  'layout-shift',
  'paint',
  'visibility-state'
];

/** A fake observer class exposing its one instance. */
function observerClass(types: readonly string[] = CHROMIUM_TYPES, refuse: readonly string[] = []) {
  const state: {
    observed: unknown[];
    pending: unknown[];
    deliver: (entries: unknown[]) => void;
    disconnected: number;
  } = { observed: [], pending: [], deliver: () => undefined, disconnected: 0 };
  class FakeObserver {
    static readonly supportedEntryTypes = types;
    constructor(callback: (list: { getEntries(): readonly unknown[] }) => void) {
      state.deliver = (entries) => {
        callback({ getEntries: () => entries });
      };
    }
    observe(options: { type: string }): void {
      if (refuse.includes(options.type)) throw new TypeError(`refused ${options.type}`);
      state.observed.push(options);
    }
    takeRecords(): unknown[] {
      const taken = state.pending;
      state.pending = [];
      return taken;
    }
    disconnect(): void {
      state.disconnected += 1;
    }
  }
  return { Observer: FakeObserver as VitalsObserverClass, state };
}

/** A timeline with these entries by type; `interactionCount` when given. */
function timeline(byType: Record<string, unknown[]> = {}, interactionCount?: number) {
  return {
    getEntriesByType: (type: string) => byType[type] ?? [],
    getEntriesByName: (name: string, type?: string) =>
      (byType[type ?? ''] ?? []).filter((entry) => (entry as { name: string }).name === name),
    ...(interactionCount !== undefined && { interactionCount })
  } as unknown as VitalsCollectorDeps['performance'];
}

/** A timeline whose `interactionCount` reads the counter live. */
function liveCount(
  performance: VitalsCollectorDeps['performance'],
  counter: { interactionCount: number }
): VitalsCollectorDeps['performance'] {
  return Object.defineProperty(performance, 'interactionCount', {
    get: () => counter.interactionCount
  });
}

/** Deps over the fake observer and an empty visible page. */
function deps(overrides: Partial<VitalsCollectorDeps> = {}): VitalsCollectorDeps {
  return {
    Observer: observerClass().Observer,
    performance: timeline(),
    document: { visibilityState: 'visible' },
    hasInteractionIds: true,
    trackedFirstHidden: () => null,
    onError: vi.fn(),
    ...overrides
  };
}

describe('createVitalsCollector', () => {
  it('observes every supported metric, buffered, interactions from 16 ms', () => {
    const { Observer, state } = observerClass();
    createVitalsCollector(deps({ Observer }));
    expect(state.observed).toEqual([
      { type: 'largest-contentful-paint', buffered: true },
      { type: 'layout-shift', buffered: true },
      { type: 'event', buffered: true, durationThreshold: EVENT_DURATION_THRESHOLD_MS },
      { type: 'first-input', buffered: true }
    ]);
    expect(EVENT_DURATION_THRESHOLD_MS).toBe(16);
  });

  it('marks absent metrics unsupported and observes nothing for them (Firefox-like)', () => {
    const { Observer, state } = observerClass(['largest-contentful-paint', 'event', 'paint']);
    const collector = createVitalsCollector(deps({ Observer, hasInteractionIds: false }));
    expect(state.observed).toEqual([{ type: 'largest-contentful-paint', buffered: true }]);
    expect(collector.read().input.supported).toEqual({ lcp: true, cls: false, inp: false });
  });

  it('is all-unsupported without an observer', () => {
    const collector = createVitalsCollector(deps({ Observer: undefined }));
    expect(collector.read().input.supported).toEqual({ lcp: false, cls: false, inp: false });
    collector.stop();
  });

  it('copies entries to plain numbers, longest event per interaction', () => {
    const { Observer, state } = observerClass();
    const collector = createVitalsCollector(deps({ Observer, performance: timeline({}, 4) }));
    const node = document.createElement('img');
    state.deliver([
      { entryType: 'largest-contentful-paint', startTime: 700, element: node, url: 'a.jpg' },
      {
        entryType: 'layout-shift',
        startTime: 800,
        value: 0.12,
        hadRecentInput: false,
        sources: [{ node }]
      },
      { entryType: 'layout-shift', startTime: 900, value: NaN, hadRecentInput: 1 },
      { entryType: 'first-input', startTime: 1000, duration: 40, interactionId: 5 },
      { entryType: 'event', startTime: 1000, duration: 120, interactionId: 5 },
      { entryType: 'event', startTime: 1001, duration: 30, interactionId: 5 },
      { entryType: 'event', startTime: 1500, duration: 64, interactionId: 6 },
      { entryType: 'event', startTime: 1600, duration: 300, interactionId: 0 },
      { entryType: 'event', startTime: 1600, duration: 300 }
    ]);
    state.pending = [{ entryType: 'largest-contentful-paint', startTime: 1200 }];
    const { input, capped } = collector.read();
    expect(input).toMatchObject({
      lcpEntries: [{ startTime: 700 }, { startTime: 1200 }],
      layoutShifts: [
        { startTime: 800, value: 0.12, hadRecentInput: false },
        { startTime: 900, value: 0, hadRecentInput: false }
      ],
      events: [
        { interactionId: 5, duration: 120 },
        { interactionId: 6, duration: 64 }
      ],
      interactionCount: 4
    });
    expect(capped).toBe(false);
    expect(JSON.stringify(input)).not.toContain('a.jpg');
    // A read hands out copies: later entries never change an earlier answer.
    state.deliver([{ entryType: 'largest-contentful-paint', startTime: 2000 }]);
    expect(input.lcpEntries).toHaveLength(2);
  });

  it('keeps the latest LCP candidates past the bound and says so', () => {
    const { Observer, state } = observerClass();
    const collector = createVitalsCollector(deps({ Observer }));
    const total = CURRENT_VISIT_LIMITS.lcpEntries + 3;
    state.deliver(
      Array.from({ length: total }, (_, index) => ({
        entryType: 'largest-contentful-paint',
        startTime: index + 1
      }))
    );
    const { input, capped } = collector.read();
    expect(capped).toBe(true);
    expect(input.lcpEntries).toHaveLength(CURRENT_VISIT_LIMITS.lcpEntries);
    expect(input.lcpEntries[0]).toEqual({ startTime: 4 });
    expect(input.lcpEntries.at(-1)).toEqual({ startTime: total });
    expect(reduceCurrentVisit(input).lcp).toMatchObject({ value: total });
  });

  /** Unexpected shifts every 2 s (one window each), with a 5-shift burst at `burstAt`. */
  function shiftStream(count: number, burstAt: number): Record<string, unknown>[] {
    return Array.from({ length: count }, (_, index) => {
      const inBurst = index >= burstAt && index < burstAt + 5;
      return {
        entryType: 'layout-shift',
        startTime: inBurst ? burstAt * 2000 + (index - burstAt) * 100 : index * 2000,
        value: inBurst ? 0.2 : 0.01,
        hadRecentInput: false
      };
    });
  }

  it.each([
    ['a burst folded into the carry', 0],
    ['a burst past the bound', CURRENT_VISIT_LIMITS.layoutShifts + 10]
  ])('keeps CLS exact past the shift bound (%s), never capped', (_label, burstAt) => {
    const { Observer, state } = observerClass();
    const collector = createVitalsCollector(deps({ Observer }));
    const stream = shiftStream(CURRENT_VISIT_LIMITS.layoutShifts + 20, burstAt);
    // Shifts right after input never count, so they take no room in the list.
    state.deliver([
      ...stream,
      { entryType: 'layout-shift', startTime: 1, value: 5, hadRecentInput: true }
    ]);
    const reply = collector.read();
    expect(reply.capped).toBe(false);
    expect(reply.input.layoutShifts).toHaveLength(CURRENT_VISIT_LIMITS.layoutShifts);
    expect(reply.input.clsCarry).toBeDefined();
    expect(parseCurrentVisitVitalsReply(reply)).toEqual(reply);
    const all = stream.map((entry) => ({
      startTime: entry.startTime as number,
      value: entry.value as number,
      hadRecentInput: false
    }));
    expect(reduceCls(reply.input.layoutShifts, reply.input.clsCarry)).toBeCloseTo(reduceCls(all));
    expect(reduceCurrentVisit({ ...reply.input, fcpTime: 1 }).cls).toMatchObject({
      value: expect.closeTo(1, 9) as number
    });
  });

  it('keeps the slowest interactions past the bound, counting the others', () => {
    const { Observer, state } = observerClass();
    const collector = createVitalsCollector(deps({ Observer }));
    state.deliver(
      Array.from({ length: CURRENT_VISIT_LIMITS.interactions }, (_, index) => ({
        entryType: 'event',
        duration: 20,
        interactionId: index + 1
      }))
    );
    expect(collector.read().capped).toBe(false);
    expect(collector.read().input.interactionsDropped).toBeUndefined();
    state.deliver([
      // A known interaction still updates.
      { entryType: 'event', duration: 500, interactionId: 1 },
      // A new slow one replaces a least slow one; a new fast one is only counted.
      { entryType: 'event', duration: 900, interactionId: 999_999 },
      { entryType: 'event', duration: 16, interactionId: 1_000_000 }
    ]);
    const reply = collector.read();
    const { input, capped } = reply;
    expect(capped).toBe(true);
    expect(input.events).toHaveLength(CURRENT_VISIT_LIMITS.interactions);
    expect(input.events[0]).toEqual({ interactionId: 1, duration: 500 });
    expect(input.events).toContainEqual({ interactionId: 999_999, duration: 900 });
    expect(input.events).not.toContainEqual(expect.objectContaining({ interactionId: 2 }));
    expect(input.events).not.toContainEqual(expect.objectContaining({ interactionId: 1_000_000 }));
    expect(input.interactionsDropped).toBe(2);
    expect(parseCurrentVisitVitalsReply(reply)).toEqual(reply);
    expect(reduceCurrentVisit(input).inp).toMatchObject({
      value: 20,
      interactions: CURRENT_VISIT_LIMITS.interactions + 2
    });
  });

  it('counts a dropped interaction once, however many events it has', () => {
    const { Observer, state } = observerClass();
    const collector = createVitalsCollector(deps({ Observer }));
    const full = CURRENT_VISIT_LIMITS.interactions;
    state.deliver(
      Array.from({ length: full }, (_, index) => ({
        entryType: 'event',
        duration: 20,
        interactionId: index + 1
      }))
    );
    /** One fast event of an interaction (below every kept latency). */
    const fast = (interactionId: number) => ({ entryType: 'event', duration: 16, interactionId });
    // 100 taps (pointerdown, pointerup, click), each delivered together.
    for (let tap = 0; tap < 100; tap += 1) {
      const id = 1_000_000 + tap;
      state.deliver([fast(id), fast(id), fast(id)]);
    }
    // Overlapping key presses interleave: keydown A, keydown B, keyup A, keyup B.
    state.deliver([fast(2_000_001), fast(2_000_002), fast(2_000_001), fast(2_000_002)]);
    expect(collector.read().input.interactionsDropped).toBe(102);
    // A dropped interaction whose later event is slow gets in: it evicts one
    // kept interaction, so the distinct dropped count stays.
    state.deliver([
      fast(3_000_000),
      { entryType: 'event', duration: 900, interactionId: 3_000_000 }
    ]);
    const { input } = collector.read();
    expect(input.interactionsDropped).toBe(103);
    expect(input.events).toContainEqual({ interactionId: 3_000_000, duration: 900 });
    expect(input.events).toHaveLength(full);
    expect(reduceCurrentVisit(input).inp).toMatchObject({ interactions: full + 103 });
  });

  it('remembers only the latest dropped interactions', () => {
    const { Observer, state } = observerClass();
    const collector = createVitalsCollector(deps({ Observer }));
    state.deliver(
      Array.from({ length: CURRENT_VISIT_LIMITS.interactions }, (_, index) => ({
        entryType: 'event',
        duration: 20,
        interactionId: index + 1
      }))
    );
    const ids = Array.from({ length: RECENT_DROPS + 1 }, (_, index) => 1_000_000 + index);
    state.deliver(
      ids.map((interactionId) => ({ entryType: 'event', duration: 16, interactionId }))
    );
    // The newest are still known; the oldest was forgotten, so it counts again.
    state.deliver([{ entryType: 'event', duration: 16, interactionId: ids[RECENT_DROPS] }]);
    expect(collector.read().input.interactionsDropped).toBe(RECENT_DROPS + 1);
    state.deliver([{ entryType: 'event', duration: 16, interactionId: ids[0] }]);
    expect(collector.read().input.interactionsDropped).toBe(RECENT_DROPS + 2);
  });

  it('starts a new visit on a restore: entries, bounds and counts from then on', () => {
    const { Observer, state } = observerClass();
    const counter = { interactionCount: 7 };
    const performance = liveCount(
      timeline({
        'visibility-state': [
          { name: 'hidden', startTime: 3000 },
          { name: 'hidden', startTime: 9000 }
        ]
      }),
      counter
    );
    const collector = createVitalsCollector(deps({ Observer, performance }));
    state.deliver([
      ...Array.from({ length: CURRENT_VISIT_LIMITS.lcpEntries + 1 }, (_, index) => ({
        entryType: 'largest-contentful-paint',
        startTime: index
      })),
      { entryType: 'layout-shift', startTime: 800, value: 0.3, hadRecentInput: false },
      { entryType: 'event', duration: 300, interactionId: 3 }
    ]);
    expect(collector.read()).toMatchObject({ capped: true, input: { firstHiddenTime: 3000 } });
    // Queued before the restore: the previous visit's.
    state.pending = [{ entryType: 'largest-contentful-paint', startTime: 2500 }];
    collector.restart(5000);
    counter.interactionCount = 9;
    state.deliver([{ entryType: 'layout-shift', startTime: 5200, value: 0.05 }]);
    const { input, capped } = collector.read();
    expect(capped).toBe(false);
    expect(input).toMatchObject({
      restoredAt: 5000,
      lcpEntries: [],
      layoutShifts: [{ startTime: 5200, value: 0.05, hadRecentInput: false }],
      events: [],
      interactionCount: 2,
      firstHiddenTime: 9000
    });
    expect(input.clsCarry).toBeUndefined();
    expect(input.interactionsDropped).toBeUndefined();
  });

  it('never counts a restore before the interaction count below zero', () => {
    const counter = { interactionCount: 7 };
    const performance = liveCount(timeline(), counter);
    const collector = createVitalsCollector(deps({ performance }));
    collector.restart(100);
    counter.interactionCount = 3;
    expect(collector.read().input.interactionCount).toBe(0);
  });

  it('reads activation, FCP and the first hide from the timeline', () => {
    const performance = timeline({
      navigation: [{ activationStart: 50 }],
      paint: [
        { name: 'first-paint', startTime: 90 },
        { name: 'first-contentful-paint', startTime: 120 }
      ],
      'visibility-state': [
        { name: 'visible', startTime: 0 },
        { name: 'hidden', startTime: 20 },
        { name: 'hidden', startTime: 3000 }
      ]
    });
    const { input } = createVitalsCollector(deps({ performance })).read();
    expect(input).toMatchObject({ activationStart: 50, fcpTime: 120, firstHiddenTime: 3000 });
  });

  it('takes the earlier of the hidden entry and the tracker, and a hidden page as 0', () => {
    const performance = timeline({ 'visibility-state': [{ name: 'hidden', startTime: 900 }] });
    expect(
      createVitalsCollector(deps({ performance, trackedFirstHidden: () => 400 })).read().input
    ).toMatchObject({ firstHiddenTime: 400, activationStart: 0, fcpTime: null });
    expect(
      createVitalsCollector(deps({ trackedFirstHidden: () => 400 })).read().input.firstHiddenTime
    ).toBe(400);
    const hidden = deps({ document: { visibilityState: 'hidden' } });
    expect(createVitalsCollector(hidden).read().input.firstHiddenTime).toBe(0);
    const prerendering = deps({ document: { visibilityState: 'hidden', prerendering: true } });
    expect(createVitalsCollector(prerendering).read().input.firstHiddenTime).toBeNull();
    expect(createVitalsCollector(deps()).read().input.firstHiddenTime).toBeNull();
  });

  it('reads a junk interaction count as none', () => {
    const junk = timeline({}, -1);
    expect(
      createVitalsCollector(deps({ performance: junk })).read().input.interactionCount
    ).toBeNull();
    expect(createVitalsCollector(deps()).read().input.interactionCount).toBeNull();
  });

  it('reports an observer the engine refuses, keeping the other metrics', () => {
    const { Observer, state } = observerClass(CHROMIUM_TYPES, ['layout-shift']);
    const onError = vi.fn();
    createVitalsCollector(deps({ Observer, onError }));
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError));
    expect(state.observed).toHaveLength(3);
    // A constructor the engine refuses outright (`new` on it throws).
    const Throwing = Object.assign(
      function refusedObserver(): never {
        throw new Error('no observer');
      },
      { supportedEntryTypes: CHROMIUM_TYPES }
    ) as unknown as VitalsObserverClass;
    const failing = vi.fn();
    const collector = createVitalsCollector(deps({ Observer: Throwing, onError: failing }));
    expect(failing).toHaveBeenCalledTimes(1);
    expect(collector.read().input.lcpEntries).toEqual([]);
  });

  it('reports a delivery that throws instead of reaching the page', () => {
    const { Observer, state } = observerClass();
    const onError = vi.fn();
    createVitalsCollector(deps({ Observer, onError }));
    const hostile = {
      get entryType(): string {
        throw new Error('hostile');
      }
    };
    expect(() => {
      state.deliver([hostile]);
    }).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('disconnects on stop, once', () => {
    const { Observer, state } = observerClass();
    const collector = createVitalsCollector(deps({ Observer }));
    collector.stop();
    collector.stop();
    expect(state.disconnected).toBe(1);
    expect(collector.read().input.lcpEntries).toEqual([]);
  });
});
