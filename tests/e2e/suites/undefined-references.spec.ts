/**
 * Suite 2 — Undefined-references capture (host safety + pipeline).
 *
 * Fixture pages throw real (or synthetic-hostile) errors; the assert surface
 * is the page's own console truth plus the content script's accumulated
 * words pulled through the extension's own panel contract.
 *
 * - "page console unchanged" is asserted against uncaught exceptions
 *   (`pageerror` events): the page must produce exactly its own fixture
 *   throws — no injected noise and no uncaught capture failures. Extension
 *   lines are console prints of our own surfaces, never page errors.
 * - the validated batch observable is the `getFdtData` pull-through (the
 *   panel's own protocol row, driven from the SW; the panel rendering itself
 *   lands with its phase). The dev-build debug log named by the phase doc
 *   does not exist in the shipped code (the validated path logs nothing),
 *   so the stronger always-on observable is used instead — recorded in the
 *   phase doc.
 */

import { type ExtensionDriver, expect, test, type DriverPage } from '../helpers/extension';
import { openFixturePage } from '../helpers/extension';

/** The narrow slice of the panel payload these suites assert on. */
interface PanelFdtData {
  /** Validated undefined-reference words accumulated for the page. */
  undefinedReferencesOnPage: string[];
  /** WP Rocket presence/cache booleans the summary push relays. */
  wpr?: {
    present?: boolean;
    cached?: boolean;
  };
}

/**
 * Pull the panel payload for one tab through `getFdtData` (the panel's own
 * protocol row; the harness drives it from the SW the way the panel would).
 *
 * @param driver The extension driver.
 * @param fixture The page whose content script answers.
 */
async function pullFdtData(
  driver: ExtensionDriver,
  fixture: DriverPage
): Promise<PanelFdtData | null> {
  return await driver.sendToTab<PanelFdtData | null>(fixture.tabId, 'getFdtData');
}

/** Standard polling profile: the batch flush waits out its debounce. */
const POLL_OPTIONS: { timeout: number; intervals: number[] } = {
  timeout: 8_000,
  intervals: [250, 250, 500, 1_000]
};

test.describe('undefined-references capture', () => {
  test('a ReferenceError 2 s after load is captured; page console unchanged', async ({
    extension
  }) => {
    /** @type {string[]} */
    const pageErrors: string[] = [];
    /** @type {string[]} */
    const consoleErrors: string[] = [];
    const fixture = await openFixturePage(
      extension,
      '/errors/undefined-reference.html',
      undefined,
      (page) => {
        page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
      }
    );

    // Before the 2 s throw nothing is captured yet (parity with the fixture
    // timing — the throw is a page-lifetime error, not a document_start one).
    expect(await pullFdtData(extension, fixture)).not.toBeNull();
    expect((await pullFdtData(extension, fixture))?.undefinedReferencesOnPage).toEqual([]);
    await expect
      .poll(
        async () => (await pullFdtData(extension, fixture))?.undefinedReferencesOnPage,
        POLL_OPTIONS
      )
      .toEqual(['foo']);

    // Page noise check: the ONLY uncaught error is the page's own throw;
    // the capture added none (no console-error level lines either).
    expect(pageErrors, 'uncaught exceptions on the page').toEqual([
      'ReferenceError: foo is not defined'
    ]);
    expect(consoleErrors, 'the capture must stay silent at error level').toEqual([]);
  });

  test('a hostile thrown value cannot break the capture', async ({ extension }) => {
    /** @type {string[]} */
    const pageErrors: string[] = [];
    /** @type {string[]} */
    const consoleErrors: string[] = [];
    const fixture = await openFixturePage(
      extension,
      '/errors/hostile-stack.html',
      undefined,
      (page) => {
        page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
      }
    );

    // The real throw AFTER the hostile dispatches is still captured: the
    // hostile reads were swallowed, not fatal — and the hostile identifiers
    // never entered the ledger (only the real one is listed).
    await expect
      .poll(
        async () => (await pullFdtData(extension, fixture))?.undefinedReferencesOnPage,
        POLL_OPTIONS
      )
      .toEqual(['afterHostileWord']);
    // Page noise check: uncaught errors on the page are exactly the
    // fixture's own real throw (which is what proves the capture survived);
    // the hostile reads regurgitated nothing — and no error-level console
    // line from the capture either.
    expect(pageErrors, 'exactly the fixture throw, no hostile noise').toEqual([
      'ReferenceError: afterHostileWord is not defined'
    ]);
    expect(consoleErrors, 'the capture must stay silent at error level').toEqual([]);
  });

  test('a malformed batch is rejected without breaking the capture', async ({ extension }) => {
    /** @type {string[]} */
    const rejectedWarnings: string[] = [];
    /** @type {string[]} */
    const consoleErrors: string[] = [];
    const fixture = await openFixturePage(
      extension,
      '/errors/malformed-batch.html',
      undefined,
      (page) => {
        page.on('console', (message) => {
          if (
            message.type() === 'warning' &&
            message.text().includes('Rejected an invalid undefined-references batch')
          ) {
            rejectedWarnings.push(message.text());
          }
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
      }
    );

    // The receiving guard answered every malformed batch and stayed alive:
    // the post-malformed fixture throw is the only word captured.
    await expect
      .poll(
        async () => (await pullFdtData(extension, fixture))?.undefinedReferencesOnPage,
        POLL_OPTIONS
      )
      .toEqual(['survivedMalformedWord']);

    // One rejection warn per malformed batch (three were posted — the guard's
    // recovery is designed to be visible in a debugging tool); an error level
    // line from the capture would be injected page noise, not recovery.
    expect(rejectedWarnings, 'one rejection log per malformed batch').toHaveLength(3);
    expect(consoleErrors, 'the capture must stay silent at error level').toEqual([]);
  });
});
