/**
 * The page side of an LCP analysis: one buffered `largest-contentful-paint`
 * observer — its entries taken, then disconnected — plus the navigation's
 * (first byte, prerender activation offset) and the LCP resource's timing, answered as plain facts (the panel
 * computes the breakdown). An element is described by its tag, id and first
 * classes — never its markup. On request the LCP element is framed for a
 * few seconds (the highlighter owns the frame and its cleanup).
 *
 * Pure over its seams (the observer class, the performance timeline, the
 * highlighter, the timer), so it is unit-tested with fakes.
 */
import { scheduleWithTimeout, type ScheduleTimer } from '../../../lib/messaging/bounded-ask';
import {
  LCP_ANALYSIS_LIMITS,
  type LcpAnalysisReply,
  type LcpAnalysisRequest,
  type LcpCandidateFacts,
  type LcpElementFacts,
  type LcpHighlight
} from '../../../lib/messaging/lcp-analysis';
import {
  dedupeCandidates,
  type NavigationTiming,
  type ResourceTiming
} from '../../../lib/lcp-analysis/breakdown';
import { LCP_BUFFER_WAIT_MS } from '../../../lib/lcp-analysis/deadlines';
import { capText } from '../../../utils/cap-text';
import { domTiming } from '../../../utils/dom-timing';

/** The entry type observed. */
const LCP_ENTRY_TYPE = 'largest-contentful-paint';

/** The fields of an LCP entry the analysis reads. */
export interface LcpEntryLike {
  readonly startTime: number;
  readonly renderTime: number;
  readonly loadTime: number;
  readonly size: number;
  readonly url: string;
  readonly element: Element | null;
}

/** The observer the analysis creates (the platform's `PerformanceObserver`, or a fake). */
export interface ObserverLike {
  observe(options: { type: string; buffered: boolean }): void;
  takeRecords(): readonly unknown[];
  disconnect(): void;
}

/** The observer class: constructor plus the supported entry types. */
export interface ObserverClass {
  new (callback: (list: { getEntries(): readonly unknown[] }) => void): ObserverLike;
  readonly supportedEntryTypes?: readonly string[];
}

/** What the executor runs against (tests inject doubles). */
export interface LcpAnalysisDeps {
  /** `PerformanceObserver`, or undefined where the engine has none. */
  readonly Observer: ObserverClass | undefined;
  /** The page's performance timeline. */
  readonly performance: Pick<Performance, 'getEntriesByType'>;
  /** Frame the element; resolves whether the frame is up. */
  readonly highlight: (element: Element) => Promise<boolean>;
  /** Timer seam for the buffer wait (default `setTimeout`). */
  readonly schedule?: ScheduleTimer;
}

/**
 * Describe an element without its markup.
 *
 * @param element The element.
 * @returns Its local name, id and first class names, capped.
 */
export function describeElement(element: Element): LcpElementFacts {
  const max = LCP_ANALYSIS_LIMITS.namePoints;
  return {
    tag: capText(element.localName, max),
    id: capText(element.id, max),
    classes: [...element.classList]
      .slice(0, LCP_ANALYSIS_LIMITS.classes)
      .map((name) => capText(name, max))
  };
}

/**
 * An entry's facts.
 *
 * @param entry The LCP entry.
 */
export function candidateFacts(entry: LcpEntryLike): LcpCandidateFacts {
  return {
    startTime: domTiming(entry.startTime),
    renderTime: domTiming(entry.renderTime),
    loadTime: domTiming(entry.loadTime),
    size: domTiming(entry.size),
    url: capText(typeof entry.url === 'string' ? entry.url : '', LCP_ANALYSIS_LIMITS.urlPoints),
    element: entry.element === null ? null : describeElement(entry.element)
  };
}

/**
 * The LCP URL's first resource entry, as the contract carries it.
 *
 * @param url The LCP entry's full URL (`''` for text).
 * @param performance The timeline.
 * @returns The timing, or null for text or when no entry has that name.
 */
export function lcpResource(
  url: string,
  performance: LcpAnalysisDeps['performance']
): ResourceTiming | null {
  if (url === '') return null;
  const entry = performance
    .getEntriesByType('resource')
    .find((candidate) => candidate.name === url) as PerformanceResourceTiming | undefined;
  if (entry === undefined) return null;
  return {
    name: capText(entry.name, LCP_ANALYSIS_LIMITS.urlPoints),
    startTime: domTiming(entry.startTime),
    requestStart: domTiming(entry.requestStart),
    responseEnd: domTiming(entry.responseEnd)
  };
}

/**
 * The navigation's first byte and prerender activation offset (0 when not
 * prerendered, or where the engine has no such field), or null without a
 * navigation entry.
 *
 * @param performance The timeline.
 */
export function navigationTiming(
  performance: LcpAnalysisDeps['performance']
): Required<NavigationTiming> | null {
  const entry = performance.getEntriesByType('navigation')[0] as
    (PerformanceNavigationTiming & { readonly activationStart?: unknown }) | undefined;
  return entry === undefined
    ? null
    : {
        responseStart: domTiming(entry.responseStart),
        activationStart: domTiming(entry.activationStart)
      };
}

/**
 * Take the buffered LCP entries with one observer, then disconnect it:
 * at once when the engine hands them over on `observe`, else at its first
 * delivery or after {@link LCP_BUFFER_WAIT_MS}.
 *
 * @param Observer The observer class.
 * @param schedule The timer seam.
 * @returns The entries, in report order (empty when there are none or the observer failed).
 */
export function takeLcpEntries(
  Observer: ObserverClass,
  schedule: ScheduleTimer
): Promise<LcpEntryLike[]> {
  return new Promise((resolve) => {
    const entries: unknown[] = [];
    let observer: ObserverLike | null = null;
    let cancel = (): void => undefined;
    let done = false;
    /** Collect what is left, disconnect, answer — once. */
    const finish = (): void => {
      if (done) return;
      done = true;
      cancel();
      if (observer !== null) {
        entries.push(...observer.takeRecords());
        observer.disconnect();
      }
      resolve(entries as LcpEntryLike[]);
    };
    try {
      observer = new Observer((list) => {
        entries.push(...list.getEntries());
        finish();
      });
      observer.observe({ type: LCP_ENTRY_TYPE, buffered: true });
      entries.push(...observer.takeRecords());
    } catch {
      // An engine refusing the observer reads as "no candidates": answer what was taken.
      finish();
      return;
    }
    if (entries.length > 0) finish();
    else cancel = schedule(finish, LCP_BUFFER_WAIT_MS);
  });
}

/**
 * Frame the LCP element when asked.
 *
 * @param asked Whether the request asked for it.
 * @param element The LCP entry's element.
 * @param highlight The highlighter.
 */
async function highlightOf(
  asked: boolean,
  element: Element | null,
  highlight: LcpAnalysisDeps['highlight']
): Promise<LcpHighlight> {
  if (!asked) return 'off';
  if (element === null || !element.isConnected) return 'unavailable';
  try {
    return (await highlight(element)) ? 'shown' : 'unavailable';
  } catch {
    // The highlighter logs its own failures; the analysis still answers.
    return 'unavailable';
  }
}

/**
 * Run one analysis.
 *
 * @param request The panel's request.
 * @param deps See {@link LcpAnalysisDeps}.
 * @returns The facts, or `unsupported` when the engine reports no LCP entries.
 */
export async function analyseLcp(
  request: LcpAnalysisRequest,
  deps: LcpAnalysisDeps
): Promise<LcpAnalysisReply> {
  const Observer = deps.Observer;
  if (Observer?.supportedEntryTypes?.includes(LCP_ENTRY_TYPE) !== true) {
    return { kind: 'unsupported' };
  }
  const entries = dedupeCandidates(
    await takeLcpEntries(Observer, deps.schedule ?? scheduleWithTimeout)
  );
  const kept = entries.slice(-LCP_ANALYSIS_LIMITS.candidates);
  const last = kept.at(-1);
  return {
    kind: 'measured',
    navigation: navigationTiming(deps.performance),
    candidates: kept.map(candidateFacts),
    resource: last === undefined ? null : lcpResource(last.url, deps.performance),
    highlight: await highlightOf(request.highlight, last?.element ?? null, deps.highlight)
  };
}
