/**
 * Many `str_replace` calls in one pass: when every occurrence of every
 * search text in the subject is disjoint from every other (and the caller
 * proved no replacement can create a new occurrence), running PHP's
 * `str_replace` once per search, in any order, replaces exactly those
 * occurrences — so one left-to-right pass gives the same text in linear time
 * instead of one full rescan per search.
 */
import type { NextOccurrence } from '../../utils/next-occurrence';

/**
 * Where an occurrence's key ends: given a text, the finder of the end
 * (exclusive) of the key region starting at a `<` there, or `-1` when none
 * can start there. It must be read from the text inside the region only, so
 * a search's key (its region at 0, read on the search alone) is also the
 * subject's region wherever the search occurs.
 */
export type KeyEnds = (text: string) => NextOccurrence;

/** Code units of lookup work allowed per subject code unit before giving up. */
const LOOKUP_WORK_PER_UNIT = 4;

/** Lookup work always allowed (short subjects). */
const LOOKUP_WORK_FLOOR = 1 << 16;

/** The search texts sharing one key. */
type KeyGroups = ReadonlyMap<string, readonly string[]>;

/**
 * The searches grouped by key, and the key lengths (a subject position
 * whose key has another length cannot start any search).
 *
 * @param searches The search texts.
 * @param keyEnds The key region's end finder.
 * @throws {@link Error} for a search that does not start with `<` or has no key.
 */
function groupByKey(
  searches: Iterable<string>,
  keyEnds: KeyEnds
): { readonly groups: KeyGroups; readonly lengths: ReadonlySet<number> } {
  const groups = new Map<string, string[]>();
  const lengths = new Set<number>();
  for (const search of searches) {
    const end = search.startsWith('<') ? keyEnds(search)(0) : -1;
    if (end === -1 || end > search.length) {
      throw new Error(`Disjoint replace cannot key the search text ${JSON.stringify(search)}`);
    }
    const key = search.slice(0, end);
    lengths.add(key.length);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [search]);
    else group.push(search);
  }
  return { groups, lengths };
}

/**
 * Replace every occurrence of every search text in one pass, or report that
 * the occurrences are not pairwise disjoint (two searches, or two
 * occurrences of one, overlap or touch the same position) or too costly to
 * locate — then the caller must replace sequentially.
 *
 * Occurrences are found from every `<`: its key is looked up only when some
 * search has a key that long, then each search of that key is compared in
 * place. The work is bounded by
 * {@link LOOKUP_WORK_PER_UNIT} per subject code unit, so hostile subjects
 * (many `<` before one far `>`) give up instead of going quadratic.
 *
 * Callers must have proved that no replacement can create an occurrence
 * (an occurrence holding replaced text); this function cannot see that.
 *
 * @param subject The text.
 * @param replacements Each search text (starting with `<`) and its replacement.
 * @param keyEnds How a would-be occurrence's key is delimited.
 * @returns The replaced text, or `null` when the one-pass result could differ.
 * @throws What {@link groupByKey} throws.
 */
export function replaceDisjoint(
  subject: string,
  replacements: ReadonlyMap<string, string>,
  keyEnds: KeyEnds
): string | null {
  if (replacements.size === 0) return subject;
  const { groups, lengths } = groupByKey(replacements.keys(), keyEnds);
  const keyEnd = keyEnds(subject);
  const budget = LOOKUP_WORK_FLOOR + LOOKUP_WORK_PER_UNIT * subject.length;
  let work = 0;
  const parts: string[] = [];
  let copied = 0;
  for (let at = subject.indexOf('<'); at !== -1; at = subject.indexOf('<', at + 1)) {
    const end = keyEnd(at);
    if (end === -1) continue;
    if (!lengths.has(end - at)) continue;
    work += end - at;
    const group = groups.get(subject.slice(at, end));
    if (group === undefined) continue;
    let found: string | undefined;
    for (const search of group) {
      work += search.length;
      if (work > budget) return null;
      if (!subject.startsWith(search, at)) continue;
      // Two searches at one position: whichever runs first wins, so order matters.
      if (found !== undefined) return null;
      found = search;
    }
    if (work > budget) return null;
    if (found === undefined) continue;
    // Starts inside the previous occurrence: the first replacement would break this one.
    if (at < copied) return null;
    parts.push(subject.slice(copied, at), replacements.get(found) as string);
    copied = at + found.length;
  }
  parts.push(subject.slice(copied));
  return parts.join('');
}
