/**
 * Free edges of a PCRE parse: the parts of a row that never decide whether
 * it matches somewhere in a subject (see {@link withoutFreeEdges}).
 */
import type { ParsedPattern, PatternNode } from './parse';

/**
 * A row with each top-level alternative's free edges dropped: its leading
 * and trailing repeats that may repeat zero times (`.*`, `\s*`, `(?:…)?`)
 * and hold no capture group or option setting. Whether a row matches
 * *somewhere* in a subject — all a Delay JS verdict asks — is unchanged,
 * for every subject:
 * - a match of `E R` (E a free edge) contains a match of `R` (the rest of
 *   it, at the position E's part ends; assertions and lookarounds in `R`
 *   test the subject at their own positions, which do not move), and a
 *   match of `R` is one of `E R` with E repeated zero times — the same for
 *   `R E`;
 * - without captures inside, dropping E renumbers no group, so no
 *   back-reference changes; without option settings, no later part of the
 *   row changes meaning;
 * - only edges are dropped (nothing before a leading one, nothing after a
 *   trailing one), so no anchor or lookaround next to them loses its place
 *   in the match — it stays at the match's edge, where the dropped part
 *   could have been empty.
 *
 * Used where only that is asked: the Delay JS matcher (a leading `.*`
 * costs a backtracking JS regex quadratic time) and the mask-id probe (a
 * `.*` that could read an id byte no longer makes `.*plugin1` look
 * id-dependent).
 *
 * @param parsed The row's runtime parse.
 */
export function withoutFreeEdges(parsed: ParsedPattern): ParsedPattern {
  if (!parsed.complete || parsed.issues.length > 0) return parsed;
  const alternatives = parsed.alternatives.map((branch) => {
    let start = 0;
    let end = branch.length;
    while (start < end && isFreeEdge(branch[start])) start++;
    while (end > start && isFreeEdge(branch[end - 1])) end--;
    return branch.slice(start, end);
  });
  return { ...parsed, alternatives };
}

/** Whether a node may match nothing, unconditionally, and holds no capture or option. */
function isFreeEdge(node: PatternNode | undefined): boolean {
  return node?.type === 'repeat' && node.min === 0 && !holdsCaptureOrOption(node.node);
}

/** Whether a node holds a capture group, an option setting or a back-reference. */
function holdsCaptureOrOption(node: PatternNode): boolean {
  switch (node.type) {
    case 'option':
    case 'backref':
    case 'keep':
      return true;
    case 'group':
      return (
        node.kind === 'capture' ||
        node.alternatives.some((branch) => branch.some(holdsCaptureOrOption))
      );
    case 'repeat':
      return holdsCaptureOrOption(node.node);
    default:
      return false;
  }
}
