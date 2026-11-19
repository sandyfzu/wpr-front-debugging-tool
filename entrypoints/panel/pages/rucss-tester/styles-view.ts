/**
 * The page-style inventory's row views, pure, built once per list (never in
 * a row renderer): a calm row's name (a link's file name, an inline style's
 * `#id.class` or its ordinal), its preview line (what a keep rule matches:
 * the identity and the full stylesheet URL, or the CSS start — the media
 * leading when it says anything), an inline style's character count, and the "Test
 * result" chip on the style a test injected.
 */
import type { PageStyleEntry } from '../../../../lib/messaging/page-styles';
import { styleIdentity } from '../../../../lib/panel/style-identity';
import { RUCSS_RESULT_STYLE_ID } from '../../../../lib/rucss-tester/run-plan';
import { formatCompactCount } from '../../../../utils/format-count';
import {
  NO_STATE_CHIPS,
  splitStateChips,
  CALM_VISIBLE_STATE_CHIPS,
  type StateChip,
  type StateChipSplit
} from '../resource-list/state-chips';
import {
  EMPTY_STYLE_PREVIEW,
  mediaDetail,
  NO_HREF_NAME,
  styleName
} from '../resource-list/style-words';

/**
 * The chip on the test's own style: a state the panel's test produced, so
 * it takes the FDT source look (flask, dashed), never WP Rocket's.
 */
export const TEST_RESULT_CHIP: StateChip = {
  id: 'test-result',
  label: 'Test result',
  source: 'simulated',
  title: "The used CSS this panel's RUCSS test added (gone once the page reloads)"
};

/** The result row's chips (shared: one split for the one row that has it). */
const RESULT_CHIPS: StateChipSplit = splitStateChips([TEST_RESULT_CHIP], CALM_VISIBLE_STATE_CHIPS);

/** One inventory row as its renderer reads it. */
export interface InventoryRowView {
  /** The entry's kind (sets the row icon). */
  readonly kind: PageStyleEntry['kind'];
  /** The row's name. */
  readonly name: string;
  /** The name is an identifier (`#id.class`), shown in mono. */
  readonly monoName: boolean;
  /** The preview line. */
  readonly preview: string;
  /** An inline style's characters (compact), else undefined (a link's are never read). */
  readonly size: string | undefined;
  /** The row's chips. */
  readonly chips: StateChipSplit;
}

/**
 * Whether an entry is the style a test injected.
 *
 * @param entry The entry.
 */
export function isTestResult(entry: PageStyleEntry): boolean {
  return entry.kind === 'inline' && entry.id === RUCSS_RESULT_STYLE_ID;
}

/**
 * Join the non-empty parts of a preview line.
 *
 * @param parts The parts, in order.
 */
function joinPreview(parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join(' · ');
}

/**
 * One row's view.
 *
 * @param entry The entry.
 * @param inlineOrdinal Its 1-based position among inline styles (the name of an anonymous one).
 */
export function inventoryRowView(entry: PageStyleEntry, inlineOrdinal: number): InventoryRowView {
  const { name, mono } = styleName(entry, inlineOrdinal);
  const media = mediaDetail(entry.media) ?? '';
  const chips = isTestResult(entry) ? RESULT_CHIPS : NO_STATE_CHIPS;
  if (entry.kind === 'link') {
    return {
      kind: 'link',
      name,
      monoName: mono,
      // The full URL: a "Stylesheets to keep" pattern is matched against it.
      preview: joinPreview([
        styleIdentity(entry),
        media,
        entry.href === '' ? NO_HREF_NAME : entry.href
      ]),
      size: undefined,
      chips
    };
  }
  return {
    kind: 'inline',
    name,
    monoName: mono,
    preview: joinPreview([media, entry.preview === '' ? EMPTY_STYLE_PREVIEW : entry.preview]),
    size: formatCompactCount(entry.chars),
    chips
  };
}

/**
 * Every row's view, in list order.
 *
 * @param styles The listed entries.
 * @returns One view per entry.
 */
export function inventoryRowViews(styles: readonly PageStyleEntry[]): InventoryRowView[] {
  let inline = 0;
  return styles.map((entry) => {
    if (entry.kind === 'inline') inline += 1;
    return inventoryRowView(entry, inline);
  });
}
