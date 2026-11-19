/**
 * The undefined-references page's exclusion copy on the real panel canvas:
 * the found word's detail (opened from its row) carries the
 * Copy-as-exclusion control, after the page's real search (the panel seam's
 * `inspect` stub answers for the resource table a real DevTools window
 * serves; everything after it is shipped code — the adapter's shape checks,
 * the definition search, the store flow, the row + detail, the shared copy
 * button), and the copy's feedback is the phase contract:
 * a pending hold keeps keyboard focus and swallows repeat activation, the
 * confirmation toast names the WP Rocket setting to paste into, a rejected
 * write names the pattern to type by hand, and the in-place wording swaps
 * to `Copied` for the flash window and back.
 */
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';
import { ORIGIN_A } from '../helpers/extension';
import { openWordDetail } from '../helpers/undefined-references-page';

/** The fixture's undefined word (thrown inline, assigned by the definer file). */
const WORD = 'wocketInventory';
/** The definition file the search answers with (`/errors/wocket-definer.js`). */
const DEFINER_PATH = '/errors/wocket-definer.js';
/** The exclusion pattern the definition copies: the file's path, its host dropped. */
const PATTERN = DEFINER_PATH;
/** The row control's full accessible name (the file identifies it apart). */
const COPY_NAME = 'Copy as exclusion: wocket-definer.js';

/** Open the panel on the found-reference fixture's Undefined References page. */
async function openExclusionPanel(...args: Parameters<typeof openPanelForFixture>) {
  const opened = await openPanelForFixture(...args);
  await expect(
    opened.panel.getByRole('heading', { name: 'Undefined References', level: 1 })
  ).toBeVisible();
  // The detail answers when the real search over the stubbed resource has run.
  await openWordDetail(opened.panel, WORD);
  const copy = opened.panel.getByRole('button', { name: COPY_NAME });
  await expect(copy).toBeVisible();
  // The definition's source tile shows the served file's path.
  await expect(opened.panel.locator('[data-fdt="source-link-path"]')).toHaveText(DEFINER_PATH);
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

/** The live docker capture pair's served URL (P18.0): the fixture enqueue's minified copy. */
const DOCKER_SERVED =
  'http://127.0.0.1:8493/wp-content/cache/min/1/wp-content/mu-plugins/assets/fdt-delayed-definer.js?ver=1792430636';
/** …and the original path its copy payload must carry. */
const DOCKER_ORIGINAL_PATH = '/wp-content/mu-plugins/assets/fdt-delayed-definer.js';
/** The real remote-mirror capture (the klaviyo delay row), served minified with a hidden host. */
const KLAVIYO_SERVED =
  'https://wp-rocket.me/wp-content/cache/min/1/onsite/js/PD7as8/klaviyo.js?ver=1791299187';
/** The klaviyo definition's hostless payload — the host-hidden script's final answer. */
const KLAVIYO_HOSTLESS = '/onsite/js/PD7as8/klaviyo.js';

test('the minified served URL copies the original path, not the cache path', async ({
  extension
}) => {
  const opened = await openPanelForFixture(extension, '/errors/found-reference.html', {
    bootHash: '#/undefined-references',
    inspect: {
      origin: 'http://127.0.0.1:8493',
      resources: [{ url: DOCKER_SERVED, content: 'window.wocketInventory = null;' }]
    }
  });
  const { panel, fixture } = opened;
  try {
    await openWordDetail(panel, WORD);
    // The tile presents the SERVED file (what actually loaded) and opens it.
    const copy = panel.getByRole('button', {
      name: 'Copy as exclusion: fdt-delayed-definer.js'
    });
    await expect(copy).toBeVisible();
    const link = panel.getByRole('link', { name: /fdt-delayed-definer\.js/ });
    await expect(link).toHaveAttribute('href', DOCKER_SERVED);
    // The clipboard write is audited through the page's dataset.
    await panel.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => {
            document.documentElement.dataset.auditLast = text;
            return Promise.resolve();
          }
        }
      });
    });
    await copy.click();
    await expect
      .poll(() => panel.evaluate(() => document.documentElement.dataset.auditLast))
      .toBe(DOCKER_ORIGINAL_PATH);
    // The cache path is never the payload — the defect this fixes copied it.
    expect(DOCKER_ORIGINAL_PATH).not.toContain('cache/min');
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('a remote-mirror row copies the hostless original path — no notice, no pending state', async ({
  extension
}) => {
  const opened = await openPanelForFixture(extension, '/errors/found-reference.html', {
    bootHash: '#/undefined-references',
    inspect: {
      origin: ORIGIN_A,
      resources: [{ url: KLAVIYO_SERVED, content: 'window.wocketInventory = null;' }]
    }
  });
  const { panel, fixture } = opened;
  try {
    await openWordDetail(panel, WORD);
    // The hostless pattern is the definition's final answer the moment it renders:
    // the control is ready immediately (no resolution wait) and no notice
    // ever appears (the path matches both minify states; no host to resolve).
    const copy = panel.getByRole('button', {
      name: 'Copy as exclusion: klaviyo.js (wp-rocket.me)'
    });
    await expect(copy).toBeVisible();
    await expect(copy).not.toHaveAttribute('aria-busy');
    await expect(copy).toHaveAttribute(
      'title',
      'Copy an exclusion for this script, to exclude it from Delay JavaScript execution'
    );
    await expect(panel.getByText(/original hosts could not be verified/)).toHaveCount(0);
    await panel.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => {
            document.documentElement.dataset.auditLast = text;
            return Promise.resolve();
          }
        }
      });
    });
    await copy.click();
    await expect
      .poll(() => panel.evaluate(() => document.documentElement.dataset.auditLast))
      .toBe(KLAVIYO_HOSTLESS);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
