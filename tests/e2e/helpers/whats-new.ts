/**
 * What's new tab helpers shared by the update-path suites: which tabs are the
 * page, the one bound both the "it opens" and the "it never opens" checks use,
 * and the release the page must feature — read off the release index, so a
 * version bump never needs a spec edit.
 */
import type { BrowserContext, Page } from '@playwright/test';
import packageInfo from '../../../package.json' with { type: 'json' };
import { WHATS_NEW_PAGE_PATH } from '../../../lib/release-notes/page-path';
import { newestAnnouncedBetween } from '../../../lib/release-notes/decision';
import { FIRST_WINDOW_WAIT_MS } from '../../../lib/release-notes/target-window';
import { RELEASES } from '../../../lib/release-notes/releases';
import { parseExtensionVersion } from '../../../utils/extension-version';
import { expect } from './extension';

/**
 * How long an open may take, and so how long a steady-count check watches:
 * the slowest legitimate open first waits up to {@link FIRST_WINDOW_WAIT_MS}
 * for a window, then a few storage and tab round trips. A shorter negative
 * window would pass on a slow duplicate open the positive check still allows.
 */
export const WHATS_NEW_WAIT_MS = FIRST_WINDOW_WAIT_MS + 7_000;

/** Poll step of the steady-count watch: a stray tab fails within it. */
const WATCH_STEP_MS = 250;

/**
 * The open What's new tabs (by path: the update's tab carries a `since` query).
 *
 * @param context The browser context.
 */
export function whatsNewTabs(context: BrowserContext): Page[] {
  return context.pages().filter((page) => new URL(page.url()).pathname === WHATS_NEW_PAGE_PATH);
}

/**
 * Assert exactly `count` What's new tabs are open at every point of the whole
 * {@link WHATS_NEW_WAIT_MS} window (fails at the first deviation): `0` after
 * a wake that must open none, `1` after the update's open (no duplicate).
 *
 * @param context The browser context.
 * @param count The tab count that must hold throughout.
 * @param label What the check is about (the failure message).
 */
export async function expectWhatsNewTabsStay(
  context: BrowserContext,
  count: number,
  label: string
): Promise<void> {
  const until = Date.now() + WHATS_NEW_WAIT_MS;
  for (;;) {
    expect(whatsNewTabs(context), label).toHaveLength(count);
    if (Date.now() >= until) return;
    await new Promise((done) => setTimeout(done, WATCH_STEP_MS));
  }
}

/**
 * After a same-version reload: the reload closes the extension's own tabs
 * (the earlier What's new tab with them), so wait for that, then assert none
 * opens for the whole window — the wake's own checks would open a new one.
 *
 * @param context The browser context.
 */
export async function expectSecondWakeOpensNone(context: BrowserContext): Promise<void> {
  await expect
    .poll(() => whatsNewTabs(context).length, {
      message: 'the reload closes the earlier What’s new tab',
      timeout: WHATS_NEW_WAIT_MS
    })
    .toBe(0);
  await expectWhatsNewTabsStay(context, 0, 'a second wake opens no What’s new tab');
}

/**
 * The release an update from `since` to the packaged version features: the
 * newest announced one above `since` (the background's own rule).
 *
 * @param since The version updated from.
 * @returns The release version.
 * @throws {@link Error} When the index announces nothing in that range.
 */
export function featuredRelease(since: string): string {
  const lower = parseExtensionVersion(since);
  const current = parseExtensionVersion(packageInfo.version);
  const featured =
    lower === null || current === null ? null : newestAnnouncedBetween(RELEASES, lower, current);
  if (featured === null) {
    throw new Error(`No announced release between ${since} and ${packageInfo.version}`);
  }
  return featured;
}
