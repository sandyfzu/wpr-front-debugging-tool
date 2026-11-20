/**
 * The stylesheet inventory's contract: `listPageStylesheets` (DevTools panel
 * → the tab's top frame) answers what the page's styles are right now, for
 * the Stylesheets page — every inline `style` and every stylesheet link the
 * detection counts as one (an async-swapped `rel="preload"` link included),
 * in document order, each with the WP Rocket stamps its tag carries.
 *
 * The same entry fields and bounds as the RUCSS test's inventory
 * (`./page-styles`, whose narrower list is what a test strips), plus three
 * tag facts. Read-only and bounded the same way: entries past
 * `PAGE_STYLE_LIMITS.count` are dropped (`total` still counts them). Each
 * answer carries a `snapshotId`: the page keeps the listed elements under
 * it, so a style's full CSS can be read by position later (`./style-source`).
 */
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';
import { isRandomId } from '../../utils/random-id';
import {
  PAGE_STYLE_ENTRY_KEYS,
  parseStyleInventory,
  readPageStyleFields,
  type PageStyleEntry
} from './page-styles';

/** One page style with its WP Rocket tag facts (all false on an inline style). */
export interface PageStylesheetEntry extends PageStyleEntry {
  /** A link with an `href` carries Minify CSS's exact `data-minify="1"` stamp. */
  readonly minifyAttribute: boolean;
  /** A link carries Load CSS asynchronously's exact `data-rocket-async="style"` stamp. */
  readonly rocketAsync: boolean;
  /** A link carries Self-host Google Fonts' `data-wpr-hosted-gf-parameters` attribute. */
  readonly hostedFont: boolean;
}

/** The inventory reply. */
export interface PageStylesheetsReply {
  /** The listed styles, in document order. */
  readonly styles: readonly PageStylesheetEntry[];
  /** Every matching element on the page (more than `styles` when the list was cut). */
  readonly total: number;
  /** The id the page keeps this list's elements under (random per answer). */
  readonly snapshotId: string;
}

/** The entry keys, exactly: the shared fields, then the tag facts. */
const ENTRY_KEYS = [...PAGE_STYLE_ENTRY_KEYS, 'minifyAttribute', 'rocketAsync', 'hostedFont'];

/**
 * Guard one entry.
 *
 * @param input The boundary value.
 * @returns The rebuilt entry, or null on any violation.
 */
export function parsePageStylesheetEntry(input: unknown): PageStylesheetEntry | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ENTRY_KEYS)) return null;
  const fields = readPageStyleFields(input);
  const minifyAttribute = ownValue(input, 'minifyAttribute');
  const rocketAsync = ownValue(input, 'rocketAsync');
  const hostedFont = ownValue(input, 'hostedFont');
  if (
    fields === null ||
    typeof minifyAttribute !== 'boolean' ||
    typeof rocketAsync !== 'boolean' ||
    typeof hostedFont !== 'boolean'
  ) {
    return null;
  }
  return { ...fields, minifyAttribute, rocketAsync, hostedFont };
}

/**
 * Guard the inventory reply.
 *
 * @param input The boundary value.
 * @returns The rebuilt reply, or null on any violation (an entry included).
 */
export function parsePageStylesheetsReply(input: unknown): PageStylesheetsReply | null {
  const inventory = parseStyleInventory(input, parsePageStylesheetEntry, ['snapshotId']);
  if (inventory === null || !isRecord(input)) return null;
  const snapshotId = ownValue(input, 'snapshotId');
  return isRandomId(snapshotId) ? { ...inventory, snapshotId } : null;
}
