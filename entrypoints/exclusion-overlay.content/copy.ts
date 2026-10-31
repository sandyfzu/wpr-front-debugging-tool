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
  LABEL_LOAD_JAVASCRIPT_DEFERRED,
  SHORT_LABEL_DEFER_JS,
  SHORT_LABEL_DELAY_JS,
  SHORT_LABEL_LAZYLOAD
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
import {
  LAZYLOAD_PAGE_INDEPENDENT_CAVEATS,
  SIMULATED_FEATURES,
  type LatestListMiss,
  type LazyloadAssetsUrlSource,
  type LazyloadCaveat,
  type LazyloadPlacementFallback,
  type SimulationCaveat,
  type SimulationCspLimit,
  type SimulationCspUnavailableReason,
  type SimulationRuntimeUnavailableCause,
  type SimulatedFeatureId,
  type UnreproducedRegex
} from '../../lib/wp-rocket-simulation/spec';
import type {
  DocumentSimulationReport,
  LazyloadSimulationReport,
  SimulationListProvenance
} from '../../lib/messaging/exclusion-simulation';
import type {
  DraftModeBlock,
  ModeBlock,
  SimulationLane,
  SimulationMode
} from './exclusions/simulation-mode';
import { LATEST_LIST_MAX_AGE_MS } from '../../lib/exclusion-session/latest-list-source';
import { relativeAge } from '../../utils/relative-age';
import { joinWords } from '../../utils/text';
import type { OverlayState, SessionAction } from './session/machine';
import {
  simulationReports,
  type AppliedWarning,
  type SessionView,
  type UnmodifiedReason
} from './session/session-view';
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
  match: { one: 'match', other: 'matches' },
  image: { one: 'image', other: 'images' },
  picture: { one: 'picture', other: 'pictures' },
  backgroundImage: { one: 'background image', other: 'background images' },
  limit: { one: 'limit', other: 'limits' },
  sessionNote: { one: 'session note', other: 'session notes' }
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
    rowHint: 'Text matched against image attributes · case-sensitive · images only',
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

/**
 * The lanes' headings by engine id — WP Rocket's settings labels: a row's
 * timeout names the lane its row sits in by the heading it carries.
 */
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
  'not-served': 'The rewrite was not delivered: the navigation ended first.',
  'timed-out': 'Rewriting it took too long, so the original was served. Reload to try again.',
  'ineligible-response':
    'Its response isn’t a complete HTML page (for example a partial or XHTML response), so it can’t be rewritten.',
  'network-error': 'Its response failed on the network. Reload to try again.'
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
    return `Simulating ${bannerFeatureName(reason.feature)} took longer than ${String(reason.budgetMs)} ms (the simulation counts toward the time budget), so the page was served unmodified. Reload to try again, or choose As served to apply your exclusions without the simulation.`;
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
 * How long a session lasts, a session note of every banner of an active
 * session (it outlives the page until it is stopped or the tab closes).
 */
export const SESSION_ON_NOTE = 'Stays on in this tab until Stop or the tab closes.';

/**
 * The same, plus what it does to the next pages — said only where this
 * page shows it working (applied, or armed for the next load); on a page
 * the session did not (or may not have) rewritten, that promise would not
 * be honest.
 */
export const SESSION_PERSISTS_NOTE = `${SESSION_ON_NOTE.slice(0, -1)}; every page of this site you open here loads with these exclusions.`;

/**
 * What the session changed on a served document besides the exclusions,
 * each a session note said only when it happened (see `servedNotes`).
 */
export const SERVED_NOTE_COPY = {
  /** The page is the extension's rewritten copy (security indicator, timings). */
  copy: 'The security indicator and timings describe the rewritten copy.',
  serviceWorkersBypassed: 'Service workers are bypassed.',
  prefetchOff: 'Link prefetching is off.'
} as const;

/**
 * The banner's session-notes disclosure label: "1 session note", "3 session notes".
 *
 * @param count Notes behind it (≥ 1).
 */
export const sessionNotesLabel = (count: number): string =>
  `${String(count)} ${countNoun(count, COUNT_WORDS.sessionNote)}`;

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
  const reports = simulationReports(view);
  const notSimulated = reports.find((report) => report.state !== 'simulated');
  const outcome =
    notSimulated === undefined
      ? null
      : simulationOutcomeCopy(
          notSimulated,
          reports.filter((report) => report !== notSimulated)
        );
  if (outcome !== null) return outcome;
  const warnings = view.warnings.map(appliedWarningLine);
  const tail = warnings.length === 0 ? '' : ` ${warnings.join(' ')}`;
  if (view.unmatched > 0) {
    // Every report here simulated (a step that did not run has its own banner).
    const note = simulatedNote(reports);
    return {
      title: 'Applied, with rows that matched nothing',
      body: `${String(view.unmatched)} ${countNoun(view.unmatched, COUNT_WORDS.rowMatches)} no element on this page. Check the rows marked “No match”.${note === null ? '' : ` ${note}`}${tail}`
    };
  }
  const rendered =
    reports.length === 0
      ? RENDER_WORDS
      : simulatedRenderWords(reports.map((report) => report.feature));
  return warnings.length === 0
    ? { title: 'Applied', body: rendered }
    : { title: 'Applied, with warnings', body: `${rendered}${tail}` };
}

/** What an applied page shows. */
const RENDER_WORDS = 'This page was rendered with your exclusions.';

/** The simulated features' compact names (a banner lists several in one sentence). */
const FEATURE_SHORT_NAMES: Readonly<Record<SimulatedFeatureId, string>> = {
  lazyload: SHORT_LABEL_LAZYLOAD,
  defer_all_js: SHORT_LABEL_DEFER_JS,
  delay_js: SHORT_LABEL_DELAY_JS
};

/**
 * Per simulated feature whose rows cover less than the site's own exclusions
 * can: the scope its rows test (LazyLoad rows restore images, while the site's
 * LazyLoad exclusions also cover pictures and background images).
 */
const ROW_SCOPE: Readonly<Partial<Record<SimulatedFeatureId, string>>> = {
  lazyload: `${SHORT_LABEL_LAZYLOAD}: images only`
};

/**
 * A feature's banner name: its compact name when the extension simulates it
 * (every banner names a simulated feature alike), else its lane's heading.
 *
 * @param id The feature.
 */
function bannerFeatureName(id: ExclusionFeatureId): string {
  const short: Readonly<Partial<Record<ExclusionFeatureId, string>>> = FEATURE_SHORT_NAMES;
  return short[id] ?? FEATURE_NAMES[id];
}

/**
 * The site-exclusions note for a page whose given features were simulated:
 * the simulation runs WP Rocket's own lists plus the builder rows, never the
 * exclusions saved in the site's settings (unreadable without site access).
 * Said once in the banner (each simulated lane's version line says it in
 * short, {@link SIMULATION_LANE_COPY}), never where nothing was simulated.
 *
 * @param features The simulated features (any order; repeats ignored).
 * @returns The note, with each feature's narrower row scope in parentheses.
 */
export function siteExclusionsNote(features: readonly SimulatedFeatureId[]): string {
  const scopes = SIMULATED_FEATURES.flatMap(({ id }) =>
    features.includes(id) ? (ROW_SCOPE[id] ?? []) : []
  );
  const scope = scopes.length === 0 ? '' : ` (${scopes.join('; ')})`;
  return `The site’s own WP Rocket exclusions aren’t included; add them as rows${scope}.`;
}

/**
 * The note for these reports when any simulated, else null.
 *
 * @param reports The page's simulation reports (any states).
 */
function simulatedNote(reports: readonly DocumentSimulationReport[]): string | null {
  const features = reports
    .filter((report) => report.state === 'simulated')
    .map((report) => report.feature);
  return features.length === 0 ? null : siteExclusionsNote(features);
}

/**
 * What an applied, simulated page shows — never mistaken for the site's own
 * configuration, and naming the site exclusions the simulation lacks. The
 * features go by their compact names, in registry order (WP Rocket's buffer
 * order), so one sentence holds all of them.
 *
 * @param features The simulated features (any order; repeats ignored).
 */
export function simulatedRenderWords(features: readonly SimulatedFeatureId[]): string {
  const names = SIMULATED_FEATURES.flatMap(({ id }) =>
    features.includes(id) ? [FEATURE_SHORT_NAMES[id]] : []
  );
  return `Rendered with your exclusions and simulated ${joinWords(names)} — not the site’s real setup. ${siteExclusionsNote(features)}`;
}

/**
 * The reports' compact feature names, joined ("A", "A and B", "A, B and C").
 *
 * @param reports The reports, in buffer order.
 */
function featureList(reports: readonly DocumentSimulationReport[]): string {
  return joinWords(reports.map((report) => FEATURE_SHORT_NAMES[report.feature]));
}

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
    case 'unrecorded':
      return {
        title: 'No result for this page',
        body: 'The session didn’t get this page’s result, so your exclusions may not be applied.'
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
    case 'unrecorded':
      return { tone: 'warn', label: 'No result', glyph: 'alert' };
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

/**
 * Why the page does not allow the draft's mode, short (inside the blocked
 * note's parentheses); the lane's own block line says it in full.
 */
const DRAFT_MODE_BLOCK_REASONS: Readonly<Record<DraftModeBlock, string>> = {
  'already-served': 'WP Rocket already does it',
  'delay-served': 'WP Rocket delays scripts here',
  amp: 'AMP page',
  preview: 'preview',
  search: 'search results',
  'page-builder-editor': 'page builder editor'
};

/** The mode control's words every mode lane shares. */
const SHARED_MODE_COPY = {
  labels: {
    served: 'As served',
    simulated: 'Simulated',
    disabled: 'Disabled'
  } satisfies Readonly<Record<SimulationMode, string>>,
  /**
   * The draft's mode the page does not allow: shown checked, dimmed (the
   * draft keeps it for the site's other pages); As served clears it.
   *
   * @param block Why the page does not allow it.
   */
  blockedDraft: (block: DraftModeBlock): string =>
    `Set for this site; doesn’t apply on this page (${DRAFT_MODE_BLOCK_REASONS[block]}). Choose As served to clear it.`,
  /** Why the control is held (its tooltip): an action is in flight. */
  held: 'Wait for the current action to finish.',
  /** The page still runs a simulation the session no longer applies (e.g. after Stop). */
  kept: 'Simulated · reload to see the page without it.',
  /** The admin and login screens' warning (never blocks). */
  adminScreen:
    'This is a WordPress admin or login screen. WP Rocket never optimizes these screens, so a simulation here shows something the site never serves.'
} as const;

/** One mode lane's control words: the shared ones, then its own. */
export type LaneModeCopy = typeof SHARED_MODE_COPY & {
  /** The control's accessible name. */
  readonly groupName: string;
  /**
   * Why the page leaves an option out (one line under the control) — every
   * block the lane can meet (Delay JS never meets `delay-served`).
   */
  readonly blocks: Readonly<Partial<Record<ModeBlock, string>>>;
  /**
   * Disabled is shown on a page WP Rocket does not serve the feature on
   * (allowed: a no-op here); absent for a lane that offers no Disabled.
   */
  readonly disabledChangesNothing?: string;
};

/** The Delay JS lane's mode control: its options, and why one is unavailable. */
export const DELAY_MODE_COPY = {
  ...SHARED_MODE_COPY,
  groupName: `${LABEL_DELAY_JAVASCRIPT_EXECUTION} on this page`,
  blocks: {
    'already-served':
      'WP Rocket already delays scripts on this page — exclusions apply to its output.',
    amp: 'WP Rocket never delays AMP pages.',
    checking: 'Checking whether WP Rocket delays scripts on this page…'
  },
  disabledChangesNothing:
    'WP Rocket doesn’t delay scripts on this page, so Disabled changes nothing here.'
} as const satisfies LaneModeCopy;

/** The Defer JS lane's mode control: its options, and why one is unavailable. */
export const DEFER_MODE_COPY = {
  ...SHARED_MODE_COPY,
  groupName: `${LABEL_LOAD_JAVASCRIPT_DEFERRED} on this page`,
  blocks: {
    'already-served':
      'WP Rocket already defers scripts on this page — exclusions apply to its output.',
    'delay-served':
      'WP Rocket delays scripts on this page and defers them before it delays them, so Defer JS can’t be simulated here.',
    amp: 'WP Rocket never defers AMP pages.',
    checking: 'Checking whether WP Rocket defers scripts on this page…'
  },
  disabledChangesNothing:
    'WP Rocket doesn’t defer scripts on this page, so Disabled changes nothing here.'
} as const satisfies LaneModeCopy;

/** Why WP Rocket never lazy loads a request by its URL (the lane note and the banners share it). */
const LAZYLOAD_URL_SKIP_COPY = {
  preview: 'WP Rocket never lazy loads images on a preview',
  search: 'WP Rocket never lazy loads images on search results',
  'page-builder-editor': 'WP Rocket never lazy loads images in a page builder’s editor'
} as const;

/**
 * The LazyLoad lane's mode control: its options (no Disabled — the
 * feature has no feature-wide disable), and why one is unavailable.
 */
export const LAZYLOAD_MODE_COPY = {
  ...SHARED_MODE_COPY,
  groupName: `${LABEL_IMAGE_LAZYLOAD} on this page`,
  blocks: {
    'already-served':
      'WP Rocket already lazy loads images on this page — exclusions apply to its output.',
    amp: 'WP Rocket never lazy loads images on AMP pages.',
    checking: 'Checking whether WP Rocket lazy loads images on this page…',
    preview: `${LAZYLOAD_URL_SKIP_COPY.preview}, so LazyLoad can’t be simulated here.`,
    search: `${LAZYLOAD_URL_SKIP_COPY.search}, so LazyLoad can’t be simulated here.`,
    'page-builder-editor': `${LAZYLOAD_URL_SKIP_COPY['page-builder-editor']}, so LazyLoad can’t be simulated here.`
  }
} as const satisfies LaneModeCopy;

/** Each mode lane's control words. */
export const MODE_LANE_COPY: Readonly<Record<SimulationLane, LaneModeCopy>> = {
  delayJs: DELAY_MODE_COPY,
  deferJs: DEFER_MODE_COPY,
  lazyload: LAZYLOAD_MODE_COPY
};

/** Each CSP limit of a simulated page: what fails, as it would on the site. */
const CSP_LIMIT_COPY: Readonly<Record<SimulationCspLimit, string>> = {
  eval: 'CSP blocks eval: delayed elements’ event handlers fail, as on the site.',
  data: 'CSP blocks data: scripts: Delay JS falls back to inline copies, as on the site.',
  inline: 'CSP blocks inline scripts: delayed inline scripts fail, as on the site.',
  'inline-after-fallback':
    'If Delay JS switched to inline copies on an earlier page in this tab, CSP blocks them here, as on the site.',
  'trusted-types':
    'Page requires Trusted Types: Delay JS can’t load delayed scripts, as on the site.',
  placeholders:
    'CSP blocks data: images: placeholders look broken until images load, as on the site.'
};

/** What a page's CSP forbids when it blocks a feature's runtime, and what then did not happen. */
const CSP_BLOCKED_COPY: Readonly<Record<'delay_js' | 'lazyload', string>> = {
  delay_js: 'WP Rocket’s inline Delay JS script, as it would on the site, so nothing was delayed',
  lazyload:
    'WP Rocket’s LazyLoad script or its inline options, as it would on the site, so no image was lazy loaded'
};

/** Why a page's CSP was not evaluated (never said as "no CSP"), Delay JS's words. */
const CSP_UNAVAILABLE_COPY: Readonly<Record<SimulationCspUnavailableReason, string>> = {
  oversized: 'CSP not evaluated (too large to check): Delay JS scripts it blocks aren’t named.',
  unreadable: 'CSP not evaluated (unreadable): Delay JS scripts it blocks aren’t named.'
};

/** Why a page's CSP was not evaluated for LazyLoad (its runtime, options and placeholders). */
const LAZYLOAD_CSP_UNAVAILABLE_COPY: Readonly<Record<SimulationCspUnavailableReason, string>> = {
  oversized:
    'CSP not evaluated (too large to check): may block LazyLoad’s script, options or placeholders.',
  unreadable:
    'CSP not evaluated (unreadable): may block LazyLoad’s script, options or placeholders.'
};

/**
 * The caveats said as a line of their own: `runtime-url` is said by the
 * script line instead, whose lead names the address's source
 * ({@link SCRIPT_ADDRESS_LEAD}).
 */
type LineCaveat = Exclude<SimulationCaveat, 'runtime-url'>;

/** What a simulation cannot reproduce on a page. */
const CAVEAT_COPY: Readonly<Record<LineCaveat, string>> = {
  // Page-found caveats: banner limit lines (they warn).
  'combined-js':
    'Combined JS served here; with Delay JS, WP Rocket serves it uncombined, which the simulation can’t.',
  'core-lazy-loading':
    'WordPress added loading="lazy" here, which it skips with LazyLoad on: fallback copies differ slightly. Chromium ignores WordPress’s sizes="auto, …": srcset images may load larger files here.',
  'image-smilies':
    'WordPress image smilies here: WP Rocket prints them slightly differently with LazyLoad on.',
  'foreign-lazy-markup':
    'Another plugin’s lazy-load markup here is lazy loaded again, as WP Rocket would.',
  // LazyLoad's every-page caveats: lane limit lines, short (behind the lane's disclosure).
  'hook-text-placement': 'Style and scripts placed where most themes print them.',
  'above-the-fold-exclusions':
    'Above-the-fold and LCP images aren’t skipped (needs WP Rocket’s site data).',
  'site-filters': 'Site filters, options and DONOTLAZYLOAD aren’t applied.'
};

/** The WP Rocket pattern a page may stop, named for the not-reproduced reason. */
const UNREPRODUCED_REGEX_NAMES: Readonly<Record<PatternRefusal, string>> = {
  'ie-conditionals': 'IE conditional comments',
  'ie-conditional-script': 'IE conditional scripts',
  'xmp-mask': '<xmp> masking',
  'svg-mask': '<svg> masking',
  'meta-charset': 'meta charset',
  'html-comments': 'Defer JS comment stripping',
  'defer-script-src': 'Defer JS script matching',
  'defer-inline-scripts': 'Defer JS inline script matching',
  'defer-replacements': 'Defer JS script rewriting',
  'defer-inline-exclusions': 'Defer JS inline exclusion',
  'defer-file-exclusions': 'Defer JS file exclusion',
  'lazyload-hidden-blocks': 'LazyLoad script and noscript hiding',
  'lazyload-pictures': 'LazyLoad picture matching',
  'lazyload-images': 'LazyLoad image matching',
  'lazyload-picture-image': 'LazyLoad picture image rewriting',
  'lazyload-picture-pattern-size': 'LazyLoad picture image matching',
  'lazyload-tag-length': 'LazyLoad attribute',
  'lazyload-dimension': 'LazyLoad image dimension parsing',
  'lazyload-url': 'LazyLoad URL escaping',
  'lazyload-entities': 'LazyLoad background URL decoding',
  'lazyload-replacements': 'LazyLoad image rewriting'
};

/** The refusals that are no pattern stopping: each has its own banner. */
type OwnRefusal = 'lazyload-injected-scripts' | 'lazyload-runtime-url';

/** The refusals named as a WP Rocket pattern that may stop. */
type PatternRefusal = Exclude<UnreproducedRegex, OwnRefusal>;

/**
 * The banners of the refusals that are no pattern stopping.
 *
 * @param served How the page was rendered instead.
 */
const OWN_REFUSAL_COPY: Readonly<Record<OwnRefusal, (served: string) => StateCopy>> = {
  'lazyload-injected-scripts': (served) => ({
    title: 'Not simulated: LazyLoad’s scripts would be delayed or deferred',
    body: `The Delay JS or Defer JS exclusion list in use would delay or defer LazyLoad’s own scripts, which WP Rocket’s lists never do, so ${served} ${NOT_SIMULATED_REMEDY}`
  }),
  'lazyload-runtime-url': (served) => ({
    title: 'Not simulated: LazyLoad’s script address is too long',
    body: `The address worked out for LazyLoad’s script is longer than the extension can follow, so ${served} ${NOT_SIMULATED_REMEDY}`
  })
};

/**
 * Whether a refusal has its own banner (no pattern stopping).
 *
 * @param regex The refusal.
 */
function isOwnRefusal(regex: UnreproducedRegex): regex is OwnRefusal {
  return Object.hasOwn(OWN_REFUSAL_COPY, regex);
}

/** What to do when a page could not be simulated: the forward actions. */
const NOT_SIMULATED_REMEDY =
  'Test on another page of the site, or choose As served to apply your exclusions without the simulation.';

/** What WP Rocket does, per simulated feature (the banners' verb and its object). */
const FEATURE_VERBS: Readonly<Record<SimulatedFeatureId, string>> = {
  lazyload: 'lazy loads images',
  delay_js: 'delays scripts',
  defer_all_js: 'defers scripts'
};

/**
 * How the page was rendered when one feature's step did not run: as served
 * with the exclusions, or with the other features' simulation.
 *
 * @param simulated The other features' reports that simulated.
 * @param alone The words when nothing else simulated.
 */
function renderedWith(simulated: readonly DocumentSimulationReport[], alone: string): string {
  return simulated.length === 0
    ? alone
    : `the page was rendered with ${featureList(simulated)} simulated and your exclusions.`;
}

/**
 * The applied banner of a simulating session whose step did not run on
 * this page — each state titled with a way forward — or null when the
 * page was simulated (the regular applied words then say so). With both
 * features asked for, the other feature's outcome follows unless the body
 * already says it, then the site-exclusions note when any feature simulated.
 *
 * @param simulation The step's report.
 * @param others The other features' reports on this page (buffer order).
 */
export function simulationOutcomeCopy(
  simulation: DocumentSimulationReport,
  others: readonly DocumentSimulationReport[] = []
): StateCopy | null {
  if (simulation.state === 'simulated') return null;
  const simulated = others.filter((report) => report.state === 'simulated');
  const copy = ownOutcomeCopy(simulation, simulated);
  const tail = others.flatMap((other) => otherOutcomeSentence(simulation, other) ?? []);
  const note = simulatedNote(simulated);
  if (note !== null) tail.push(note);
  return tail.length === 0 ? copy : { title: copy.title, body: [copy.body, ...tail].join(' ') };
}

/**
 * One sentence on another feature's outcome beside a step that did not run.
 *
 * @param first The step that did not run.
 * @param other The other feature's report.
 * @returns The sentence, or null when the first step's words already say it
 *   (Delay JS served, so Defer JS could not run; the other feature simulated,
 *   named by every body but an already-served one).
 */
function otherOutcomeSentence(
  first: DocumentSimulationReport,
  other: DocumentSimulationReport
): string | null {
  const name = FEATURE_SHORT_NAMES[other.feature];
  if (first.reason === 'delay-js-served' && other.state === 'already-served') return null;
  if (other.state !== 'simulated') return `${ownOutcomeCopy(other, []).title} (${name}).`;
  // Every body but an already-served one names the simulated features already.
  return first.state === 'already-served' ? `${name} was simulated.` : null;
}

/**
 * A step's own banner words (a step that did not run: never `simulated`).
 *
 * @param simulation The report.
 * @param simulated The other features' reports that simulated.
 */
function ownOutcomeCopy(
  simulation: DocumentSimulationReport,
  simulated: readonly DocumentSimulationReport[]
): StateCopy {
  const name = FEATURE_SHORT_NAMES[simulation.feature];
  if (simulation.state === 'already-served') {
    const opener = simulated.length === 0 ? 'Nothing was simulated' : `${name} wasn’t simulated`;
    return {
      title: `Applied — WP Rocket already ${FEATURE_VERBS[simulation.feature]} here`,
      body: `${opener}: your exclusions apply to WP Rocket’s own ${name}, as served.`
    };
  }
  if (simulation.state === 'csp-blocked' && simulation.feature !== 'defer_all_js') {
    return {
      title: 'Not simulated: blocked by this page’s Content Security Policy',
      body: `The policy forbids ${CSP_BLOCKED_COPY[simulation.feature]} and ${renderedWith(simulated, 'the page was rendered with your exclusions only.')} ${NOT_SIMULATED_REMEDY}`
    };
  }
  return notApplicableCopy(
    simulation,
    renderedWith(simulated, 'the page was rendered as served, with your exclusions.')
  );
}

/**
 * A not-applicable step's banner, per reason.
 *
 * @param simulation The report (state `not-applicable`).
 * @param served How the page was rendered instead.
 */
function notApplicableCopy(simulation: DocumentSimulationReport, served: string): StateCopy {
  switch (simulation.reason) {
    case 'amp':
      return {
        title: 'Not simulated: AMP page',
        body: `WP Rocket never ${FEATURE_VERBS[simulation.feature]} on AMP pages, so ${served} Choose As served to stop asking for the simulation.`
      };
    case 'preview':
      return {
        title: 'Not simulated: preview',
        body: `${LAZYLOAD_URL_SKIP_COPY.preview}, so ${served} Choose As served to stop asking for the simulation.`
      };
    case 'search':
      return {
        title: 'Not simulated: search page',
        body: `${LAZYLOAD_URL_SKIP_COPY.search}, so ${served} Choose As served to stop asking for the simulation.`
      };
    case 'page-builder-editor':
      return {
        title: 'Not simulated: page builder editor',
        body: `${LAZYLOAD_URL_SKIP_COPY['page-builder-editor']}, so ${served} Choose As served to stop asking for the simulation.`
      };
    case 'no-head-end':
    case 'no-body-end':
    case 'body-end-before-head-end':
      return {
        title: 'Not simulated: page has no usable head or body end',
        body: `LazyLoad’s style and scripts go before the page’s </head> and </body>, which this page lacks, so ${served} ${NOT_SIMULATED_REMEDY}`
      };
    case 'runtime-unavailable':
      return {
        title: 'Not simulated: LazyLoad’s script file is unavailable',
        body: `The extension’s packaged copy of LazyLoad’s script couldn’t be loaded or is damaged, so ${served} Reload the page to retry (if it persists, reload or reinstall the extension), or choose As served to stop asking for the simulation.`
      };
    case 'runtime-undeliverable':
      return {
        title: 'Not simulated: LazyLoad’s script can’t be served on this page',
        body: `This page’s Content Security Policy sandboxes it without allow-same-origin, and Firefox then hides the page from the extension, so LazyLoad’s script can’t be served for it and ${served} Test in a Chromium-based browser, or choose As served to stop asking for the simulation.`
      };
    case 'runtime-mixed-content':
      return {
        title: 'Not simulated: LazyLoad’s script would be blocked as mixed content',
        body: `This https page would load LazyLoad’s script over http, which the browser blocks (as it would on the site), so ${served} Serve WP Rocket’s assets over https, or choose As served to stop asking for the simulation.`
      };
    case 'delay-js-served':
      return {
        title: 'Not simulated: WP Rocket already delays scripts here',
        body: `WP Rocket defers scripts before it delays them, and this page is already delayed, so Defer JS can’t be reproduced and ${served} ${NOT_SIMULATED_REMEDY}`
      };
    case 'unsupported-charset':
      return {
        title: 'Not simulated: page isn’t UTF-8',
        body: `Only UTF-8 pages (or pages whose text is plain ASCII) can be simulated, so ${served} ${NOT_SIMULATED_REMEDY}`
      };
    case 'beyond-exact-reproduction':
    case undefined: {
      const refusal = simulation.unreproducedRegex;
      if (refusal !== undefined && isOwnRefusal(refusal)) return OWN_REFUSAL_COPY[refusal](served);
      const regex =
        refusal === undefined ? 'patterns' : `${UNREPRODUCED_REGEX_NAMES[refusal]} pattern`;
      return {
        title: 'Not simulated: this page can’t be reproduced exactly',
        body: `WP Rocket’s ${regex} may stop on this page, which the simulation can’t reproduce, so ${served} ${NOT_SIMULATED_REMEDY}`
      };
    }
  }
}

/** A LazyLoad caveat every simulated page carries (see {@link LAZYLOAD_PAGE_INDEPENDENT_CAVEATS}). */
type PageIndependentCaveat = (typeof LAZYLOAD_PAGE_INDEPENDENT_CAVEATS)[number];

/**
 * Whether a LazyLoad caveat holds on every simulated page (said in the
 * lane, never as a banner warning).
 *
 * @param caveat The caveat.
 */
function isPageIndependent(caveat: LazyloadCaveat): caveat is PageIndependentCaveat {
  return (LAZYLOAD_PAGE_INDEPENDENT_CAVEATS as readonly LazyloadCaveat[]).includes(caveat);
}

/**
 * Whether a caveat is said as a line of its own (see {@link LineCaveat}).
 *
 * @param caveat The caveat.
 */
function isLineCaveat(caveat: SimulationCaveat): caveat is LineCaveat {
  return caveat !== 'runtime-url';
}

/**
 * What a simulated page cannot show as the site would, one line each (the
 * banner's warnings): the CSP's limits (or why it was not evaluated) and
 * the caveats this page shows — LazyLoad's every-page caveats are said in
 * its lane instead ({@link simulationLaneLimits}), so they never turn every
 * banner into a warning. Empty for any other state, and for a feature that
 * injects no runtime (Defer JS).
 *
 * @param simulation The simulation step's report.
 */
export function simulationLimitLines(simulation: DocumentSimulationReport): string[] {
  if (simulation.state !== 'simulated' || simulation.feature === 'defer_all_js') return [];
  const lines = (simulation.cspLimits ?? []).map((limit) => CSP_LIMIT_COPY[limit]);
  if (simulation.feature === 'lazyload') {
    if (simulation.cspUnavailable !== undefined)
      lines.push(LAZYLOAD_CSP_UNAVAILABLE_COPY[simulation.cspUnavailable]);
    const found = (simulation.caveats ?? []).filter(
      (caveat): caveat is Exclude<LazyloadCaveat, PageIndependentCaveat> =>
        !isPageIndependent(caveat)
    );
    return [...lines, ...found.map((caveat) => CAVEAT_COPY[caveat])];
  }
  if (simulation.cspUnavailable !== undefined)
    lines.push(CSP_UNAVAILABLE_COPY[simulation.cspUnavailable]);
  lines.push(
    ...(simulation.caveats ?? []).filter(isLineCaveat).map((caveat) => CAVEAT_COPY[caveat])
  );
  return lines;
}

/** An end tag the simulation chose among several (the theme's own one is not knowable). */
const PLACEMENT_FALLBACK_COPY: Readonly<Record<LazyloadPlacementFallback, string>> = {
  'first-of-several-head-ends': 'Several </head> tags: LazyLoad’s style went before the first.',
  'last-of-several-body-ends': 'Several </body> tags: LazyLoad’s scripts went before the last.'
};

/**
 * What a simulated page shows where the rows restored images: WP Rocket
 * never lazy loads an excluded image, so it prints no `<noscript>` copy of
 * it, while the simulation's rows restore it after the copy was written.
 */
const RESTORED_NOSCRIPT_COPY =
  'Images your rows restore keep their noscript copy, unlike on the site.';

/** The script line's lead for an address inferred from another plugin's or a theme's asset. */
const INFERRED_SCRIPT_LEAD =
  'Script address inferred from this page; your plugin folder or CDN may differ: ';

/**
 * LazyLoad's script line lead (the address follows), by where the address
 * came from: WP Rocket's beacon tag gives the exact folder (but not a CDN
 * rewrite of the runtime tag), a plugin's or theme's asset assumes the
 * folder names, WordPress's defaults assume every folder.
 */
const SCRIPT_ADDRESS_LEAD: Readonly<Record<LazyloadAssetsUrlSource, string>> = {
  beacon: 'Script address from WP Rocket’s beacon tag; a CDN may serve another: ',
  'plugin-asset': INFERRED_SCRIPT_LEAD,
  'theme-asset': INFERRED_SCRIPT_LEAD,
  default:
    'Script address guessed from WordPress’s default folders; your folders or CDN may differ: '
};

/**
 * A simulated lane's limit lines, behind its "N limits" disclosure —
 * LazyLoad's script address, the end tags it chose among several, the
 * noscript copies of the images the rows restored and its every-page
 * caveats; none for Delay JS or Defer JS. Outcomes stay visible lines
 * instead ({@link SIMULATION_LANE_COPY}'s `undetermined` and `regexLimit`),
 * and the banner says the page-found caveats and CSP limits
 * ({@link simulationLimitLines}).
 *
 * @param simulation The lane's report (`simulated`).
 * @param restored What the rows restored on the page (the lane transform's rewrites).
 * @returns One line per limit (the disclosure's count).
 */
export function simulationLaneLimits(
  simulation: DocumentSimulationReport,
  restored: number
): NoteText[] {
  return simulation.feature === 'lazyload' ? lazyloadLaneLimits(simulation, restored) : [];
}

/**
 * LazyLoad's lane limits (see {@link simulationLaneLimits}): the script line
 * first (its lead names where the address came from), then the page's own
 * caveats, then the other every-page ones.
 *
 * @param simulation The LazyLoad report (`simulated`).
 * @param restored What the rows restored on the page.
 */
function lazyloadLaneLimits(simulation: LazyloadSimulationReport, restored: number): NoteText[] {
  const { runtimeUrl, assetsUrlSource } = simulation;
  const everyPage = (simulation.caveats ?? []).filter(
    (caveat): caveat is Exclude<PageIndependentCaveat, 'runtime-url'> =>
      isPageIndependent(caveat) && isLineCaveat(caveat)
  );
  return [
    // Present on every simulated report (validated at the message boundary).
    ...(runtimeUrl === undefined || assetsUrlSource === undefined
      ? []
      : [
          [SCRIPT_ADDRESS_LEAD[assetsUrlSource], { code: capText(runtimeUrl, LAZYLOAD_URL_SHOWN) }]
        ]),
    ...(simulation.placement?.fallbacks ?? []).map((fallback) => [
      PLACEMENT_FALLBACK_COPY[fallback]
    ]),
    ...(restored > 0 ? [[RESTORED_NOSCRIPT_COPY]] : []),
    ...everyPage.map((caveat) => [CAVEAT_COPY[caveat]])
  ];
}

/** Characters of LazyLoad's script address the lane shows before it is cut (`…`). */
const LAZYLOAD_URL_SHOWN = 160;

/** Every simulated lane's version-line tail: the site-exclusions note in short. */
const WITHOUT_SITE_EXCLUSIONS = ' · without the site’s own exclusions';

/** A mode lane's lines about the simulation on the page it applied to. */
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
   * The Defer JS count line, e.g. "4 deferred and 1 inline wrapped by the
   * simulation · 1 excluded by your rows".
   *
   * @param deferred External scripts the simulation deferred.
   * @param wrapped Inline scripts it wrapped.
   * @param excluded Of those, scripts the rows restored.
   */
  deferLine: (deferred: number, wrapped: number, excluded: number): string =>
    `${String(deferred)} deferred and ${String(wrapped)} inline wrapped by the simulation · ${String(excluded)} excluded by your rows`,
  /**
   * The LazyLoad count line, e.g. "12 images, 2 pictures and 1 background
   * image lazy loaded by the simulation · 3 excluded by your rows".
   *
   * @param counts What the simulation made lazy.
   * @param excluded Of the images, those the rows restored.
   */
  lazyloadLine: (
    counts: Pick<LazyloadSimulationReport, 'images' | 'pictures' | 'backgrounds'>,
    excluded: number
  ): string => {
    const all = [
      [counts.images, COUNT_WORDS.image],
      [counts.pictures, COUNT_WORDS.picture],
      [counts.backgrounds, COUNT_WORDS.backgroundImage]
    ] as const;
    // Zero kinds are left out, unless every kind is zero (then all say so).
    const some = all.filter(([count]) => count > 0);
    const words = (some.length === 0 ? all : some).map(
      ([count, noun]) => `${String(count)} ${countNoun(count, noun)}`
    );
    return `${joinWords(words)} lazy loaded by the simulation · ${String(excluded)} excluded by your rows`;
  },
  /**
   * The simulated version, and the site's when it serves another one, then
   * the site-exclusions note in short (the banner says it in full).
   *
   * @param simulation The simulation step's report.
   */
  version: (simulation: DocumentSimulationReport): string =>
    simulation.siteVersion === undefined || simulation.siteVersion === simulation.wpRocketVersion
      ? `Simulated · WP Rocket ${simulation.wpRocketVersion}${WITHOUT_SITE_EXCLUSIONS}`
      : `Simulated · WP Rocket ${simulation.wpRocketVersion} (the site serves ${simulation.siteVersion})${WITHOUT_SITE_EXCLUSIONS}`,
  /**
   * A simulated lane's limits disclosure label, e.g. "3 limits".
   *
   * @param count The limit lines (≥ 1).
   */
  limits: (count: number): string => `${String(count)} ${countNoun(count, COUNT_WORDS.limit)}`,
  /**
   * Scripts left as served because WP Rocket's verdict on them depends on
   * ids it draws at random (an outcome, shown in the lane).
   *
   * @param count The count (≥ 1).
   */
  undetermined: (count: number): string =>
    `${String(count)} left as served: WP Rocket decides ${countNoun(count, COUNT_WORDS.it)} with random ids.`,
  /** WP Rocket's own pattern stops on the page: it would delay nothing either (an outcome, shown in the lane). */
  regexLimit:
    'Delay JS’s pattern stops here (PHP backtracking limit): nothing delayed, as on the site.'
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
