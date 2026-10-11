/**
 * Shared `chrome.action` badge-assert helpers for the suites that pin the
 * toolbar-badge seam (the fixture pipeline suite and the local-site suites).
 *
 * Environment fact pinned by the committed green runs and the P4.3 probes:
 * the PROMISE form of these APIs resolves the raw value in this Chromium
 * build — `getBadgeText` → the text string, `getBadgeTextColor` /
 * `getBadgeBackgroundColor` → the RGBA array — not a `{ text }` details
 * object. Suites read them through {@link readBadge} so the quirk has one
 * home.
 */

/** The badge dot glyph — presence is in its color, not in text. */
export const BADGE_DOT = '●';

/** Transparent tile: the background action color (fixed browser-chrome value). */
export const TRANSPARENT_TILE: [number, number, number, number] = [0, 0, 0, 0];

/** State colors, as the badge runtime sets them (hex literals there, RGB here). */
export const BADGE_COLORS = {
  cached: '26-127-55',
  presentUncached: '9-105-218',
  absent: '110-119-129'
} as const;

/** Standard polling profile for the badge seam (post-processing delivery). */
export const POLLED_BADGE_OPTIONS: { timeout: number; intervals: number[] } = {
  timeout: 8_000,
  intervals: [100, 100, 250, 500]
};

/**
 * Normalize the badge color API's answer to a canonical `r-g-b` string.
 *
 * @param color The `chrome.action` color answer (an RGBA array per the
 *   committed `@types/chrome`; the suites trip hard on any other shape).
 */
export function canonicalRgb(color: readonly number[]): string {
  const [r, g, b] = color;
  if (r === undefined || g === undefined || b === undefined) {
    throw new Error(`Badge color answer had fewer than three channels: ${JSON.stringify(color)}`);
  }
  return `${String(r)}-${String(g)}-${String(b)}`;
}

import type { ExtensionDriver } from './extension';

/**
 * Read one tab's rendered badge (text + text color) from the service worker.
 *
 * @param driver The extension driver (its SW evaluator reads the state).
 * @param tabId The tab whose badge state is read.
 */
export async function readBadge(
  driver: ExtensionDriver,
  tabId: number
): Promise<{ text: string; color: string }> {
  const raw = await driver.evaluateInWorker(
    async (tab: number) => ({
      text: await chrome.action.getBadgeText({ tabId: tab }),
      color: await chrome.action.getBadgeTextColor({ tabId: tab })
    }),
    tabId
  );
  return { text: raw.text, color: canonicalRgb(raw.color) };
}
