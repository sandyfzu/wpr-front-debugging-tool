/**
 * The closed strip pill as the builder suites read it: its builder glyph and
 * its accessible name in Chromium's real accessibility tree (CDP), where the
 * Exclusion Builder hint is spoken once, right after the version (where the
 * glyph sits).
 *
 * Every tree read is polled by its caller or here: the tree updates a beat
 * after the DOM, so a single read right after a DOM match is a flake.
 */
import type { Page } from '@playwright/test';
import { expect, type ExtensionDriver } from './extension';

/** The widget's shadow-root host. */
export const STRIP_HOST = 'wpr-fdt-detection-widget';

/** `chrome.storage.sync` key of the per-origin widget map. */
export const WIDGET_ORIGINS_KEY = 'detection-widget-sites';

/**
 * Clear the per-origin widget map: every origin then follows the default
 * (the widget is on), whatever an earlier suite in this profile left.
 *
 * @param extension The driver.
 */
export async function clearWidgetMap(extension: ExtensionDriver): Promise<void> {
  await extension.evaluateInWorker(async (key: string) => {
    await chrome.storage.sync.remove([key]);
  }, WIDGET_ORIGINS_KEY);
}

/** The closed pill's accessible-name stem. */
export const PILL_STEM = 'WP Rocket page analysis: ';

/** What the closed pill's name gains on a rewritten page (spoken once, after the version). */
export const PILL_SUFFIX = ', rewritten by the Exclusion Builder';

/** The name's stem + identity (`WPR <version>`), the part the hint follows. */
const NAMED_IDENTITY = /^WP Rocket page analysis: WPR \d[\d.]*/;

/**
 * An untouched page's pill name with the builder hint where a rewritten
 * page's name carries it — right after the identity — and nowhere else.
 *
 * @param plainName The untouched page's pill name.
 * @throws {@link Error} When the name carries no versioned identity.
 */
export function withPillHint(plainName: string): string {
  const identity = NAMED_IDENTITY.exec(plainName)?.[0];
  if (identity === undefined) throw new Error(`no versioned identity in "${plainName}"`);
  return `${identity}${PILL_SUFFIX}${plainName.slice(identity.length)}`;
}

/**
 * Whether a pill name carries the builder hint exactly once, right after its identity.
 *
 * @param name A pill name.
 */
export function hasPillHint(name: string): boolean {
  const identity = NAMED_IDENTITY.exec(name)?.[0];
  return (
    identity !== undefined &&
    name.startsWith(PILL_SUFFIX, identity.length) &&
    name.split('Exclusion Builder').length === 2
  );
}

/** The closed pill's builder glyph (Playwright locators pierce the open shadow root). */
export const PILL_GLYPH = `${STRIP_HOST} [data-fdt-strip-pill-builder]`;

/**
 * The pill's accessible name(s) in Chromium's accessibility tree — one while
 * the card is closed, none while it is open (the pill is then hidden).
 *
 * @param page The page carrying the strip.
 */
export async function pillNames(page: Page): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await session.send('Accessibility.getFullAXTree')) as {
      nodes: { ignored?: boolean; role?: { value?: unknown }; name?: { value?: unknown } }[];
    };
    return nodes
      .filter((node) => node.ignored !== true && node.role?.value === 'button')
      .map((node) => node.name?.value)
      .filter((name): name is string => typeof name === 'string' && name.startsWith(PILL_STEM));
  } finally {
    await session.detach();
  }
}

/**
 * The names carrying `needle` of every node assistive tech announces on its
 * own — text leaves (`StaticText`/`InlineTextBox`, the pieces a control's
 * name is built from) excluded, so a phrase inside a button counts once.
 *
 * @param page The page carrying the strip.
 * @param needle The phrase to look for.
 */
export async function announcedNamesWith(page: Page, needle: string): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await session.send('Accessibility.getFullAXTree')) as {
      nodes: { ignored?: boolean; role?: { value?: unknown }; name?: { value?: unknown } }[];
    };
    return nodes
      .filter(
        (node) =>
          node.ignored !== true &&
          node.role?.value !== 'StaticText' &&
          node.role?.value !== 'InlineTextBox'
      )
      .map((node) => node.name?.value)
      .filter((name): name is string => typeof name === 'string' && name.includes(needle));
  } finally {
    await session.detach();
  }
}

/**
 * The closed pill's name once the pass answered (its identity carries a
 * version), polled off the tree until exactly one pill reads that way.
 *
 * @param page The page carrying the strip.
 * @param timeout How long the pass may take to answer.
 */
export async function answeredPillName(page: Page, timeout = 15_000): Promise<string> {
  await expect(page.locator(`${STRIP_HOST} .dw-pill`)).toContainText(/WPR \d/, { timeout });
  let name = '';
  await expect
    .poll(
      async () => {
        const names = await pillNames(page);
        name = names[0] ?? '';
        return names.length === 1 && name.startsWith(`${PILL_STEM}WPR `);
      },
      { timeout }
    )
    .toBe(true);
  return name;
}

/**
 * Assert the closed pill's builder hint: the glyph of `kind` (aria-hidden)
 * and the name carrying {@link PILL_SUFFIX} once after the version — or, for null,
 * no glyph and no builder words in the name. Closes the card first.
 *
 * @param page The page carrying the strip.
 * @param kind The expected glyph kind, or null for an untouched page.
 */
export async function expectPillHint(page: Page, kind: 'off' | 'excluded' | null): Promise<void> {
  const close = page.locator(`${STRIP_HOST} .dw-close`);
  if (await page.locator(`${STRIP_HOST} .dw-card`).isVisible()) {
    await close.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`${STRIP_HOST} .dw-pill`)).toBeVisible();
  }
  const glyph = page.locator(PILL_GLYPH);
  if (kind === null) {
    await expect(glyph).toHaveCount(0);
    await expect.poll(async () => (await answeredPillName(page)).includes('Exclusion')).toBe(false);
    return;
  }
  await expect(glyph).toBeVisible();
  await expect(glyph).toHaveAttribute('data-fdt-strip-pill-builder', kind);
  await expect(glyph).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(async () => hasPillHint(await answeredPillName(page))).toBe(true);
}
