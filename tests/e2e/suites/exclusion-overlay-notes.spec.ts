/**
 * P10K.5a suite — the exclusion builder's stored-form notes, in the real
 * overlay (injected into a fixture page's top frame the way the background
 * opens it) over the real session backend.
 *
 * Owner-visible flows: a row becomes WP Rocket's stored form when left,
 * with a "you typed" note and Undo (keyboard only) that survive leaving the
 * row again, arrow passes and an apply (only an edit ends them); a
 * duplicate row leaves with its note and Restore, and focus that was
 * heading into the removed row lands on Restore; a 250-row paste of
 * duplicates causes no long task; copy-all copies the stored form; a Defer
 * JS set WP Rocket turns off page-wide (P10K.5b; a warning since P10K.5c)
 * warns with the message naming its row — unverified, here — and Go to on
 * the row, Apply goes through and the preview has no script deferred, the
 * message and the counts saying why; a Delay row matching everything
 * (P10K.5c) warns, applies, and excludes every script; and, applied, a
 * Delay row typed in another case matches its script while a picked row
 * whose file name holds `+` excludes its own (both scripts run). The
 * "On this page" toggle shows its open state where the shadow CSS applies:
 * the accent fill with its on-accent text and a turned chevron, instant under
 * reduced motion.
 *
 * The overlay is a shadow-root UI (open root): Playwright's role locators
 * pierce it. Every leg opens its own fixture tab (a session is per tab).
 */

import type { Locator, Page } from '@playwright/test';

import {
  expect,
  ORIGIN_A,
  test,
  type DriverPage,
  type ExtensionDriver
} from '../helpers/extension';
import {
  APPLIED,
  DEFER,
  DELAY,
  LAZY_RENDER,
  openBuilder as openBuilderOn
} from '../helpers/exclusion-overlay';

/** The fixture page: two scripts served as Delay JavaScript execution delays them. */
const FIXTURE = '/exclusion/delayed.html';

/** The fixture page: two scripts served as Load JavaScript deferred defers them. */
const DEFERRED_FIXTURE = '/exclusion/deferred.html';

/**
 * Open the fixture with the exclusion builder in it (drafts cleared: every
 * leg starts empty).
 *
 * @param extension The driver.
 * @param fixture The fixture page's path.
 */
async function openBuilder(extension: ExtensionDriver, fixture = FIXTURE): Promise<DriverPage> {
  return await openBuilderOn(extension, fixture);
}

/** The Delay lane region. */
const delayLane = (page: Page): Locator => page.getByRole('region', { name: DELAY });

/** A Delay row's input. */
const delayRow = (page: Page, n: number): Locator =>
  page.getByRole('textbox', { name: `${DELAY} row ${String(n)}`, exact: true });

/** The focused element's accessible name (inside the overlay's shadow root). */
async function focusedName(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active?.getAttribute('aria-label') ?? null;
  });
}

/** What one interaction cost: its synchronous handler time and the long tasks it caused. */
interface Cost {
  readonly sync: number;
  readonly tasks: readonly number[];
}

/**
 * Paste text into the focused row as a real paste event, timing the handler
 * and collecting long tasks (> 50 ms) until two frames and a beat after.
 *
 * @param page The page.
 * @param text The pasted text.
 */
async function pasteFocused(page: Page, text: string): Promise<Cost> {
  return await page.evaluate(async (pasted) => {
    const tasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(Math.round(entry.duration));
    });
    observer.observe({ type: 'longtask' });
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    const data = new DataTransfer();
    data.setData('text/plain', pasted);
    const start = performance.now();
    active?.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
        composed: true
      })
    );
    const sync = Math.round(performance.now() - start);
    await new Promise((settled) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(settled, 300)));
    });
    observer.disconnect();
    return { sync, tasks };
  }, text);
}

/**
 * Click a control, collecting the long tasks it caused (a click's round
 * trip includes the driver, so only its long tasks are judged).
 *
 * @param page The page.
 * @param control The control.
 */
async function clickLongTasks(page: Page, control: Locator): Promise<readonly number[]> {
  await page.evaluate(() => {
    const store = window as unknown as { xoTasks?: number[]; xoObserver?: PerformanceObserver };
    store.xoTasks = [];
    store.xoObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) store.xoTasks?.push(Math.round(entry.duration));
    });
    store.xoObserver.observe({ type: 'longtask' });
  });
  await control.click();
  await page.waitForTimeout(300);
  return await page.evaluate(() => {
    const store = window as unknown as { xoTasks?: number[]; xoObserver?: PerformanceObserver };
    store.xoObserver?.disconnect();
    return store.xoTasks ?? [];
  });
}

/** Add a Delay row and type into it (focus ends in the row). */
async function typeNewDelayRow(page: Page, text: string): Promise<void> {
  await delayLane(page).getByRole('button', { name: 'Add row' }).click();
  await page.keyboard.type(text);
}

test.describe('exclusion builder stored-form notes', () => {
  test('a row left becomes its stored form with a note; Undo restores the typed text', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension);
    await typeNewDelayRow(page, 'jquery-*.js');
    await page.keyboard.press('Tab');
    await expect(delayRow(page, 1)).toHaveValue('jquery-(.*).js');
    await expect(delayLane(page)).toContainText(
      'WP Rocket stores this as jquery-(.*).js (you typed jquery-*.js).'
    );
    // The note describes the row; focus did not move at commit.
    await expect(delayRow(page, 1)).toHaveAccessibleDescription(
      'WP Rocket stores this as jquery-(.*).js (you typed jquery-*.js).'
    );
    expect(await focusedName(page)).toBe(`Remove ${DELAY} row 1`);
    await expect(page.getByRole('status').last()).toHaveText(
      `${DELAY} row 1: WP Rocket stores it as jquery-(.*).js.`
    );
    // Undo is next in Tab order; Enter puts the typed text back, focused.
    await page.keyboard.press('Tab');
    expect(await focusedName(page)).toBe(`Undo change to ${DELAY} row 1`);
    await page.keyboard.press('Enter');
    await expect(delayRow(page, 1)).toHaveValue('jquery-*.js');
    await expect(delayRow(page, 1)).toBeFocused();
    // Leaving again converts again, with the same note.
    await page.keyboard.press('Tab');
    await expect(delayRow(page, 1)).toHaveValue('jquery-(.*).js');
    const undo = delayLane(page).getByRole('button', { name: `Undo change to ${DELAY} row 1` });
    await expect(undo).toBeVisible();
    // Shift+Tab back into the row and Tab out again (no edit): note and Undo stay.
    await page.keyboard.press('Shift+Tab');
    await expect(delayRow(page, 1)).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await focusedName(page)).toBe(`Undo change to ${DELAY} row 1`);
    // Editing the row itself ends its undo and its note (the "you typed" part is gone).
    await delayRow(page, 1).press('End');
    await page.keyboard.type('x');
    await expect(undo).toHaveCount(0);
    await expect(delayRow(page, 1)).toHaveAccessibleDescription('');
    await page.close();
  });

  test('notes outlive commits that change nothing: arrows and an apply keep them', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension);
    await delayLane(page).getByRole('button', { name: 'Add row' }).click();
    // A paste converts its first row and leaves the caret in the second (no edit since).
    await pasteFocused(page, 'jquery-*.js\ngtag');
    const undo = delayLane(page).getByRole('button', { name: `Undo change to ${DELAY} row 1` });
    const note = 'WP Rocket stores this as jquery-(.*).js (you typed jquery-*.js).';
    // Arrow up through the converted row and down again: both rows commit unchanged.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await expect(delayRow(page, 2)).toBeFocused();
    await expect(delayRow(page, 1)).toHaveAccessibleDescription(note);
    await expect(undo).toBeVisible();
    // `(a+)+$` is kept by WP Rocket's save but refused here (a backtracking
    // risk): the apply commits every row, then stops on it, so the page
    // stays. Another lane, so no edit in the Delay lane retires its undo.
    const defer = page.getByRole('region', { name: DEFER });
    await defer.getByRole('button', { name: 'Add row' }).click();
    await page.keyboard.type('(a+)+$');
    await page.getByRole('button', { name: /^Apply$/ }).click();
    await expect(
      page.getByRole('textbox', { name: `${DEFER} row 1`, exact: true })
    ).toHaveAttribute('aria-invalid', 'true');
    await expect(delayRow(page, 1)).toHaveAccessibleDescription(note);
    await expect(undo).toBeVisible();
    await page.close();
  });

  test('a paste of 250 duplicates into a 250-row lane stays off long tasks', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension);
    const rows = Array.from(
      { length: 250 },
      (_, n) => `https://example.com/wp-content/plugins/p${String(n)}/assets/js/script-(.*).min.js`
    );
    await delayLane(page).getByRole('button', { name: 'Add row' }).click();
    const seed = await pasteFocused(page, rows.join('\n'));
    // A fresh row 251 (the caret sat at the end of row 250) takes the duplicates.
    await page.keyboard.press('Enter');
    await expect(delayRow(page, 251)).toBeFocused();
    const duplicates = await pasteFocused(
      page,
      [...rows]
        .reverse()
        .map((row) => ` ${row} `)
        .join('\n')
    );
    await page.keyboard.press('Tab');
    // Every duplicate left the lane, each named in the removed list.
    await expect(delayRow(page, 251)).toHaveCount(0);
    const restoreTasks = await clickLongTasks(
      page,
      delayLane(page)
        .getByRole('button', { name: /^Restore removed/ })
        .first()
    );
    await expect(delayRow(page, 251)).toBeFocused();
    console.log('PERF', JSON.stringify({ seed, duplicates, restoreTasks }));
    for (const run of [seed, duplicates]) {
      expect(run.sync).toBeLessThan(50);
      expect(run.tasks).toEqual([]);
    }
    expect(restoreTasks).toEqual([]);
    await page.close();
  });

  test('a duplicate row leaves with its note; Restore brings it back for editing', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension);
    await typeNewDelayRow(page, 'gtag');
    await page.keyboard.press('Enter');
    await page.keyboard.type('gtag');
    // Tab heads to the row's own Remove button, which leaves with the row.
    await page.keyboard.press('Tab');
    await expect(delayRow(page, 2)).toHaveCount(0);
    await expect(delayLane(page).getByRole('list', { name: `${DELAY} rows removed` })).toHaveText(
      /Removed gtag: WP Rocket drops a copy of row 1\./
    );
    expect(await focusedName(page)).toBe(`Restore removed ${DELAY} row 2`);
    await page.keyboard.press('Enter');
    await expect(delayRow(page, 2)).toHaveValue('gtag');
    await expect(delayRow(page, 2)).toBeFocused();
    await page.close();
  });

  test('copy-all copies the stored form', async ({ extension }) => {
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: ORIGIN_A
    });
    const { page } = await openBuilder(extension);
    await typeNewDelayRow(page, 'jquery-*.js');
    await page.keyboard.press('Enter');
    await page.keyboard.type('g%41tag');
    await page.getByRole('button', { name: `Copy all ${DELAY} exclusions`, exact: true }).click();
    await expect(page.getByRole('status').last()).toHaveText('Copied 2 exclusions');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('jquery-(.*).js\ngtag');
    await page.close();
  });

  test('lazy-render rows copy as a rocket_lrc_exclusions filter, with the re-keying note', async ({
    extension
  }) => {
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: ORIGIN_A
    });
    const { page } = await openBuilder(extension);
    const lazyRender = page.getByRole('region', { name: LAZY_RENDER });
    await expect(lazyRender).toContainText(
      'Text, matched against the element’s opening tag (upper and lower case A–Z count as the same)'
    );
    await lazyRender.getByRole('button', { name: 'Add row' }).click();
    await page.keyboard.type('id="footer"');
    await expect(lazyRender).toContainText('Excluding an element re-keys the elements after it');
    await lazyRender
      .getByRole('button', { name: `Copy all ${LAZY_RENDER} exclusions`, exact: true })
      .click();
    await expect(page.getByRole('status').last()).toHaveText(
      'Copied 1 exclusion as a rocket_lrc_exclusions filter'
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      [
        "add_filter( 'rocket_lrc_exclusions', function ( $exclusions ) {",
        '\treturn array_merge( (array) $exclusions, [',
        '\t\t\'id="footer"\',',
        '\t] );',
        '} );'
      ].join('\n')
    );
    // Defer JS names what this preview cannot read.
    await expect(page.getByRole('region', { name: DEFER })).toContainText(
      'WP Rocket’s remote exclusion lists and any custom code filters aren’t read here'
    );
    await page.close();
  });

  test('a Defer JS set WP Rocket turns off page-wide warns, naming the row; Apply previews no script deferred', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension, DEFERRED_FIXTURE);
    const defer = page.getByRole('region', { name: DEFER });
    const deferRow = (n: number): Locator =>
      page.getByRole('textbox', { name: `${DEFER} row ${String(n)}`, exact: true });
    await defer.getByRole('button', { name: 'Add row' }).click();
    await page.keyboard.type('a\\.js');
    await page.keyboard.press('Enter');
    // Unverified (`\p{L}`: its save isn't modeled) yet behind the page-off: its open
    // `\Q` quotes the joined pattern's closing parenthesis.
    await page.keyboard.type('\\p{L}\\Qab');
    const lead = 'WP Rocket defers no script on this page because of this row:';
    const message = defer.getByRole('group', { name: lead });
    await expect(message).toHaveText(
      `${lead}Go to row 2\\p{L}\\QabApply still runs and previews the page as WP Rocket serves it, with no script deferred. Edit or remove it to defer scripts again.`
    );
    // A group named by its lead (`aria-labelledby`), so a screen reader says what it is.
    await expect(message).toHaveAttribute('role', 'group');
    await expect(message).toHaveAccessibleName(lead);
    // A warning, never a problem: the row says so in its note slot.
    await expect(deferRow(2)).toHaveAttribute('aria-invalid', 'false');
    await expect(deferRow(2)).toHaveAccessibleDescription(
      'This row makes WP Rocket’s Defer JS check fail (it checks all the rows joined as one pattern). Apply still runs and previews it as WP Rocket would.'
    );
    await message.getByRole('button', { name: 'Go to row 2' }).click();
    await expect(deferRow(2)).toBeFocused();
    await page.getByRole('button', { name: /^Apply$/ }).click();
    await expect(page.getByText(/before applying/)).toHaveCount(0);
    // The session applies: the page reloads with the builder back on an active session.
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible(APPLIED);
    await expect(defer.getByText('2 of 2 deferred and wrapped scripts restored')).toBeVisible();
    await expect(
      defer.getByText(
        'WP Rocket defers no script on this page because of row 2, so every deferred script is restored.'
      )
    ).toBeVisible();
    // The message stays beside the counts: the preview explains itself.
    await expect(message).toBeVisible();
    // Screen readers hear it too: the polite status banner carries the warning.
    await expect(
      page.getByRole('status').filter({ hasText: 'Applied, with warnings' })
    ).toContainText(
      'Load JavaScript deferred: WP Rocket defers no script on this page because of row 2, so every deferred script is restored.'
    );
    // As WP Rocket would serve it: no script deferred, both ran.
    await expect
      .poll(() =>
        page.evaluate(() => ({
          deferred: document.querySelectorAll('script[defer], script[data-rocket-defer]').length,
          ran: [
            document.documentElement.dataset.deferredOneRan,
            document.documentElement.dataset.deferredTwoRan
          ]
        }))
      )
      .toEqual({ deferred: 0, ran: ['true', 'true'] });
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.close();
  });

  test('a Delay row matching everything warns; Apply goes through and excludes every script', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension);
    // WP Rocket's stored form of `(?<n>a)`: it matches every script.
    await typeNewDelayRow(page, '(?a)');
    await page.keyboard.press('Tab');
    await expect(delayRow(page, 1)).toHaveAttribute('aria-invalid', 'false');
    const row = delayLane(page).getByRole('listitem').nth(0);
    await expect(delayRow(page, 1)).toHaveAccessibleDescription(
      'WP Rocket stores this and it excludes every script. Apply still runs and previews it as WP Rocket would.'
    );
    await page.getByRole('button', { name: /^Apply$/ }).click();
    await expect(page.getByText(/before applying/)).toHaveCount(0);
    await expect(page.getByText('2 of 2 delayed scripts restored')).toBeVisible(APPLIED);
    await expect(
      delayLane(page).getByText(
        'Row 1 matches everything: WP Rocket excludes all delayed scripts with it, and so does this preview.'
      )
    ).toBeVisible();
    await expect(row).toContainText('2 matches');
    await expect(
      page.getByRole('status').filter({ hasText: 'Applied, with warnings' })
    ).toContainText('Delay JavaScript execution: Row 1 matches everything');
    // The warning stays after the apply, next to the counts.
    await expect(row).toContainText('WP Rocket stores this and it excludes every script.');
    await expect
      .poll(() =>
        page.evaluate(() => [
          document.documentElement.dataset.jqueryUiRan,
          document.documentElement.dataset.abRan
        ])
      )
      .toEqual(['true', 'true']);
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.close();
  });

  test('applied: a row typed in another case matches; a picked + row excludes its script', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension);
    await typeNewDelayRow(page, 'JQUERY-UI.JS');
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: /^On this page/ }).click();
    await page.getByRole('button', { name: `Add a+b.js to ${DELAY}` }).click();
    // The picker writes `+` as `\x2B` (WP Rocket reads a Delay `+` literally).
    await expect(delayRow(page, 2)).toHaveValue(/a\\x2Bb/);
    await page.getByRole('button', { name: /^Apply$/ }).click();
    // The page reloads through the session; the overlay comes back with counts.
    await expect(page.getByText('2 of 2 delayed scripts restored')).toBeVisible(APPLIED);
    const rows = delayLane(page).getByRole('listitem');
    await expect(rows.nth(0)).toContainText('1 match');
    await expect(rows.nth(1)).toContainText('1 match');
    await expect
      .poll(() =>
        page.evaluate(() => [
          document.documentElement.dataset.jqueryUiRan,
          document.documentElement.dataset.abRan
        ])
      )
      .toEqual(['true', 'true']);
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.close();
  });

  test('the "On this page" toggle reads open by its accent fill and text and a turned chevron, closed again after', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension);
    const toggle = page.getByRole('button', { name: /^On this page/ });
    /** The toggle's computed fill and text, and its chevron's computed transform. */
    const look = (): Promise<{ fill: string; text: string; turn: string; turnSeconds: number }> =>
      toggle.evaluate((button) => {
        const chevron = button.querySelector('.xo-chevron');
        if (chevron === null) throw new Error('the toggle has no chevron');
        const chevronStyle = getComputedStyle(chevron);
        const style = getComputedStyle(button);
        return {
          fill: style.backgroundColor,
          text: style.color,
          turn: chevronStyle.transform,
          turnSeconds: Number.parseFloat(chevronStyle.transitionDuration)
        };
      });
    /** The accent pair as the toggle's own tree resolves the tokens (palette included). */
    const accentPair = (): Promise<{ fill: string; text: string }> =>
      toggle.evaluate((button) => {
        const probe = document.createElement('span');
        probe.style.setProperty('background-color', 'var(--accent-strong)');
        probe.style.setProperty('color', 'var(--on-accent)');
        button.parentElement?.append(probe);
        const resolved = getComputedStyle(probe);
        const pair = { fill: resolved.backgroundColor, text: resolved.color };
        probe.remove();
        return pair;
      });
    // Keyboard only: a pointer resting on the toggle would add its hover fill.
    await toggle.focus();
    const closed = await look();
    expect(closed.turn).toBe('none');
    expect(closed.turnSeconds).toBeCloseTo(0.12, 3);
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // A half turn once the 120 ms transition ends.
    await expect.poll(async () => (await look()).turn).toBe('matrix(-1, 0, 0, -1, 0, 0)');
    const open = await look();
    expect(open.fill).not.toBe(closed.fill);
    // The open state is the accent pair: the fill and its on-accent text.
    const accent = await accentPair();
    expect(open.fill).toBe(accent.fill);
    expect(open.text).toBe(accent.text);
    expect(closed.text).not.toBe(accent.text);
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(look).toEqual(closed);
    // Reduced motion collapses the turn (the token sheet's reset reaches the shadow root).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect((await look()).turnSeconds).toBeLessThan(0.001);
    await page.close();
  });
});
