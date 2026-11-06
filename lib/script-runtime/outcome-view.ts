/**
 * The live script read's words: the section's label, each state's and
 * group's name and tone, why a script is in its state, the read's notes
 * (cut list, scripts outside every state filter) and each script's code
 * notes, and the misses with their recoveries. Pure — the panel renders
 * what this decides.
 */
import { formatCount } from '../../utils/format-count';
import type { AskMiss } from '../messaging/bounded-ask';
import { SCRIPT_RUNTIME_LIMITS } from '../messaging/script-runtime';
import {
  FULL_TEXT_MAX,
  type ScriptGroup,
  type ScriptRuntimeRecord,
  type ScriptRuntimeState
} from './classify';
import { SCRIPT_RUNTIME_ASK_DEADLINE_MS, type LiveScriptRecord } from './read-live';

/** The section's label: what this list reads, and what it is not. */
export const LIVE_STATE_LABEL = 'Live DOM state (not the snapshot passed to detection)';

/** The line under the label: how to see Delay JS make progress. */
export const LIVE_STATE_HINT =
  'Read from the page as it is now. Interact with the page (scroll, click, type) so Delay JS runs its delayed scripts, then read again.';

/** The line once the page reloaded or navigated after the shown read. */
export const RUNTIME_STALE_COPY =
  'The page reloaded since this read — these states describe the earlier page. Read again for the current one.';

/** A tone of the status vocabulary (icon + tint; the panel maps it). */
export type RuntimeTone = 'ok' | 'warn' | 'error' | 'info' | 'neutral';

/** Each state's name. */
export const RUNTIME_STATE_LABELS: Readonly<Record<ScriptRuntimeState, string>> = {
  executed: 'Executed',
  failed: 'Failed',
  skipped: 'Skipped',
  pending: 'Pending',
  'not-delayed': 'Not delayed',
  unknown: 'Unknown state'
};

/** Each state's tone. */
export const RUNTIME_STATE_TONES: Readonly<Record<ScriptRuntimeState, RuntimeTone>> = {
  executed: 'ok',
  failed: 'error',
  skipped: 'neutral',
  pending: 'info',
  'not-delayed': 'neutral',
  unknown: 'warn'
};

/** Each group's name. */
export const RUNTIME_GROUP_LABELS: Readonly<Record<ScriptGroup, string>> = {
  theme: 'Theme',
  plugin: 'Plugins',
  inline: 'Inline',
  other: 'Other'
};

/** The list's empty view when the chosen group has no script in the read. */
export const RUNTIME_GROUP_EMPTY_TITLES: Readonly<Record<ScriptGroup, string>> = {
  theme: 'No theme scripts in this read',
  plugin: 'No plugin scripts in this read',
  inline: 'No inline scripts in this read',
  other: 'No scripts from other sources in this read'
};

/** The list's empty view when the page has no script at all. */
export const NO_SCRIPTS_COPY = {
  title: 'No scripts on the page now',
  description: 'The page had no script elements when it was read.'
} as const;

/** Why a failed script failed, by the status value WP Rocket's runtime stamps. */
const FAILURE_REASONS: Readonly<Record<string, string>> = {
  'failed-network': 'Delay JS tried to run it, but its file failed to load.',
  'failed-transform': "Delay JS couldn't prepare it to run (an error while rewriting the tag)."
};

/**
 * Why the script is in its state (one sentence).
 *
 * @param record The classified script.
 * @returns The sentence.
 */
export function stateReason(
  record: Pick<ScriptRuntimeRecord, 'state' | 'rawStatus' | 'structuredData'>
): string {
  const raw = record.rawStatus ?? '';
  switch (record.state) {
    case 'executed':
      return 'Delay JS ran it.';
    case 'failed':
      return Object.hasOwn(FAILURE_REASONS, raw)
        ? (FAILURE_REASONS[raw] ?? '')
        : `Delay JS marked it as failed (“${raw}”).`;
    case 'skipped':
      return 'A nomodule fallback: this browser runs modules, so Delay JS skipped it.';
    case 'pending':
      return 'Delayed and not run yet: Delay JS runs it after the first user interaction.';
    case 'not-delayed':
      return record.structuredData
        ? 'Structured data (JSON-LD): read as data, never run.'
        : 'Delay JS doesn’t handle it: the browser loads it as served (or Delay JS was loading it during the read — read again).';
    case 'unknown':
      return `Delay JS marked it “${raw}”, a status this version of the extension doesn’t know.`;
  }
}

/** How many listed scripts no state filter covers, by state. */
export interface OutsideFilterCounts {
  readonly skipped: number;
  readonly unknown: number;
}

/**
 * The note naming the scripts no state filter covers (they are listed under
 * all states only), or null when there are none.
 *
 * @param counts See {@link OutsideFilterCounts}.
 */
export function outsideFiltersNote(counts: OutsideFilterCounts): string | null {
  const parts: string[] = [];
  if (counts.skipped > 0) {
    parts.push(
      counts.skipped === 1
        ? '1 skipped script (a nomodule fallback this browser doesn’t need)'
        : `${formatCount(counts.skipped)} skipped scripts (nomodule fallbacks this browser doesn’t need)`
    );
  }
  if (counts.unknown > 0) {
    parts.push(
      `${counts.unknown === 1 ? '1 script' : `${formatCount(counts.unknown)} scripts`} with a status this version doesn’t know`
    );
  }
  if (parts.length === 0) return null;
  return `${parts.join(' and ')}: listed under “All states” only.`;
}

/**
 * The note when the page had more scripts than the read lists, or null.
 *
 * @param read The read's count facts.
 */
export function truncatedNote(read: {
  readonly truncated: boolean;
  readonly total: number;
  readonly listed: number;
}): string | null {
  if (!read.truncated) return null;
  return `The page has ${formatCount(read.total)} scripts; the first ${formatCount(read.listed)} are listed.`;
}

/** The note on a script whose code the read's shared budget cut to its preview. */
export const TEXT_CUT_NOTE = `Only the start of this code arrived: one read carries up to ${formatCount(SCRIPT_RUNTIME_LIMITS.textBudgetUnits)} characters of code for all scripts together, and they ran out before this one.`;

/** The note on a script longer than the per-script cap. */
export const TEXT_CAPPED_NOTE = `Shortened to its first ${formatCount(FULL_TEXT_MAX)} characters.`;

/**
 * Whether a full text was cut at the per-script cap: it holds the cap's
 * code points plus the ellipsis the cap appends. A text whose own last
 * character is `…` at exactly that length reads as cut too — the safe side.
 *
 * @param fullText The record's full text.
 */
export function fullTextCapped(fullText: string): boolean {
  // Fewer units than the cap cannot hold cap + 1 code points.
  if (fullText.length <= FULL_TEXT_MAX || !fullText.endsWith('…')) return false;
  let points = 0;
  // Count code points, stopping early once past the capped length.
  for (let index = 0; index < fullText.length && points <= FULL_TEXT_MAX + 1; index += 1) {
    const unit = fullText.charCodeAt(index);
    // A high surrogate followed by a low one is one code point.
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = fullText.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    points += 1;
  }
  return points === FULL_TEXT_MAX + 1;
}

/**
 * The note on a script's code, or null when the whole code is shown.
 *
 * @param record The live record.
 */
export function codeNote(
  record: Pick<LiveScriptRecord, 'fullTextCut' | 'fullText'>
): string | null {
  if (record.fullTextCut) return TEXT_CUT_NOTE;
  return fullTextCapped(record.fullText) ? TEXT_CAPPED_NOTE : null;
}

/** What the reader can do about a miss. */
export type RuntimeRecovery = 'retry' | 'reload-page';

/** A miss, as shown. */
export interface RuntimeMissView {
  readonly title: string;
  readonly message: string;
  /** In order; the first is the primary action. */
  readonly recoveries: readonly RuntimeRecovery[];
}

/** Sentence ending a miss: nothing was read. */
const NOTHING_READ = 'No script was read.';

/**
 * A miss of the read: the page never answered usably.
 *
 * @param miss How the ask missed.
 */
export function describeRuntimeMiss(miss: AskMiss): RuntimeMissView {
  switch (miss) {
    case 'no-receiver':
      return {
        title: "The page isn't listening",
        message: `The extension is not active on this page yet — reload it (an http or https page) and read again. ${NOTHING_READ}`,
        recoveries: ['reload-page', 'retry']
      };
    case 'timeout':
      return {
        title: "The page didn't answer in time",
        message: `No answer within ${formatCount(SCRIPT_RUNTIME_ASK_DEADLINE_MS / 1000)} s. Read again; reload the page if it keeps happening.`,
        recoveries: ['retry', 'reload-page']
      };
    case 'invalid-reply':
      return {
        title: "The page's answer was unreadable",
        message:
          'The page runs another version of the extension — reload it so both match, then read again.',
        recoveries: ['reload-page', 'retry']
      };
    case 'failed':
      return {
        title: "Couldn't reach the page",
        message: `Asking the page for its scripts failed — reload it and read again. ${NOTHING_READ}`,
        recoveries: ['reload-page', 'retry']
      };
  }
}
