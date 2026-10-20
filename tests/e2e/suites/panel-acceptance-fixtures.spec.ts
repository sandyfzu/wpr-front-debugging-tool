/**
 * P6.1 browser acceptance — the fixture round (rows 1–2 of
 * 07-phase-6-panel-pages.md).
 *
 * The local docker site serves no `x-rocket-*`/`age`-shaped responses, so
 * this round rides known served fixtures through the real capture path:
 *
 * - **Cache-evidence fixture** — one response carrying every
 *   caching-evidence verdict shape the headers model documents (freshness,
 *   the cache's `age` counter, HIT probes, a MISS probe, the WP Rocket
 *   marker family, Cloudflare DYNAMIC, the edge hints) plus the platform/
 *   server cards' rows, a value-less row, a redaction-exempt caching key,
 *   and page-set cookies. On this one fixture the Detections cards, the
 *   summary strip and the support report all agree with the pure view
 *   model over the same served payload (summary/card consistency); the
 *   headers page lists every verdict with its evidence tone; names-only
 *   cookies never carry a value; and both clipboard forms (one row, all
 *   headers) produce the pure copy rules' exact text. The copied report is
 *   byte-exact against the shipped builder for the same served payload and
 *   reconstructed provenance.
 * - **Secret fixture** — a response whose headers carry planted secrets:
 *   the panel's display and clipboard show the withheld marker and the
 *   reduced URL, and no planted secret reaches the panel's DOM, clipboard
 *   or report.
 * - **Producer-omission shapes (a named dev-only seam)** — the served
 *   `getFdtData` response is reshaped at the panel's transport seam into
 *   two genuine producer-omission shapes (`pageHeaders: null`; the cookie
 *   capture absent, the older-payload form). Everything after the seam —
 *   the boundary validator, the store, the pages — is shipped code; the
 *   capture path itself did not produce these two responses in this run.
 */
import type { Page } from '@playwright/test';
import type { ExtensionDriver } from '../helpers/extension';
import { expect, test } from '../helpers/extension';
import {
  devtoolsShim,
  openFixturePage,
  openPanelForFixture,
  panelPageUrl
} from '../helpers/panel-data';
import { runPanelAxe } from '../helpers/audit';
import packageInfo from '../../../package.json' with { type: 'json' };
import { parseFdtData } from '../../../lib/messaging/validate';
import type { FdtData } from '../../../lib/wp-rocket/types';
import { buildHeadersViewModel, type HeaderRowVM } from '../../../lib/panel/headers-view-model';
import { shownHeader, type ShownHeader } from '../../../lib/panel/shown-header';
import { buildStatusItems } from '../../../lib/panel/detections-view-model';
import { STATUS_LABELS, summarizeDetections } from '../../../lib/panel/detections-summary';
import { buildSupportReport } from '../../../lib/panel/support-report';
import {
  allHeadersCopyText,
  buildInventory,
  headerCopyText
} from '../../../entrypoints/panel/pages/headers-cookies/inventory';

/** The cache-evidence fixture (its response carries the verdict shapes). */
const CACHE_EVIDENCE_PATH = '/__e2e/cache-evidence';

/** The planted-secret fixture (its response carries the withheld rows). */
const SECRET_HEADERS_PATH = '/__e2e/secret-headers';

/** The planted secret token no panel surface may ever carry. */
const PLANTED_SECRET = 'E2E_SECRET';

/** The planted cookie value no panel surface may ever carry. */
const PLANTED_COOKIE_VALUE = 'fdt_never_served_value';

/**
 * Read the fixture page's served payload and parse it the way the panel
 * does — the pure chain every byte-exact expectation in this file derives
 * from. A payload the panel cannot accept lands its pages on the recorded
 * error state; this guard makes that a named failure, never a puzzle later.
 *
 * @param extension The extension driver (the SW-side `getFdtData` read).
 * @param fixture The fixture page binding.
 * @returns The validated payload.
 */
async function readServedPayload(
  extension: ExtensionDriver,
  fixture: { readonly tabId: number }
): Promise<FdtData> {
  const served = await extension.sendToTab<unknown>(fixture.tabId, 'getFdtData');
  const parsed = parseFdtData(served);
  if (parsed === null) throw new Error('the served fixture payload failed the panel validator');
  return parsed;
}

/**
 * The report's generation stamp, parsed out of the copied markdown:
 * `Generated:` carries `YYYY-MM-DD HH:MM:SS UTC`, exact to the second the
 * report was generated in (its provenance floor — never rounded ahead).
 *
 * @param report The copied report text.
 * @returns That instant in epoch milliseconds.
 */
function generationStampFrom(report: string): number {
  const stamp = report.match(
    /^- \*\*Generated:\*\* (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC$/m
  )?.[1];
  if (stamp === undefined)
    throw new Error(`the copied report carries no generation stamp:\n${report}`);
  const ms = Date.parse(`${stamp}Z`);
  if (Number.isNaN(ms)) throw new Error(`the report's stamp is not a UTC second: ${stamp}`);
  return ms;
}

/**
 * The shown header rows of one served capture — the pure display/copy chain
 * the page itself runs (`buildHeadersViewModel` → `shownHeader`), so the
 * expectations below can never drift from what the page actually renders.
 *
 * @param served The validated payload.
 * @returns The shown rows, in the model's render order.
 */
function expectedShownHeaders(served: FdtData): readonly ShownHeader[] {
  const model = buildHeadersViewModel(served.pageHeaders);
  return model.caching.concat(model.other).map((row: HeaderRowVM) => shownHeader(row));
}

/**
 * The all-headers clipboard text for one served capture — the page's own
 * pure chain over its rendered rows (`buildInventory` → its header rows).
 *
 * @param served The validated payload.
 * @returns One line per header row.
 */
function expectedAllHeaders(served: FdtData): string {
  return allHeadersCopyText(
    buildInventory(buildHeadersViewModel(served.pageHeaders), served.cookies).rows
  );
}

/** The shown row's clipboard wire form. */
function expectedRowCopy(served: FdtData, name: string): string {
  return headerCopyText(
    expectedShownHeaders(served).find(
      (row) => row.name.toLowerCase() === name.toLowerCase()
    ) as ShownHeader
  );
}

/**
 * Every rendered inventory row of the headers page, one snapshot: kind, the
 * key-value name/value spans, the row's own text.
 *
 * @param panel The panel page.
 * @returns The rendered rows in list order.
 */
function renderedInventory(
  panel: Page
): Promise<{ kind: string; term: string | null; value: string | null; text: string }[]> {
  return panel.evaluate(() =>
    Array.from(document.querySelectorAll('[data-fdt-inventory-row]')).map((row) => ({
      kind: row.getAttribute('data-fdt-inventory-row') ?? '',
      term: row.querySelector('[data-fdt-key-value-term]')?.textContent ?? null,
      value: row.querySelector('[data-fdt-key-value-value]')?.textContent ?? null,
      text: row.textContent
    }))
  );
}

test.describe('acceptance over served cache-evidence fixtures (real capture)', () => {
  test('one response agrees across Detections, report, headers page and clipboard', async ({
    extension
  }) => {
    // The tier's worker-scoped browser shares one profile, so the exact
    // cookie counts below pin this fixture alone whatever an earlier suite
    // left on this origin.
    await extension.browserContext.clearCookies();
    const fixture = await openFixturePage(extension, CACHE_EVIDENCE_PATH);
    const pageUrl = fixture.page.url();
    const panel = await extension.browserContext.newPage();
    // The report's page-URL line comes from the same seam the real DevTools
    // eval rides; the stub answers this suite's served address (the whole
    // reason the shim is exported: the URL must name THIS fixture's real
    // address, which only exists after the fixture page is open).
    // The palette exists before the boot (the audit runner's palette rule).
    await panel.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await panel.addInitScript(devtoolsShim(fixture.tabId, { origin: pageUrl, resources: [] }));
    await panel.goto(`${await panelPageUrl(extension)}#/detections`, { waitUntil: 'load' });
    try {
      await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
      const served = await readServedPayload(extension, fixture);

      // --- Detections: the rendered card set IS the view model over this
      // payload (ids, names, verdicts), and the summary strip's headline
      // counts exactly what the cards say Active.
      const detections = panel.locator('[data-fdt-page="detections"]');
      await expect(detections.getByRole('heading', { level: 1, name: 'Detections' })).toBeVisible();
      const pure = buildStatusItems(served);
      const summary = summarizeDetections(pure);
      const cards = await panel.evaluate(
        (activeLabel: string) =>
          Array.from(document.querySelectorAll('[data-fdt-card-id]')).map((card) => {
            const name = card.querySelector('[data-fdt-card-name]');
            return {
              id: card.getAttribute('data-fdt-card-id'),
              text: name?.textContent ?? '',
              // The verdict is the badge's own word (STATUS_LABELS'), never a
              // styling class on the name.
              active: card.querySelector('[data-fdt="status-badge"]')?.textContent === activeLabel
            };
          }),
        STATUS_LABELS.active
      );
      expect(cards).toHaveLength(pure.length);
      expect(cards).toEqual(
        pure.map((item) => ({
          id: item.id,
          text: item.name,
          active: item.status === 'active'
        }))
      );
      const headline = await panel.locator('[data-fdt-summary-headline]').textContent();
      expect(headline).toBe(
        `${summary.optimizations.active.toString()} of ${summary.optimizations.total.toString()} optimizations active`
      );
      // The facts list states the same facts the cards do — once.
      if (summary.cache.kind === 'cached' && summary.cache.formatted !== null)
        await expect(panel.locator('[data-fdt-summary-fact="cache"] time')).toHaveText(
          summary.cache.formatted
        );
      if (summary.platform !== null)
        await expect(panel.locator('[data-fdt-summary-fact="platform"]')).toContainText(
          `${summary.platform.name} via`
        );

      // --- The support report: the shipped chain's content, byte-exact
      // against the committed builder for the same payload and provenance
      // (the generation stamp read back out of the copy itself, never a
      // raced wall clock).
      await panel.getByRole('button', { name: 'Copy report', exact: true }).click();
      await expect(panel.getByText('Report copied')).toBeVisible();
      const report = await panel.evaluate(() => navigator.clipboard.readText());
      expect(report).toBe(
        buildSupportReport(served, {
          generatedAt: generationStampFrom(report),
          extensionVersion: packageInfo.version,
          pageUrl: pageUrl
        })
      );
      expect(report).not.toContain(PLANTED_SECRET);

      // --- Headers page: the whole model order rendered, verdicts toned,
      // names-only cookies, and the row/all-headers clipboards exact.
      await panel.evaluate(() => {
        location.hash = '#/headers-cookies';
      });
      const headersPage = panel.locator('[data-fdt-page="headers-cookies"]');
      await expect(
        headersPage.getByRole('heading', { level: 1, name: 'Headers & Cookies' })
      ).toBeVisible();
      const model = buildHeadersViewModel(served.pageHeaders);
      const cachingNames = model.caching.map((row) => row.name);
      const otherNames = model.other.map((row) => row.name);
      const expectedNames = [...cachingNames, ...otherNames];
      const rows = await renderedInventory(panel);
      const headerRows = rows.filter((row) => row.kind === 'header');
      expect(headerRows).toHaveLength(expectedNames.length);
      expect(headerRows.map((row) => row.term)).toEqual(expectedNames);
      // Caching evidence led: the model's caching group is the list's head,
      // the unrelated rows follow in capture order.
      expect(headerRows.map((row) => row.term).slice(0, cachingNames.length)).toEqual(cachingNames);
      // Verdict hints: the model's tone per row rides the shared status
      // vocabulary's icon class; a row with no hint carries no tone icon.
      const tones = model.caching.concat(model.other).map((row) => row.hint?.tone ?? null);
      const renderedTones = await panel.evaluate(() =>
        Array.from(document.querySelectorAll('[data-fdt-inventory-row="header"]')).map((row) => {
          const classes = row.querySelector('svg')?.getAttribute('class') ?? '';
          return /(^|\s)text-status-(ok|warn|info|neutral|error)(\s|$)/.exec(classes)?.[2] ?? null;
        })
      );
      expect(renderedTones).toEqual(tones);
      // Value-less row: displayed as no value (its term still listed).
      expect(rows.find((row) => row.term === 'x-plain-empty')?.value).toBe('(no value)');
      // Names-only cookies: the section carries exactly the fixture's two
      // names, and a cookie VALUE's text never renders anywhere.
      expect(rows.filter((row) => row.kind === 'cookie').map((row) => row.text)).toEqual([
        'fdt_evidence',
        'fdt_evidence_two'
      ]);
      const bodyText = await panel.evaluate(() => document.body.textContent);
      expect(bodyText).not.toContain(PLANTED_COOKIE_VALUE);
      // Section badges restate the exact counts (caching first, then other,
      // then cookies) — read off each band's level-2 heading name, which
      // carries only the title, the count and its noun (the bands' stamp
      // lives outside the heading).
      const headingNames = await panel.evaluate(() =>
        Array.from(document.querySelectorAll('[data-fdt-inventory-row="section"]')).map((row) => {
          const heading = row.querySelector('[role="heading"]');
          return heading?.textContent ?? '';
        })
      );
      expect(headingNames).toHaveLength(3);
      expect(headingNames[0]).toBe(
        `Caching evidence ${model.caching.length.toString()} ${model.caching.length === 1 ? 'header' : 'headers'}`
      );
      expect(headingNames[1]).toBe(
        `Other headers ${model.other.length.toString()} ${model.other.length === 1 ? 'header' : 'headers'}`
      );
      // This fixture's page writes two cookies (the badge below pins their
      // exact count): a capture that missed them fails here, named.
      const cookies = served.cookies;
      if (cookies === undefined)
        throw new Error('the cache-evidence fixture captured no cookie set');
      expect(headingNames[2]).toBe(
        `Cookies ${cookies.names.length.toString()} ${cookies.names.length === 1 ? 'cookie' : 'cookies'}`
      );

      // One row copy and the all-headers copy: the pure copy chain's text.
      const ageCopy = panel.getByRole('button', { name: 'age header — copy' });
      await ageCopy.click();
      await expect(panel.getByText('age header copied')).toBeVisible();
      await expect
        .poll(async () => await panel.evaluate(() => navigator.clipboard.readText()))
        .toBe(expectedRowCopy(served, 'age'));
      await panel.getByRole('button', { name: 'All headers', exact: true }).click();
      await expect(panel.getByText('All headers copied')).toBeVisible();
      await expect
        .poll(async () => await panel.evaluate(() => navigator.clipboard.readText()))
        .toBe(expectedAllHeaders(served));
      // The all-headers clipboard carries no planted secret either.
      const clipboard = await panel.evaluate(() => navigator.clipboard.readText());
      expect(clipboard).not.toContain(PLANTED_COOKIE_VALUE);
      expect(clipboard).not.toContain(PLANTED_SECRET);

      // --- Strict axe over this page state at the compact tier, dark
      //     (the palette was booted into, not emulated at audit time).
      await panel.setViewportSize({ width: 320, height: 800 });
      expect.soft(await runPanelAxe(panel)).toEqual({ violations: [], incomplete: [], detail: [] });
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('planted-secret headers stay withheld at display, copy and report', async ({
    extension
  }) => {
    await extension.browserContext.clearCookies();
    // The report's inspected-URL line rides the same seam the real eval
    // rides, and it must name THIS fixture's real address — which only
    // exists after the fixture page is open — so this round boots the panel
    // itself (the same opening the other rounds ride).
    const fixture = await openFixturePage(extension, SECRET_HEADERS_PATH);
    const pageUrl = fixture.page.url();
    const panel = await extension.browserContext.newPage();
    await panel.addInitScript(devtoolsShim(fixture.tabId, { origin: pageUrl, resources: [] }));
    await panel.goto(`${await panelPageUrl(extension)}#/headers-cookies`, { waitUntil: 'load' });
    try {
      await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
      const served = await readServedPayload(extension, fixture);
      const headersPage = panel.locator('[data-fdt-page="headers-cookies"]');
      await expect(
        headersPage.getByRole('heading', { level: 1, name: 'Headers & Cookies' })
      ).toBeVisible();
      // Display: the nonce row's value area is the marker (lock + text).
      const nonceRow = panel
        .locator('[data-fdt-inventory-row="header"]')
        .filter({ hasText: 'x-wp-nonce' });
      await expect(nonceRow.locator('[data-fdt-redacted]')).toBeVisible();
      await expect(nonceRow.locator('[data-fdt-redacted] span').first()).toHaveText(
        '(value redacted)'
      );
      // The reduced URL row shows the reduction, never the token.
      const locationRow = panel
        .locator('[data-fdt-inventory-row="header"]')
        .filter({ hasText: 'location' });
      await expect(locationRow.locator('[data-fdt-key-value-value]')).toHaveText(
        '/next?token=[redacted]&ok=1'
      );
      // The legend names the lock vocabulary once for the whole inventory.
      await expect(
        panel.locator('[data-fdt="withheld-legend"]', { hasText: 'withheld' })
      ).toBeVisible();
      // Nothing planted: the whole panel document text (and the capture
      // tripwire: Chromium delivers no Set-Cookie row to this listener, so
      // the page carries none either).
      const bodyText = await panel.evaluate(() => document.body.textContent);
      expect(bodyText).not.toContain(PLANTED_SECRET);
      expect(bodyText.toLowerCase()).not.toContain('set-cookie');
      // Row clipboard carries the marker form, never the secret.
      const nonceCopy = panel.getByRole('button', { name: 'x-wp-nonce header — copy' });
      await nonceCopy.click();
      await expect(panel.getByText('x-wp-nonce header copied')).toBeVisible();
      await expect
        .poll(async () => await panel.evaluate(() => navigator.clipboard.readText()))
        .toBe(expectedRowCopy(served, 'x-wp-nonce'));
      // All headers: marker text again, no planted secret anywhere.
      await panel.getByRole('button', { name: 'All headers', exact: true }).click();
      await expect(panel.getByText('All headers copied')).toBeVisible();
      const clipboard = await panel.evaluate(() => navigator.clipboard.readText());
      expect(clipboard).toBe(expectedAllHeaders(served));
      expect(clipboard).not.toContain(PLANTED_SECRET);

      // --- The Detections report over the same capture: the withheld cell
      // is the marker; the reduced location row stays reduced.
      await panel.evaluate(() => {
        location.hash = '#/detections';
      });
      await panel.getByRole('button', { name: 'Copy report', exact: true }).click();
      await expect(panel.getByText('Report copied')).toBeVisible();
      const report = await panel.evaluate(() => navigator.clipboard.readText());
      expect(report).toBe(
        buildSupportReport(served, {
          generatedAt: generationStampFrom(report),
          extensionVersion: packageInfo.version,
          pageUrl: pageUrl
        })
      );
      expect(report).not.toContain(PLANTED_SECRET);
      expect(report).toContain('(value redacted)');
      expect(report).toContain('/next?token=[redacted]&ok=1');
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('producer-omission shapes land graceful: no headers, no cookie capture', async ({
    extension
  }, info) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/plain.html', {
      panelInit: OMISSION_SEAM,
      emulation: { colorScheme: 'dark', reducedMotion: 'reduce' }
    });
    try {
      // The seam served the omission shapes; the panel accepted and lives
      // on them (the Detections page rendered, not the recorded error).
      const detections = panel.locator('[data-fdt-page="detections"]');
      await expect(detections.getByRole('heading', { level: 1, name: 'Detections' })).toBeVisible();
      // No headers → both header-derived cards omitted, and no cached card
      // either (a plain page's plugin is absent; no cache card exists).
      const cardIds = await panel.evaluate(() =>
        Array.from(document.querySelectorAll('[data-fdt-card-id]')).map((card) =>
          card.getAttribute('data-fdt-card-id')
        )
      );
      expect(cardIds).not.toContain('server');
      expect(cardIds).not.toContain('known-platform');
      expect(cardIds).not.toContain('cached');
      // The strip says the absence (WP Rocket not detected on a plain page).
      await expect(panel.locator('[data-fdt-summary-fact="wpr"]')).toContainText(
        'WP Rocket was not detected'
      );

      // Headers & Cookies on a null capture: the empty state, plus NO
      // cookie section (the older-payload form) and no filter field.
      await panel.evaluate(() => {
        location.hash = '#/headers-cookies';
      });
      const headersPage = panel.locator('[data-fdt-page="headers-cookies"]');
      await expect(
        headersPage.getByRole('heading', { level: 1, name: 'Headers & Cookies' })
      ).toBeVisible();
      await expect(headersPage.getByText('No response headers captured')).toBeVisible();
      // The reload remedy rides where the context can reload; a standalone
      // page cannot, which hides the action — both are the page's states.
      expect(await panel.getByRole('button', { name: 'All headers', exact: true }).count()).toBe(0);
      expect(await headersPage.locator('input[type="search"]').count()).toBe(0);
      expect(await headersPage.getByRole('heading', { level: 2 }).count()).toBe(0);
      expect((await renderedInventory(panel)).map((row) => row.kind)).toEqual([]);
      // Strict axe over the empty state (the palette was booted into).
      await panel.setViewportSize({ width: 1280, height: 800 });
      expect(await runPanelAxe(panel)).toEqual({ violations: [], incomplete: [], detail: [] });
      await info.attach('omission-axe', { body: 'clean', contentType: 'text/plain' });
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
});

/**
 * The panel-side seam script for the omission shapes: one transport-seam
 * wrapper on both namespaces (`chrome` and `browser`) intercepting only the
 * payload `getFdtData` serves and reshaping it into the two producer
 * omission shapes. Everything past the wrapper — the boundary validator,
 * the store, the pages — runs shipped code; nothing here is app state. The
 * `No response headers captured` assertion is the proof the seam served
 * these shapes: this fixture's own capture carries headers naturally.
 */
const OMISSION_SEAM = `(() => {
  const reshape = (name, namespace) => {
    if (namespace === undefined || namespace === null) return;
    const original = namespace.tabs.sendMessage.bind(namespace.tabs);
    namespace.tabs.sendMessage = (...args) => {
      const envelope = args[1];
      if (
        envelope === undefined ||
        envelope === null ||
        envelope.type !== 'getFdtData'
      ) {
        return original(...args);
      }
      const callback = args[args.length - 1];
      if (typeof callback !== 'function') return original(...args);
      const rest = args.slice(0, -1);
      const interceptor = (response) => {
        if (response === undefined || response === null || typeof response !== 'object') {
          callback(response);
          return;
        }
        // The reply rides the protocol envelope ({ res, err }): the payload
        // is its res field, so that is what the omission shapes reshape.
        const next = JSON.parse(JSON.stringify(response));
        const payload = next.res;
        if (payload !== null && typeof payload === 'object') {
          payload.pageHeaders = null;
          delete payload.cookies;
        }
        callback(next);
      };
      return original(...rest, interceptor);
    };
  };
  reshape('chrome', window['chrome']);
  reshape('browser', window['browser']);
})();`;
