/**
 * The JavaScript page's harness seam: locators and moves over its calm list
 * (two-line rows), its facets (choice segments + the Excluded toggle; below
 * the compact width they move into the Filters sheet) and its master–detail
 * (a side pane from the split width on, a drill-in view below it). The code,
 * the served tag, the facts and the copy action live only in the detail.
 *
 * Harness-only: no shipped module imports this file.
 */
import type { Locator, Page } from '@playwright/test';

import { expect } from './extension';

/** A script row's surface (the calm list item: `data-fdt-row-key`, `data-selected`). */
export const SCRIPT_ROW = '[data-fdt="script-row"]';

/** The open detail, in either layout. */
export const SCRIPT_DETAIL = '[data-fdt="detail-pane"], [data-fdt="drill-detail"]';

/** A locator root: the panel page, or a narrower scope inside it. */
type Scope = Page | Locator;

/**
 * Every rendered script row in a scope.
 *
 * @param scope The panel page or a narrower root.
 */
export function scriptRows(scope: Scope): Locator {
  return scope.locator(SCRIPT_ROW);
}

/**
 * The rendered row whose text (name or preview) contains a text.
 *
 * @param scope The panel page or a narrower root.
 * @param text The text (a file name, a URL part, a code snippet).
 */
export function scriptRow(scope: Scope, text: string): Locator {
  return scope.locator(SCRIPT_ROW, { hasText: text });
}

/**
 * The rendered row whose name is exactly a text (an external script's file
 * name, "Inline script #n") — never a row that merely previews it.
 *
 * @param scope The panel page or a narrower root.
 * @param name The row's whole name.
 */
export function scriptRowNamed(scope: Scope, name: string): Locator {
  const page = 'page' in scope ? scope.page() : scope;
  return scope.locator(SCRIPT_ROW).filter({
    has: page.locator('[data-fdt="list-row-name"]', {
      hasText: new RegExp(`^${escapeRegExp(name)}$`)
    })
  });
}

/**
 * Escape a text for a literal match inside a regular expression.
 *
 * @param text The literal text.
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The open detail (pane or drill-in).
 *
 * @param scope The panel page or a narrower root.
 */
export function scriptDetail(scope: Scope): Locator {
  return scope.locator(SCRIPT_DETAIL);
}

/**
 * Open a row's detail with a real click on its open button and wait for it.
 *
 * @param scope The panel page (the detail renders beside or over the list).
 * @param row The row (its surface or its virtual item wrapper).
 * @returns The open detail.
 */
export async function openScriptDetail(scope: Scope, row: Locator): Promise<Locator> {
  const open = row.locator('[data-fdt-row-open]');
  await open.click();
  // The selected row's open button is the list's current item.
  await expect(open).toHaveAttribute('aria-current', 'true');
  const detail = scriptDetail(scope);
  await expect(detail).toBeVisible();
  return detail;
}

/**
 * Close the open detail the way the user does: Back (drill-in) or the
 * pane's close button; waits until no detail shows.
 *
 * @param scope The panel page.
 */
export async function closeScriptDetail(scope: Scope): Promise<void> {
  const back = scope.locator('[data-fdt="drill-back"]');
  if (await back.isVisible()) await back.click();
  else await scope.locator('[data-fdt="detail-close"]').click();
  await expect(scriptDetail(scope)).toHaveCount(0);
}

/**
 * A facet segment (a choice value: `delayed`, `inline`, `combined`…). The
 * value ids are unique across the page's facets except `any` ("Any", every
 * choice facet's first segment): name the facet for that one.
 *
 * @param scope The panel page or the JavaScript page root.
 * @param value The value id.
 * @param facet The facet's label ("Delay", "File"…), to scope to its group.
 */
export function facetSegment(scope: Scope, value: string, facet?: string): Locator {
  const group = facet === undefined ? scope : scope.getByRole('radiogroup', { name: facet });
  return group.locator(`[data-fdt="choice"][data-fdt-choice-value="${value}"]`);
}

/**
 * A facet segment's count (the number of rows that value keeps).
 *
 * @param scope The panel page or the JavaScript page root.
 * @param value The value id.
 * @param facet The facet's label (needed for `any` only).
 */
export function facetCount(scope: Scope, value: string, facet?: string): Locator {
  return facetSegment(scope, value, facet).locator('[data-fdt-choice-count]');
}

/**
 * Pick a facet value with a real click on its segment's label (the radio
 * itself is visually hidden). A compact bar holds its facets in the Filters
 * sheet: it is opened, the value picked, and the sheet closed again.
 *
 * @param scope The panel page or the JavaScript page root.
 * @param value The value id.
 * @param facet The facet's label (needed for `any` only).
 */
export async function pickFacet(scope: Scope, value: string, facet?: string): Promise<void> {
  const bar = scope.locator('[data-fdt="facet-bar"]');
  const compact = (await bar.getAttribute('data-fdt-compact')) !== null;
  if (compact) await bar.locator('[data-fdt="facet-filters-button"]').click();
  const segment = facetSegment(compact ? sheetScope(scope) : bar, value, facet);
  await segment.locator('label').click();
  await expect(segment.locator('input')).toBeChecked();
  if (compact) await sheetScope(scope).locator('[data-fdt="facet-sheet-show"]').click();
}

/**
 * A toggle facet's chip (`excluded`).
 *
 * @param scope The panel page or the JavaScript page root.
 * @param id The toggle facet's id.
 */
export function facetToggle(scope: Scope, id: string): Locator {
  return scope.locator(`[data-fdt="toggle-chip"][data-fdt-toggle-chip="${id}"]`);
}

/**
 * Press a toggle facet into a state with a real click (compact: through the
 * Filters sheet, as {@link pickFacet}); a chip already there is left alone.
 *
 * @param scope The panel page or the JavaScript page root.
 * @param id The toggle facet's id.
 * @param on The wanted state.
 */
export async function setFacetToggle(scope: Scope, id: string, on: boolean): Promise<void> {
  const bar = scope.locator('[data-fdt="facet-bar"]');
  const compact = (await bar.getAttribute('data-fdt-compact')) !== null;
  if (compact) await bar.locator('[data-fdt="facet-filters-button"]').click();
  const chip = facetToggle(compact ? sheetScope(scope) : bar, id);
  if ((await chip.getAttribute('aria-pressed')) !== String(on)) await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', String(on));
  if (compact) await sheetScope(scope).locator('[data-fdt="facet-sheet-show"]').click();
}

/**
 * The open Filters sheet (portalled to the document, outside the page root).
 *
 * @param scope Any locator root of the panel page.
 */
function sheetScope(scope: Scope): Locator {
  const page = 'page' in scope ? scope.page() : scope;
  return page.locator('[data-fdt="sheet"]');
}
