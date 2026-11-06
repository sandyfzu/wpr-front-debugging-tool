/**
 * This visit's Core Web Vitals entries, collected from document start: one
 * performance observer (buffered, so entries from before it count too) for
 * LCP candidates, layout shifts and interactions — interactions observed
 * from 16 ms, below the 104 ms the buffer keeps, so short ones count. Each
 * entry is copied to plain numbers at once (no element reference is kept)
 * into bounded lists; a read flushes pending records and answers the
 * reducer's input. Stops with the content script's context.
 *
 * Past a list's bound, what each metric needs survives: the latest LCP
 * candidates (the LCP is the last one); every unexpected layout shift, the
 * oldest folded into the CLS session state the reducer continues from (CLS
 * stays exact; shifts right after input never count, so they are not kept);
 * the slowest interactions, the others only counted (once each). A back/forward-cache
 * restore starts a new visit ({@link VitalsCollector.restart}).
 *
 * Pure over its seams (the observer class, the timeline, the document, the
 * first-hidden tracker), so it is unit-tested with fakes.
 */
import {
  CURRENT_VISIT_LIMITS,
  type CurrentVisitVitalsReply
} from '../../../lib/messaging/current-visit-vitals';
import {
  CLS_START,
  foldClsShift,
  resolveFirstHiddenTime,
  type ClsSessions,
  type VitalsInput
} from '../../../lib/web-vitals/current-visit';
import { domTiming } from '../../../utils/dom-timing';

/** The entry types observed, by metric. */
const ENTRY_TYPES = {
  lcp: 'largest-contentful-paint',
  cls: 'layout-shift',
  event: 'event',
  firstInput: 'first-input'
} as const;

/** The interaction latency floor observed (ms): the lowest the platform accepts. */
export const EVENT_DURATION_THRESHOLD_MS = 16;

/**
 * How many recently dropped interaction ids are remembered so their later
 * events do not count them again. One interaction's events (pointerdown,
 * pointerup, click; keydown, keyup) arrive together, but overlapping key
 * presses interleave theirs — 16 covers keyboard rollover with room, at a
 * fixed cost.
 */
export const RECENT_DROPS = 16;

/** The observer the collector creates (the platform's `PerformanceObserver`, or a fake). */
export interface VitalsObserverLike {
  observe(options: { type: string; buffered: boolean; durationThreshold?: number }): void;
  takeRecords(): readonly unknown[];
  disconnect(): void;
}

/** The observer class: constructor plus the supported entry types. */
export interface VitalsObserverClass {
  new (callback: (list: { getEntries(): readonly unknown[] }) => void): VitalsObserverLike;
  readonly supportedEntryTypes?: readonly string[];
}

/** What the collector runs against (tests inject doubles). */
export interface VitalsCollectorDeps {
  /** `PerformanceObserver`, or undefined where the engine has none. */
  readonly Observer: VitalsObserverClass | undefined;
  /** The page's performance timeline (`interactionCount` where the engine has it). */
  readonly performance: Pick<Performance, 'getEntriesByType' | 'getEntriesByName'> & {
    readonly interactionCount?: number;
  };
  readonly document: Pick<Document, 'visibilityState'> & { readonly prerendering?: boolean };
  /** Whether `PerformanceEventTiming` entries carry interaction ids. */
  readonly hasInteractionIds: boolean;
  /** The first-hidden tracker's reading (engines without `visibility-state` entries), else null. */
  readonly trackedFirstHidden: () => number | null;
  /** Reports an observer that could not start (the metric then reads no data). */
  readonly onError: (cause: unknown) => void;
}

/** The collector. */
export interface VitalsCollector {
  /** This visit's entries so far, as the reducer's input. */
  readonly read: () => CurrentVisitVitalsReply;
  /**
   * Start a new visit (a back/forward-cache restore): forget every entry,
   * count interactions and hides from now on.
   *
   * @param restoredAt The `pageshow` event's time stamp.
   */
  readonly restart: (restoredAt: number) => void;
  /** Stop observing (idempotent). */
  readonly stop: () => void;
}

/**
 * The interaction whose latency is the lowest (the first such, in insertion order).
 *
 * @param interactions Latency by interaction id (non-empty).
 * @returns Its id and latency.
 */
function leastSlow(interactions: ReadonlyMap<number, number>): [number, number] {
  let least: [number, number] = [0, Infinity];
  for (const entry of interactions) if (entry[1] < least[1]) least = entry;
  return least;
}

/** The entry fields the collector reads (all optional: entries are untyped here). */
interface RawEntry {
  readonly entryType?: unknown;
  readonly startTime?: unknown;
  readonly duration?: unknown;
  readonly value?: unknown;
  readonly hadRecentInput?: unknown;
  readonly interactionId?: unknown;
}

/**
 * Start collecting.
 *
 * @param deps See {@link VitalsCollectorDeps}.
 * @returns The collector (a no-op one where the engine has no observer).
 */
export function createVitalsCollector(deps: VitalsCollectorDeps): VitalsCollector {
  const types = deps.Observer?.supportedEntryTypes ?? [];
  const supported = {
    lcp: types.includes(ENTRY_TYPES.lcp),
    cls: types.includes(ENTRY_TYPES.cls),
    inp: types.includes(ENTRY_TYPES.event) && deps.hasInteractionIds
  };
  type Shift = VitalsInput['layoutShifts'][number];
  let lcpEntries: { startTime: number }[] = [];
  // Unexpected shifts only, in report order; older ones folded into clsCarry.
  let layoutShifts: Shift[] = [];
  let clsCarry: ClsSessions | null = null;
  // Each interaction's longest event; past the bound, the slowest only.
  const interactions = new Map<number, number>();
  let interactionsDropped = 0;
  // Ids already counted in interactionsDropped, newest last (at most RECENT_DROPS).
  const recentDrops = new Set<number>();
  let capped = false;
  // The visit's start after a back/forward-cache restore (null: the load).
  let restoredAt: number | null = null;
  let interactionBase = 0;

  /** Keep an LCP candidate; past the bound, drop the oldest. */
  const keepLcp = (entry: RawEntry): void => {
    if (lcpEntries.length >= CURRENT_VISIT_LIMITS.lcpEntries) {
      lcpEntries.shift();
      capped = true;
    }
    lcpEntries.push({ startTime: domTiming(entry.startTime) });
  };

  /** Keep an unexpected shift; past the bound, fold the oldest into the carry. */
  const keepShift = (entry: RawEntry): void => {
    if (entry.hadRecentInput === true) return;
    if (layoutShifts.length >= CURRENT_VISIT_LIMITS.layoutShifts) {
      const oldest = layoutShifts.shift();
      if (oldest !== undefined) clsCarry = foldClsShift(clsCarry ?? CLS_START, oldest);
    }
    layoutShifts.push({
      startTime: domTiming(entry.startTime),
      value: domTiming(entry.value),
      hadRecentInput: false
    });
  };

  /**
   * Remember a dropped interaction's id as counted, forgetting the oldest
   * past {@link RECENT_DROPS}.
   *
   * @param id The dropped interaction's id.
   */
  const noteDrop = (id: number): void => {
    recentDrops.add(id);
    if (recentDrops.size <= RECENT_DROPS) return;
    const [oldest] = recentDrops;
    if (oldest !== undefined) recentDrops.delete(oldest);
  };

  /**
   * Keep an interaction's longest event; past the bound, keep the slowest
   * ones (INP reads only the 10 slowest) and count the others once each: a
   * later event of a recently dropped interaction is not counted again, and
   * one that now makes it in swaps places with the interaction it evicts.
   */
  const keepInteraction = (entry: RawEntry): void => {
    const id = entry.interactionId;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return;
    const duration = domTiming(entry.duration);
    const known = interactions.get(id);
    if (known === undefined && interactions.size >= CURRENT_VISIT_LIMITS.interactions) {
      capped = true;
      // Each event either drops this interaction or evicts another: one drop,
      // unless this one was already counted (then the count stays).
      if (!recentDrops.delete(id)) interactionsDropped += 1;
      const [leastId, leastLatency] = leastSlow(interactions);
      if (duration <= leastLatency) {
        noteDrop(id);
        return;
      }
      interactions.delete(leastId);
      noteDrop(leastId);
    }
    interactions.set(id, Math.max(known ?? 0, duration));
  };

  /** Keep one entry's numbers. */
  const keep = (entry: RawEntry): void => {
    switch (entry.entryType) {
      case ENTRY_TYPES.lcp:
        keepLcp(entry);
        return;
      case ENTRY_TYPES.cls:
        keepShift(entry);
        return;
      default:
        keepInteraction(entry);
    }
  };
  const keepAll = (entries: readonly unknown[]): void => {
    for (const entry of entries) keep(entry as RawEntry);
  };

  let observer: VitalsObserverLike | null = null;
  if (deps.Observer !== undefined) {
    try {
      observer = new deps.Observer((list) => {
        // Guarded: an observer callback that throws would reach the page's console.
        try {
          keepAll(list.getEntries());
        } catch (cause) {
          deps.onError(cause);
        }
      });
    } catch (cause) {
      deps.onError(cause);
    }
  }
  /** Observe one supported type; a refusal leaves that metric without data. */
  const observe = (type: string, extra?: { durationThreshold: number }): void => {
    if (observer === null || !types.includes(type)) return;
    try {
      observer.observe({ type, buffered: true, ...extra });
    } catch (cause) {
      deps.onError(cause);
    }
  };
  if (supported.lcp) observe(ENTRY_TYPES.lcp);
  if (supported.cls) observe(ENTRY_TYPES.cls);
  if (supported.inp) {
    observe(ENTRY_TYPES.event, { durationThreshold: EVENT_DURATION_THRESHOLD_MS });
    observe(ENTRY_TYPES.firstInput);
  }

  /** The reducer's visibility and activation fields, read now. */
  const timeline = (): Pick<VitalsInput, 'activationStart' | 'firstHiddenTime' | 'fcpTime'> => {
    const navigation = deps.performance.getEntriesByType('navigation')[0] as
      { readonly activationStart?: unknown } | undefined;
    const activationStart = domTiming(navigation?.activationStart);
    // After a restore, only a hide since the restore counts.
    const visibleFrom = Math.max(activationStart, restoredAt ?? 0);
    const hiddenEntry = deps.performance
      .getEntriesByType('visibility-state')
      .find((entry) => entry.name === 'hidden' && entry.startTime >= visibleFrom);
    const hiddenNow =
      deps.document.visibilityState === 'hidden' && deps.document.prerendering !== true;
    const fcp = deps.performance.getEntriesByName('first-contentful-paint', 'paint')[0];
    return {
      activationStart,
      firstHiddenTime: resolveFirstHiddenTime(
        hiddenEntry === undefined ? null : domTiming(hiddenEntry.startTime),
        deps.trackedFirstHidden(),
        hiddenNow
      ),
      fcpTime: fcp === undefined ? null : domTiming(fcp.startTime)
    };
  };

  /** `performance.interactionCount`, where the engine has a usable one. */
  const browserInteractions = (): number | null => {
    const count = deps.performance.interactionCount;
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null;
  };
  /** The browser's interaction count since the visit's start. */
  const interactionCount = (): number | null => {
    const count = browserInteractions();
    return count === null ? null : Math.max(count - interactionBase, 0);
  };

  return {
    read: () => {
      // Records queued but not yet delivered belong to this read.
      if (observer !== null) keepAll(observer.takeRecords());
      const input: VitalsInput = {
        supported,
        ...timeline(),
        lcpEntries: [...lcpEntries],
        layoutShifts: [...layoutShifts],
        events: [...interactions].map(([interactionId, duration]) => ({
          interactionId,
          duration
        })),
        interactionCount: interactionCount(),
        // Optional fields only when they carry something (the guard refuses undefined).
        ...(clsCarry === null ? {} : { clsCarry }),
        ...(interactionsDropped === 0 ? {} : { interactionsDropped }),
        ...(restoredAt === null ? {} : { restoredAt })
      };
      return { input, capped };
    },
    restart: (at) => {
      // Records queued before the restore belong to the previous visit.
      if (observer !== null) observer.takeRecords();
      lcpEntries = [];
      layoutShifts = [];
      clsCarry = null;
      interactions.clear();
      interactionsDropped = 0;
      recentDrops.clear();
      capped = false;
      restoredAt = domTiming(at);
      interactionBase = browserInteractions() ?? 0;
    },
    stop: () => {
      observer?.disconnect();
      observer = null;
    }
  };
}
