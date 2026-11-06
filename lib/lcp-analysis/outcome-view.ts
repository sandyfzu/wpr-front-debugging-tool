/**
 * The LCP analysis's words: each outcome as a tone, a title, one sentence
 * and its recoveries; the four parts' names; the highlight's and the LCP
 * resource's notes; and the candidates as display rows. Pure — the panel
 * page renders what this decides.
 */
import { formatCount } from '../../utils/format-count';
import type { AskMiss } from '../messaging/bounded-ask';
import type { LcpCandidateFacts, LcpElementFacts, LcpHighlight } from '../messaging/lcp-analysis';
import { sinceActivation, type LcpPartKey, type LcpResourceState } from './breakdown';
import { LCP_ANALYSIS_ASK_DEADLINE_MS, LCP_HIGHLIGHT_MS } from './deadlines';
import type { LcpAnalysisOutcome } from './run-analysis';

/** What the reader can do about an outcome. */
export type LcpRecovery = 'retry' | 'reload-page';

/** An outcome, as shown. */
export interface LcpOutcomeView {
  readonly tone: 'ok' | 'warn' | 'error' | 'neutral';
  readonly title: string;
  readonly message: string;
  /** In order; the first is the primary action. */
  readonly recoveries: readonly LcpRecovery[];
}

/** The parts' names, in the order the breakdown lists them. */
export const LCP_PART_LABELS: Readonly<Record<LcpPartKey, string>> = {
  timeToFirstByte: 'Time to first byte',
  resourceLoadDelay: 'Resource load delay',
  resourceLoadDuration: 'Resource load time',
  elementRenderDelay: 'Element render delay'
};

/** What each part measures (one line under its name). */
export const LCP_PART_HINTS: Readonly<Record<LcpPartKey, string>> = {
  timeToFirstByte: "Until the first byte of the page's HTML arrived.",
  resourceLoadDelay: "From the first byte until the LCP image's request started.",
  resourceLoadDuration: 'Downloading the LCP image.',
  elementRenderDelay: 'From the end of the download until the element was painted.'
};

/** The LCP resource's note, when the breakdown reads it in a special way. */
export const LCP_RESOURCE_NOTES: Readonly<Record<LcpResourceState, string | null>> = {
  found: null,
  text: 'The LCP is text: nothing to download, so both resource parts are 0 ms.',
  missing:
    'The browser kept no download timing for this image (a data URL, a cached copy or a cleared buffer): both resource parts read 0 ms and everything after the first byte counts as render delay.'
};

/** The highlight's note per state (`off`: nothing to say). */
export const LCP_HIGHLIGHT_NOTES: Readonly<Record<LcpHighlight, string | null>> = {
  off: null,
  shown: `The LCP element was framed on the page for ${formatCount(LCP_HIGHLIGHT_MS / 1000)} s when this analysis ran.`,
  unavailable:
    "Couldn't frame the LCP element: it is no longer on the page. Analyse again to frame the current one."
};

/** Sentence ending every miss: the page was not measured. */
const NOTHING_MEASURED = 'Nothing was measured.';

/**
 * Milliseconds as shown: whole, grouped digits.
 *
 * @param ms A duration or time, ms.
 * @returns E.g. `1,234 ms`.
 */
export function formatMs(ms: number): string {
  return `${formatCount(Math.round(ms))} ms`;
}

/**
 * A part's share as shown.
 *
 * @param percent One decimal, or null when the total is 0.
 * @returns E.g. `33.3%`, or `—` without a share.
 */
export function formatPercent(percent: number | null): string {
  return percent === null ? '—' : `${String(percent)}%`;
}

/**
 * An element named as DevTools does: tag, `#id`, then `.class` per class.
 *
 * @param element The element's facts.
 * @returns E.g. `img#hero.wide.lazy`.
 */
export function describeElement(element: LcpElementFacts): string {
  const id = element.id === '' ? '' : `#${element.id}`;
  return `${element.tag}${id}${element.classes.map((name) => `.${name}`).join('')}`;
}

/** One candidate, as listed. */
export interface LcpCandidateRow {
  /** 1-based report order (stable key). */
  readonly id: number;
  /** Painted at, ms from activation. */
  readonly time: string;
  /** The element (`null`: it left the page). */
  readonly element: string | null;
  /** The image URL, or null for text. */
  readonly url: string | null;
  /** The painted area. */
  readonly size: string;
  /** The last candidate: the page's LCP. */
  readonly isLcp: boolean;
}

/**
 * The candidates as rows, in report order.
 *
 * @param candidates The analysis's candidates (the last is the LCP).
 * @param activationStart The prerender activation offset, ms.
 */
export function candidateRows(
  candidates: readonly LcpCandidateFacts[],
  activationStart: number
): LcpCandidateRow[] {
  return candidates.map((candidate, index) => ({
    id: index + 1,
    time: formatMs(sinceActivation(candidate.startTime, activationStart)),
    element: candidate.element === null ? null : describeElement(candidate.element),
    url: candidate.url === '' ? null : candidate.url,
    size: `${formatCount(Math.round(candidate.size))} px²`,
    isLcp: index === candidates.length - 1
  }));
}

/**
 * The note on a prerendered page's times.
 *
 * @param activationStart The activation offset, ms.
 * @returns The note, or null when the page was not prerendered.
 */
export function prerenderNote(activationStart: number): string | null {
  return activationStart > 0
    ? `Prerendered page: times count from when it was shown, ${formatMs(activationStart)} after its navigation started.`
    : null;
}

/**
 * Build a view.
 *
 * @param tone The tone.
 * @param title The title.
 * @param message The sentence.
 * @param recoveries The recoveries.
 */
function view(
  tone: LcpOutcomeView['tone'],
  title: string,
  message: string,
  recoveries: readonly LcpRecovery[] = []
): LcpOutcomeView {
  return { tone, title, message, recoveries };
}

/**
 * Where the candidates of an analysis without a breakdown are.
 *
 * @param count How many were painted.
 */
function candidatesLine(count: number): string {
  if (count === 0) return 'No candidate was painted yet either.';
  return count === 1
    ? 'Its one candidate is listed below.'
    : `Its ${formatCount(count)} candidates are listed below.`;
}

/**
 * A miss of the panel's ask: the page never answered usably.
 *
 * @param miss How the ask missed.
 */
function missView(miss: AskMiss): LcpOutcomeView {
  switch (miss) {
    case 'no-receiver':
      return view(
        'error',
        "The page isn't listening",
        `The extension is not active on this page yet — reload it (an http or https page) and analyse again. ${NOTHING_MEASURED}`,
        ['reload-page', 'retry']
      );
    case 'timeout':
      return view(
        'error',
        "The page didn't answer in time",
        `No answer within ${formatCount(LCP_ANALYSIS_ASK_DEADLINE_MS / 1000)} s. Analyse again; reload the page if it keeps happening.`,
        ['retry', 'reload-page']
      );
    case 'invalid-reply':
      return view(
        'error',
        "The page's answer was unreadable",
        'The page runs another version of the extension — reload it so both match, then analyse again.',
        ['reload-page', 'retry']
      );
    case 'failed':
      return view(
        'error',
        "Couldn't reach the page",
        `Asking the page for its LCP failed — reload it and analyse again. ${NOTHING_MEASURED}`,
        ['reload-page', 'retry']
      );
  }
}

/**
 * Describe an analysis's outcome.
 *
 * @param outcome How the analysis ended.
 */
export function describeLcpOutcome(outcome: LcpAnalysisOutcome): LcpOutcomeView {
  switch (outcome.kind) {
    case 'page-unreachable':
      return missView(outcome.miss);
    case 'unsupported':
      return view(
        'neutral',
        'LCP not supported',
        "This browser doesn't report Largest Contentful Paint, so there is nothing to analyse."
      );
    case 'analysed': {
      const count = outcome.candidates.length;
      switch (outcome.breakdown.kind) {
        case 'no-lcp':
          return view(
            'warn',
            'No LCP yet',
            "The page hasn't painted a candidate yet. Let it finish loading, then analyse again.",
            ['retry']
          );
        case 'no-navigation':
          return view(
            'warn',
            "Can't break the LCP down",
            `The browser has no navigation timing for this page, so its first byte is unknown. ${candidatesLine(count)}`,
            ['reload-page']
          );
        case 'breakdown':
          return view(
            'ok',
            `LCP at ${formatMs(outcome.breakdown.total)}`,
            count === 1
              ? 'One candidate was painted: it is the LCP.'
              : `${formatCount(count)} candidates were painted; the last one is the LCP.`
          );
      }
    }
  }
}
