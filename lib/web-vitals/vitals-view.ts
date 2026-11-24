/**
 * The current-visit vitals' words: each metric as a display row (value and
 * rating, or why there is none — unsupported and no-data said per metric),
 * the visit's notes (back/forward-cache restore, capped lists), and a read
 * that missed the page as a tone, title, sentence and recoveries. Pure — the
 * panel page renders what this decides. One visit's values, never field data.
 */
import { formatCount } from '../../utils/format-count';
import type { AskMiss } from '../messaging/bounded-ask';
import { ASK_MISS_TITLES } from '../messaging/ask-miss-words';
import {
  rate,
  VITAL_THRESHOLDS,
  type CurrentVisitVitals,
  type VitalOutcome,
  type VitalRating
} from './current-visit';
import { CURRENT_VISIT_ASK_DEADLINE_MS, type CurrentVisitOutcome } from './read-current-visit';

/** The three metrics, in the order they are shown. */
export const VITAL_KEYS = ['lcp', 'cls', 'inp'] as const;

/** One metric's key. */
export type VitalKey = (typeof VITAL_KEYS)[number];

/** Each metric's short and full name. */
export const VITAL_NAMES: Readonly<Record<VitalKey, { short: string; full: string }>> = {
  lcp: { short: 'LCP', full: 'Largest Contentful Paint' },
  cls: { short: 'CLS', full: 'Cumulative Layout Shift' },
  inp: { short: 'INP', full: 'Interaction to Next Paint' }
};

/** The ratings' words. */
export const RATING_LABELS: Readonly<Record<VitalRating, string>> = {
  good: 'Good',
  'needs-improvement': 'Needs improvement',
  poor: 'Poor'
};

/** Why a metric is unsupported: what the browser does not report. */
export const UNSUPPORTED_NOTES: Readonly<Record<VitalKey, string>> = {
  lcp: "This browser doesn't report LCP entries.",
  cls: "This browser doesn't report layout shifts.",
  inp: "This browser doesn't report interaction timing."
};

/** Why a metric has no value yet (a visit that was not restored). */
export const NO_DATA_NOTES: Readonly<Record<VitalKey, string>> = {
  lcp: 'No LCP while the page was visible: it loaded in a background tab or has not painted yet.',
  cls: 'Counted once the page has painted content while visible.',
  inp: 'No interaction yet. Click, tap or type on the page, then refresh.'
};

/** LCP after a back/forward-cache restore: not measured again. */
export const RESTORED_LCP_NOTE =
  'Not measured again after a back/forward-cache restore: the page was already painted.';

/** The line under the card's title: whose values these are. */
export const VISIT_SCOPE_NOTE =
  'This visit only, measured in this browser — not field data from real users (CrUX).';

/** The note on a visit started by a back/forward-cache restore. */
export const RESTORED_NOTE =
  'Restored from the back/forward cache: this visit starts at the restore, so CLS and INP count from there. Reload the page to measure a full load.';

/** The note when a collection bound was reached. */
export const CAPPED_NOTE =
  'A long visit: the oldest LCP candidates and the fastest interactions were left out of the lists. LCP and INP rarely change because of it.';

/** What the reader can do about a read that missed the page. */
export type VitalsRecovery = 'retry' | 'reload-page';

/** A missed read, as shown. */
export interface VitalsMissView {
  readonly title: string;
  readonly message: string;
  /** In order; the first is the primary action. */
  readonly recoveries: readonly VitalsRecovery[];
}

/** One metric, as shown. */
export type VitalRow = {
  readonly key: VitalKey;
  readonly short: string;
  readonly full: string;
} & (
  | {
      readonly state: 'measured';
      readonly value: string;
      readonly rating: VitalRating;
      readonly note: string | null;
    }
  | { readonly state: 'unsupported' | 'no-data'; readonly note: string }
);

/** Display units per metric unit: whole milliseconds, CLS thousandths. */
const DISPLAY_UNITS: Readonly<Record<VitalKey, number>> = { lcp: 1, cls: 1000, inp: 1 };

/**
 * A value in display units, rounded — except that a value rated worse than
 * its rounded figure (just above a threshold: CLS 0.1004 → 0.100) steps one
 * unit up instead, so the figure shown is never on the good side of the
 * rating shown. Ratings stay the raw value's (the official `>` thresholds);
 * thresholds are whole display units, so rounding up never crosses one.
 *
 * @param key The metric.
 * @param value Its raw value.
 * @returns The shown figure, in display units.
 */
export function shownUnits(key: VitalKey, value: number): number {
  const units = DISPLAY_UNITS[key];
  const rounded = Math.round(value * units);
  const thresholds = VITAL_THRESHOLDS[key];
  return rate(rounded / units, thresholds) === rate(value, thresholds) ? rounded : rounded + 1;
}

/**
 * A metric's value as shown: LCP and INP in whole milliseconds, CLS (a
 * unitless score) to three decimals, a tiny non-zero shift as `< 0.001`;
 * rounded without ever crossing the rating's threshold ({@link shownUnits}).
 *
 * @param key The metric.
 * @param value Its value.
 */
export function formatVital(key: VitalKey, value: number): string {
  const units = shownUnits(key, value);
  if (key !== 'cls') return `${formatCount(units)} ms`;
  if (value > 0 && units === 0) return '< 0.001';
  return (units / DISPLAY_UNITS.cls).toFixed(3);
}

/**
 * The note under a measured metric (INP: how many interactions it was chosen from).
 *
 * @param key The metric.
 * @param interactions INP's interaction count, when known.
 */
function measuredNote(key: VitalKey, interactions: number | undefined): string | null {
  if (key !== 'inp' || interactions === undefined) return null;
  return interactions === 1
    ? 'From 1 interaction.'
    : `From ${formatCount(interactions)} interactions.`;
}

/**
 * One metric's row.
 *
 * @param key The metric.
 * @param outcome Its outcome.
 * @param restored Whether a back/forward-cache restore started the visit.
 * @param interactions INP's interaction count, when known.
 */
export function vitalRow(
  key: VitalKey,
  outcome: VitalOutcome,
  restored: boolean,
  interactions?: number
): VitalRow {
  const names = { key, ...VITAL_NAMES[key] };
  switch (outcome.state) {
    case 'unsupported':
      return { ...names, state: 'unsupported', note: UNSUPPORTED_NOTES[key] };
    case 'no-data':
      return {
        ...names,
        state: 'no-data',
        note: key === 'lcp' && restored ? RESTORED_LCP_NOTE : NO_DATA_NOTES[key]
      };
    case 'measured':
      return {
        ...names,
        state: 'measured',
        value: formatVital(key, outcome.value),
        rating: outcome.rating,
        note: measuredNote(key, interactions)
      };
  }
}

/**
 * The visit's three rows, in {@link VITAL_KEYS} order.
 *
 * @param vitals The reduced visit.
 */
export function vitalRows(vitals: CurrentVisitVitals): VitalRow[] {
  const restored = vitals.restored === true;
  return [
    vitalRow('lcp', vitals.lcp, restored),
    vitalRow('cls', vitals.cls, restored),
    vitalRow('inp', vitals.inp, restored, vitals.inp.interactions)
  ];
}

/**
 * The notes on a read (restored first, then capped).
 *
 * @param outcome A read that reached the page.
 */
export function visitNotes(outcome: Extract<CurrentVisitOutcome, { kind: 'read' }>): string[] {
  const notes: string[] = [];
  if (outcome.vitals.restored === true) notes.push(RESTORED_NOTE);
  if (outcome.capped) notes.push(CAPPED_NOTE);
  return notes;
}

/**
 * A read that missed the page.
 *
 * @param miss How the ask missed.
 */
export function describeVitalsMiss(miss: AskMiss): VitalsMissView {
  switch (miss) {
    case 'no-receiver':
      return {
        title: ASK_MISS_TITLES['no-receiver'],
        message:
          'The extension is not active on this page yet. Reload it (an http or https page): vitals are collected from the start of a load.',
        recoveries: ['reload-page', 'retry']
      };
    case 'timeout':
      return {
        title: ASK_MISS_TITLES.timeout,
        message: `No answer within ${formatCount(CURRENT_VISIT_ASK_DEADLINE_MS / 1000)} s. Refresh; reload the page if it keeps happening.`,
        recoveries: ['retry', 'reload-page']
      };
    case 'invalid-reply':
      return {
        title: ASK_MISS_TITLES['invalid-reply'],
        message:
          'The page runs another version of the extension — reload it so both match, then refresh.',
        recoveries: ['reload-page', 'retry']
      };
    case 'failed':
      return {
        title: ASK_MISS_TITLES.failed,
        message: 'Asking the page for its vitals failed — reload it and refresh.',
        recoveries: ['reload-page', 'retry']
      };
  }
}
