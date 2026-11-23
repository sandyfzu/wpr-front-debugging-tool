/**
 * The Exclusion Builder on the on-page strip, in real Chromium, over the
 * docker site's real `/fdt/` markup carrying a marker the real writer put
 * there (as a rewritten document does): Delay JS off, Defer JS off for the
 * page, LazyLoad rows excluded.
 *
 * The open card carries the tab-level "Exclusion Builder rewrote this page"
 * line (visible title + hints, dots drawn in a clipped gutter and never
 * spoken; the dialog's description, so keyboard opening announces it) and
 * each changed row's modifier (badge with icon + visible sentence). Checked
 * at 320/480/768/1280 px in both palettes with reduced motion: no
 * horizontal scroll, AA contrast from computed colours, keyboard reach,
 * strict axe over the strip. Freshness: the line follows the displayed
 * document — kept on a re-read of the rewritten page (Stop does not
 * reload), gone once a reload serves the page without the marker.
 *
 * Each case serves the real `/fdt/` HTML (fetched read-only) through a route
 * on a unique site URL — the site itself is never changed.
 *
 * Set `FDT_SHOTS_DIR` to save a card screenshot per palette × width there.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { writeBuilderMarker } from '../../../lib/exclusion-builder/builder-marker-write';
import {
  BUILDER_MARKER_META_NAME,
  CACHE_BYPASS_QUERY_PARAM
} from '../../../lib/wp-rocket/constants';
import { expect, test, type ExtensionDriver } from '../helpers/extension';
import { openSitePage, SITE_ORIGIN, SITE_URL } from '../helpers/site';
import {
  announcedNamesWith,
  answeredPillName,
  hasPillHint,
  PILL_GLYPH,
  pillNames,
  STRIP_HOST,
  WIDGET_ORIGINS_KEY,
  withPillHint
} from '../helpers/strip-pill';

/** The accessibility engine, injected into the page under test. */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

/** The note every marked case writes. */
const NOTE = {
  delay_js: { off: 'feature' },
  defer_all_js: { off: 'page' },
  lazyload: { excluded: 3 }
} as const;

/** The tab-level line's visible title and hints. */
const TITLE = 'Exclusion Builder rewrote this page';
const HINTS = ['Delay JS off', 'Defer JS off on this page', 'Lazyload Images: 3 excluded'];

/** What opening the card announces (the shared line, its dots spoken as commas). */
const DESCRIPTION = `${TITLE} — ${HINTS.join(', ')}`;

/** Each changed row: its chip label, modifier kind, badge words and sentence. */
const ROWS = [
  {
    label: 'Delay JS',
    kind: 'off',
    chip: 'Disabled in this tab',
    sentence: 'Disabled in this tab by the Exclusion Builder.'
  },
  {
    label: 'Defer JS',
    kind: 'off',
    chip: 'Off on this page',
    sentence: 'Off in this tab: an Exclusion Builder row stops WP Rocket deferring.'
  },
  {
    label: 'Lazyload Images',
    kind: 'excluded',
    chip: '3 excluded',
    sentence: '3 images excluded by the Exclusion Builder.'
  }
] as const;

/** The UI bar's D-1 widths. */
const WIDTHS = [320, 480, 768, 1280] as const;

/** The AA floor for the strip's small text. */
const AA_SMALL_TEXT = 4.5;

/** The AA floor for a meaningful non-text glyph (WCAG 1.4.11). */
const AA_NON_TEXT = 3;

/** The identity's longest form: the generator meta carries no version. */
const UNKNOWN_IDENTITY = 'WPR (unknown version)';

/** Drop the generator meta's version, keeping the WP Rocket generator itself. */
function unversioned(html: string): string {
  const out = html.replace(/(<meta name="generator" content="WP Rocket) [^"]*"/, '$1"');
  if (out === html) throw new Error('the served /fdt/ page lost its WP Rocket generator meta');
  return out;
}

/** Remove one required piece of the served page, failing loudly when it is absent. */
function without(html: string, piece: RegExp, name: string): string {
  const out = html.replace(piece, '');
  if (out === html) throw new Error(`the served /fdt/ page lost its ${name}`);
  return out;
}

/** WP Rocket's footer comment: its cache signature (and the debug stamp inside it). */
const FOOTER_COMMENT = /<!-- This website is like a Rocket[^>]*-->/;

/** The footer's debug stamp alone: without it the signature is not proof of a cached visit. */
const DEBUG_STAMP = / - Debug: cached@\d+/;

/**
 * The pill's worst cases: the longest identity next to each long chip state
 * word (and the cached chip's long stamp), each served plain and rewritten.
 */
const PILL_WORST_CASES: readonly {
  label: string;
  chip: string;
  make: (html: string) => string;
  serve?: ServeOptions;
}[] = [
  { label: 'cached', chip: '✓ Cached', make: unversioned },
  {
    label: 'not-detected',
    chip: 'Cache not detected',
    make: (html) => without(unversioned(html), FOOTER_COMMENT, 'footer comment')
  },
  {
    label: 'not-proven',
    chip: 'Cache not proven',
    make: (html) => without(unversioned(html), DEBUG_STAMP, 'debug stamp')
  },
  {
    label: 'bypass',
    chip: 'Bypass requested',
    make: (html) => without(unversioned(html), FOOTER_COMMENT, 'footer comment'),
    serve: { query: `${CACHE_BYPASS_QUERY_PARAM}=1` }
  },
  {
    label: 'possibly',
    chip: 'Possibly cached',
    make: (html) => without(unversioned(html), FOOTER_COMMENT, 'footer comment'),
    serve: { headers: { 'cf-cache-status': 'HIT' } }
  }
];

/** The real `/fdt/` HTML, as the site serves it. */
async function servedFdtHtml(extension: ExtensionDriver): Promise<string> {
  const response = await extension.browserContext.request.get(`${SITE_URL}/fdt/`);
  expect(response.ok(), `GET ${SITE_URL}/fdt/ answered ${String(response.status())}`).toBe(true);
  return await response.text();
}

/** Enable (or clear) the widget for the site's origin through its storage seam. */
async function setWidget(extension: ExtensionDriver, enabled: boolean | null): Promise<void> {
  await extension.evaluateInWorker(
    async (payload: { key: string; origin: string; enabled: boolean | null }) => {
      if (payload.enabled === null) {
        await chrome.storage.sync.remove([payload.key]);
        return;
      }
      await chrome.storage.sync.set({
        [payload.key]: { [payload.origin]: { enabled: payload.enabled } }
      });
    },
    { key: WIDGET_ORIGINS_KEY, origin: SITE_ORIGIN, enabled }
  );
}

/** Extra request shape for a served case: query parameters and response headers. */
interface ServeOptions {
  readonly query?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Serve `body()` at a unique site URL (re-read per request, so a reload can
 * serve a different document) and open it.
 */
async function openServed(
  extension: ExtensionDriver,
  label: string,
  body: () => string,
  options: ServeOptions = {}
): Promise<{ page: Page; url: string }> {
  const extra = options.query === undefined ? '' : `&${options.query}`;
  const url = `${SITE_URL}/fdt/?fdt-strip-builder=${label}-${String(Date.now())}${extra}`;
  await extension.browserContext.route(url, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: body(),
      ...(options.headers === undefined ? {} : { headers: { ...options.headers } })
    });
  });
  const { page } = await openSitePage(extension, url);
  return { page, url };
}

/** Open the card from the pill with the keyboard; resolves once the card is settled. */
async function openCardByKeyboard(page: Page): Promise<void> {
  const pill = page.locator(`${STRIP_HOST} .ins-pill`);
  await expect(pill).toContainText('WPR', { timeout: 15_000 });
  // The pass must have answered (identity carries a version) before opening.
  await expect(pill).toContainText(/WPR \d/, { timeout: 15_000 });
  await pill.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(`${STRIP_HOST} .ins-card`)).toBeVisible();
  await settle(page);
}

/** Wait until the strip has no running animation, then two frames. */
async function settle(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (host) =>
            (document.querySelector(host)?.shadowRoot?.getAnimations() ?? []).filter(
              (animation) => animation.playState === 'running'
            ).length,
          STRIP_HOST
        ),
      { timeout: 10_000 }
    )
    .toBe(0);
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done();
          });
        });
      })
  );
}

/** One measured text: which part, its text and its contrast ratio. */
interface MeasuredContrast {
  readonly part: string;
  readonly text: string;
  readonly ratio: number;
}

/**
 * The contrast ratio of every builder text in the strip against the layers
 * it is painted over, from computed colours composited in a 1 px canvas
 * (translucent soft fills count), walking out of the shadow root.
 */
async function builderContrast(
  page: Page,
  selector = '.ins-builder-title, .ins-builder-hint, .ins-mod, .ins-mod-line'
): Promise<MeasuredContrast[]> {
  return await page.evaluate(
    ({ host, selector }) => {
      const root = document.querySelector(host)?.shadowRoot;
      if (root === undefined || root === null) throw new Error('no strip');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) throw new Error('no 2d context');
      const paint = (layers: string[]): number[] => {
        context.clearRect(0, 0, 1, 1);
        for (const layer of layers) {
          context.fillStyle = layer;
          context.fillRect(0, 0, 1, 1);
        }
        return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
      };
      const luminance = (rgb: number[]): number => {
        const [r = 0, g = 0, b = 0] = rgb.map((value) => {
          const channel = value / 255;
          return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const parts = root.querySelectorAll<HTMLElement>(selector);
      return Array.from(parts, (element) => {
        const fills: string[] = [];
        for (
          let node: Element | null = element;
          node !== null;
          node =
            node.parentElement ??
            (node.parentNode instanceof ShadowRoot ? node.parentNode.host : null)
        ) {
          fills.unshift(getComputedStyle(node).backgroundColor);
        }
        const layers = ['#fff', ...fills];
        const background = paint(layers);
        const foreground = paint([...layers, getComputedStyle(element).color]);
        const [light = 0, dark = 0] = [luminance(foreground), luminance(background)].sort(
          (a, b) => b - a
        );
        return {
          part: element.className,
          text: element.textContent,
          ratio: Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
        };
      });
    },
    { host: STRIP_HOST, selector }
  );
}

/** The card's layout facts at the current width (overflow + the hints' gutter dots). */
interface BuilderLayout {
  cardInside: boolean;
  bodyOverflow: number;
  /** The horizontal document overflow the strip adds (the theme's own excluded). */
  documentOverflow: number;
  hintLines: number;
  /** Per hint: whether it starts a line and whether its dot is clipped. */
  hints: { startsLine: boolean; dotHidden: boolean; dotContent: string; inside: boolean }[];
  sentencesInside: boolean;
}

/** Read the open card's layout facts. */
async function builderLayout(page: Page): Promise<BuilderLayout> {
  return await page.evaluate((host) => {
    const root = document.querySelector(host)?.shadowRoot;
    if (root === undefined || root === null) throw new Error('no strip');
    const card = root.querySelector<HTMLElement>('.ins-card');
    const body = root.querySelector<HTMLElement>('.ins-card-body');
    const clip = root.querySelector<HTMLElement>('.ins-builder-hints');
    if (card === null || body === null || clip === null) throw new Error('no builder line');
    const cardBox = card.getBoundingClientRect();
    const clipBox = clip.getBoundingClientRect();
    const hints = Array.from(root.querySelectorAll<HTMLElement>('.ins-builder-hint'));
    // The strip's own share of the document's horizontal overflow: the host
    // theme's overflow (if any) is not ours, so measure with and without it.
    const overflow = (): number =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const withStrip = overflow();
    const hostElement = document.querySelector<HTMLElement>(host);
    hostElement?.style.setProperty('display', 'none', 'important');
    const withoutStrip = overflow();
    hostElement?.style.removeProperty('display');
    return {
      cardInside: cardBox.left >= -0.5 && cardBox.right <= window.innerWidth + 0.5,
      bodyOverflow: body.scrollWidth - body.clientWidth,
      documentOverflow: withStrip - withoutStrip,
      hintLines: new Set(hints.map((hint) => Math.round(hint.getBoundingClientRect().top))).size,
      hints: hints.map((hint) => {
        const own = hint.getBoundingClientRect();
        const dot = getComputedStyle(hint, '::before');
        const dotRight = own.left + parseFloat(dot.left) + parseFloat(dot.width);
        return {
          startsLine: Math.abs(own.left - clipBox.left) < 0.5,
          dotHidden: dotRight <= clipBox.left + 0.5,
          dotContent: dot.content,
          inside: own.left >= clipBox.left - 0.5 && own.right <= clipBox.right + 0.5
        };
      }),
      sentencesInside: Array.from(root.querySelectorAll<HTMLElement>('.ins-mod-line')).every(
        (line) => {
          const box = line.getBoundingClientRect();
          return box.left >= cardBox.left - 0.5 && box.right <= cardBox.right + 0.5;
        }
      )
    };
  }, STRIP_HOST);
}

/** Every name and value in Chromium's accessibility tree for the page. */
async function accessibleTexts(page: Page): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await session.send('Accessibility.getFullAXTree')) as {
      nodes: { ignored?: boolean; name?: { value?: unknown }; value?: { value?: unknown } }[];
    };
    return nodes
      .filter((node) => node.ignored !== true)
      .flatMap((node) => [node.name?.value, node.value?.value])
      .filter((text): text is string => typeof text === 'string' && text !== '');
  } finally {
    await session.detach();
  }
}

/** Every accessible description in Chromium's accessibility tree for the page. */
async function accessibleDescriptions(page: Page): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await session.send('Accessibility.getFullAXTree')) as {
      nodes: { ignored?: boolean; description?: { value?: unknown } }[];
    };
    return nodes
      .filter((node) => node.ignored !== true)
      .map((node) => node.description?.value)
      .filter((text): text is string => typeof text === 'string' && text !== '');
  } finally {
    await session.detach();
  }
}

/** The closed pill's layout facts at the current width. */
interface PillLayout {
  pillInside: boolean;
  /** The pill's own horizontal overflow (its content wider than its box). */
  pillOverflow: number;
  /** The chip box's own overflow (a clip with no ellipsis of its own). */
  chipOverflow: number;
  /** The builder glyph's facts; null on a page with no hint. */
  glyphInside: boolean | null;
  glyphWidth: number | null;
  /** The glyph follows the identity on the same row. */
  glyphAfterIdentity: boolean | null;
  /** How much of the identity (the version) its ellipsis hides. */
  identityClipped: number;
  /** The chip's state word, and how much of it is hidden. */
  chipText: string;
  chipTextClipped: number;
  /** The stamp's shown width and hidden part; null when the chip has no stamp. */
  stampWidth: number | null;
  stampClipped: number | null;
  /** Pill text parts cut without an ellipsis (each must ellipsize or show whole). */
  unellipsized: string[];
  /** The horizontal document overflow the strip adds (the theme's own excluded). */
  documentOverflow: number;
}

/** Read the closed pill's layout facts. */
async function pillLayout(page: Page): Promise<PillLayout> {
  return await page.evaluate((host) => {
    const root = document.querySelector(host)?.shadowRoot;
    if (root === undefined || root === null) throw new Error('no strip');
    const part = (selector: string): HTMLElement | null =>
      root.querySelector<HTMLElement>(selector);
    const pill = part('.ins-pill');
    const identity = part('.ins-pill .ins-identity');
    const chip = part('.ins-pill .ins-cache');
    const chipText = part('.ins-pill .ins-cache-text');
    const stamp = part('.ins-pill .ins-cache-stamp');
    const glyph = part('[data-fdt-strip-pill-builder]');
    if (pill === null || identity === null || chip === null || chipText === null) {
      throw new Error('no pill identity/chip');
    }
    const clipped = (element: HTMLElement): number => element.scrollWidth - element.clientWidth;
    const unellipsized = (
      [
        ['identity', identity],
        ['chip text', chipText],
        ['stamp', stamp]
      ] as const
    )
      .filter(([, element]) => element !== null && clipped(element) > 0)
      .filter(
        ([, element]) => element !== null && getComputedStyle(element).textOverflow !== 'ellipsis'
      )
      .map(([name]) => name);
    const pillBox = pill.getBoundingClientRect();
    const identityBox = identity.getBoundingClientRect();
    const glyphBox = glyph?.getBoundingClientRect() ?? null;
    const middle = (box: DOMRect): number => box.top + box.height / 2;
    const overflow = (): number =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const withStrip = overflow();
    const hostElement = document.querySelector<HTMLElement>(host);
    hostElement?.style.setProperty('display', 'none', 'important');
    const withoutStrip = overflow();
    hostElement?.style.removeProperty('display');
    return {
      pillInside: pillBox.left >= -0.5 && pillBox.right <= window.innerWidth + 0.5,
      pillOverflow: clipped(pill),
      chipOverflow: clipped(chip),
      glyphInside:
        glyphBox === null
          ? null
          : glyphBox.left >= pillBox.left - 0.5 && glyphBox.right <= pillBox.right + 0.5,
      glyphWidth: glyphBox === null ? null : Math.round(glyphBox.width * 10) / 10,
      glyphAfterIdentity:
        glyphBox === null
          ? null
          : glyphBox.left >= identityBox.right - 0.5 &&
            Math.abs(middle(glyphBox) - middle(identityBox)) < 2,
      identityClipped: clipped(identity),
      chipText: chipText.textContent,
      chipTextClipped: clipped(chipText),
      stampWidth: stamp === null ? null : stamp.clientWidth,
      stampClipped: stamp === null ? null : clipped(stamp),
      unellipsized,
      documentOverflow: withStrip - withoutStrip
    };
  }, STRIP_HOST);
}

/**
 * The pill's narrowing contract at one width: it fits (no pill, chip or
 * document overflow), the state word is never cut, every cut part shows an
 * ellipsis, and the identity gives way only once the stamp is spent.
 */
function expectPillFits(layout: PillLayout, at: string): void {
  expect(layout.pillInside, at).toBe(true);
  expect(layout.pillOverflow, at).toBe(0);
  expect(layout.chipOverflow, at).toBe(0);
  expect(layout.chipTextClipped, at).toBe(0);
  expect(layout.unellipsized, at).toEqual([]);
  if (layout.identityClipped > 0) expect(layout.stampWidth ?? 0, `${at} stamp spent`).toBe(0);
  expect(layout.documentOverflow, at).toBe(0);
}

/** Run axe over the strip only (the host page's own markup is not ours). */
async function axeStrip(page: Page): Promise<unknown> {
  await page.evaluate(AXE_SOURCE);
  return await page.evaluate(async (host) => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: unknown
          ) => Promise<{ violations: { id: string }[]; incomplete: { id: string }[] }>;
        };
      }
    ).axe;
    const result = await axe.run({ include: [[host]] });
    return {
      violations: result.violations.map((rule) => rule.id),
      incomplete: result.incomplete.map((rule) => rule.id)
    };
  }, STRIP_HOST);
}

test.describe('strip builder line + modifiers', () => {
  test.afterEach(async ({ extension }) => {
    await setWidget(extension, null);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`the open card says what the builder changed (${colorScheme})`, async ({ extension }) => {
      await setWidget(extension, true);
      const marked = writeBuilderMarker(await servedFdtHtml(extension), NOTE);
      expect(marked).toContain(BUILDER_MARKER_META_NAME);
      const { page, url } = await openServed(extension, `marked-${colorScheme}`, () => marked);
      try {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await openCardByKeyboard(page);

        // Keyboard: the card took focus and announces the line as its description.
        const dialog = page.locator(`${STRIP_HOST} [role="dialog"]`);
        await expect(dialog).toBeFocused();
        await expect(dialog).toHaveAccessibleDescription(DESCRIPTION);
        // Tab reaches the scroll region that holds the line (after the close control).
        const scroller = page.locator(`${STRIP_HOST} .ins-card-body`);
        await page.keyboard.press('Tab');
        await expect(page.locator(`${STRIP_HOST} .ins-close`)).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(scroller).toBeFocused();
        await expect(scroller.locator('[data-fdt-strip-builder]')).toHaveCount(1);

        const line = page.locator(`${STRIP_HOST} [data-fdt-strip-builder]`);
        await expect(line).toBeVisible();
        await expect(line.locator('.ins-builder-title')).toHaveText(TITLE);
        const hints = line.locator('[data-fdt-strip-builder-hint]');
        await expect(hints).toHaveCount(HINTS.length);
        for (const [index, hint] of HINTS.entries()) {
          await expect(hints.nth(index)).toHaveText(hint);
        }
        await expect(line).not.toContainText('·');

        for (const { label, kind, chip, sentence } of ROWS) {
          const row = page.locator(`${STRIP_HOST} .ins-row`, {
            has: page.locator('.ins-chip', { hasText: new RegExp(`^${label}$`) })
          });
          const badge = row.locator('[data-fdt-strip-modifier]');
          await expect(badge, label).toHaveAttribute('data-fdt-strip-modifier', kind);
          await expect(badge, label).toHaveText(chip);
          await expect(badge, label).toHaveAttribute('aria-hidden', 'true');
          await expect(badge.locator('svg'), label).toHaveCount(1);
          const sentenceLine = row.locator('[data-fdt-strip-modifier-line]');
          await expect(sentenceLine, label).toBeVisible();
          await expect(sentenceLine, label).toHaveText(`, ${sentence}`);
          // The served chip stays (WP Rocket served all three on /fdt/).
          await expect(row.locator('.ins-chip'), label).toHaveClass(/ins-chip-ok/);
          // Turned off: the count of the rewritten page gives way to the modifier.
          await expect(row.locator('.ins-value'), label).toHaveCount(kind === 'off' ? 0 : 1);
        }

        // Assistive tech never hears the dot.
        // Polled: the accessibility tree updates after the DOM.
        await expect
          .poll(async () => {
            const spoken = await accessibleTexts(page);
            return {
              title: spoken.some((text) => text.includes(TITLE)),
              dots: spoken.filter((text) => text.includes('·') && text.includes(TITLE))
            };
          })
          .toEqual({ title: true, dots: [] });
        // Each sentence is spoken once: no row repeats it as its description.
        const described = await accessibleDescriptions(page);
        for (const { sentence } of ROWS) {
          expect(
            described.filter((text) => text.includes(sentence)),
            sentence
          ).toEqual([]);
        }
        // The line itself is the dialog's description, nothing else's.
        expect(described.filter((text) => text.includes(TITLE))).toEqual([DESCRIPTION]);

        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await settle(page);
          const layout = await builderLayout(page);
          console.log(`[layout] ${colorScheme} ${String(width)} px ${JSON.stringify(layout)}`);
          const at = `${colorScheme} ${String(width)} px`;
          expect(layout.cardInside, at).toBe(true);
          expect(layout.bodyOverflow, at).toBe(0);
          expect(layout.documentOverflow, at).toBe(0);
          expect(layout.sentencesInside, at).toBe(true);
          for (const [index, hint] of layout.hints.entries()) {
            expect(hint.inside, `${at} hint ${String(index)} inside`).toBe(true);
            expect(hint.dotContent, at).toBe('"·" / ""');
            // A line never starts with a dot: clipped exactly at line starts.
            expect(hint.dotHidden, `${at} hint ${String(index)} dot`).toBe(hint.startsLine);
          }
          expect(layout.hints[0]?.startsLine, at).toBe(true);
          if (width === 320)
            expect(layout.hintLines, 'the hints wrap at 320 px').toBeGreaterThan(1);
          // The overflow probe re-showed the host: let any restyle settle first.
          await settle(page);
          const measured = await builderContrast(page);
          console.log(`[contrast] ${at} ${JSON.stringify(measured)}`);
          // Title + three hints + three badges + three sentences.
          expect(measured, at).toHaveLength(1 + HINTS.length + ROWS.length * 2);
          for (const entry of measured) {
            expect(entry.ratio, `${at} ${entry.part} "${entry.text}"`).toBeGreaterThanOrEqual(
              AA_SMALL_TEXT
            );
          }
          const shots = process.env['FDT_SHOTS_DIR'];
          if (shots !== undefined && shots !== '') {
            mkdirSync(shots, { recursive: true });
            await page.locator(`${STRIP_HOST} .ins-card`).screenshot({
              path: join(shots, `strip-${colorScheme}-${String(width)}.png`)
            });
          }
        }

        // Reduced motion: nothing in the strip animates at rest.
        await settle(page);
        expect(await axeStrip(page)).toEqual({ violations: [], incomplete: [] });
      } finally {
        await page.close();
        await extension.browserContext.unroute(url);
      }
    });
  }

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`the closed pill hints the rewrite (${colorScheme})`, async ({ extension }) => {
      await setWidget(extension, true);
      const served = await servedFdtHtml(extension);
      const marked = writeBuilderMarker(served, NOTE);
      // The untouched page's pill name: the rewritten one adds the suffix, nothing else.
      const plain = await openServed(extension, `pill-plain-${colorScheme}`, () => served);
      let plainName: string;
      try {
        plainName = await answeredPillName(plain.page);
        expect(plainName).not.toContain('Exclusion Builder');
        await expect(plain.page.locator(PILL_GLYPH)).toHaveCount(0);
      } finally {
        await plain.page.close();
        await extension.browserContext.unroute(plain.url);
      }

      const { page, url } = await openServed(extension, `pill-${colorScheme}`, () => marked);
      try {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await answeredPillName(page);
        // Spoken once, right after the version; never the pill's description too.
        await expect.poll(() => pillNames(page)).toEqual([withPillHint(plainName)]);
        await expect
          .poll(() => announcedNamesWith(page, 'Exclusion Builder'))
          .toEqual([withPillHint(plainName)]);
        await expect
          .poll(async () =>
            (await accessibleDescriptions(page)).filter((text) =>
              text.includes('Exclusion Builder')
            )
          )
          .toEqual([]);
        const glyph = page.locator(PILL_GLYPH);
        await expect(glyph).toBeVisible();
        await expect(glyph).toHaveAttribute('aria-hidden', 'true');
        // Delay JS and Defer JS are off on this page: the turned-off glyph.
        await expect(glyph).toHaveAttribute('data-fdt-strip-pill-builder', 'off');
        await expect(glyph.locator('svg')).toHaveCount(1);
        // The words are for assistive tech only: their run is visually hidden (1 px, clipped).
        const words = page.locator(`${STRIP_HOST} [data-fdt-strip-pill-builder-spoken]`);
        expect(await words.evaluate((element) => getComputedStyle(element).clipPath)).toBe(
          'inset(50%)'
        );
        // The layout box, not the painted one: the pill's entrance scales it.
        expect(
          await words.evaluate((element: HTMLElement) => [
            element.offsetWidth,
            element.offsetHeight
          ])
        ).toEqual([1, 1]);

        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await settle(page);
          const layout = await pillLayout(page);
          console.log(`[pill] ${colorScheme} ${String(width)} px ${JSON.stringify(layout)}`);
          const at = `${colorScheme} ${String(width)} px`;
          expectPillFits(layout, at);
          expect(layout.glyphInside, at).toBe(true);
          expect(layout.glyphWidth, at).toBe(13);
          // The real page: the chip's stamp gives way first, the version is never cut.
          expect(layout.identityClipped, at).toBe(0);
          expect(layout.chipText, at).toBe('✓ Cached');
          // A wide host shows the stamp whole (no chip cap at rest).
          if (width === 1280) expect(layout.stampClipped, at).toBe(0);
          expect(layout.glyphAfterIdentity, at).toBe(true);
          // The overflow probe re-showed the host: let any restyle settle first.
          await settle(page);
          const measured = await builderContrast(page, '.ins-pill-builder');
          console.log(`[pill contrast] ${at} ${JSON.stringify(measured)}`);
          expect(measured, at).toHaveLength(1);
          for (const entry of measured) {
            expect(entry.ratio, `${at} pill glyph`).toBeGreaterThanOrEqual(AA_NON_TEXT);
          }
          const shots = process.env['FDT_SHOTS_DIR'];
          if (shots !== undefined && shots !== '') {
            mkdirSync(shots, { recursive: true });
            await page.locator(`${STRIP_HOST} .ins-pill`).screenshot({
              path: join(shots, `pill-${colorScheme}-${String(width)}.png`)
            });
          }
        }
        // Hovered, the pill's fill steps up a layer: the glyph keeps its contrast.
        await page.locator(`${STRIP_HOST} .ins-pill`).hover();
        await settle(page);
        const hovered = await builderContrast(page, '.ins-pill-builder');
        console.log(`[pill contrast] ${colorScheme} hovered ${JSON.stringify(hovered)}`);
        for (const entry of hovered) {
          expect(entry.ratio, `${colorScheme} hovered pill glyph`).toBeGreaterThanOrEqual(
            AA_NON_TEXT
          );
        }
        await page.mouse.move(0, 0);
        await settle(page);
        // Closed, the pill carries `aria-haspopup` with `aria-controls` → the
        // card's id; the reference must resolve to the dialog (proven here),
        // so the strict audit resolves both axes empty.
        expect(
          await page.evaluate((host) => {
            const root = document.querySelector(host)?.shadowRoot;
            const id = root?.querySelector('.ins-pill')?.getAttribute('aria-controls') ?? '';
            return root?.getElementById(id)?.getAttribute('role') ?? null;
          }, STRIP_HOST)
        ).toBe('dialog');
        expect(await axeStrip(page)).toEqual({
          violations: [],
          incomplete: []
        });
      } finally {
        await page.close();
        await extension.browserContext.unroute(url);
      }
    });
  }

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`the closed pill narrows without cutting words, worst cases (${colorScheme})`, async ({
      extension
    }) => {
      test.setTimeout(240_000);
      await setWidget(extension, true);
      const served = await servedFdtHtml(extension);
      for (const pillCase of PILL_WORST_CASES) {
        for (const rewritten of [false, true]) {
          const variant = `${pillCase.label}-${rewritten ? 'rewritten' : 'plain'}`;
          const html = pillCase.make(served);
          const body = rewritten ? writeBuilderMarker(html, NOTE) : html;
          const { page, url } = await openServed(
            extension,
            `worst-${variant}-${colorScheme}`,
            () => body,
            pillCase.serve
          );
          try {
            await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
            const pill = page.locator(`${STRIP_HOST} .ins-pill`);
            await expect(pill, variant).toContainText(UNKNOWN_IDENTITY, { timeout: 15_000 });
            await expect(pill.locator('.ins-cache-text'), variant).toHaveText(pillCase.chip);
            await expect(page.locator(PILL_GLYPH), variant).toHaveCount(rewritten ? 1 : 0);
            for (const width of WIDTHS) {
              await page.setViewportSize({ width, height: 900 });
              await settle(page);
              const layout = await pillLayout(page);
              const at = `${variant} ${colorScheme} ${String(width)} px`;
              console.log(`[pill worst] ${at} ${JSON.stringify(layout)}`);
              expectPillFits(layout, at);
              if (rewritten) {
                expect(layout.glyphInside, at).toBe(true);
                expect(layout.glyphWidth, at).toBe(13);
              }
              // Past the narrowest width nothing gives way.
              if (width >= 480) {
                expect(layout.identityClipped, at).toBe(0);
                expect(layout.stampClipped ?? 0, at).toBe(0);
              }
              const shots = process.env['FDT_SHOTS_DIR'];
              if (shots !== undefined && shots !== '') {
                mkdirSync(shots, { recursive: true });
                await pill.screenshot({
                  path: join(shots, `pill-worst-${variant}-${colorScheme}-${String(width)}.png`)
                });
              }
            }
          } finally {
            await page.close();
            await extension.browserContext.unroute(url);
          }
        }
      }
    });
  }

  test('without a fact the card has no line and no modifier', async ({ extension }) => {
    await setWidget(extension, true);
    const served = await servedFdtHtml(extension);
    expect(served).not.toContain(BUILDER_MARKER_META_NAME);
    const { page, url } = await openServed(extension, 'plain', () => served);
    try {
      // The closed pill: no glyph, no builder words in its name.
      expect(await answeredPillName(page)).not.toContain('Exclusion Builder');
      await expect(page.locator(PILL_GLYPH)).toHaveCount(0);
      await openCardByKeyboard(page);
      await expect(page.locator(`${STRIP_HOST} .ins-row`).first()).toBeVisible();
      await expect(page.locator(`${STRIP_HOST} [data-fdt-strip-builder]`)).toHaveCount(0);
      await expect(page.locator(`${STRIP_HOST} [data-fdt-strip-modifier]`)).toHaveCount(0);
      await expect(page.locator(`${STRIP_HOST} .ins-card`)).not.toContainText('Exclusion Builder');
      await expect(page.locator(`${STRIP_HOST} [role="dialog"]`)).not.toHaveAttribute(
        'aria-describedby'
      );
    } finally {
      await page.close();
      await extension.browserContext.unroute(url);
    }
  });

  test('the line follows the displayed document: kept on re-read, gone after a clean reload', async ({
    extension
  }) => {
    await setWidget(extension, true);
    const served = await servedFdtHtml(extension);
    const version = /content="WP Rocket ([\d.]+)"/.exec(served)?.[1];
    if (version === undefined) throw new Error('the served /fdt/ page lost its generator version');
    // The detected version keeps four parts: bump the last one.
    const parts = version.split('.');
    const bumped = [...parts.slice(0, -1), String(Number(parts.at(-1)) + 1)].join('.');
    let body = writeBuilderMarker(served, NOTE);
    const { page, url } = await openServed(extension, 'fresh', () => body);
    const line = page.locator(`${STRIP_HOST} [data-fdt-strip-builder]`);
    const title = page.locator(`${STRIP_HOST} .ins-title`);
    try {
      await expect(page.locator(PILL_GLYPH)).toBeVisible({ timeout: 15_000 });
      expect(hasPillHint(await answeredPillName(page))).toBe(true);
      await openCardByKeyboard(page);
      await expect(line).toBeVisible();

      // A re-read of the rewritten document (Stop leaves it displayed): a
      // distinguishable version stamp proves the fresh payload is shown.
      body = writeBuilderMarker(
        served.replaceAll(`WP Rocket ${version}`, `WP Rocket ${bumped}`),
        NOTE
      );
      await page.reload();
      await expect(page.locator(`${STRIP_HOST} .ins-pill`)).toContainText(`WPR ${bumped}`, {
        timeout: 15_000
      });
      await expect(page.locator(PILL_GLYPH)).toBeVisible();
      expect(hasPillHint(await answeredPillName(page))).toBe(true);
      await openCardByKeyboard(page);
      await expect(title).toHaveText(`WPR ${bumped}`, { timeout: 15_000 });
      await expect(line).toBeVisible();
      await expect(line.locator('[data-fdt-strip-builder-hint]')).toHaveCount(HINTS.length);

      // A reload that serves WP Rocket's own page again: no marker, no line.
      body = served;
      await page.reload();
      await expect(page.locator(`${STRIP_HOST} .ins-pill`)).toContainText(`WPR ${version}`, {
        timeout: 15_000
      });
      await expect(page.locator(PILL_GLYPH)).toHaveCount(0);
      expect(await answeredPillName(page)).not.toContain('Exclusion Builder');
      await openCardByKeyboard(page);
      await expect(title).toHaveText(`WPR ${version}`, { timeout: 15_000 });
      await expect(line).toHaveCount(0);
      await expect(page.locator(`${STRIP_HOST} [data-fdt-strip-modifier]`)).toHaveCount(0);
    } finally {
      await page.close();
      await extension.browserContext.unroute(url);
    }
  });
});
