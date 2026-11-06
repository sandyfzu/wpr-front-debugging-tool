/**
 * The page-style inventory's contract: `listPageStyles` (DevTools panel →
 * the tab's top frame) answers what the page's styles are right now — the
 * same elements a RUCSS test strips (`style`, `link[rel="stylesheet"]`), in
 * document order — so the panel can show them in place of a console dump.
 *
 * Read-only and bounded: entries past {@link PAGE_STYLE_LIMITS.count} are
 * dropped (the reply's `total` still counts them), every string is clipped
 * to its cap, and an inline style carries only a short preview of its CSS,
 * never the whole sheet.
 */
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';
import { isCount } from './guard-policy';

/** Bounds of one inventory reply. */
export const PAGE_STYLE_LIMITS = {
  /** Entries one reply lists. */
  count: 2_000,
  /** An element's `id`. */
  idChars: 256,
  /** An element's `class` attribute. */
  classChars: 512,
  /** A stylesheet's resolved URL. */
  hrefChars: 2_048,
  /** An inline style's CSS preview (whitespace collapsed). */
  previewChars: 160,
  /** An element's `media` attribute. */
  mediaChars: 256
} as const;

/** One page style. */
export interface PageStyleEntry {
  /** An inline `<style>` or a `<link rel="stylesheet">`. */
  readonly kind: 'inline' | 'link';
  /** The element's id (empty when none). */
  readonly id: string;
  /** The element's class attribute (empty when none). */
  readonly className: string;
  /** The stylesheet's resolved URL (links; empty for inline styles and a link without one). */
  readonly href: string;
  /** The element's media attribute (empty when none). */
  readonly media: string;
  /** The start of an inline style's CSS, whitespace collapsed (empty for links). */
  readonly preview: string;
  /** An inline style's full CSS length in characters (0 for links). */
  readonly chars: number;
}

/** The inventory reply. */
export interface PageStylesReply {
  /** The listed styles, in document order. */
  readonly styles: readonly PageStyleEntry[];
  /** Every matching element on the page (more than `styles` when the list was cut). */
  readonly total: number;
}

/** The entry keys, exactly. */
const ENTRY_KEYS = ['kind', 'id', 'className', 'href', 'media', 'preview', 'chars'] as const;

/**
 * A string of at most `max` characters.
 *
 * @param value The boundary value.
 * @param max The character cap.
 */
function isCappedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

/**
 * Guard one entry.
 *
 * @param input The boundary value.
 * @returns The rebuilt entry, or null on any violation.
 */
export function parsePageStyleEntry(input: unknown): PageStyleEntry | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ENTRY_KEYS)) return null;
  const kind = ownValue(input, 'kind');
  const id = ownValue(input, 'id');
  const className = ownValue(input, 'className');
  const href = ownValue(input, 'href');
  const media = ownValue(input, 'media');
  const preview = ownValue(input, 'preview');
  const chars = ownValue(input, 'chars');
  if (kind !== 'inline' && kind !== 'link') return null;
  if (
    !isCappedString(id, PAGE_STYLE_LIMITS.idChars) ||
    !isCappedString(className, PAGE_STYLE_LIMITS.classChars) ||
    !isCappedString(href, PAGE_STYLE_LIMITS.hrefChars) ||
    !isCappedString(media, PAGE_STYLE_LIMITS.mediaChars) ||
    !isCappedString(preview, PAGE_STYLE_LIMITS.previewChars) ||
    !isCount(chars)
  ) {
    return null;
  }
  return { kind, id, className, href, media, preview, chars };
}

/**
 * Guard the inventory reply.
 *
 * @param input The boundary value.
 * @returns The rebuilt reply, or null on any violation (an entry included).
 */
export function parsePageStylesReply(input: unknown): PageStylesReply | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['styles', 'total'])) return null;
  const raw = ownValue(input, 'styles');
  const total = ownValue(input, 'total');
  if (!Array.isArray(raw) || raw.length > PAGE_STYLE_LIMITS.count || !isCount(total)) return null;
  if (total < raw.length) return null;
  const styles: PageStyleEntry[] = [];
  for (const item of raw) {
    const entry = parsePageStyleEntry(item);
    if (entry === null) return null;
    styles.push(entry);
  }
  return { styles, total };
}
