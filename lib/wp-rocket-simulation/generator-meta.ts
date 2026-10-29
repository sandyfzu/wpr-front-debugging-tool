/**
 * The generator meta as the simulation reads it off the served text (tag
 * scanner, no DOM) — the one test of "this tag is a generator meta" for
 * every simulation reader of it.
 */
import type { ScannedTag } from '../exclusion-builder/html-scan';
import { findAttribute } from '../exclusion-builder/tag-edit';
import { GENERATOR_META_NAME } from '../wp-rocket/constants';

/**
 * A tag's attribute value (`null` when absent or valueless; the first of
 * duplicates, as browsers keep).
 *
 * @param tag The tag.
 * @param name A lowercase attribute name.
 */
export function attributeValue(tag: ScannedTag, name: string): string | null {
  return findAttribute(tag, name)?.value ?? null;
}

/**
 * Whether a tag is a `<meta name="generator">` (the name compared exactly,
 * as WP Rocket and WordPress spell it).
 *
 * @param tag An opening tag.
 */
export function isGeneratorMeta(tag: ScannedTag): boolean {
  return tag.name === 'meta' && attributeValue(tag, 'name') === GENERATOR_META_NAME;
}
