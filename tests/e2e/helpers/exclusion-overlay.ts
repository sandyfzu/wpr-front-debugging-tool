/**
 * The browser tier's exclusion-builder overlay seams: open the overlay the
 * way the background does (its runtime content script injected into the
 * tab's top frame), name its lanes/rows by their accessible names, read the
 * session indicator, and push a session status at the message seam (the
 * background's own `exclusionSessionChanged` envelope) where a suite needs
 * a state the real backend cannot be made to reach on demand.
 *
 * The overlay is an open shadow root: Playwright's role locators pierce it.
 *
 * Harness-only: no shipped module imports this file.
 */
import { createHash } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';

import { OVERLAY_HOST_NAME } from '../../../components/injected-ui/key-guard';
import type { ExclusionSet } from '../../../lib/exclusion-builder/set';
import type {
  ExclusionServedDocument,
  ExclusionSessionStatus
} from '../../../lib/messaging/exclusion-session';
import { expect, openFixturePage, type DriverPage, type ExtensionDriver } from './extension';

/** The overlay's shadow host (the injected UI's custom element). */
export const OVERLAY_HOST = OVERLAY_HOST_NAME;

/** `chrome.storage.local` key of the per-origin saved drafts (WXT `local:exclusion-sets`). */
export const SAVED_DRAFTS_KEY = 'exclusion-sets';

/** Lane labels (the verified feature names). */
export const DELAY = 'Delay JavaScript execution';
export const DEFER = 'Load JavaScript deferred';
export const LAZYLOAD = 'LazyLoad for images';
export const LAZY_RENDER = 'Automatic Lazy Rendering';

/** Bounded waits: the overlay mount and the applied reload. */
export const MOUNT = { timeout: 15_000 };
export const APPLIED = { timeout: 30_000 };

/** Drop every origin's saved draft: the overlay reopens on it, so each leg starts empty. */
export async function clearDrafts(extension: ExtensionDriver): Promise<void> {
  await extension.evaluateInWorker(async (key: string) => {
    await chrome.storage.local.remove(key);
  }, SAVED_DRAFTS_KEY);
}

/**
 * Inject the overlay into an open tab's top frame (the background's own
 * opener path) and wait for its ready editor.
 *
 * @param extension The driver.
 * @param opened The tab.
 */
export async function injectOverlay(extension: ExtensionDriver, opened: DriverPage): Promise<void> {
  await extension.evaluateInWorker(async (tabId: number) => {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ['/content-scripts/exclusion-overlay.js']
    });
  }, opened.tabId);
  // Exact: a fixture's own heading may contain the words (the marker-spoof
  // page does), which a substring match would take for the overlay's title.
  await expect(
    opened.page.getByRole('heading', { name: 'Exclusion Builder', exact: true })
  ).toBeVisible(MOUNT);
  await expect(opened.page.getByRole('button', { name: /^Apply$/ })).toBeVisible(MOUNT);
}

/**
 * Open a fixture page with the builder in it, drafts cleared first.
 *
 * @param extension The driver.
 * @param fixture The fixture page's path.
 * @param beforeNavigate Optional hook before the first navigation (emulation, listeners).
 */
export async function openBuilder(
  extension: ExtensionDriver,
  fixture: string,
  beforeNavigate?: (page: Page) => void
): Promise<DriverPage> {
  await clearDrafts(extension);
  const opened = await openFixturePage(extension, fixture, undefined, beforeNavigate);
  await injectOverlay(extension, opened);
  return opened;
}

/** A lane's region. */
export const lane = (page: Page, label: string): Locator =>
  page.getByRole('region', { name: label });

/** A lane row's input (1-based). */
export const laneRow = (page: Page, label: string, n: number): Locator =>
  page.getByRole('textbox', { name: `${label} row ${String(n)}`, exact: true });

/**
 * Add a row to a lane and type it; focus ends in the row.
 *
 * @param page The page with the overlay.
 * @param label The lane's label.
 * @param text The row text.
 */
export async function typeRow(page: Page, label: string, text: string): Promise<void> {
  await lane(page, label).getByRole('button', { name: 'Add row' }).click();
  await page.keyboard.type(text);
}

/** The overlay's Apply button (also "Apply changes" / "Re-apply"). */
export const applyButton = (page: Page): Locator =>
  page.getByRole('button', { name: /^(Apply|Apply changes|Re-apply)$/ });

/** The panel header's session indicator: its word and the glyph's icon class. */
export interface IndicatorReading {
  readonly label: string;
  readonly tone: string | null;
  readonly glyph: string | null;
}

/**
 * Read an indicator inside the overlay (`.xo-indicator` under `scope`).
 *
 * @param page The page.
 * @param scope `header` (the open panel's) or `pill` (the folded pill's).
 * @returns The reading, or null when that indicator is not rendered.
 */
export async function readIndicator(
  page: Page,
  scope: 'header' | 'pill'
): Promise<IndicatorReading | null> {
  return await page.evaluate(
    ({ host, selector }) => {
      const root = document.querySelector(host)?.shadowRoot;
      const indicator = root?.querySelector(selector);
      if (indicator === null || indicator === undefined) return null;
      const svg = indicator.querySelector('svg');
      // The glyph's own lucide class (`lucide-<icon>`), never the shared ones.
      const glyph =
        Array.from(svg?.classList ?? []).find(
          (name) => name.startsWith('lucide-') && name !== 'lucide-icon'
        ) ?? null;
      return {
        label: indicator.textContent.replace('Session: ', '').trim(),
        tone: indicator.getAttribute('data-tone'),
        glyph
      };
    },
    {
      host: OVERLAY_HOST,
      selector: scope === 'header' ? '.xo-header .xo-indicator' : '.xo-pill .xo-indicator'
    }
  );
}

/**
 * The panel's state banners, top to bottom: tone, glyph, words, the page's
 * lines, the session-notes toggle's label, action buttons.
 */
export interface BannerReading {
  readonly tone: string | null;
  readonly glyph: string | null;
  readonly title: string;
  readonly body: string;
  readonly notes: readonly string[];
  /** The collapsed session-notes toggle's words ("2 session notes"; null: none). */
  readonly sessionNotes: string | null;
  readonly actions: readonly string[];
}

/** A banner's session-notes toggle (the disclosure under its lines). */
const SESSION_NOTES_TOGGLE = '.xo-banner-session .xo-note-disclosure';

/** Read every banner in the overlay's body. */
export async function readBanners(page: Page): Promise<BannerReading[]> {
  return await page.evaluate(
    ([host, toggle]) => {
      const root = document.querySelector(host)?.shadowRoot;
      return Array.from(root?.querySelectorAll('.xo-banner') ?? [], (banner) => {
        const svg = banner.querySelector('.xo-banner-glyph svg');
        return {
          tone: banner.getAttribute('data-tone'),
          glyph:
            Array.from(svg?.classList ?? []).find(
              (name) => name.startsWith('lucide-') && name !== 'lucide-icon'
            ) ?? null,
          title: banner.querySelector('.xo-banner-title')?.textContent ?? '',
          body: banner.querySelector('.xo-banner-body')?.textContent ?? '',
          notes: Array.from(banner.querySelectorAll('.xo-banner-notes li'), (li) =>
            li.textContent.trim()
          ),
          sessionNotes: banner.querySelector(toggle)?.textContent.trim() ?? null,
          actions: Array.from(banner.querySelectorAll(`button:not(${toggle})`), (button) =>
            (button.getAttribute('aria-label') ?? button.textContent).trim()
          )
        };
      });
    },
    [OVERLAY_HOST, SESSION_NOTES_TOGGLE] as const
  );
}

/**
 * Open the first banner's session notes (when collapsed) and read them.
 *
 * @returns Each note's words, in order.
 */
export async function openSessionNotes(page: Page): Promise<string[]> {
  const toggle = page.locator(`${OVERLAY_HOST} .xo-banner ${SESSION_NOTES_TOGGLE}`).first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const listId = await toggle.getAttribute('aria-controls');
  if (listId === null) throw new Error('The session-notes toggle names no open list');
  return await page.locator(`${OVERLAY_HOST} [id="${listId}"] li`).allTextContents();
}

/**
 * Push a session status to the tab's overlay over the background's own
 * channel (`exclusionSessionChanged`, top frame) — the message seam the
 * overlay's port validates before its state machine sees it.
 *
 * @param extension The driver.
 * @param tabId The overlay's tab.
 * @param status The pushed status (validated by the overlay, as from the background).
 */
export async function pushStatus(
  extension: ExtensionDriver,
  tabId: number,
  status: ExclusionSessionStatus
): Promise<void> {
  await extension.sendToTab(tabId, 'exclusionSessionChanged', status);
}

/**
 * A served-document identity for `href`, stamped as this document's own
 * response (inside its response window) or as another page's.
 *
 * @param page The page whose load the stamp is read from.
 * @param href The document URL the identity names (the page's own, or another).
 */
export async function servedIdentity(page: Page, href: string): Promise<ExclusionServedDocument> {
  // This load's own response: between its navigation start and response end (wall clock).
  const receivedAt = await page.evaluate(() => {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return Math.round(Date.now() - performance.now() + (entry?.responseStart ?? 0));
  });
  const url = new URL(href);
  url.hash = '';
  return {
    urlPath: `${url.origin}${url.pathname}`,
    urlDigest: createHash('sha256').update(url.href, 'utf8').digest('hex'),
    token: 'e2e-response',
    order: 1,
    receivedAt,
    speculationRules: { removedFromDocument: 0, headerRemoved: false, guarded: false },
    copy: false,
    serviceWorkersBypassed: false
  };
}

/** An active session status over `set` with `document` as its last outcome. */
export function activeStatus(
  origin: string,
  set: ExclusionSet,
  document: Extract<ExclusionSessionStatus, { state: 'active' }>['document']
): ExclusionSessionStatus {
  return { state: 'active', origin, set, startedAt: Date.now(), document };
}

/** Indicator words of a transient state (the reload has not landed yet). */
const TRANSIENT = new Set(['Checking', 'Applying', 'Stopping', 'Reloading', 'Applied · waiting']);

/**
 * What one settle poll saw on the tab: the document still marked old (no
 * reload yet), a new document without the overlay, a navigation in flight,
 * or the overlay's header word.
 */
type SettleReading =
  | { readonly kind: 'old-document' }
  | { readonly kind: 'no-overlay' }
  | { readonly kind: 'navigating' }
  | { readonly kind: 'word'; readonly word: string };

/**
 * Describe a settle reading for a failure message.
 *
 * @param reading The last reading, or null before the first poll answered.
 */
function describeSettle(reading: SettleReading | null): string {
  if (reading === null) return 'no poll answered';
  switch (reading.kind) {
    case 'old-document':
      return 'the old document is still loaded (the action never reloaded the tab)';
    case 'no-overlay':
      return 'the new document has no overlay header (the overlay was not re-opened)';
    case 'navigating':
      return 'a navigation was still in flight';
    case 'word':
      return `the header still read "${reading.word}"`;
  }
}

/** The deadline lines `expect.poll` ends a timed-out failure with (its own, or the test's). */
const POLL_DEADLINE =
  /Timeout \d+ms exceeded while waiting on the predicate|Test timeout of \d+ms exceeded/;

/**
 * Headline a settle-poll failure: the deadline only when the poll actually
 * ran out of time; any other failure (a probe that threw, a closed page) by
 * its own first message line, so a crash never reads as a slow reload.
 *
 * @param cause What the poll threw.
 * @returns The headline.
 */
function settleFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const deadline = POLL_DEADLINE.exec(message);
  if (deadline !== null) return `the session reload did not settle (${deadline[0]})`;
  return `the settle poll failed: ${message.split('\n')[0] ?? message}`;
}

/**
 * Run an action that reloads the tab through the session (Apply, Re-apply,
 * Reset) and wait for the overlay on the NEW document to settle: the old
 * document is marked first, so an armed state read before the reload never
 * passes for the result. A failure names the last state seen, so a stall
 * says where it stalled.
 *
 * @param page The page with the overlay.
 * @param act The click (or key) that starts the reload.
 * @returns The settled header indicator word.
 * @throws {Error} When the new document does not settle (deadline, or a probe failure), naming the last state seen.
 */
export async function reloadThroughSession(page: Page, act: () => Promise<void>): Promise<string> {
  await page.evaluate(() => {
    (window as unknown as { e2eOldDocument: boolean }).e2eOldDocument = true;
  });
  await act();
  // A holder: the poll's closure writes it, the failure path reads it.
  const seen: { last: SettleReading | null } = { last: null };
  try {
    await expect
      .poll(
        async () => {
          const reading = await page
            .evaluate((host): SettleReading => {
              if ('e2eOldDocument' in window) return { kind: 'old-document' };
              const root = document.querySelector(host)?.shadowRoot;
              const indicator = root?.querySelector('.xo-header .xo-indicator');
              return indicator === null || indicator === undefined
                ? { kind: 'no-overlay' }
                : { kind: 'word', word: indicator.textContent.replace('Session: ', '').trim() };
            }, OVERLAY_HOST)
            // A destroyed context is the navigation in flight: poll again.
            .catch((error: unknown): SettleReading => {
              if (
                error instanceof Error &&
                error.message.includes('Execution context was destroyed')
              )
                return { kind: 'navigating' };
              throw error;
            });
          seen.last = reading;
          return reading.kind === 'word' && !TRANSIENT.has(reading.word);
        },
        { ...APPLIED, intervals: [100, 250, 500] }
      )
      .toBe(true);
  } catch (cause) {
    throw new Error(
      `reloadThroughSession: ${settleFailure(cause)} — ${describeSettle(seen.last)}`,
      {
        cause
      }
    );
  }
  const settled = seen.last;
  if (settled === null || settled.kind !== 'word') {
    throw new Error(
      `reloadThroughSession: settled without a header word (${describeSettle(settled)})`
    );
  }
  return settled.word;
}
