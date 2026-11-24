/**
 * The word detail's render branches: script definitions as source-link tiles
 * with their copy action (accessible names that tell rows apart, the original
 * path copied, the in-place confirmation, the pending guard, the failure
 * remedy), the combined-bundle note, inline tiles, the five-item cap with its
 * disclosure, the verdict as visible text, the single-letter note, the
 * sentinel / not-found / answer-less bodies, a refreshed answer keeping the
 * copy control (and focus), and untrusted words and URLs rendered inertly.
 * User-facing copy is pinned literally.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { COPIED_FLASH_MS } from '../../../../components/ui/copy-flash';
import { toastItems } from '../../../../components/ui/toast-store';
import type { DefinitionAnswer } from './model';
import type { ScriptOrigin } from '../../../../lib/panel/undefined-refs';
import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../../../../lib/wp-rocket/constants';
import type { OpenResource } from '../open-resource';
import {
  INLINE_DEFINITION_NOTE,
  SINGLE_LETTER_FOUND_NOTE,
  SINGLE_LETTER_NOT_FOUND_NOTE,
  WordDetail,
  copyExclusionName,
  notFoundExplanation,
  singleLetterNote
} from './word-detail';
import { wordRowView } from './word-view';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const PAGE = 'https://example.com';
const URL_A = 'https://example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1';
const URL_CDN = 'https://cdn.example.net/wp-includes/js/jquery/jquery.min.js?ver=3.7.1';

/** What {@link show} renders. */
interface ShowOptions {
  pageOrigin?: string | null;
  unreadable?: number;
  inlineCut?: boolean;
  openResource?: OpenResource | null;
}

/**
 * Render the detail for one word and answer.
 *
 * @param word The word.
 * @param answer Its answer.
 * @param options Page-level facts.
 */
function show(word: string, answer: DefinitionAnswer, options: ShowOptions = {}): void {
  const unreadable = options.unreadable ?? 0;
  const inlineCut = options.inlineCut ?? false;
  render(() => (
    <WordDetail
      view={() => wordRowView(word, answer, unreadable, inlineCut)}
      pageOrigin={() => (options.pageOrigin === undefined ? PAGE : options.pageOrigin)}
      unreadable={() => unreadable}
      inlineCut={() => inlineCut}
      openResource={options.openResource ?? null}
    />
  ));
}

/** A clipboard double through the default navigator seam (the shared button resolves it). */
function writer(behavior: 'resolve' | 'reject'): { writeText: Mock } {
  const clipboard = {
    writeText: vi.fn((): Promise<void> =>
      behavior === 'resolve'
        ? Promise.resolve()
        : Promise.reject(new Error('Document is not focused.'))
    )
  };
  vi.stubGlobal('navigator', { clipboard });
  return clipboard;
}

/** The rendered verdict line. */
function verdict(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-fdt-verdict]');
  if (!node) throw new Error('no verdict rendered');
  return node;
}

/** Every source tile's open action, in order. */
function tiles(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-fdt="source-link-open"]')];
}

describe('WordDetail — script definitions', () => {
  it('opens the served file from its tile and copies the path, page host dropped', async () => {
    const clipboard = writer('resolve');
    show('jQuery', [{ kind: 'url', url: URL_A }]);
    expect(verdict().textContent).toBe('In 1 script');
    const [tile] = tiles();
    expect(tile?.getAttribute('href')).toBe(URL_A);
    expect(tile?.getAttribute('target')).toBe('_blank');
    expect(tile?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(tile?.querySelector('[data-fdt="source-link-path"]')?.textContent).toBe(
      '/wp-includes/js/jquery/jquery.min.js?ver=3.7.1'
    );
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: jquery.min.js' });
    // The detail's primary action keeps its visible label at every width.
    expect(copy.textContent).toBe('Copy as exclusion');
    expect(copy.querySelector('.sr-only, [class*="@max-regular"]')).toBeNull();
    fireEvent.click(copy);
    await vi.waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith('/wp-includes/js/jquery/jquery.min.js');
    });
  });

  it('opens in Sources when DevTools can, with the companion new-tab link', () => {
    const open = vi.fn<OpenResource>(() => Promise.resolve());
    show('jQuery', [{ kind: 'url', url: URL_A }], { openResource: open });
    const [tile] = tiles();
    expect(tile?.getAttribute('data-fdt-action')).toBe('sources');
    fireEvent.click(tile as HTMLElement);
    expect(open).toHaveBeenCalledWith(URL_A);
    expect(document.querySelector('[data-fdt="source-link-new-tab"]')?.getAttribute('href')).toBe(
      URL_A
    );
  });

  it('names the same file from two hosts apart; only the clicked pattern is copied', async () => {
    const clipboard = writer('resolve');
    show('jQuery', [
      { kind: 'url', url: URL_A },
      { kind: 'url', url: URL_CDN }
    ]);
    expect(
      tiles().map((tile) => tile.querySelector('[data-fdt="source-link-host"]')?.textContent)
    ).toEqual(['example.com', 'cdn.example.net']);
    const copies = screen.getAllByRole('button', { name: /^Copy as exclusion/ });
    expect(copies.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Copy as exclusion: jquery.min.js',
      'Copy as exclusion: jquery.min.js (cdn.example.net)'
    ]);
    fireEvent.click(copies[1] as HTMLElement);
    await vi.waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith(
        'cdn.example.net/wp-includes/js/jquery/jquery.min.js'
      );
    });
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it('flashes "Copied" in place after a confirmed copy, then reverts', async () => {
    vi.useFakeTimers();
    writer('resolve');
    show('jQuery', [{ kind: 'url', url: URL_A }]);
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: jquery.min.js' });
    expect(copy.getAttribute('title')).toBe(
      'Copy an exclusion for this script, to exclude it from Delay JavaScript execution'
    );
    fireEvent.click(copy);
    await vi.advanceTimersByTimeAsync(0);
    expect(copy.hasAttribute('data-fdt-copied')).toBe(true);
    expect(copy.textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(COPIED_FLASH_MS);
    expect(copy.hasAttribute('data-fdt-copied')).toBe(false);
    expect(copy.textContent).toBe('Copy as exclusion');
  });

  it('issues exactly one clipboard write when repeat activation rides a pending copy', async () => {
    let resolveWrite: () => void = () => undefined;
    const clipboard = writer('resolve');
    clipboard.writeText.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolveWrite = done;
        })
    );
    show('jQuery', [{ kind: 'url', url: URL_A }]);
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: jquery.min.js' });
    fireEvent.click(copy);
    expect(copy.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(copy);
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    resolveWrite();
    await vi.waitFor(() => {
      expect(copy.hasAttribute('aria-busy')).toBe(false);
    });
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(copy.hasAttribute('data-fdt-copied')).toBe(true);
  });

  it('does not flash on a failed copy; the error toast names the pattern', async () => {
    const clipboard = writer('reject');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    show('jQuery', [{ kind: 'url', url: URL_A }]);
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: jquery.min.js' });
    fireEvent.click(copy);
    await vi.waitFor(() => {
      expect(toastItems().some((item) => item.tone === 'error')).toBe(true);
    });
    expect(toastItems().find((item) => item.tone === 'error')?.description).toBe(
      'Add it by hand: /wp-includes/js/jquery/jquery.min.js'
    );
    expect(copy.hasAttribute('data-fdt-copied')).toBe(false);
    expect(copy.textContent).toBe('Copy as exclusion');
    fireEvent.click(copy);
    await vi.waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledTimes(2);
    });
    warn.mockRestore();
  });

  it('renders a non-http(s) URL as plain text with no action', () => {
    show('x', [{ kind: 'url', url: 'javascript:alert(1)' }]);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('[data-fdt="source-link-text"]')?.textContent).toBe(
      'javascript:alert(1)'
    );
    expect(document.querySelector('[href]')).toBeNull();
  });

  it('names the copy control with the visible label first (label in name)', () => {
    expect(copyExclusionName('a.js', null)).toBe('Copy as exclusion: a.js');
    expect(copyExclusionName('a.js', 'cdn.example.com')).toBe(
      'Copy as exclusion: a.js (cdn.example.com)'
    );
  });

  it('keeps the copy control (and its focus) when a refresh hands back known origins', () => {
    const origin: ScriptOrigin = { kind: 'url', url: URL_A };
    const [answer, setAnswer] = createSignal<DefinitionAnswer>([origin]);
    render(() => (
      <WordDetail
        view={() => wordRowView('jQuery', answer(), 0, false)}
        pageOrigin={() => PAGE}
        unreadable={() => 0}
        inlineCut={() => false}
        openResource={null}
      />
    ));
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: jquery.min.js' });
    copy.focus();
    // A re-read keeps the known origin object and adds one.
    setAnswer([origin, { kind: 'inline' }]);
    expect(screen.getByRole('button', { name: 'Copy as exclusion: jquery.min.js' })).toBe(copy);
    expect(document.activeElement).toBe(copy);
    expect(verdict().textContent).toBe('In 2 scripts');
  });
});

describe('WordDetail — copy payload names the original path', () => {
  const SITE = 'http://127.0.0.1:8493';
  const SERVED_MINIFIED = `${SITE}/wp-content/cache/min/1/wp-content/mu-plugins/assets/fdt-delayed-definer.js?ver=1792430636`;
  const ORIGINAL_PATH = '/wp-content/mu-plugins/assets/fdt-delayed-definer.js';
  const COMBINED = `${SITE}/wp-content/cache/min/1/cdb2e71f9f3da2a001630dcca225acbf.js`;

  it('opens the served minified URL and copies the original path', async () => {
    const clipboard = writer('resolve');
    show('fdtDelayTypedDependency', [{ kind: 'url', url: SERVED_MINIFIED }], { pageOrigin: SITE });
    expect(tiles()[0]?.getAttribute('href')).toBe(SERVED_MINIFIED);
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy as exclusion: fdt-delayed-definer.js' })
    );
    await vi.waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith(ORIGINAL_PATH);
    });
  });

  it('copies the hostless original path when the page origin is unknown', async () => {
    const clipboard = writer('resolve');
    show('fdtDelayTypedDependency', [{ kind: 'url', url: SERVED_MINIFIED }], { pageOrigin: null });
    fireEvent.click(
      screen.getByRole('button', {
        // An unknown page origin keeps the served host in the control's name.
        name: 'Copy as exclusion: fdt-delayed-definer.js (127.0.0.1:8493)'
      })
    );
    await vi.waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith(ORIGINAL_PATH);
    });
  });

  it('a remote-mirrored script copies the hostless original path, ready at once', async () => {
    const clipboard = writer('resolve');
    show(
      'Klaviyo',
      [
        {
          kind: 'url',
          url: 'https://wp-rocket.me/wp-content/cache/min/1/onsite/js/PD7as8/klaviyo.js?ver=1791299187'
        }
      ],
      { pageOrigin: 'https://wp-rocket.me' }
    );
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: klaviyo.js' });
    expect(copy.hasAttribute('aria-busy')).toBe(false);
    fireEvent.click(copy);
    await vi.waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith('/onsite/js/PD7as8/klaviyo.js');
    });
  });

  it('replaces the copy control with the combined-bundle note and keeps the tile', () => {
    show('bundle', [{ kind: 'url', url: COMBINED }], { pageOrigin: SITE });
    expect(screen.queryByRole('button', { name: /Copy as exclusion/ })).toBeNull();
    expect(tiles()[0]?.getAttribute('href')).toBe(COMBINED);
    expect(document.querySelector('[data-fdt="combined-note"]')?.textContent).toBe(
      "This script ships inside WP Rocket's combined JS bundle — per-file Delay exclusion is not available. The remedy is disabling Combine JS or excluding the original file in JavaScript & CSS."
    );
  });
});

describe('WordDetail — definition list', () => {
  it('renders an inline definition as a static tile — never a link or a button', () => {
    show('gamma', [{ kind: 'inline' }]);
    const item = document.querySelector('[data-fdt-definition="inline"]');
    expect(item?.textContent).toBe(`Inline script${INLINE_DEFINITION_NOTE}`);
    expect(INLINE_DEFINITION_NOTE).toBe("In the page's HTML — no file to open");
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lists the definitions under their heading, named by the word', () => {
    show('beta', [{ kind: 'inline' }]);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Possible definitions');
    expect(screen.getByRole('list', { name: 'Possible definitions of beta' })).toBeTruthy();
  });

  it('caps the items at five behind a "Show all N" disclosure that keeps focus', () => {
    const definitions: ScriptOrigin[] = Array.from({ length: 7 }, (_, i) => ({
      kind: 'url',
      url: `https://example.com/js/file-${String(i)}.js`
    }));
    show('$', definitions);
    expect(verdict().textContent).toBe('In 7 scripts');
    const list = screen.getByRole('list', { name: 'Possible definitions of $' });
    expect(list.querySelectorAll(':scope > li')).toHaveLength(5);
    const toggle = screen.getByRole('button', { name: 'Show all 7' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(list.id);
    toggle.focus();
    fireEvent.click(toggle);
    expect(list.querySelectorAll(':scope > li')).toHaveLength(7);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Show fewer');
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    expect(list.querySelectorAll(':scope > li')).toHaveLength(5);
  });

  it('shows no toggle at five items or fewer', () => {
    const definitions: ScriptOrigin[] = Array.from({ length: 5 }, (_, i) => ({
      kind: 'url',
      url: `https://example.com/js/f${String(i)}.js`
    }));
    show('x', definitions);
    expect(document.querySelector('[data-fdt="definitions-toggle"]')).toBeNull();
  });
});

describe('WordDetail — single-letter note', () => {
  it('opens a found detail with the warn-styled note qualifying its matches', () => {
    show('a', [{ kind: 'inline' }]);
    const note = screen.getByText(SINGLE_LETTER_FOUND_NOTE);
    expect(SINGLE_LETTER_FOUND_NOTE).toBe(
      'Single-letter name — usually an artifact of minified code; the matches below are likely coincidental.'
    );
    expect(note.className).toContain('text-status-warn');
    // Never color alone: the vocabulary's warning icon leads it.
    expect(note.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('opens a not-found detail with the note above the explanation', () => {
    show('a', []);
    expect(SINGLE_LETTER_NOT_FOUND_NOTE).toBe(
      'Single-letter name — usually an artifact of minified code.'
    );
    const note = screen.getByText(SINGLE_LETTER_NOT_FOUND_NOTE);
    expect(note.className).toContain('text-status-warn');
    const explanation = document.querySelector('[data-fdt="word-explanation"]');
    expect(explanation?.textContent).toBe(
      "No declaration or assignment of this name was found in the page's scripts."
    );
    // The note reads first, the explanation answers under it.
    expect(note.compareDocumentPosition(explanation as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('carries the note on no other word or answer', () => {
    const inline: ScriptOrigin[] = [{ kind: 'inline' }];
    for (const word of ['$', '_', 'ab']) {
      expect(singleLetterNote(wordRowView(word, inline, 0, false))).toBeNull();
    }
    expect(singleLetterNote(wordRowView(UNDEFINED_REFERENCE_EXTERNAL_ERROR, [], 0, false))).toBe(
      null
    );
    expect(singleLetterNote(wordRowView('a', 'pending', 0, false))).toBeNull();
    expect(singleLetterNote(wordRowView('a', null, 0, false))).toBeNull();
    show('a', 'pending');
    expect(screen.queryByText(/Single-letter name/)).toBeNull();
  });
});

describe('WordDetail — verdicts and bodies', () => {
  it('says "No definition found" in text with the explanation below', () => {
    show('nope', []);
    expect(verdict().textContent).toBe('No definition found');
    expect(verdict().getAttribute('data-fdt-verdict')).toBe('not-found');
    expect(screen.getByText(notFoundExplanation(0))).toBeTruthy();
  });

  it('softens not-found when some scripts could not be read', () => {
    show('nope', [], { unreadable: 2 });
    expect(verdict().textContent).toBe('No definition found in the readable scripts');
    expect(
      screen.getByText(
        "No declaration or assignment of this name was found in the page's readable scripts. 2 scripts could not be read, so a definition may still be in one of them."
      )
    ).toBeTruthy();
    expect(notFoundExplanation(1)).toContain('1 script could not be read');
  });

  it('says when the inline scripts were only partly captured', () => {
    show('nope', [], { inlineCut: true });
    expect(verdict().textContent).toBe('No definition found in the readable scripts');
    expect(
      screen.getByText(
        "No declaration or assignment of this name was found in the page's readable scripts. The inline scripts were only partly captured, so a definition may still be in the part that was cut."
      )
    ).toBeTruthy();
    expect(notFoundExplanation(1, true)).toBe(
      "No declaration or assignment of this name was found in the page's readable scripts. 1 script could not be read and the inline scripts were only partly captured, so a definition may still be in what was not searched."
    );
  });

  it('keeps a found verdict unchanged when scripts were skipped', () => {
    show('x', [{ kind: 'inline' }], { unreadable: 3 });
    expect(verdict().textContent).toBe('In 1 script');
  });

  it('explains the cross-origin sentinel', () => {
    show(UNDEFINED_REFERENCE_EXTERNAL_ERROR, []);
    expect(verdict().textContent).toBe('Details hidden');
    expect(document.querySelector('[data-fdt="word-explanation"]')?.textContent).toBe(
      'The error came from a script loaded from another origin, so the browser hides its details. If the site serves scripts from a CDN, turn the CDN off and reload to read the full error.'
    );
    expect(document.querySelector('[data-fdt="word-definitions"]')).toBeNull();
  });

  it('renders searching and unsearched words as their verdict alone', () => {
    show('alpha', 'pending');
    expect(verdict().textContent).toBe('Searching…');
    expect(document.querySelector('[data-fdt="word-definitions"]')).toBeNull();
    expect(document.querySelector('[data-fdt="word-explanation"]')).toBeNull();
    cleanup();
    show('alpha', null);
    expect(verdict().textContent).toBe('Not searched');
    expect(document.querySelector('[data-fdt="word-explanation"]')).toBeNull();
  });

  it('renders a page-controlled word as inert text', () => {
    const hostile = '<img src=x onerror="window.__pwned=1">';
    show(hostile, [{ kind: 'inline' }]);
    expect(screen.getByRole('list', { name: `Possible definitions of ${hostile}` })).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });
});
