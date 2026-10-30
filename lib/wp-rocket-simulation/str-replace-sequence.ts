/**
 * PHP's `str_replace` called once per search text, in order, over a whole
 * page — the way WP Rocket's buffer passes rewrite what their regexes
 * matched. Done in one linear pass when the caller proved that gives the
 * same text ({@link replaceDisjoint}), else replayed call by call within a
 * bounded amount of work, so a hostile page cannot make a transform
 * quadratic: past the bound the caller refuses the page instead.
 */
import { replaceDisjoint, type KeyEnds } from './disjoint-replace';

/**
 * Code units the call-by-call replay may rescan in total per transform
 * (each call reads the whole subject). Only pages one pass cannot replace
 * get there; the replay then stops within about 0.2 s (measured: Node 24,
 * a 4 MiB page of overlapping tags), well inside a document step's budget.
 * PHP has no such limit: a page beyond it is not simulated.
 */
export const REPLACEMENT_WORK_LIMIT = 2 ** 28;

/** Thrown by a replay that passes {@link REPLACEMENT_WORK_LIMIT}. */
export class ReplacementWorkExceeded extends Error {
  override readonly name = 'ReplacementWorkExceeded';
}

/** The replay's running total of code units read (one per transform run). */
export interface ReplacementWork {
  units: number;
  /** The transform's own bound, measured for its passes (default {@link REPLACEMENT_WORK_LIMIT}). */
  readonly limit?: number;
}

/**
 * PHP's `str_replace` on strings, counting the code units it reads. An
 * empty search changes nothing (PHP 8 returns the subject as is).
 *
 * @param work The running total (mutated).
 * @param subject The text searched.
 * @param search The text replaced.
 * @param replacement Its replacement.
 * @throws {@link ReplacementWorkExceeded} past the work's limit.
 */
export function strReplaceCounted(
  work: ReplacementWork,
  subject: string,
  search: string,
  replacement: string
): string {
  work.units += subject.length;
  if (work.units > (work.limit ?? REPLACEMENT_WORK_LIMIT)) throw new ReplacementWorkExceeded();
  if (search === '' || search === replacement) return subject;
  return subject.split(search).join(replacement);
}

/**
 * Count a pass over the whole subject that is not a `str_replace` (a
 * `preg_replace` replayed per call) against the same bound.
 *
 * @param work The running total (mutated).
 * @param units The code units the pass reads.
 * @throws {@link ReplacementWorkExceeded} past the work's limit.
 */
export function countReplacementWork(work: ReplacementWork, units: number): void {
  work.units += units;
  if (work.units > (work.limit ?? REPLACEMENT_WORK_LIMIT)) throw new ReplacementWorkExceeded();
}

/**
 * Replace each search text in order, as PHP's sequential `str_replace`
 * calls over the whole page do: in one pass when the caller proved no
 * replacement can create an occurrence and the occurrences are disjoint,
 * else call by call.
 *
 * @param html The page.
 * @param order The search texts in call order (repeats included).
 * @param replacements Each distinct search text's replacement.
 * @param createsNone Whether no replacement can create an occurrence of any search text.
 * @param keyEnds How the one pass keys an occurrence.
 * @param work The replay's work so far.
 * @throws {@link ReplacementWorkExceeded} when the replay passes its limit.
 */
export function replaceInOrder(
  html: string,
  order: readonly string[],
  replacements: ReadonlyMap<string, string>,
  createsNone: boolean,
  keyEnds: KeyEnds,
  work: ReplacementWork
): string {
  const once = createsNone ? replaceDisjoint(html, replacements, keyEnds) : null;
  if (once !== null) return once;
  let out = html;
  for (const search of order) {
    out = strReplaceCounted(work, out, search, replacements.get(search) as string);
  }
  return out;
}
