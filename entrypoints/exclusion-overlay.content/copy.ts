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
import type { OverlayState, SessionAction } from './session/machine';
import type { AppliedWarning, SessionView, UnmodifiedReason } from './session/session-view';
import type { SaveState } from './controller';

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
  more: (count: number): string => `And ${String(count)} more ${count === 1 ? 'row' : 'rows'}.`
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
        `WP Rocket defers no script on this page because of ${rows === 1 ? 'this row' : 'these rows'}:`,
      offOutcome: (rows) =>
        `Apply still runs and previews the page as WP Rocket serves it, with no script deferred. Edit or remove ${rows === 1 ? 'it' : 'them'} to defer scripts again.`,
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
    return `${positions.length === 1 ? 'row' : 'rows'} ${join(positions)}`;
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
        `${String(counts.undetermined)} left as served: how WP Rocket matched ${counts.undetermined === 1 ? 'it' : 'them'} can’t be read from this page.`
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
    `${String(count)} more ${count === 1 ? 'row' : 'rows'} removed.`,
  /**
   * A batch's count (paste, restored draft, apply).
   *
   * @param summary The batch's count.
   */
  summary: (summary: BatchSummary): string => {
    const noun = BATCH_NOUNS[summary.source];
    const rows = (count: number): string =>
      `${String(count)} ${noun}${count === 1 ? 'row' : 'rows'}`;
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

/** A paste the lane cap cut short. */
export const PASTE_COPY = {
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
    `${String(lines)} pasted ${lines === 1 ? 'line was' : 'lines were'} not added: a lane holds ${String(max)} rows at most.`
} as const;

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
    `Copied ${String(count)} ${count === 1 ? 'exclusion' : 'exclusions'}${as}`,
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

/**
 * The words of an unmodified page's reason.
 *
 * @param reason The reason.
 */
export function unmodifiedCopy(reason: UnmodifiedReason): string {
  if (reason.kind === 'failed') return DOCUMENT_FAILURE_COPY[reason.reason];
  const row = reason.row === null ? '' : ` (row ${reason.row})`;
  return `${FEATURE_NAMES[reason.feature]}${row} took longer than ${String(reason.budgetMs)} ms, so the page was served unmodified. Simplify the row, then apply again.`;
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
  const warnings = view.warnings.map(appliedWarningLine);
  const tail = warnings.length === 0 ? '' : ` ${warnings.join(' ')}`;
  if (view.unmatched > 0) {
    return {
      title: 'Applied, with rows that matched nothing',
      body: `${String(view.unmatched)} ${view.unmatched === 1 ? 'row matches' : 'rows match'} no element on this page. Check the rows marked “No match”.${tail}`
    };
  }
  return warnings.length === 0
    ? { title: 'Applied', body: 'This page was rendered with your exclusions.' }
    : {
        title: 'Applied, with warnings',
        body: `This page was rendered with your exclusions.${tail}`
      };
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
    case 'applied':
      return appliedCopy(view);
    case 'unmodified':
      return { title: 'Served unmodified', body: unmodifiedCopy(view.reason) };
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
  readonly glyph: 'idle' | 'waiting' | 'check' | 'alert' | 'blocked' | 'spinner' | 'question';
}

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
