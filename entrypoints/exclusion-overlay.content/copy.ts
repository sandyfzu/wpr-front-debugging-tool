/**
 * Every word the overlay shows, declared once and mapped over the contract
 * tables (causes, document failures, problems, lanes) — so a new cause or
 * lane fails to type-check until it has its words. Sentence case, present
 * tense, no blame (the UI bar's word rules).
 */
import type {
  ExclusionDocumentFailure,
  ExclusionSaveFailure,
  InterceptionUnavailableCause
} from '../../lib/messaging/exclusion-session';
import { EXCLUSION_SET_LIMITS } from '../../lib/messaging/exclusion-session';
import type { ExclusionFeatureId } from '../../lib/exclusion-builder/set';
import {
  LABEL_AUTOMATIC_LAZY_RENDERING,
  LABEL_DELAY_JAVASCRIPT_EXECUTION,
  LABEL_IMAGE_LAZYLOAD,
  LABEL_LOAD_JAVASCRIPT_DEFERRED
} from '../../lib/detection/labels';
import { LAZY_RENDER_EXCLUSIONS_FILTER } from '../../lib/exclusion-builder/copy-form';
import { storedText, trimExclusionRow } from '../../lib/exclusion-builder/field-text';
import { capText } from '../../utils/cap-text';
import { countNoun, type CountNoun } from '../../utils/format-count';
import { differenceExcerpts } from '../../utils/difference-excerpt';
import type { LaneCounts } from './exclusions/counts';
import type { LaneKey } from './exclusions/draft';
import {
  isConversion,
  type BatchSummary,
  type CommitSource,
  type DroppedRowDiff,
  type KeptRowDiff,
  type LatestCommits
} from './exclusions/row-notes';
import type { SessionProblem } from './session/port';
import type {
  LatestListMiss,
  SimulationCaveat,
  SimulationCspLimit,
  SimulationCspUnavailableReason,
  SimulationRuntimeUnavailableCause,
  UnreproducedRegex
} from '../../lib/wp-rocket-simulation/spec';
import type {
  DocumentSimulationReport,
  SimulationListProvenance
} from '../../lib/messaging/exclusion-simulation';
import type { DelayMode, DelayModeBlock } from './exclusions/delay-mode';
import { LATEST_LIST_MAX_AGE_MS } from '../../lib/exclusion-session/latest-list-source';
import { relativeAge } from '../../utils/relative-age';
import type { OverlayState, SessionAction } from './session/machine';
import type { AppliedWarning, SessionView, UnmodifiedReason } from './session/session-view';
import type { CandidateAddOutcome, SaveState } from './controller';

/**
 * The words the overlay's sentences agree with a count, each in its two
 * count forms (`countNoun` picks one) — nouns, and noun + verb pairs.
 */
export const COUNT_WORDS = {
  row: { one: 'row', other: 'rows' },
  thisRow: { one: 'this row', other: 'these rows' },
  it: { one: 'it', other: 'them' },
  lineWas: { one: 'line was', other: 'lines were' },
  exclusion: { one: 'exclusion', other: 'exclusions' },
  rowMatches: { one: 'row matches', other: 'rows match' },
  rowNeeds: { one: 'row needs', other: 'rows need' },
  match: { one: 'match', other: 'matches' }
} as const satisfies Readonly<Record<string, CountNoun>>;

/** The tool's name (the overlay's heading). */
export const TOOL_TITLE = 'Exclusion builder';

/** One lane's words. */
export interface LaneCopy {
  /** The feature's verified name. */
  readonly label: string;
  /** How a row matches, in one line. */
  readonly rowHint: string;
  /** The empty row input's placeholder. */
  readonly placeholder: string;
  /** What a candidate count counts (plural noun). */
  readonly noun: string;
  /** Shown when the page has nothing this lane can act on. */
  readonly absent: string;
  /** Where the lane's copied lines go (the copy-all control's hint). */
  readonly copyHint: string;
  /** What copy-all copies, after "Copied N exclusions" (empty: the field text). */
  readonly copiedAs: string;
  /** What this preview cannot see of WP Rocket's own matching (a lane line). */
  readonly limitHint?: string;
  /** Shown while the lane holds rows (what they do beyond matching). */
  readonly rowsNote?: string;
  /** The page-wide words, for a lane whose rows WP Rocket reads as one set. */
  readonly page?: LanePageCopy;
}

/** A set-read lane's page-wide words (its rows can turn the feature off for the whole page). */
export interface LanePageCopy {
  /**
   * The page-off warning's lead, before the rows it names.
   *
   * @param rows How many rows it names (≥ 1).
   */
  readonly offLead: (rows: number) => string;
  /**
   * The page-off warning's outcome, after the rows: Apply still runs, what
   * the preview shows, and the way back.
   *
   * @param rows How many rows it names (≥ 1).
   */
  readonly offOutcome: (rows: number) => string;
  /**
   * The applied page's count caveat when the applied rows turned the
   * feature off on the page.
   *
   * @param rows The rows behind it, as {@link rowsPhrase} names them (empty: not named).
   */
  readonly countsOff: (rows: string) => string;
  /** The rows' page state isn't checked here (non-blocking). */
  readonly unknown: string;
  /** The applied page's counts assume a page state that wasn't checked (a count caveat). */
  readonly countsUnknown: string;
}

/** Rows the page-off message names (each with its Go to button); the rest are counted. */
export const PAGE_OFF_ROWS_SHOWN = 3;

/** The page-off message's per-row words. */
export const PAGE_OFF_COPY = {
  /**
   * A named row's Go to button (visible label = accessible name).
   *
   * @param position The row's 1-based position in its lane.
   */
  goTo: (position: number): string => `Go to row ${String(position)}`,
  /**
   * Rows past the ones named.
   *
   * @param count Rows not named (≥ 1).
   */
  more: (count: number): string => `And ${String(count)} more ${countNoun(count, COUNT_WORDS.row)}.`
} as const;

/** The settings-field hint shared by the lanes WP Rocket has a field for. */
const FIELD_COPY_HINT =
  'Copies the exclusions one per line, as WP Rocket’s exclusion field takes them';

/** The lanes' words. */
export const LANE_COPY: Readonly<Record<LaneKey, LaneCopy>> = {
  delayJs: {
    label: LABEL_DELAY_JAVASCRIPT_EXECUTION,
    rowHint:
      'Regular expression, matched against the script element (upper and lower case A–Z count as the same)',
    placeholder: 'wp-content/plugins/slider/',
    noun: 'delayed scripts',
    absent: 'No delayed scripts on this page.',
    copyHint: FIELD_COPY_HINT,
    copiedAs: ''
  },
  deferJs: {
    label: LABEL_LOAD_JAVASCRIPT_DEFERRED,
    rowHint:
      'Regular expression, matched against the script’s src value (upper and lower case A–Z count as the same)',
    placeholder: 'jquery\\.min\\.js',
    // WP Rocket's inline-jQuery wrapping is Defer JS's work too: counted with them.
    noun: 'deferred and wrapped scripts',
    absent: 'No deferred scripts on this page.',
    copyHint: FIELD_COPY_HINT,
    copiedAs: '',
    limitHint:
      'WP Rocket’s remote exclusion lists and any custom code filters aren’t read here (assumed unused: rocket_exclude_defer_js, rocket_defer_jquery_patterns, rocket_defer_inline_exclusions).',
    page: {
      offLead: (rows) =>
        `WP Rocket defers no script on this page because of ${countNoun(rows, COUNT_WORDS.thisRow)}:`,
      offOutcome: (rows) =>
        `Apply still runs and previews the page as WP Rocket serves it, with no script deferred. Edit or remove ${countNoun(rows, COUNT_WORDS.it)} to defer scripts again.`,
      countsOff: (rows) =>
        `WP Rocket defers no script on this page because of ${rows === '' ? 'the applied rows' : rows}, so every deferred script is restored.`,
      unknown: 'WP Rocket may defer no script on this page with these rows — not checked here.',
      countsUnknown:
        'These counts assume WP Rocket defers scripts on this page: with the applied rows, that isn’t checked here.'
    }
  },
  lazyRender: {
    label: LABEL_AUTOMATIC_LAZY_RENDERING,
    rowHint:
      'Text, matched against the element’s opening tag (upper and lower case A–Z count as the same)',
    placeholder: 'id="footer"',
    noun: 'lazily rendered elements',
    absent: 'No lazily rendered elements on this page.',
    copyHint: `Copies a ready-to-paste ${LAZY_RENDER_EXCLUSIONS_FILTER} filter (PHP, for a must-use plugin or the theme’s functions.php): WP Rocket has no settings field for these`,
    copiedAs: ` as a ${LAZY_RENDER_EXCLUSIONS_FILTER} filter`,
    rowsNote:
      'Excluding an element re-keys the elements after it: WP Rocket keeps them rendered until its lazy-render data is regenerated.'
  },
  lazyload: {
    label: LABEL_IMAGE_LAZYLOAD,
    rowHint:
      'Text, matched against the image’s attributes; upper and lower case must match (images only: pictures, iframes and background images aren’t previewed)',
    placeholder: 'hero.jpg',
    noun: 'lazy images',
    absent: 'No lazy images on this page.',
    copyHint: FIELD_COPY_HINT,
    copiedAs: ''
  }
};

/** A row with invisible characters WP Rocket keeps (non-blocking). */
export const INVISIBLE_ROW_NOTE =
  'This row has invisible characters WP Rocket keeps (non-breaking spaces, zero-width, text-direction, soft-hyphen, emoji-variation or tag characters): they must match too.';

/**
 * The words a row warning gets in the editor: WP Rocket's reading, then
 * what the editor does with the row (a blank row is an unfinished edit —
 * never sent, never copied).
 *
 * @param reason The engine's warning.
 */
export function rowWarningNote(reason: string): string {
  return `${reason}. It is left out here: a blank row is an unfinished edit.`;
}

/**
 * The words a row warning WP Rocket applies gets in the editor: the
 * engine's reading, then that the preview applies it too (never blocked).
 *
 * @param reason The engine's warning.
 */
export function appliedRowWarningNote(reason: string): string {
  return `${reason}. Apply still runs and previews it as WP Rocket would.`;
}

/** How a count caveat refers to an applied row: its position in the lane, else its text. */
export type RowRef = { readonly position: number } | { readonly text: string };

/**
 * Applied rows named in a caveat: "row 2", "rows 1 and 3", "rows 1, 2 and
 * 4"; a row no longer in the lane by its text in backticks (shown as code).
 *
 * @param refs The rows, in lane order (≥ 1).
 */
export function rowsPhrase(refs: readonly RowRef[]): string {
  const join = (parts: readonly string[]): string =>
    parts.length < 2
      ? (parts[0] ?? '')
      : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
  const positions = refs.flatMap((ref) => ('position' in ref ? [String(ref.position)] : []));
  if (positions.length === refs.length) {
    return `${countNoun(positions.length, COUNT_WORDS.row)} ${join(positions)}`;
  }
  return join(
    refs.map((ref) =>
      'position' in ref ? `row ${String(ref.position)}` : `\`${capText(ref.text, NOTE_ROW_MAX)}\``
    )
  );
}

/** Inline-jQuery wrapping that only the site's own exclusions decide (one page-level line). */
export const INLINE_JQUERY_LINE =
  'Whether inline jQuery stays wrapped depends on your existing Defer JS exclusions';

/** A lane's count line and the caveats under it. */
export const COUNT_COPY = {
  /**
   * Applied rows that match every candidate.
   *
   * @param refs The rows (≥ 1), as {@link rowsPhrase} names them.
   * @param noun What is counted (plural).
   */
  matchAll: (refs: readonly RowRef[], noun: string): string => {
    const named = rowsPhrase(refs);
    const one = refs.length === 1;
    return `${named.charAt(0).toUpperCase()}${named.slice(1)} ${one ? 'matches' : 'match'} everything: WP Rocket excludes all ${noun} with ${one ? 'it' : 'them'}, and so does this preview.`;
  },
  /**
   * The lane's count, e.g. "3 of 9 delayed scripts restored".
   *
   * @param counts The lane's counts.
   * @param noun What is counted (plural).
   */
  line: (counts: LaneCounts, noun: string): string =>
    counts.featureWide
      ? `All ${String(counts.rewritten)} ${noun} restored (feature disabled)`
      : `${String(counts.rewritten)} of ${String(counts.candidates)} ${noun} restored`,
  /**
   * What the count could not tell, and the warnings it carries out, one
   * line each (none when it is exact and nothing warned). Applied rows are
   * named in backticks only when they left the lane (shown as code).
   *
   * @param counts The lane's counts.
   * @param noun What is counted (plural).
   * @param refs Names the applied rows (see {@link rowsPhrase}).
   * @param page The lane's page-wide words (set-read lanes only).
   */
  caveats: (
    counts: LaneCounts,
    noun: string,
    refs: (rows: readonly string[]) => readonly RowRef[],
    page?: LanePageCopy
  ): string[] => {
    const lines: string[] = [];
    if (counts.pageOffRows !== null && page !== undefined) {
      const named = counts.pageOffRows.length === 0 ? '' : rowsPhrase(refs(counts.pageOffRows));
      lines.push(page.countsOff(named));
    }
    if (counts.matchAllRows.length > 0) {
      lines.push(COUNT_COPY.matchAll(refs(counts.matchAllRows), noun));
    }
    if (counts.pageUnknown && page !== undefined) lines.push(page.countsUnknown);
    if (counts.undetermined > 0)
      lines.push(
        `${String(counts.undetermined)} left as served: how WP Rocket matched ${countNoun(counts.undetermined, COUNT_WORDS.it)} can’t be read from this page.`
      );
    if (counts.approximate > 0)
      lines.push(
        `${String(counts.approximate)} matched against a rebuilt tag: WP Rocket’s original wasn’t on the page.`
      );
    if (counts.inlineUnknown) lines.push(`${INLINE_JQUERY_LINE}.`);
    if (counts.bestEffort)
      lines.push(
        'Row counts are best effort: WP Rocket matches these rows as one pattern, so the first matching row is credited.'
      );
    return lines;
  }
} as const;

/** A text run of a note: plain words, or a row's text shown as code. */
export type NoteSegment = string | { readonly code: string };

/** A note as runs (row texts stay code whatever characters they hold). */
export type NoteText = readonly NoteSegment[];

/** Code points of a row's text a note quotes before it is cut (`…`). */
export const NOTE_ROW_MAX = 64;

/**
 * A row's text as a note quotes it.
 *
 * @param text The row's text.
 */
function quotedRow(text: string): NoteSegment {
  return { code: capText(text, NOTE_ROW_MAX) };
}

/**
 * A note's plain text (the announcement's form).
 *
 * @param note The note.
 */
export function noteToText(note: NoteText): string {
  return note.map((segment) => (typeof segment === 'string' ? segment : segment.code)).join('');
}

/** Why WP Rocket's save removed a row, after "WP Rocket drops ". */
function dropPhrase(diff: DroppedRowDiff, copyOf: number | null): NoteText {
  switch (diff.reason) {
    case 'empty':
      return ['rows left empty once saved'];
    case 'zero':
      return ['rows that read ', { code: '0' }];
    case 'duplicate':
      return [copyOf === null ? 'a copy of another row' : `a copy of row ${String(copyOf)}`];
    case 'invalid-pattern':
      return diff.construct === undefined
        ? ['patterns it can’t read']
        : ['patterns it can’t read: ', quotedRow(diff.construct), ` (${diff.detail ?? 'invalid'})`];
    case 'safe-mode':
      return ['this row while Safe Mode for jQuery is on'];
  }
}

/**
 * How a kept row's stored form differs from what was typed, as a note
 * shows it: in words when only the ends' whitespace went (invisible as
 * code), else both texts cut around their first difference (long rows
 * would otherwise show two identical prefixes).
 *
 * @param stored The stored form.
 * @param typed The row as typed (≠ `stored`).
 */
function storedChange(
  stored: string,
  typed: string
):
  | { readonly kind: 'ends-trimmed' }
  | { readonly kind: 'excerpts'; readonly stored: string; readonly typed: string } {
  if (trimExclusionRow(typed) === stored) return { kind: 'ends-trimmed' };
  const excerpts = differenceExcerpts(stored, typed, NOTE_ROW_MAX);
  return { kind: 'excerpts', stored: excerpts.left, typed: excerpts.right };
}

/** The word a batch's rows get in its count ("3 pasted rows"). */
const BATCH_NOUNS: Readonly<Record<CommitSource, string>> = {
  row: '',
  insert: '',
  candidate: '',
  paste: 'pasted ',
  restore: 'saved ',
  apply: ''
};

/** The stored-rows notes, removals, undo controls and announcements. */
export const ROW_NOTE_COPY = {
  /**
   * The note under a kept row (stored form, unverified, safe mode — merged
   * into one).
   *
   * @param diff The row's commit diff.
   */
  row: (diff: KeptRowDiff): NoteText => {
    const stored = storedText(diff) ?? diff.typed;
    const change = stored === diff.typed ? null : storedChange(stored, diff.typed);
    const parts: NoteSegment[] =
      change === null
        ? []
        : change.kind === 'ends-trimmed'
          ? ['WP Rocket stores this without the spaces at its ends.']
          : [
              'WP Rocket stores this as ',
              { code: change.stored },
              ' (you typed ',
              { code: change.typed },
              ').'
            ];
    if (diff.state === 'unverified') {
      parts.push(
        parts.length === 0
          ? 'WP Rocket’s handling of this row isn’t checked here, so the preview doesn’t apply it; kept as typed.'
          : ' Whether WP Rocket keeps it isn’t checked here, so the preview doesn’t apply it.'
      );
    }
    if (diff.dropsInSafeMode === true) {
      parts.push(
        `${parts.length === 0 ? '' : ' '}WP Rocket drops this row when Safe Mode for jQuery is on (that setting can’t be read from the page).`
      );
    }
    return parts;
  },
  /**
   * A removed row's line.
   *
   * @param diff The removed row's diff.
   * @param copyOf For a duplicate, the row it copies.
   */
  removed: (diff: DroppedRowDiff, copyOf: number | null): NoteText => [
    'Removed ',
    quotedRow(diff.typed),
    ': WP Rocket drops ',
    ...dropPhrase(diff, copyOf),
    '.'
  ],
  /** The undo control's visible label on a kept row (its name starts with it). */
  undo: 'Undo',
  /** The undo control's visible label on a removed row (its name starts with it). */
  restore: 'Restore',
  /**
   * Undo's accessible name on a kept row.
   *
   * @param lane The lane's label.
   * @param row The 1-based row.
   */
  undoName: (lane: string, row: number): string => `Undo change to ${lane} row ${String(row)}`,
  /**
   * Undo's accessible name on a removed row.
   *
   * @param lane The lane's label.
   * @param row The row's former 1-based position.
   */
  restoreName: (lane: string, row: number): string => `Restore removed ${lane} row ${String(row)}`,
  /**
   * The removed-rows list's accessible name.
   *
   * @param lane The lane's label.
   */
  removedListName: (lane: string): string => `${lane} rows removed`,
  /**
   * Removed rows past the ones listed.
   *
   * @param count Rows not listed (≥ 1).
   */
  moreRemoved: (count: number): string =>
    `${String(count)} more ${countNoun(count, COUNT_WORDS.row)} removed.`,
  /**
   * A batch's count (paste, restored draft, apply).
   *
   * @param summary The batch's count.
   */
  summary: (summary: BatchSummary): string => {
    const noun = BATCH_NOUNS[summary.source];
    const rows = (count: number): string =>
      `${String(count)} ${noun}${countNoun(count, COUNT_WORDS.row)}`;
    if (summary.changed === 0)
      return `${rows(summary.removed)} removed: WP Rocket drops them when saving.`;
    const removed = summary.removed === 0 ? '' : `, ${String(summary.removed)} removed`;
    return `${rows(summary.changed)} changed to WP Rocket’s stored form${removed}.`;
  }
} as const;

/**
 * What to announce for a commit batch, or null: a single changed or removed
 * row by its number; several by count. Rows kept as typed (flagged only)
 * are not news to announce.
 *
 * @param latest The batch.
 */
export function commitAnnouncement(latest: LatestCommits): string | null {
  const changed = latest.news.filter((item) => isConversion(item.diff));
  const [only] = changed;
  if (only === undefined) return null;
  if (changed.length === 1) {
    const row = `${LANE_COPY[only.lane].label} row ${String(only.position)}`;
    if (only.diff.state === 'dropped') {
      return `${row} removed: WP Rocket drops ${noteToText(dropPhrase(only.diff, only.copyOf))}.`;
    }
    // The same words as the row's note.
    const change = storedChange(storedText(only.diff) ?? '', only.diff.typed);
    return change.kind === 'ends-trimmed'
      ? `${row}: WP Rocket stores it without the spaces at its ends.`
      : `${row}: WP Rocket stores it as ${change.stored}.`;
  }
  const removed = changed.filter((item) => item.diff.state === 'dropped').length;
  return ROW_NOTE_COPY.summary({
    source: latest.source,
    changed: changed.length - removed,
    removed
  });
}

/** A paste the lane cap cut short, or one still landing. */
export const PASTE_COPY = {
  /** Typing, a second paste or Copy all while a long paste's rows are still landing (nothing done). */
  held: 'Still adding the pasted rows: try again once they are in.',
  /** A long paste broke while committing: nothing was added. */
  failed: 'The paste could not be added. Paste it again, or fewer lines at a time.',
  /**
   * Nothing pasted: the lane holds no more rows.
   *
   * @param max The lane's row cap.
   */
  laneFull: (max: number): string =>
    `Lane full: the paste was not added (${String(max)} rows max).`,
  /**
   * Some pasted lines left out.
   *
   * @param lines Lines left out (≥ 1).
   * @param max The lane's row cap.
   */
  dropped: (lines: number, max: number): string =>
    `${String(lines)} pasted ${countNoun(lines, COUNT_WORDS.lineWas)} not added: a lane holds ${String(max)} rows at most.`
} as const;

/**
 * What adding a candidate (a pick on the page, or the page list) announces,
 * per outcome — the real reason when nothing was added.
 *
 * @param outcome What the add did.
 * @param subject The candidate as the page names it.
 * @param lane The lane's label.
 */
export function candidateAnnouncement(
  outcome: CandidateAddOutcome,
  subject: string,
  lane: string
): string {
  switch (outcome) {
    case 'added':
      return `Added ${subject} to ${lane}`;
    case 'present':
      return `${subject} is already in ${lane}`;
    case 'dropped':
      return `${subject} not added: WP Rocket's save would drop it from ${lane}`;
    case 'full':
      return `${subject} not added: ${lane} holds ${String(EXCLUSION_SET_LIMITS.rowsPerFeature)} rows at most`;
    case 'held':
      return `${subject} not added: the exclusions can't be edited right now`;
  }
}

/** The per-lane copy-all control's words. */
export const COPY_ALL_COPY = {
  label: 'Copy all',
  /** The visible label while the confirmation shows. */
  copiedLabel: 'Copied',
  /**
   * The control's accessible name (stable across the confirmation).
   *
   * @param lane The lane's label.
   */
  name: (lane: string): string => `Copy all ${lane} exclusions`,
  /**
   * The accessible name while "Copied" shows (it holds the visible label).
   *
   * @param lane The lane's label.
   */
  copiedName: (lane: string): string => `Copied all ${lane} exclusions`,
  /**
   * The success announcement.
   *
   * @param count Exclusions copied (≥ 1).
   * @param as What they were copied as (the lane's `copiedAs`; empty: field text).
   */
  copied: (count: number, as = ''): string =>
    `Copied ${String(count)} ${countNoun(count, COUNT_WORDS.exclusion)}${as}`,
  /** Why the control does nothing on an empty lane. */
  empty: 'Nothing to copy yet: add an exclusion to this lane first.',
  /** A refused copy, with the way forward. */
  failed:
    'Copy failed: this page refused clipboard access. Select Copy all again, or copy each row from its field.'
} as const;

/** The feature names by engine id (report → words). */
export const FEATURE_NAMES: Readonly<Record<ExclusionFeatureId, string>> = {
  delay_js: LANE_COPY.delayJs.label,
  defer_all_js: LANE_COPY.deferJs.label,
  automatic_lazy_rendering: LANE_COPY.lazyRender.label,
  lazyload: LANE_COPY.lazyload.label
};

/** A titled message with its remedy. */
export interface StateCopy {
  readonly title: string;
  readonly body: string;
}

/**
 * The interception-unavailable warning per cause: what happened and what
 * to do — distinct words for each arm.
 */
export const UNAVAILABLE_COPY: Readonly<Record<InterceptionUnavailableCause, StateCopy>> = {
  'attach-denied': {
    title: 'The browser refused interception',
    body: 'Another debugger may hold this tab. Close it, then retry.'
  },
  'debugging-policy': {
    title: 'Debugging is blocked by policy',
    body: 'This browser is managed and forbids extension debugging. Ask its administrator, or use an unmanaged profile.'
  },
  'infobar-cancelled': {
    title: 'Interception was cancelled',
    body: 'The browser’s “started debugging” bar was closed with Cancel. Retry, and leave the bar open while the session runs.'
  },
  detached: {
    title: 'Interception ended',
    body: 'The browser ended it while the tab stayed open (for example after a crash). Retry to start it again.'
  },
  'unsupported-page': {
    title: 'This page can’t be intercepted',
    body: 'Only regular http and https pages can be rewritten. Open the site page itself in a normal tab.'
  },
  'unsupported-browser': {
    title: 'This browser can’t rewrite pages',
    body: 'Rewriting pages before they render needs Chrome (or another Chromium browser) or Firefox.'
  },
  'session-limit': {
    title: 'Too many sessions',
    body: 'Other tabs hold every available session. Stop one of them, then retry.'
  }
};

/** Why an intercepted page was served unmodified, per failure. */
export const DOCUMENT_FAILURE_COPY: Readonly<Record<ExclusionDocumentFailure, string>> = {
  'body-unavailable': 'Its HTML could not be read (too large, or the response was cut short).',
  'decode-failed': 'Its character encoding is not supported for rewriting.',
  'encode-failed': 'The rewritten HTML could not be saved back in the page’s character encoding.',
  'engine-failed': 'The exclusion engine failed on this page.',
  'not-served': 'The rewrite was not delivered: the navigation ended first.'
};

/** Reload or reinstall: the packaged data itself is unreadable, so a fresh copy can fix it. */
const RELOAD_EXTENSION = 'Reload or reinstall the extension.';

/**
 * What went wrong with the packaged simulation data, per cause (the
 * sentence's middle), and the action that can fix it.
 */
const RUNTIME_UNAVAILABLE_COPY: Readonly<
  Record<SimulationRuntimeUnavailableCause, { readonly what: string; readonly remedy: string }>
> = {
  // A failed read is retried on the next document: reloading the page retries it.
  'asset-unreachable': { what: 'could not be loaded', remedy: 'Reload the page to retry.' },
  'asset-malformed': { what: 'is damaged', remedy: RELOAD_EXTENSION },
  'hash-mismatch': { what: 'is damaged', remedy: RELOAD_EXTENSION },
  // This build carries no data for the version: only a newer build can.
  'version-missing': {
    what: 'has no entry for this WP Rocket version',
    remedy: 'Update the extension to simulate this version.'
  }
};

/**
 * Why a simulating session served a page unmodified: its packaged runtime.
 *
 * @param cause The runtime-unavailable cause.
 */
export function runtimeUnavailableCopy(cause: SimulationRuntimeUnavailableCause): string {
  const { what, remedy } = RUNTIME_UNAVAILABLE_COPY[cause];
  return `The packaged simulation data ${what}, so the page was served unmodified. ${remedy}`;
}

/** Days a kept latest list is trusted, for its expiry words. */
const LATEST_LIST_MAX_AGE_DAYS = LATEST_LIST_MAX_AGE_MS / 86_400_000;

/**
 * Why the bundled list ran, per latest-list miss — every one opens with
 * "latest list"; the server's answer (`malformed`, `invalid`) is told apart
 * from the kept copy (`unreadable`, `expired`).
 */
const LATEST_LIST_MISS_COPY: Readonly<Record<LatestListMiss, string>> = {
  'never-fetched': 'latest list not fetched yet',
  'network-error': 'latest list unreachable: network error',
  timeout: 'latest list unreachable: the request timed out',
  'http-error': 'latest list refused by the server',
  oversize: 'latest list too large',
  malformed: 'latest list in an unexpected format',
  invalid: 'latest list failed validation',
  unreadable: 'latest list copy unreadable',
  expired: `latest list copy over ${String(LATEST_LIST_MAX_AGE_DAYS)} days old`
};

/**
 * The lane detail naming the exclusion list a simulation ran with: the
 * fetched latest list with its age, or the version's bundled
 * list with why the latest one did not run.
 *
 * @param list The simulation's list provenance and its WP Rocket version.
 * @param now The current time (epoch ms), for the fetched list's age.
 */
export function simulationListCopy(
  list: SimulationListProvenance & { readonly wpRocketVersion: string },
  now: number
): string {
  return list.listSource === 'latest'
    ? `Exclusion list: latest (fetched ${relativeAge(now - list.listFetchedAt)})`
    : `Exclusion list: bundled with WP Rocket ${list.wpRocketVersion} (${LATEST_LIST_MISS_COPY[list.listMiss]})`;
}

/**
 * The words of an unmodified page's reason.
 *
 * @param reason The reason.
 */
export function unmodifiedCopy(reason: UnmodifiedReason): string {
  if (reason.kind === 'failed') return DOCUMENT_FAILURE_COPY[reason.reason];
  if (reason.kind === 'runtime-unavailable') return runtimeUnavailableCopy(reason.cause);
  if (reason.stage === 'simulate') {
    return `Simulating ${FEATURE_NAMES[reason.feature]} took longer than ${String(reason.budgetMs)} ms (the simulation counts toward the time budget), so the page was served unmodified. Reload to try again, or choose As served to apply your exclusions without the simulation.`;
  }
  const row = reason.row === null ? '' : ` (row ${reason.row})`;
  if (reason.simulating === true) {
    return `${FEATURE_NAMES[reason.feature]}${row} ran past the ${String(reason.budgetMs)} ms budget, so the page was served unmodified. The simulation’s time counts toward that budget, so the row may not be slow on its own. Simplify the row, or choose As served, then apply again.`;
  }
  return `${FEATURE_NAMES[reason.feature]}${row} took longer than ${String(reason.budgetMs)} ms, so the page was served unmodified. Simplify the row, then apply again.`;
}

/**
 * The unmodified banner's title: the simulation's own failures are named
 * apart (their remedy is not the rows').
 *
 * @param reason Why the page was served unmodified.
 */
function unmodifiedTitle(reason: UnmodifiedReason): string {
  if (reason.kind === 'runtime-unavailable')
    return 'Served unmodified: simulation data unavailable';
  if (reason.kind === 'over-budget' && reason.stage === 'simulate')
    return 'Served unmodified: the simulation took too long';
  return 'Served unmodified';
}

/** An ask that produced nothing, per problem. */
export const PROBLEM_COPY: Readonly<Record<SessionProblem, string>> = {
  'no-receiver': 'The extension is not answering. Try again in a moment.',
  timeout: 'The extension took too long to answer. Try again.',
  'invalid-reply': 'The extension sent an unexpected answer. Try again.',
  'context-invalidated':
    'The extension was reloaded or updated. Open the exclusion builder again from the extension.',
  failed: 'The request to the extension failed. Try again.'
};

/** The title of a failed action's notice. */
export const ACTION_FAILED_TITLE: Readonly<Record<SessionAction, string>> = {
  apply: 'Couldn’t apply',
  reset: 'Couldn’t reset',
  stop: 'Couldn’t stop'
};

/**
 * How long a session lasts, said on every banner of an active session
 * (it outlives the page until it is stopped or the tab closes).
 */
export const SESSION_ON_NOTE =
  'The session stays on in this tab until you stop it or close the tab.';

/**
 * The same, plus what it does to the next pages — said only where this
 * page shows it working (applied, or armed for the next load); on a page
 * the session did not (or may not have) rewritten, that promise would not
 * be honest.
 */
export const SESSION_PERSISTS_NOTE = `${SESSION_ON_NOTE.slice(0, -1)}: each page of this site you open here loads with these exclusions.`;

/**
 * An applied warning as the page-wide announcement says it: the lane, then
 * the same words its counts carry.
 *
 * @param warning The applied warning.
 */
export function appliedWarningLine(warning: AppliedWarning): string {
  const lane = LANE_COPY[warning.lane];
  const refs = warning.positions.map((position) => ({ position }));
  if (warning.kind === 'match-all') return `${lane.label}: ${COUNT_COPY.matchAll(refs, lane.noun)}`;
  const named = refs.length === 0 ? '' : rowsPhrase(refs);
  const words =
    lane.page?.countsOff(named) ?? `WP Rocket runs ${lane.label} on nothing on this page.`;
  return `${lane.label}: ${words}`;
}

/**
 * The applied banner's words: what the page shows, then each applied
 * warning — the banner is the polite status region, so a screen reader
 * hears why the preview looks as it does.
 *
 * @param view The applied view.
 */
function appliedCopy(view: Extract<SessionView, { kind: 'applied' }>): StateCopy {
  const simulated = view.simulation === undefined ? null : simulationOutcomeCopy(view.simulation);
  if (simulated !== null) return simulated;
  const warnings = view.warnings.map(appliedWarningLine);
  const tail = warnings.length === 0 ? '' : ` ${warnings.join(' ')}`;
  if (view.unmatched > 0) {
    return {
      title: 'Applied, with rows that matched nothing',
      body: `${String(view.unmatched)} ${countNoun(view.unmatched, COUNT_WORDS.rowMatches)} no element on this page. Check the rows marked “No match”.${tail}`
    };
  }
  const rendered = view.simulation?.state === 'simulated' ? SIMULATED_RENDER_WORDS : RENDER_WORDS;
  return warnings.length === 0
    ? { title: 'Applied', body: rendered }
    : { title: 'Applied, with warnings', body: `${rendered}${tail}` };
}

/** What an applied page shows. */
const RENDER_WORDS = 'This page was rendered with your exclusions.';

/** What an applied, simulated page shows — never mistaken for the site's own configuration. */
const SIMULATED_RENDER_WORDS = `This page was rendered with WP Rocket ${LABEL_DELAY_JAVASCRIPT_EXECUTION} simulated and your exclusions — not the site’s real configuration.`;

/** The session view's banner words. */
export function viewCopy(view: SessionView): StateCopy {
  switch (view.kind) {
    case 'off':
      return {
        title: 'Not applied',
        body: 'Pick elements or write rows, then apply: the page reloads with the exclusions rendered for real.'
      };
    case 'unavailable':
      return UNAVAILABLE_COPY[view.cause];
    case 'armed':
      return {
        title: 'Applied — waiting for the page',
        body: 'Reload to render this page through the session.'
      };
    case 'applied':
      return appliedCopy(view);
    case 'unmodified':
      return { title: unmodifiedTitle(view.reason), body: unmodifiedCopy(view.reason) };
    case 'not-intercepted':
      return {
        title: 'This page was not intercepted',
        body: 'The session is on, but this load bypassed it. Reload to render it with your exclusions.'
      };
    case 'cant-tell':
      return {
        title: 'Can’t verify this page',
        body: 'The session is on, but this page changed its address or loaded from history, so it may not be the rewritten one. Reload to be sure.'
      };
  }
}

/** The tone vocabulary of the session indicator (one status token each). */
export type IndicatorTone = 'neutral' | 'ok' | 'warn' | 'error' | 'info';

/** The session indicator: a word and a glyph, never color alone. */
export interface Indicator {
  readonly tone: IndicatorTone;
  readonly label: string;
  /** Glyph name (the overlay's icon set). */
  readonly glyph:
    'idle' | 'waiting' | 'check' | 'alert' | 'blocked' | 'spinner' | 'question' | 'simulated';
}

/**
 * The simulation indicator beside the session's: shown whenever the page
 * on screen runs a simulation (every simulated load, the folded pill too).
 */
export const SIMULATED_INDICATOR: Indicator = {
  tone: 'info',
  label: 'Simulated',
  glyph: 'simulated'
};

/**
 * The header's session indicator for the overlay state.
 *
 * @param state The overlay state.
 * @param view The session view (null outside `ready`).
 */
export function sessionIndicator(state: OverlayState, view: SessionView | null): Indicator {
  if (state.phase === 'loading') return { tone: 'neutral', label: 'Checking', glyph: 'spinner' };
  if (state.phase === 'load-failed')
    return { tone: 'error', label: 'Unreachable', glyph: 'blocked' };
  if (state.phase === 'reloading') return { tone: 'info', label: 'Reloading', glyph: 'spinner' };
  if (state.pending !== null) {
    return {
      tone: 'info',
      label: state.pending === 'stop' ? 'Stopping' : 'Applying',
      glyph: 'spinner'
    };
  }
  switch (view?.kind) {
    case 'applied':
      return view.unmatched === 0
        ? { tone: 'ok', label: 'Applied', glyph: 'check' }
        : { tone: 'warn', label: 'Applied · no-match rows', glyph: 'alert' };
    case 'armed':
      return { tone: 'info', label: 'Applied · waiting', glyph: 'waiting' };
    case 'unavailable':
      return { tone: 'error', label: 'Unavailable', glyph: 'blocked' };
    case 'unmodified':
      return { tone: 'warn', label: 'Served unmodified', glyph: 'alert' };
    case 'not-intercepted':
      return { tone: 'warn', label: 'Not intercepted', glyph: 'alert' };
    case 'cant-tell':
      return { tone: 'warn', label: 'Can’t verify', glyph: 'question' };
    default:
      return { tone: 'neutral', label: 'Not applied', glyph: 'idle' };
  }
}

/** Why a draft save stored nothing, per save failure. */
export const SAVE_FAILURE_COPY: Readonly<Record<ExclusionSaveFailure, string>> = {
  'unsupported-page': 'this page can’t hold a draft',
  'invalid-request': 'a row is too long or has control characters, or the draft is too large',
  'storage-failed': 'storage failed'
};

/**
 * The footer's line for a draft over the set cap: it cannot be kept, so it
 * is gone once the overlay closes — and what to do.
 */
export const DRAFT_TOO_LARGE_WORDS = `Draft not saved: it is over ${EXCLUSION_SET_LIMITS.totalChars.toLocaleString('en-US')} characters, so closing the overlay loses it. Remove rows to keep it.`;

/** Why a draft save got no answer, per ask problem (a footer clause). */
const SAVE_PROBLEM_COPY: Readonly<Record<SessionProblem, string>> = {
  'no-receiver': 'the extension is not answering',
  timeout: 'the extension took too long to answer',
  'invalid-reply': 'the extension sent an unexpected answer',
  'context-invalidated': 'the extension was reloaded or updated',
  failed: 'the request to the extension failed'
};

/**
 * The footer's draft line, or null when there is nothing to say.
 *
 * @param save The draft's save state.
 */
export function saveStateWords(save: SaveState): string | null {
  switch (save.kind) {
    case 'idle':
      return null;
    case 'saving':
      return 'Saving draft…';
    case 'saved':
      return 'Draft saved';
    case 'not-saved':
      if (save.reason === 'too-large') return DRAFT_TOO_LARGE_WORDS;
      return `Draft not saved: ${
        isSaveFailure(save.reason) ? SAVE_FAILURE_COPY[save.reason] : SAVE_PROBLEM_COPY[save.reason]
      }`;
  }
}

/** Whether a not-saved reason is the background's answer (not an ask problem). */
function isSaveFailure(
  reason: ExclusionSaveFailure | SessionProblem
): reason is ExclusionSaveFailure {
  return Object.hasOwn(SAVE_FAILURE_COPY, reason);
}

/** The Delay JS lane's mode control: its options, and why one is unavailable. */
export const DELAY_MODE_COPY = {
  /** The control's accessible name. */
  groupName: `${LABEL_DELAY_JAVASCRIPT_EXECUTION} on this page`,
  labels: {
    served: 'As served',
    simulated: 'Simulated',
    disabled: 'Disabled'
  } satisfies Readonly<Record<DelayMode, string>>,
  /** Why the page leaves an option out (one line under the control). */
  blocks: {
    'already-delayed':
      'WP Rocket already delays scripts on this page — exclusions apply to its output.',
    amp: 'WP Rocket never delays AMP pages.',
    checking: 'Checking whether WP Rocket delays scripts on this page…'
  } satisfies Readonly<Record<DelayModeBlock, string>>,
  /**
   * The draft's mode the page does not allow: no option is checked and the
   * page runs as served (the draft keeps the mode for other pages).
   *
   * @param mode The replaced mode.
   */
  replaced: (mode: DelayMode): string =>
    `${DELAY_MODE_COPY.labels[mode]} doesn’t apply here, so this page runs as served (${DELAY_MODE_COPY.labels[mode]} stays set for other pages).`,
  /** Disabled is shown on a page WP Rocket does not delay (allowed: it is a no-op here). */
  disabledChangesNothing:
    'WP Rocket doesn’t delay scripts on this page, so Disabled changes nothing here.',
  /** Why the control is held (its tooltip): an action is in flight. */
  held: 'Wait for the current action to finish.',
  /** The page still runs a simulation the session no longer applies (e.g. after Stop). */
  kept: 'Simulated · reload to see the page without it.',
  /** The admin and login screens' warning (never blocks). */
  adminScreen:
    'This is a WordPress admin or login screen. WP Rocket never optimizes these screens, so a simulation here shows something the site never serves.'
} as const;

/** Each CSP limit of a simulated page: what fails, as it would on the site. */
const CSP_LIMIT_COPY: Readonly<Record<SimulationCspLimit, string>> = {
  eval: 'This page’s Content Security Policy blocks eval: event handlers of delayed elements fail here as they would on the site.',
  data: 'This page’s Content Security Policy blocks data: scripts: WP Rocket’s runtime falls back to inline copies of the delayed scripts, as it would on the site.',
  inline:
    'This page’s Content Security Policy blocks inline scripts: delayed inline scripts fail here as they would on the site.',
  'inline-after-fallback':
    'If WP Rocket switched to its inline fallback on an earlier page of this tab, this page’s CSP blocks those inline scripts — as it would live.',
  'trusted-types':
    'This page requires Trusted Types — WP Rocket’s Delay JS cannot load delayed scripts under it; they fail here as they would on the site.'
};

/** Why a page's CSP was not evaluated (never said as "no CSP"). */
const CSP_UNAVAILABLE_COPY: Readonly<Record<SimulationCspUnavailableReason, string>> = {
  oversized:
    'CSP not evaluated: this page’s Content Security Policy is too large to check, so scripts it blocks aren’t named.',
  unreadable:
    'CSP not evaluated: this page’s Content Security Policy couldn’t be read, so scripts it blocks aren’t named.'
};

/** What a simulation cannot reproduce on a page. */
const CAVEAT_COPY: Readonly<Record<SimulationCaveat, string>> = {
  'combined-js':
    'This page serves WP Rocket’s combined JavaScript files: with Delay JS on, WP Rocket would serve them uncombined, which the simulation can’t reproduce.'
};

/** The WP Rocket pattern a page may stop, named for the not-reproduced reason. */
const UNREPRODUCED_REGEX_NAMES: Readonly<Record<UnreproducedRegex, string>> = {
  'ie-conditionals': 'IE conditional comments',
  'ie-conditional-script': 'IE conditional scripts',
  'xmp-mask': '<xmp> masking',
  'svg-mask': '<svg> masking',
  'meta-charset': 'meta charset'
};

/** What to do when a page could not be simulated: the forward actions. */
const NOT_SIMULATED_REMEDY =
  'Test on another page of the site, or choose As served to apply your exclusions without the simulation.';

/**
 * The applied banner of a simulating session whose step did not delay
 * this page — each state titled with a way forward — or null when the
 * page was simulated (the regular applied words then say so).
 *
 * @param simulation The simulation step's report.
 */
export function simulationOutcomeCopy(simulation: DocumentSimulationReport): StateCopy | null {
  switch (simulation.state) {
    case 'simulated':
      return null;
    case 'already-served':
      return {
        title: 'Applied — WP Rocket already delays scripts here',
        body: 'Nothing was simulated: your exclusions apply to WP Rocket’s own Delay JavaScript execution, as served.'
      };
    case 'csp-blocked':
      return {
        title: 'Not simulated: blocked by this page’s Content Security Policy',
        body: `The policy forbids WP Rocket’s inline Delay JS script, as it would on the site, so nothing was delayed and the page was rendered with your exclusions only. ${NOT_SIMULATED_REMEDY}`
      };
    case 'not-applicable':
      return notApplicableCopy(simulation);
  }
}

/**
 * A not-applicable simulation's banner, per reason.
 *
 * @param simulation The report (state `not-applicable`).
 */
function notApplicableCopy(simulation: DocumentSimulationReport): StateCopy {
  const served = 'the page was rendered as served, with your exclusions.';
  switch (simulation.reason) {
    case 'amp':
      return {
        title: 'Not simulated: AMP page',
        body: `WP Rocket never delays scripts on AMP pages, so ${served} Choose As served to stop asking for the simulation.`
      };
    case 'unsupported-charset':
      return {
        title: 'Not simulated: page isn’t UTF-8',
        body: `Only UTF-8 pages (or pages whose text is plain ASCII) can be simulated, so ${served} ${NOT_SIMULATED_REMEDY}`
      };
    case 'beyond-exact-reproduction':
    case undefined: {
      const regex =
        simulation.unreproducedRegex === undefined
          ? 'patterns'
          : `${UNREPRODUCED_REGEX_NAMES[simulation.unreproducedRegex]} pattern`;
      return {
        title: 'Not simulated: this page can’t be reproduced exactly',
        body: `WP Rocket’s ${regex} may stop on this page, which the simulation can’t reproduce, so ${served} ${NOT_SIMULATED_REMEDY}`
      };
    }
  }
}

/**
 * What a simulated page cannot show as the site would, one line each:
 * the CSP's limits (or why it was not evaluated) and the caveats. Empty
 * for any other state.
 *
 * @param simulation The simulation step's report.
 */
export function simulationLimitLines(simulation: DocumentSimulationReport): string[] {
  if (simulation.state !== 'simulated') return [];
  const lines = (simulation.cspLimits ?? []).map((limit) => CSP_LIMIT_COPY[limit]);
  if (simulation.cspUnavailable !== undefined)
    lines.push(CSP_UNAVAILABLE_COPY[simulation.cspUnavailable]);
  lines.push(...(simulation.caveats ?? []).map((caveat) => CAVEAT_COPY[caveat]));
  return lines;
}

/** The Delay JS lane's lines about the simulation on the page it applied to. */
export const SIMULATION_LANE_COPY = {
  /**
   * The count line, e.g. "5 delayed by the simulation · 2 excluded by your rows".
   *
   * @param delayed Scripts the simulation delayed.
   * @param excluded Of those, scripts the rows restored.
   */
  line: (delayed: number, excluded: number): string =>
    `${String(delayed)} delayed by the simulation · ${String(excluded)} excluded by your rows`,
  /**
   * The simulated version, and the site's when it serves another one.
   *
   * @param simulation The simulation step's report.
   */
  version: (simulation: DocumentSimulationReport): string =>
    simulation.siteVersion === undefined || simulation.siteVersion === simulation.wpRocketVersion
      ? `Simulated · WP Rocket ${simulation.wpRocketVersion}`
      : `Simulated · WP Rocket ${simulation.wpRocketVersion} (the site serves ${simulation.siteVersion})`,
  /**
   * Scripts left as served because WP Rocket's verdict on them depends on
   * ids it draws at random.
   *
   * @param count The count (≥ 1).
   */
  undetermined: (count: number): string =>
    `${String(count)} left as served: WP Rocket decides ${countNoun(count, COUNT_WORDS.it)} with random ids, so the simulation can’t.`,
  /** WP Rocket's own pattern stops on the page: it would delay nothing either. */
  regexLimit:
    'WP Rocket’s Delay JS pattern stops on this page (PHP’s backtracking limit), so nothing is delayed — as on the site.'
} as const;

/**
 * The stopped notice's words: a page that still runs a simulation says
 * the reload removes it too.
 *
 * @param simulated The page on screen still runs a simulation.
 */
export function stoppedBody(simulated: boolean): string {
  return simulated
    ? 'Reload to see the page without exclusions or the simulation.'
    : 'Reload to see the page without exclusions.';
}
