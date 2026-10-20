/**
 * Attribute edits over a tag's own text. Each edit re-locates the attribute
 * in the (small) tag text and returns the new text, so a transform's
 * sequential edits never fight over spans; the transform then emits ONE
 * patch per edited tag (its new opening-tag text), which makes document
 * patches disjoint by construction — `applyPatches` stays a fail-fast
 * composition of region removals and tag replacements.
 *
 * Raw-text semantics throughout: values move as served (entities ride
 * along; the consuming parser decodes them) — the only escaping is the
 * quote character a value would collide with.
 */
import { parseTagAt } from './html-scan';
import type { ParsedTag, ScannedAttribute } from './html-scan';
import { FDT_EXCLUDED_RESOURCE } from '../wp-rocket/constants';
import type { ExclusionFeatureId } from './set';

/** One text replacement over original string coordinates. */
export interface TextPatch {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Apply patches right-to-left over the original coordinates. Patches must
 * not overlap — a transform emits at most one patch per tag span, so an
 * overlap is broken transform logic, never input shape. Adjacent patches
 * are fine: sharing an edge coordinate (`previous.end === patch.start`,
 * zero-width insertions at one offset included) is not an overlap.
 *
 * @param html The original document text.
 * @param patches The patches (any order; zero-width insertions allowed).
 * @returns The rewritten text; the input itself when there are no patches.
 * @throws {@link Error} when two patches overlap (a patch's start strictly
 *   inside a previous patch's span) — a bug to fix, not to hide.
 */
export function applyPatches(html: string, patches: readonly TextPatch[]): string {
  if (patches.length === 0) return html;
  const sorted = [...patches].sort((left, right) => right.start - left.start);
  let out = html;
  for (let index = 0; index < sorted.length; index++) {
    const patch = sorted[index];
    if (patch === undefined) break;
    const previous = sorted[index + 1];
    if (previous !== undefined && previous.end > patch.start) {
      throw new Error(
        `Overlapping HTML patches [${String(previous.start)},${String(previous.end)}) and [${String(patch.start)},${String(patch.end)})`
      );
    }
    out = out.slice(0, patch.start) + patch.text + out.slice(patch.end);
  }
  return out;
}

/**
 * Find one of a parsed tag's attributes by (lowercased) name.
 *
 * @param tag The parsed tag (from the scanner or the editor's re-parse).
 * @param name The attribute name (any casing).
 */
export function findAttribute(tag: ParsedTag, name: string): ScannedAttribute | null {
  const lower = name.toLowerCase();
  return tag.attrs.find((attr) => attr.name === lower) ?? null;
}

/**
 * Re-parse a tag's own text after an edit — the editor's sequential-edits
 * mechanism: spans are always current.
 *
 * @param tagText The tag's current text (from `<` through `>`).
 */
function reparsed(tagText: string): ParsedTag {
  return parseTagAt(tagText, 0);
}

/**
 * Remove one attribute: the attribute plus its following whitespace run, or
 * — when the attribute is the last before the tag's bracket (`>` or `/>`) —
 * its preceding run, so the tag never grows double whitespace or a space
 * before its bracket.
 *
 * @param tagText The tag's current text.
 * @param name The attribute name (any casing).
 * @returns The new tag text (unchanged when the attribute is absent).
 */
export function removeAttribute(tagText: string, name: string): string {
  const attr = findAttribute(reparsed(tagText), name);
  if (attr === null) return tagText;
  const tail = tagText.slice(attr.attrEnd);
  if (tail.startsWith('>') || tail.startsWith('/>')) {
    const before = tagText.slice(0, attr.attrStart);
    const precedingWhitespace = /\s+$/.exec(before)?.[0] ?? '';
    return `${before.slice(0, before.length - precedingWhitespace.length)}${tail}`;
  }
  const trailingWhitespace = /^\s+/.exec(tail)?.[0] ?? '';
  return `${tagText.slice(0, attr.attrStart)}${tail.slice(trailingWhitespace.length)}`;
}

/**
 * Choose the quote and escaping for embedding a value: `"` unless the value
 * carries one (then `'`), and `&quot;` only when both quotes appear. `&` is
 * never escaped — values move as raw served text and decode back identically.
 *
 * @param value The raw value text.
 * @returns The embedding quote plus the (possibly escaped) text.
 */
function embedValue(value: string): { quote: '"' | "'"; text: string } {
  const hasDouble = value.includes('"');
  const hasSingle = value.includes("'");
  if (hasDouble && hasSingle) return { quote: '"', text: value.replaceAll('"', '&quot;') };
  if (hasDouble) return { quote: "'", text: value };
  return { quote: '"', text: value };
}

/**
 * Write an existing attribute's value in place: the quote style is kept
 * (switched only when the value carries that quote), an unquoted value is
 * re-quoted, and a valueless attribute gains its value.
 *
 * @param tagText The tag's current text.
 * @param name The attribute name (any casing).
 * @param value The new raw value.
 * @returns The new tag text (unchanged when the attribute is absent).
 */
export function setAttributeValue(tagText: string, name: string, value: string): string {
  const attr = findAttribute(reparsed(tagText), name);
  if (attr === null) return tagText;
  if (attr.value === null || attr.valueStart === null || attr.valueEnd === null) {
    // Valueless attribute: replace the bare name with name="value".
    const { text } = embedValue(value);
    return `${tagText.slice(0, attr.attrStart)}${attr.name}="${text}"${tagText.slice(attr.attrEnd)}`;
  }
  if (attr.quote === '') {
    // Unquoted value: re-quote (the new value may carry whitespace or `>`).
    const { text } = embedValue(value);
    return `${tagText.slice(0, attr.valueStart)}"${text}"${tagText.slice(attr.valueEnd)}`;
  }
  if (value.includes(attr.quote)) {
    // The value carries the attribute's own quote — embed with the other one.
    const { quote, text } = embedValue(value);
    return `${tagText.slice(0, attr.valueStart - 1)}${quote}${text}${quote}${tagText.slice(attr.valueEnd + 1)}`;
  }
  return `${tagText.slice(0, attr.valueStart)}${value}${tagText.slice(attr.valueEnd)}`;
}

/**
 * Add an attribute just before the opening tag's bracket (before the
 * self-closing slash when present), with the whitespace the tag needs.
 *
 * @param tagText The tag's current text.
 * @param name The attribute name.
 * @param value The raw value.
 * @returns The new tag text.
 */
export function addAttributeValue(tagText: string, name: string, value: string): string {
  const current = reparsed(tagText);
  const { quote, text } = embedValue(value);
  const gt = current.openingEnd - 1; // the `>`
  const insertAt = current.selfClosing ? gt - 1 : gt;
  const needsSpace = insertAt > 0 && !/\s/.test(tagText[insertAt - 1] ?? '');
  return `${tagText.slice(0, insertAt)}${needsSpace ? ' ' : ''}${name.toLowerCase()}=${quote}${text}${quote}${tagText.slice(insertAt)}`;
}

/**
 * Stamp the FDT exclusion marker on an element, accumulating the feature id
 * as CSV (comma + space, the tool's own accumulation format): an absent
 * marker gains the id; a present one keeps its raw value and appends `, id`
 * — never clobbering, never duplicating (already-listed ids, compared
 * trimmed, stamp nothing).
 *
 * @param tagText The tag's current text.
 * @param featureId The feature to list on the marker.
 * @returns The new tag text (unchanged when the id is already listed).
 */
export function stampExclusionMarker(tagText: string, featureId: ExclusionFeatureId): string {
  const attr = findAttribute(reparsed(tagText), FDT_EXCLUDED_RESOURCE);
  if (attr === null) return addAttributeValue(tagText, FDT_EXCLUDED_RESOURCE, featureId);
  if (attr.value === null) return setAttributeValue(tagText, FDT_EXCLUDED_RESOURCE, featureId);
  const listed = attr.value.split(',').map((part) => part.trim());
  if (listed.includes(featureId)) return tagText;
  return setAttributeValue(tagText, FDT_EXCLUDED_RESOURCE, `${attr.value}, ${featureId}`);
}
