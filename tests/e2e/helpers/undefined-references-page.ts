/**
 * The Undefined References page's harness seam: its calm word rows (name ·
 * defining-script count · where) and the move that opens a word's detail
 * (pane or drill-in, through the shared list helpers), where the definitions,
 * their source-link tiles and the copy actions live.
 *
 * Harness-only: no shipped module imports this file.
 */
import type { Locator, Page } from '@playwright/test';

import { openScriptDetail } from './javascript-page';

/** A word row's surface (the calm list item). */
export const WORD_ROW = '[data-fdt="word-row"]';

/** A locator root: the panel page, or a narrower scope inside it. */
type Scope = Page | Locator;

/**
 * Every rendered word row.
 *
 * @param scope The panel page or a narrower root.
 */
export function wordRows(scope: Scope): Locator {
  return scope.locator(WORD_ROW);
}

/**
 * The row whose name is exactly a word (never one that merely previews it).
 *
 * @param panel The panel page.
 * @param word The word as the row shows it.
 */
export function wordRow(panel: Page, word: string): Locator {
  return panel.locator(WORD_ROW).filter({
    has: panel.locator('[data-fdt="list-row-name"]').getByText(word, { exact: true })
  });
}

/**
 * Open a word's detail with a real click and wait for it.
 *
 * @param panel The panel page.
 * @param word The word as the row shows it.
 * @returns The open detail (pane or drill-in).
 */
export async function openWordDetail(panel: Page, word: string): Promise<Locator> {
  return await openScriptDetail(panel, wordRow(panel, word));
}
