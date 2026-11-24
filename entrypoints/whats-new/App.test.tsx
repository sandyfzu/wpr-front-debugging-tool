/**
 * The What's new page: the headline (name + running version + release
 * headline), filled placeholders, highlight cards text-only without a
 * screenshot and with the palette's file when one is bundled (System
 * following the OS live, Dark/Light pinned), history collapsed, the empty
 * registry, several featured releases (an update across announced
 * releases) each under its version heading, Open options, the footer's
 * support link, and the footer switch's state matrix writing the synced setting.
 */
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeScheme } from '../../components/system-dark.fake';
import type { Logger } from '../../lib/logger';
import { createWhatsNewOnUpdateIO } from '../../lib/options/instant-io';
import type { InstantSettingIO } from '../../lib/options/instant-setting';
import { RELEASE_NOTES, type ReleaseNote } from '../../lib/release-notes/notes';
import { whatsNewView } from '../../lib/release-notes/page-view';
import type * as Screenshots from '../../lib/release-notes/screenshots';
import { WHATS_NEW_ON_UPDATE_LABEL } from '../../lib/release-notes/words';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '../../lib/support/contact';
import { readWhatsNewOnUpdate } from '../../lib/storage/whats-new';
import type { Appearance } from '../../utils/theme';
import App, { PAGE_WORDS } from './App';
import { ON_UPDATE_WORDS } from './on-update-switch';
import { RELEASE_WORDS } from './release';

// One bundled test screenshot, so the image leg renders (the shipped table is empty).
vi.mock('../../lib/release-notes/screenshots', async (importOriginal) => {
  const actual = await importOriginal<typeof Screenshots>();
  const table = { demo: { alt: 'Demo shot', width: 640, height: 360, format: 'webp' } } as const;
  return {
    ...actual,
    resolveScreenshot: (id: string | undefined, palette: Screenshots.ScreenshotPalette) =>
      actual.resolveScreenshot(id, palette, table)
  };
});

const TOKENS = { paletteShortcut: 'Alt+K', devtoolsShortcut: 'Ctrl+Shift+I or F12' } as const;

/** A silent logger. */
const LOG: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** A release with one highlight showing the test screenshot. */
const SHOT_RELEASE: ReleaseNote = {
  version: '9.0.0',
  announce: true,
  headline: 'Shots',
  highlights: [
    {
      id: 'with-shot',
      title: 'With shot',
      summary: 'Has one',
      howTo: ['Somewhere'],
      screenshot: 'demo' as never
    }
  ],
  improvements: [],
  notices: []
};

/** Render the page with overrides. */
function renderPage(
  overrides: {
    view?: ReturnType<typeof whatsNewView>;
    appearance?: () => Appearance;
    dark?: boolean;
    io?: InstantSettingIO<boolean>;
    openOptions?: () => Promise<void>;
  } = {}
) {
  const scheme = fakeScheme(overrides.dark ?? false);
  const openOptions = overrides.openOptions ?? vi.fn(() => Promise.resolve());
  render(() => (
    <App
      name="WPR Front Debugging Tool"
      version="3.0.0"
      view={overrides.view ?? whatsNewView(RELEASE_NOTES, '3.0.0', 'chromium')}
      tokens={TOKENS}
      appearance={overrides.appearance ?? (() => 'system')}
      settingIO={overrides.io ?? createWhatsNewOnUpdateIO(LOG)}
      openOptions={openOptions}
      colorScheme={scheme}
    />
  ));
  return { scheme, openOptions };
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('the What’s new page', () => {
  it('heads with the product name, the running version and the release headline', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('WPR Front Debugging Tool');
    expect(screen.getByText('v3.0.0')).toBeTruthy();
    const headline = RELEASE_NOTES.find((note) => note.version === '3.0.0')?.headline ?? '';
    expect(document.querySelector('[data-fdt="whats-new-headline"]')?.textContent).toBe(headline);
  });

  it('fills the placeholders in the start card and the highlights', () => {
    renderPage();
    expect(document.querySelector('[data-fdt="whats-new-panel-hint"]')?.textContent).toContain(
      'Ctrl+Shift+I or F12'
    );
    const palette = document.querySelector('[data-fdt-highlight="command-palette"]');
    expect(palette?.textContent).toContain('Press Alt+K on the page');
    expect(document.body.textContent).not.toMatch(/\{[A-Za-z]+\}/);
  });

  it('renders every 3.0.0 highlight as a text-only card (no screenshot bundled yet)', () => {
    renderPage();
    const note = RELEASE_NOTES.find((row) => row.version === '3.0.0');
    for (const highlight of note?.highlights ?? []) {
      const card = document.querySelector(`[data-fdt-highlight="${highlight.id}"]`);
      expect(card, highlight.id).not.toBeNull();
      expect(card?.querySelector('img')).toBeNull();
      expect(card?.textContent).toContain(RELEASE_WORDS.howTo);
    }
    expect(screen.getByRole('heading', { name: RELEASE_WORDS.notices })).toBeTruthy();
  });

  it('shows the Chromium-only permission notice on Chromium only', () => {
    renderPage();
    expect(document.querySelector('[data-fdt-notice="debugger-permission"]')).not.toBeNull();
    document.body.replaceChildren();
    renderPage({ view: whatsNewView(RELEASE_NOTES, '3.0.0', 'firefox') });
    expect(document.querySelector('[data-fdt-notice="debugger-permission"]')).toBeNull();
    expect(document.querySelector('[data-fdt-notice="predecessor-tool-retired"]')).not.toBeNull();
  });

  it('picks the screenshot file of the palette on screen, live', () => {
    const [appearance, setAppearance] = createSignal<Appearance>('system');
    const { scheme } = renderPage({
      view: { featured: [SHOT_RELEASE], history: [] },
      appearance
    });
    const image = (): HTMLImageElement | null =>
      document.querySelector<HTMLImageElement>('[data-fdt-highlight="with-shot"] img');
    expect(image()?.getAttribute('src')).toBe('/whats-new/demo-light.webp');
    expect(image()?.getAttribute('alt')).toBe('Demo shot');
    expect(image()?.getAttribute('width')).toBe('640');
    expect(image()?.getAttribute('height')).toBe('360');
    expect(image()?.getAttribute('loading')).toBe('lazy');
    scheme.flip(true);
    expect(image()?.getAttribute('src')).toBe('/whats-new/demo-dark.webp');
    setAppearance('light');
    expect(image()?.getAttribute('src')).toBe('/whats-new/demo-light.webp');
    setAppearance('dark');
    scheme.flip(false);
    expect(image()?.getAttribute('src')).toBe('/whats-new/demo-dark.webp');
  });

  it('collapses earlier releases under their version', () => {
    renderPage({ view: { featured: [SHOT_RELEASE], history: [RELEASE_NOTES[0] as ReleaseNote] } });
    const entry = document.querySelector<HTMLDetailsElement>('[data-fdt-history="3.0.0"]');
    expect(entry?.open).toBe(false);
    expect(screen.getByRole('heading', { name: PAGE_WORDS.history })).toBeTruthy();
    // History headings sit one level below the running release's.
    expect(entry?.querySelector('h3')?.textContent).toBe(RELEASE_WORDS.highlights);
    expect(entry?.querySelector('h4')).not.toBeNull();
  });

  it('shows several featured releases newest first, each under its version and headline', () => {
    const older: ReleaseNote = { ...SHOT_RELEASE, version: '8.0.0', headline: 'Older' };
    renderPage({ view: { featured: [SHOT_RELEASE, older], history: [] } });
    const releases = [...document.querySelectorAll('[data-fdt-release]')];
    expect(releases.map((node) => node.getAttribute('data-fdt-release'))).toEqual([
      '9.0.0',
      '8.0.0'
    ]);
    expect(releases[1]?.querySelector('h2')?.textContent).toBe(PAGE_WORDS.release('8.0.0'));
    expect(releases[1]?.textContent).toContain('Older');
    // Their blocks sit one level lower; the page headline is left to each release.
    expect(releases[0]?.querySelector('h3')?.textContent).toBe(RELEASE_WORDS.highlights);
    expect(document.querySelector('[data-fdt="whats-new-headline"]')).toBeNull();
  });

  it('says so when no release notes ship, keeping the actions and the footer', async () => {
    renderPage({ view: { featured: [], history: [] } });
    expect(screen.getByText(PAGE_WORDS.empty)).toBeTruthy();
    expect(screen.getByText(PAGE_WORDS.openOptions)).toBeTruthy();
    await screen.findByRole('switch', { name: WHATS_NEW_ON_UPDATE_LABEL });
  });

  it('opens the options page', () => {
    const { openOptions } = renderPage();
    fireEvent.click(screen.getByText(PAGE_WORDS.openOptions));
    expect(openOptions).toHaveBeenCalledOnce();
  });

  it('names the support address in the footer as a mail link', () => {
    renderPage();
    const line = document.querySelector('footer [data-fdt="whats-new-support"]');
    expect(line?.textContent).toBe(`${PAGE_WORDS.support} ${SUPPORT_EMAIL}`);
    const link = screen.getByRole('link', { name: SUPPORT_EMAIL });
    expect(link.getAttribute('href')).toBe(SUPPORT_MAILTO);
    // A mail link opens the mail client, never a tab of its own.
    expect(link.hasAttribute('target')).toBe(false);
  });

  it('keeps the support address when no release notes ship', () => {
    renderPage({ view: { featured: [], history: [] } });
    expect(screen.getByRole('link', { name: SUPPORT_EMAIL })).toBeTruthy();
  });
});

describe('the footer switch', () => {
  it('reads the stored setting and writes the synced item on flip', async () => {
    renderPage();
    const toggle = await screen.findByRole<HTMLInputElement>('switch', {
      name: WHATS_NEW_ON_UPDATE_LABEL
    });
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await vi.waitFor(async () => {
      expect(await readWhatsNewOnUpdate()).toBe(false);
    });
    expect(toggle.checked).toBe(false);
  });

  it('follows another surface’s write live', async () => {
    renderPage();
    const toggle = await screen.findByRole<HTMLInputElement>('switch', {
      name: WHATS_NEW_ON_UPDATE_LABEL
    });
    await fakeBrowser.storage.sync.set({ 'whats-new-on-update': false });
    await vi.waitFor(() => {
      expect(toggle.checked).toBe(false);
    });
  });

  it('shows a failed read with Retry, then the switch', async () => {
    let fail = true;
    const io: InstantSettingIO<boolean> = {
      read: () => (fail ? Promise.reject(new Error('dead')) : Promise.resolve(false)),
      write: () => Promise.resolve(),
      watch: () => () => undefined,
      log: LOG
    };
    renderPage({ io });
    await screen.findByText(ON_UPDATE_WORDS.readFailed);
    fail = false;
    fireEvent.click(screen.getByText(ON_UPDATE_WORDS.retry));
    const toggle = await screen.findByRole<HTMLInputElement>('switch', {
      name: WHATS_NEW_ON_UPDATE_LABEL
    });
    expect(toggle.checked).toBe(false);
  });

  it('says a failed write was not saved and shows the confirmed value', async () => {
    const io: InstantSettingIO<boolean> = {
      read: () => Promise.resolve(true),
      write: () => Promise.reject(new Error('quota')),
      watch: () => () => undefined,
      log: LOG
    };
    renderPage({ io });
    const toggle = await screen.findByRole<HTMLInputElement>('switch', {
      name: WHATS_NEW_ON_UPDATE_LABEL
    });
    fireEvent.click(toggle);
    await screen.findByText(ON_UPDATE_WORDS.writeFailed);
    expect(toggle.checked).toBe(true);
  });
});
