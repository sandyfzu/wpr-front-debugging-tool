/**
 * The overlay footer's one status line: what most needs saying about the
 * draft right now. A draft over the set cap comes first — it is lost when
 * the overlay closes, and nothing else on screen says so — then rows that
 * need fixing, an unavailability Apply cannot fix, unapplied edits, and the
 * draft's save state.
 */
import { DRAFT_TOO_LARGE_WORDS, saveStateWords } from './copy';
import type { SaveState } from './controller';

/** What the footer line is chosen from. */
export interface FooterFacts {
  /** Rows with a problem. */
  readonly invalid: number;
  /** The session is unavailable and applying again won't help. */
  readonly stuck: boolean;
  /** The draft differs from what is applied. */
  readonly dirty: boolean;
  readonly save: SaveState;
}

/** The footer line: its words and tone. */
export interface FooterLine {
  readonly text: string;
  readonly tone: 'muted' | 'error';
}

/**
 * Whether the draft is over the set cap (it cannot be kept).
 *
 * @param save The draft's save state.
 */
export function draftTooLarge(save: SaveState): boolean {
  return save.kind === 'not-saved' && save.reason === 'too-large';
}

/**
 * The footer line for these facts, or `null` when there is nothing to say.
 *
 * @param facts The draft's facts.
 */
export function footerLine(facts: FooterFacts): FooterLine | null {
  if (draftTooLarge(facts.save)) return { text: DRAFT_TOO_LARGE_WORDS, tone: 'error' };
  if (facts.invalid > 0) {
    const rows = facts.invalid === 1 ? 'row needs' : 'rows need';
    return { text: `${String(facts.invalid)} ${rows} fixing`, tone: 'error' };
  }
  if (facts.stuck) {
    return { text: 'Applying again won’t help until the cause above is fixed', tone: 'muted' };
  }
  if (facts.dirty) return { text: 'Edits not applied yet', tone: 'muted' };
  const words = saveStateWords(facts.save);
  if (words === null) return null;
  return { text: words, tone: facts.save.kind === 'not-saved' ? 'error' : 'muted' };
}
