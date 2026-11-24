/**
 * The top bar suite: the four answers' browser rendering from the
 * devtools-contract fixture data (the 0-interaction layer) — presence and
 * version, cached-or-not with the stamp's bucketed age, the platform header
 * answer, the data-freshness answer — plus the navigation contract (each
 * data answer is a real link to the Detections overview; freshness stays
 * non-navigable text), the fold (compact below the full-width threshold;
 * at every width each foldable part whole or gone, "⋯" holding what folded,
 * no horizontal scroll down to 320 px, every control and ring in view),
 * Refresh re-stamping the freshness through the real data machine, and the
 * Exclusions entry opening the builder overlay on the inspected page (its two
 * background asks carried by the harness: a standalone panel page is a tab
 * sender, which the background refuses for builder rows by design).
 *
 * Expected values derive from the fixture's SERVED detection payload (read
 * through the same contract the panel used) and the panel's own shipped
 * formatters — the suite never re-types the rules (buckets, stamp format).
 *
 * The standalone harness seam stamps `devtools.inspectedWindow.tabId` (see
 * `helpers/panel-data.ts`); all data below flows through the real channels.
 */
import type { Locator, Page } from '@playwright/test';
import { clearDrafts } from '../helpers/exclusion-overlay';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';
import { relativeAge } from '../../../utils/relative-age';
import { formatCacheTimestamp } from '../../../lib/detection/describe';

/* The width rule's threshold and the menu trigger's name repeat the shipped
 * rules (test literals pin behavior; importing the panel modules would drag
 * their logger graph into the spec's node context). The name lists what the
 * menu holds. */
const FULL_MIN_WIDTH = 760;
const MENU_NAME = /^More: /;

/**
 * The appearance control in the bar's end slot: the geometry walks run with
 * the real button laid out (the fold measures it like any end control).
 */
const APPEARANCE_BUTTON = '[data-fdt="appearance-menu"] button';

/**
 * The panel init script carrying the builder entry's two background asks
 * (the background answers builder rows only for tab-less senders — a real
 * DevTools panel — and this standalone panel page is a tab sender): the
 * session ask answers `session` (a summary literal), the open runs the
 * suite's exposed `__e2eOpenOverlay` (only the suite that opens defines it).
 *
 * @param session The session summary the status ask answers, as JS source.
 */
function builderHarness(session: string): string {
  return `(() => {
    for (const namespace of [window.chrome, window.browser]) {
      const runtime = namespace && namespace.runtime;
      if (!runtime || typeof runtime.sendMessage !== 'function') continue;
      const send = runtime.sendMessage.bind(runtime);
      runtime.sendMessage = (envelope, ...rest) => {
        const reply = rest.find((arg) => typeof arg === 'function');
        const type = envelope && envelope.type;
        if (type === 'getExclusionSessionForTab') {
          const answer = { res: ${session} };
          if (reply) { reply(answer); return undefined; }
          return Promise.resolve(answer);
        }
        if (type === 'openExclusionOverlay') {
          const done = window.__e2eOpenOverlay(envelope.data.tabId).then(() => ({ res: 'injected' }));
          if (reply) { void done.then(reply); return undefined; }
          return done;
        }
        return send(envelope, ...rest);
      };
    }
  })()`;
}

/**
 * The panel init script answering the keyboard-convention ask with the
 * non-Apple one, so the palette trigger's key chip reads "Ctrl+K" (the
 * widest hint) on any host.
 */
const CTRL_KEY_HARNESS = `(() => {
  for (const namespace of [window.chrome, window.browser]) {
    const runtime = namespace && namespace.runtime;
    if (!runtime || typeof runtime.sendMessage !== 'function') continue;
    const send = runtime.sendMessage.bind(runtime);
    runtime.sendMessage = (envelope, ...rest) => {
      if (!envelope || envelope.type !== 'getChordPlatform') return send(envelope, ...rest);
      const reply = rest.find((arg) => typeof arg === 'function');
      const answer = { res: 'other' };
      if (reply) { reply(answer); return undefined; }
      return Promise.resolve(answer);
    };
  }
})()`;

/** The quiet session ("Off": no badge in the bar). */
const SESSION_OFF = "{ state: 'inactive' }";

/** A session rewriting the page ("On": news, kept at a glance). */
const SESSION_ON = "{ state: 'active', origin: 'http://localhost:8891' }";

/** A session whose interception is unavailable (news: "Unavailable"). */
const SESSION_UNAVAILABLE = "{ state: 'unavailable' }";

/**
 * The panel init script that lets a spec age the shown data on demand:
 * `Date.now` reads through `window.__e2eClockOffset` (ms, 0 at boot), and
 * the panel's long aging cadence (>= 30 s) ticks every 300 ms, so a shifted
 * clock reaches the answers within a frame or two.
 */
const CLOCK_HARNESS = `(() => {
  window.__e2eClockOffset = 0;
  const realNow = Date.now.bind(Date);
  Date.now = () => realNow() + window.__e2eClockOffset;
  const every = window.setInterval.bind(window);
  window.setInterval = (handler, ms, ...rest) => every(handler, ms >= 30000 ? 300 : ms, ...rest);
})()`;

/**
 * Age the panel's data past the stale window and wait for the bar to show
 * the new age.
 *
 * @param page The panel page (booted with {@link CLOCK_HARNESS}).
 */
async function makeStale(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __e2eClockOffset: number }).__e2eClockOffset = 11 * 60_000;
  });
  await expect
    .poll(async () => await barText(page), { timeout: 10_000, intervals: [100, 250] })
    .toMatch(/11 min ago/);
}

/** The shared focus ring's reach past a control's box (2 px outline + 1 px offset). */
const RING_PX = 3;

/** One width's geometry read of the bar. */
interface BarGeometry {
  /** No horizontal page scroll. */
  readonly page: boolean;
  /** Each slot's scroll vs client width. */
  readonly slots: ReadonlyArray<{ slot: string; scroll: number; client: number }>;
  /** Visible controls outside their slot, or whose ring the clip would cut. */
  readonly misplaced: readonly string[];
  /** Visible texts elided with an ellipsis (graceful). */
  readonly elided: readonly string[];
  /** Visible content cut or spilling without an ellipsis (never allowed). */
  readonly cut: readonly string[];
  /** The address: absent, folded (out of sight), shown inside the slot, or cut. */
  readonly address: 'none' | 'folded' | 'visible' | 'cut';
}

/**
 * Read the bar's geometry in the page: slot overflow, each control's box
 * against its slot and its ring against its clip (the start slot clips;
 * end controls are clipped by the bar's frame), and every visible box whose
 * content is wider than it — elided (ellipsis) or cut.
 */
function readBarGeometry(page: Page): Promise<BarGeometry | null> {
  return page.evaluate((ring: number): BarGeometry | null => {
    const bar = document.querySelector<HTMLElement>('[data-fdt="panel-top-bar"]');
    if (bar === null) return null;
    const barBox = bar.getBoundingClientRect();
    const inside = (inner: DOMRect, outer: DOMRect, pad: number): boolean =>
      inner.left - pad >= outer.left - 0.5 &&
      inner.right + pad <= outer.right + 0.5 &&
      inner.top - pad >= outer.top - 0.5 &&
      inner.bottom + pad <= outer.bottom + 0.5;
    const label = (node: Element): string =>
      `${node.tagName.toLowerCase()} "${node.textContent.trim().slice(0, 40)}"`;
    // sr-only text and folded parts (laid out unseen, for measuring) are not on screen.
    const hidden = (node: Element): boolean =>
      node.closest('.sr-only') !== null || !node.checkVisibility({ visibilityProperty: true });
    const address = document.querySelector<HTMLElement>('[data-fdt="top-bar-address"]');

    const slots = [...bar.querySelectorAll<HTMLElement>('[data-fdt-app-bar-slot]')].map((slot) => ({
      slot: slot.dataset.fdtAppBarSlot ?? '',
      scroll: slot.scrollWidth,
      client: slot.clientWidth
    }));
    const misplaced: string[] = [];
    for (const control of bar.querySelectorAll<HTMLElement>('a, button')) {
      const box = control.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || hidden(control)) continue;
      const slot = control.closest<HTMLElement>('[data-fdt-app-bar-slot]');
      if (slot === null) {
        misplaced.push(`${label(control)} outside any slot`);
        continue;
      }
      const slotBox = slot.getBoundingClientRect();
      const clip = slot.dataset.fdtAppBarSlot === 'start' ? slotBox : barBox;
      if (!inside(box, slotBox, 0)) misplaced.push(`${label(control)} outside its slot`);
      else if (!inside(box, clip, ring)) misplaced.push(`${label(control)} ring clipped`);
    }
    const elided: string[] = [];
    const cut: string[] = [];
    for (const node of bar.querySelectorAll<HTMLElement>('*')) {
      if (hidden(node)) continue;
      if (node.dataset.fdtAppBarSlot !== undefined || node.clientWidth === 0) continue;
      if (node.scrollWidth <= node.clientWidth + 0.5) continue;
      const style = getComputedStyle(node);
      if (style.overflowX !== 'visible' && style.textOverflow === 'ellipsis')
        elided.push(label(node));
      else cut.push(label(node));
    }
    let addressState: BarGeometry['address'] = 'none';
    if (address !== null) {
      const slot = address.closest<HTMLElement>('[data-fdt-app-bar-slot]');
      if (hidden(address)) addressState = 'folded';
      else if (
        slot !== null &&
        inside(address.getBoundingClientRect(), slot.getBoundingClientRect(), 0)
      )
        addressState = 'visible';
      else addressState = 'cut';
    }
    return {
      page: document.documentElement.scrollWidth === document.documentElement.clientWidth,
      slots,
      misplaced,
      elided,
      cut,
      address: addressState
    };
  }, RING_PX);
}

/**
 * Assert one width's geometry: no scroll anywhere, both slots fit, every
 * control and its ring in place, nothing cut, the address shown or folded —
 * and, when `whole`, nothing elided either.
 *
 * @param geometry The read.
 * @param width The panel width (named in the messages).
 * @param whole Whether every visible text must be whole (no ellipsis).
 */
function expectBarFits(geometry: BarGeometry | null, width: number, whole: boolean): void {
  const at = `at ${String(width)}px`;
  expect(geometry, at).not.toBeNull();
  if (geometry === null) return;
  expect(geometry.page, `page scroll ${at}`).toBe(true);
  for (const slot of geometry.slots)
    expect(slot.scroll, `${slot.slot} slot overflow ${at}`).toBeLessThanOrEqual(slot.client);
  expect(geometry.misplaced, `controls ${at}`).toEqual([]);
  expect(geometry.cut, `cut content ${at}`).toEqual([]);
  expect(geometry.address, `address ${at}`).not.toBe('cut');
  if (whole) expect(geometry.elided, `elided text ${at}`).toEqual([]);
}

/** The fold as laid out: the folded parts and whether "⋯" shows. */
interface FoldRead {
  readonly folded: readonly string[];
  readonly menu: boolean;
}

/** Read the fold from the bar's hooks (the shipped attribute contract). */
function readFold(page: Page): Promise<FoldRead> {
  return page.evaluate((): FoldRead => {
    const folded = [
      ...document.querySelectorAll<HTMLElement>('[data-fdt-fold-part][data-fdt-fold="folded"]')
    ].map((part) => part.dataset.fdtFoldPart ?? '');
    const box = document.querySelector<HTMLElement>('[data-fdt="top-bar-menu-box"]');
    return { folded, menu: box?.dataset.fdtFold === 'inline' };
  });
}

/**
 * Assert "⋯" shows whenever a part folded (a compact bar always shows it),
 * and open it to check it holds each folded part's row.
 *
 * @param page The panel page.
 * @param width The panel width (named in the messages).
 */
async function expectMenuHoldsFolded(page: Page, width: number): Promise<void> {
  const fold = await readFold(page);
  const at = `at ${String(width)}px`;
  if (fold.folded.length > 0 || width < FULL_MIN_WIDTH) expect(fold.menu, `"⋯" ${at}`).toBe(true);
  if (!fold.menu) return;
  const trigger = page.getByRole('button', { name: MENU_NAME });
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const rows: Record<string, Locator> = {
    // A captured value is a link item; "unknown" / no capture is quiet text.
    server: menu.locator('[data-fdt="top-bar-menu-server"]').or(menu.getByText(/^Server: /)),
    freshness: menu.locator('[data-fdt="top-bar-menu-freshness"]'),
    cacheAge: menu.locator('[data-fdt="top-bar-menu-cache-age"]')
  };
  for (const part of fold.folded) {
    const row = rows[part];
    if (row !== undefined) await expect(row, `${part} row ${at}`).toHaveCount(1);
  }
  if (fold.folded.includes('address'))
    await expect(menu, `address row ${at}`).toContainText('localhost:8891/');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
}

/** The wide palette trigger as laid out: its key chip, and whether its words are elided. */
interface TriggerRead {
  readonly hint: string;
  readonly words: string;
  readonly elided: boolean;
}

/** Read the wide palette trigger (null when the wide form is not rendered). */
function readTrigger(page: Page): Promise<TriggerRead | null> {
  return page.evaluate((): TriggerRead | null => {
    const trigger = document.querySelector<HTMLElement>('button[aria-label^="Jump to"]');
    const words = trigger?.querySelector<HTMLElement>('span');
    const chip = trigger?.querySelector<HTMLElement>('kbd');
    if (trigger == null || words == null || chip == null) return null;
    return {
      hint: chip.dataset.keyHint ?? '',
      words: words.textContent,
      elided: words.scrollWidth > words.clientWidth || trigger.scrollWidth > trigger.clientWidth
    };
  });
}

/** Wait two animation frames (a resize's layout and paint have landed). */
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      })
  );
}

/** The bar's rendered text (answers + controls). */
function barText(page: Page): Promise<string | null> {
  return page.evaluate(
    (): string | null => document.querySelector('[data-fdt="panel-top-bar"]')?.textContent ?? null
  );
}

/** Wait for the ready answers (the fixture's version reached the bar). */
async function waitForAnswers(page: Page): Promise<void> {
  await expect
    .poll(async () => await barText(page), { timeout: 15_000, intervals: [50, 100, 250] })
    .toContain('WP Rocket 3.20.1');
}

/** The freshness answer as rendered: its visible text, its hover stamp, and whether it is a control. */
interface FreshnessRead {
  readonly text: string;
  readonly title: string;
  readonly inControl: boolean;
}

/** Read the freshness answer from the bar (null when absent). */
function readFreshness(page: Page): Promise<FreshnessRead | null> {
  return page.evaluate((): FreshnessRead | null => {
    const slot = document.querySelector<HTMLElement>('[data-fdt="top-bar-freshness"]');
    const root = slot?.querySelector<HTMLElement>('span[title]');
    if (slot === null || root === undefined || root === null) return null;
    const detail = [...root.querySelectorAll<HTMLElement>('span')].find((node) =>
      node.textContent.startsWith('Updated')
    );
    return {
      text: detail?.textContent.trim() ?? '',
      title: root.getAttribute('title') ?? '',
      inControl: root.closest('a, button') !== null
    };
  });
}

/** The capture stamp of a freshness title, as epoch ms (NaN when it is not one). */
function stampMs(title: string): number {
  const capture = /^Page data fetched at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC\.$/.exec(title);
  return capture?.[1] === undefined ? Number.NaN : Date.parse(`${capture[1].replace(' ', 'T')}Z`);
}

test.describe('panel top bar', () => {
  test('renders the four answers from the fixture data, exactly', async ({ extension }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    const served = await extension.sendToTab<{
      wprDetections: {
        wpr: {
          present: boolean;
          cached: boolean;
          version: string | null;
          timeStamp: number | null;
        };
      };
    } | null>(fixture.tabId, 'getFdtData');
    try {
      await waitForAnswers(panel);
      const bar = panel.locator('[data-fdt="panel-top-bar"]');

      // Presence + version: the marked fixture's generator meta, verbatim.
      await expect(bar.getByRole('link', { name: 'WP Rocket 3.20.1' })).toBeVisible();
      expect(served?.wprDetections.wpr.present).toBe(true);
      expect(served?.wprDetections.wpr.version).toBe('3.20.1');

      // Cached: the pill plus the stamp's bucketed age (the shipped formatter
      // over the served stamp), the absolute stamp in the tooltip.
      const stamp = served?.wprDetections.wpr.timeStamp;
      if (stamp === null || stamp === undefined) throw new Error('the served cache stamp vanished');
      const stampText = formatCacheTimestamp(stamp);
      if (stampText === null) throw new Error(`unrepresentable stamp: ${String(stamp)}`);
      const cacheLink = bar.getByRole('link', { name: /^✓ Cached/ });
      await expect(cacheLink).toBeVisible();
      await expect(cacheLink).toHaveText(
        new RegExp(`^✓ Cached${relativeAge(Date.now() - stamp * 1000)}$`)
      );
      await cacheLink.focus();
      await expect(panel.getByRole('tooltip')).toContainText(`generated ${stampText}`);
      await panel.keyboard.press('Escape');
      await expect(panel.getByRole('tooltip')).toHaveCount(0);

      // Platform: the fixture server sends neither platform header — the
      // honest "unknown", quiet text (distinct from a missing capture).
      const platform = await panel.evaluate((): { isControl: boolean } | null => {
        const answers = document.querySelector<HTMLElement>('[data-fdt="top-bar-answers"]');
        const answer = [...(answers?.querySelectorAll<HTMLElement>('span') ?? [])].find(
          (node) => node.textContent.trim() === 'unknown'
        );
        return answer === undefined ? null : { isControl: answer.closest('a, button') !== null };
      });
      expect(platform?.isControl, 'the unknown answer is quiet text').toBe(false);

      // Freshness: "Updated just now", seconds-fresh capture stamp, never a control.
      const freshness = await readFreshness(panel);
      expect(freshness?.text).toBe('Updated just now');
      expect(freshness?.inControl, 'freshness is shell-owned text, never a control').toBe(false);
      const captured = stampMs(freshness?.title ?? '');
      expect(Date.now() - captured, `seconds fresh (${freshness?.title ?? ''})`).toBeLessThan(
        60_000
      );
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('the data answers link the Detections overview; freshness stays text', async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
      bootHash: '#/javascript'
    });
    try {
      await waitForAnswers(panel);
      const hrefs = await panel.evaluate((): string[] =>
        [...document.querySelectorAll<HTMLElement>('[data-fdt="panel-top-bar"] a')].map(
          (anchor) => anchor.getAttribute('href') ?? ''
        )
      );
      expect(hrefs.length).toBeGreaterThanOrEqual(2); // presence + cache (platform answers quietly)
      for (const href of hrefs) expect(href).toBe('#/detections');

      // An answer click navigates: the nav's active row follows.
      await panel.getByRole('link', { name: /^✓ Cached/ }).click();
      await panel.waitForURL(/#\/detections$/);
      await expect(panel.locator('[data-fdt="panel-nav"] [aria-current="page"]')).toHaveAttribute(
        'href',
        '#/detections'
      );

      // No anchor or button carries the freshness text.
      const controls = await panel.evaluate((): string[] =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '[data-fdt="panel-top-bar"] a, [data-fdt="panel-top-bar"] button'
          )
        ].map((control) => control.textContent.trim())
      );
      for (const text of controls)
        expect(text, `'${text}' is not freshness`).not.toMatch(/Updated/);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('folds below the full-width threshold: "⋯" holds the rest, no horizontal scroll', async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
      panelInit: builderHarness(SESSION_OFF),
      // The address read answers the fixture page's URL (the bar shows it).
      inspect: { origin: 'http://localhost:8891/pipeline/markers.html', resources: [] }
    });
    try {
      await waitForAnswers(panel);
      const menuTrigger = panel.getByRole('button', { name: MENU_NAME });
      // A wide bar: everything inline, no menu.
      await panel.setViewportSize({ width: 1100, height: 700 });
      await expect(menuTrigger).toHaveCount(0);
      await expect(panel.locator('[data-fdt="top-bar-freshness"]')).toBeVisible();
      await expect(panel.locator('[data-fdt="top-bar-address"]')).toBeVisible();
      // From the threshold on: the full form (name, labeled controls).
      await panel.setViewportSize({ width: FULL_MIN_WIDTH, height: 700 });
      await expect(panel.getByText('Jump to…')).toBeVisible();
      await expect(panel.locator('[data-fdt="panel-top-bar"]').getByText('WPR FDT')).toBeVisible();

      for (const width of [FULL_MIN_WIDTH - 1, 420, 320]) {
        await panel.setViewportSize({ width, height: 700 });
        await expect(menuTrigger).toBeVisible();
        await expect(panel.locator('[data-fdt="top-bar-freshness"]')).toHaveCount(0);
        // The two answers stay in the bar.
        await expect(panel.getByRole('link', { name: 'WP Rocket 3.20.1' })).toBeVisible();
        await expect(panel.getByRole('link', { name: /^✓ Cached/ })).toBeVisible();
        // A quiet ("Off") builder entry waits in the menu.
        await expect(panel.locator('[data-fdt="builder-entry"]')).toHaveCount(0);
      }

      // Geometry at every checkpoint, the real appearance button laid out:
      // no scroll, both slots fit, every control and its focus ring inside
      // its clip, nothing cut or elided; "⋯" holds whatever folded.
      for (const width of [320, 420, FULL_MIN_WIDTH - 1, FULL_MIN_WIDTH, 1100]) {
        await panel.setViewportSize({ width, height: 700 });
        // The width rule lands on the shell's next measurement (compact
        // shows "⋯"; a wide bar fits everything); then the fold's frames.
        if (width < FULL_MIN_WIDTH) await expect(menuTrigger).toHaveCount(1);
        if (width === 1100) await expect(menuTrigger).toHaveCount(0);
        await expect(panel.locator(APPEARANCE_BUTTON)).toBeVisible();
        await settleFrames(panel);
        await settleFrames(panel);
        expectBarFits(await readBarGeometry(panel), width, true);
        await expectMenuHoldsFolded(panel, width);
      }
      await panel.setViewportSize({ width: 420, height: 700 });

      // The menu carries the folded parts: name, freshness, platform, Exclusions.
      await menuTrigger.click();
      const menu = panel.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByText('WPR FDT')).toBeVisible();
      await expect(menu.getByText(/^Updated just now$/)).toBeVisible();
      await expect(menu.getByText('Server: unknown')).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: /Exclusions/ })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: /Updated/ })).toHaveCount(0);
      await panel.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(menuTrigger).toBeFocused();
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('pills that arrive after a 320 px boot fold the brand before they elide', async ({
    extension
  }) => {
    // Booted at 320 px: the first fold is decided over the placeholders,
    // then the data swaps them for the two longest pills inside a row that
    // already fills its slot — a change no box size reports by itself.
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/versionless.html', {
      viewport: { width: 320, height: 700 }
    });
    try {
      const bar = panel.locator('[data-fdt="panel-top-bar"]');
      await expect(bar).toContainText('Cache not detected', { timeout: 15_000 });
      await settleFrames(panel);
      await settleFrames(panel);
      const labels = await panel.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-fdt-fold-elide]')].map((label) => ({
          text: label.textContent,
          elided: label.scrollWidth > label.clientWidth
        }))
      );
      expect(labels.map((label) => label.text)).toEqual(['WP Rocket', 'Cache not detected']);
      // The pills cannot both fit at 320 px: the brand is gone first.
      expect(labels.some((label) => label.elided)).toBe(true);
      expect((await readFold(panel)).folded).toContain('brand');
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('Refresh re-reads the page: the freshness re-stamps through the data machine', async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await waitForAnswers(panel);
      const before = stampMs((await readFreshness(panel))?.title ?? '');
      expect(Number.isFinite(before), 'the freshness carries its stamp').toBe(true);
      // The stamp renders second-rounded; waiting past its +0.5 s edge makes
      // any later settle render a later second (no clock race).
      const boundaryMs = before + 500;
      await expect
        .poll(async () => await panel.evaluate((): number => Date.now()), {
          timeout: 5_000,
          intervals: [25, 50, 100]
        })
        .toBeGreaterThanOrEqual(boundaryMs);

      await panel.getByRole('button', { name: 'Refresh page data' }).click();
      await expect
        .poll(async () => stampMs((await readFreshness(panel))?.title ?? ''), {
          timeout: 15_000,
          intervals: [50, 100, 250]
        })
        .toBeGreaterThanOrEqual(boundaryMs + 500);
      expect(await barText(panel)).toContain('WP Rocket 3.20.1');
      await expect(panel.getByRole('button', { name: 'Refresh page data' })).not.toHaveAttribute(
        'aria-busy',
        'true'
      );
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('Exclusions opens the builder overlay on the inspected page', async ({ extension }) => {
    // The background answers the builder rows only for tab-less extension
    // senders (a real DevTools panel); this standalone panel page is a tab
    // sender, so the harness carries its two builder asks instead: the
    // session ask answers "inactive", and the open runs the background's own
    // injection (`scripting.executeScript` of the overlay into the named
    // tab's top frame) for the tab the panel named. Everything panel-side is
    // real: the entry's state, the click, the tab it names, the toast. The
    // background's sender gate is its own unit tests' row.
    await clearDrafts(extension);
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
      panelInit: builderHarness(SESSION_OFF)
    });
    const opened: number[] = [];
    await panel.exposeFunction('__e2eOpenOverlay', async (tabId: number) => {
      opened.push(tabId);
      await extension.evaluateInWorker(async (target: number) => {
        await chrome.scripting.executeScript({
          target: { tabId: target, frameIds: [0] },
          files: ['/content-scripts/exclusion-overlay.js']
        });
      }, tabId);
    });
    try {
      await waitForAnswers(panel);
      const entry = panel.locator('[data-fdt="builder-entry"]');
      // The quiet "Off" answer reached the entry (its words ride the title).
      await expect(entry).toHaveAttribute('title', 'No exclusions applied in this tab.');
      await entry.click();
      await expect(
        fixture.page.getByRole('heading', { name: 'Exclusion Builder', exact: true })
      ).toBeVisible({ timeout: 15_000 });
      expect(opened, 'the panel named its inspected tab, once').toEqual([fixture.tabId]);
      await expect(panel.getByText('Exclusion Builder opened on the page')).toBeVisible();
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('a news session stays at a glance and every part stays whole or gone', async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
      panelInit: builderHarness(SESSION_ON),
      inspect: { origin: 'http://localhost:8891/pipeline/markers.html', resources: [] }
    });
    try {
      await waitForAnswers(panel);
      const entry = panel.locator('[data-fdt="builder-entry"]');
      for (const width of [320, 420, FULL_MIN_WIDTH, 1100]) {
        await panel.setViewportSize({ width, height: 700 });
        // Folded: the icon entry with its status dot; full: the "On" badge.
        await expect(entry).toBeVisible();
        if (width < FULL_MIN_WIDTH)
          await expect(entry.locator('[data-fdt="builder-entry-dot"]')).toBeVisible();
        else await expect(entry.locator('[data-fdt="status-badge"]')).toHaveText('On');
        await expect(panel.locator(APPEARANCE_BUTTON)).toBeVisible();
        await settleFrames(panel);
        await settleFrames(panel);
        expectBarFits(await readBarGeometry(panel), width, true);
      }
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
  // The densest real bar: a captured server value, stale data, a news
  // session (both news badges), the address, the real appearance button:
  // at every checkpoint around the threshold and the sidebar's, every part
  // is whole or gone (no ellipsis, no cut glyph, no clipped ring).
  for (const [name, session] of [
    ['On', SESSION_ON],
    ['Unavailable', SESSION_UNAVAILABLE]
  ] as const) {
    test(`captured server + stale data + "${name}" session: every part whole or gone`, async ({
      extension
    }) => {
      const { panel, fixture } = await openPanelForFixture(extension, '/__e2e/cache-evidence', {
        panelInit: `${CLOCK_HARNESS};${builderHarness(session)}`,
        inspect: { origin: 'http://localhost:8891/__e2e/cache-evidence', resources: [] }
      });
      try {
        await expect
          .poll(async () => await barText(panel), { timeout: 15_000, intervals: [50, 100, 250] })
          .toContain('3.20.1');
        await makeStale(panel);
        for (const width of [320, 420, FULL_MIN_WIDTH - 1, FULL_MIN_WIDTH, 800, 820, 1079, 1080]) {
          await panel.setViewportSize({ width, height: 700 });
          await expect(panel.locator('[data-fdt="builder-entry"]')).toBeVisible();
          await expect(panel.locator(APPEARANCE_BUTTON)).toBeVisible();
          await settleFrames(panel);
          await settleFrames(panel);
          expectBarFits(await readBarGeometry(panel), width, true);
          // Stale stays glanceable: the inline badge, or the dot on "⋯".
          const fold = await readFold(panel);
          await expect(
            fold.folded.includes('freshness') || width < FULL_MIN_WIDTH
              ? panel.locator('[data-fdt="top-bar-menu-stale"]')
              : panel.locator('[data-fdt="top-bar-freshness"]').getByText('Stale'),
            `stale glance at ${String(width)}px`
          ).toBeVisible();
          await expectMenuHoldsFolded(panel, width);
        }
      } finally {
        await panel.close();
        await fixture.page.close();
      }
    });
  }

  // The widest key chip ("Ctrl+K", every non-Apple host) on the densest
  // bar: the trigger sizes to its words (never "Jump…"), and the fold
  // budgets the wider end slot (nothing cut or elided, "⋯" holds the rest).
  test('a "Ctrl+K" key chip keeps the trigger whole and the dense bar whole or gone', async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/__e2e/cache-evidence', {
      panelInit: `${CTRL_KEY_HARNESS};${CLOCK_HARNESS};${builderHarness(SESSION_ON)}`,
      inspect: { origin: 'http://localhost:8891/__e2e/cache-evidence', resources: [] }
    });
    try {
      await expect
        .poll(async () => await barText(panel), { timeout: 15_000, intervals: [50, 100, 250] })
        .toContain('3.20.1');
      await makeStale(panel);
      for (const width of [FULL_MIN_WIDTH, 800, 1080, 1280]) {
        await panel.setViewportSize({ width, height: 700 });
        await expect(panel.locator('[data-fdt="builder-entry"]')).toBeVisible();
        await expect(panel.locator(APPEARANCE_BUTTON)).toBeVisible();
        await settleFrames(panel);
        await settleFrames(panel);
        const at = `at ${String(width)}px`;
        expect(await readTrigger(panel), `trigger ${at}`).toEqual({
          hint: 'Ctrl+K',
          words: 'Jump to…',
          elided: false
        });
        expectBarFits(await readBarGeometry(panel), width, true);
        await expectMenuHoldsFolded(panel, width);
      }
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
});
