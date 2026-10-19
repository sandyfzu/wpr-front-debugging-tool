/**
 * The undefined-references page's exclusion copy on the real panel canvas:
 * the found-verdict row's Copy-as-exclusion control runs the page's real
 * search (the panel seam's `inspect` stub answers for the resource table a
 * real DevTools window serves; everything after it is shipped code — the
 * adapter's shape checks, the definition search, the store flow, the card,
 * the shared copy button), and the copy's feedback is the phase contract:
 * a pending hold keeps keyboard focus and swallows repeat activation, the
 * confirmation toast names the WP Rocket setting to paste into, a rejected
 * write names the pattern to type by hand, and the in-place wording swaps
 * to `Copied` for the flash window and back.
 */
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';
import { ORIGIN_A } from '../helpers/extension';

/** The definition file the search answers with (`/errors/wocket-definer.js`). */
const DEFINER_PATH = '/errors/wocket-definer.js';
/** The exclusion pattern the row copies: the file's path, its host dropped. */
const PATTERN = DEFINER_PATH;
/** The row control's full accessible name (the file identifies it apart). */
const COPY_NAME = 'Copy as exclusion: wocket-definer.js';

/** Open the panel on the found-reference fixture's Undefined References page. */
async function openExclusionPanel(...args: Parameters<typeof openPanelForFixture>) {
  const opened = await openPanelForFixture(...args);
  await expect(
    opened.panel.getByRole('heading', { name: 'Undefined References', level: 1 })
  ).toBeVisible();
  // The card answers when the real search over the stubbed resource has run.
  const copy = opened.panel.getByRole('button', { name: COPY_NAME });
  await expect(copy).toBeVisible();
  await expect(opened.panel.locator('[data-fdt="script-location"]')).toHaveText('errors/');
  return { ...opened, copy };
}

test('holds focus through a pending copy, then names the setting it is pasted into', async ({
  extension
}) => {
  const { panel, fixture, copy } = await openExclusionPanel(
    extension,
    '/errors/found-reference.html',
    {
      bootHash: '#/undefined-references',
      inspect: {
        origin: ORIGIN_A,
        resources: [
          { url: `${ORIGIN_A}${DEFINER_PATH}`, content: 'window.wocketInventory = null;' }
        ]
      }
    }
  );
  try {
    // A controllable pending write: the count shows the guard, the settle
    // event decides the outcome (the copy is the phase's slow-copy probe);
    // the last argument records the exact payload that reached the clipboard.
    await panel.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => {
            document.documentElement.dataset.auditLast = text;
            document.documentElement.dataset.auditWrites = String(
              Number(document.documentElement.dataset.auditWrites ?? '0') + 1
            );
            return new Promise<void>((resolve, reject) => {
              document.addEventListener(
                'audit-clipboard-settle',
                (event) => {
                  if ((event as CustomEvent<string>).detail === 'reject')
                    reject(new Error('audit write rejection'));
                  else resolve();
                },
                { once: true }
              );
            });
          }
        }
      });
    });
    await copy.focus();
    await expect(copy).toBeFocused();
    await copy.press('Enter');
    await expect
      .poll(() => panel.evaluate(() => document.documentElement.dataset.auditWrites))
      .toBe('1');
    // The pending hold: focus stays, the control announces busy.
    await expect(copy).toBeFocused();
    await expect(copy).toHaveAttribute('aria-busy', 'true');
    // Repeat activation is the same copy, never a second write.
    await copy.press('Enter');
    await panel.evaluate(() =>
      document.dispatchEvent(new CustomEvent('audit-clipboard-settle', { detail: 'resolve' }))
    );
    // The direct guard fact: the second activation added no audit write.
    await expect
      .poll(() => panel.evaluate(() => document.documentElement.dataset.auditWrites))
      .toBe('1');
    // The confirmation names where the exclusion goes — not just "copied".
    await expect(panel.getByText('Exclusion copied')).toBeVisible();
    await expect(
      panel.getByText(
        "Paste it into WP Rocket's Delay JavaScript execution → Excluded JavaScript Files."
      )
    ).toBeVisible();
    // The write reached the clipboard byte-exact: the file's path, host dropped.
    expect(await panel.evaluate(() => document.documentElement.dataset.auditLast)).toBe(PATTERN);
    // The in-place feedback: the wording swaps for the flash window, then returns.
    await expect(copy).toHaveAttribute('data-fdt-copied', '');
    await expect(copy).toHaveText('Copied');
    await expect(copy).toBeFocused();
    await expect(copy).toHaveText('Copy as exclusion', { timeout: 3_000 });
    await expect(copy).not.toHaveAttribute('data-fdt-copied', '');
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('names the pattern to add by hand when the clipboard write is rejected', async ({
  extension
}) => {
  const { panel, fixture, copy } = await openExclusionPanel(
    extension,
    '/errors/found-reference.html',
    {
      bootHash: '#/undefined-references',
      inspect: {
        origin: ORIGIN_A,
        resources: [
          { url: `${ORIGIN_A}${DEFINER_PATH}`, content: 'window.wocketInventory = null;' }
        ]
      }
    }
  );
  try {
    await panel.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('Document is not focused.')) }
      });
    });
    await copy.click();
    // The error toast is the remedy: the error copy carries the pattern,
    // never the platform's rejection text.
    await expect(panel.getByText('Copy failed', { exact: true })).toBeVisible();
    await expect(panel.getByText(`Add it by hand: ${PATTERN}`)).toBeVisible();
    await expect(panel.getByText('Document is not focused.')).toHaveCount(0);
    // No flash on failure; the control stays itself.
    await expect(copy).toHaveText('Copy as exclusion');
    await expect(copy).not.toHaveAttribute('data-fdt-copied', '');
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
