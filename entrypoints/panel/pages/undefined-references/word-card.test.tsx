/**
 * The word card's render branches: inline chips vs script links (file
 * name, muted query, location, the page's own host dropped), accessible
 * names that tell rows apart, the copy action with its in-place
 * confirmation, the five-row cap with its disclosure, the verdict as visible
 * text, the single-letter note, the sentinel / not-found / header-only
 * cards, and untrusted words and URLs rendered inertly. User-facing copy is
 * pinned literally.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { COPIED_FLASH_MS } from '../../../../components/ui/copy-button';
import { toastItems } from '../../../../components/ui/toast-store';
import type { ScriptOrigin } from '../../../../lib/panel/undefined-refs';
import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../../../../lib/wp-rocket/constants';
import { WordCard, copyExclusionName } from './word-card';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const PAGE = 'https://example.com';
const URL_A = 'https://example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1';
const URL_CDN = 'https://cdn.example.net/wp-includes/js/jquery/jquery.min.js?ver=3.7.1';

/**
 * A clipboard double recorded through the default navigator seam (the card's
 * copy routes through the shared button's own clipboard resolution).
 */
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

/** The rendered verdict span. */
function verdict(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-fdt-verdict]');
  if (!node) throw new Error('no verdict rendered');
  return node;
}

describe('WordCard — script rows', () => {
  it('names the link by file + location, drops the page host, copies the path', async () => {
    const clipboard = writer('resolve');
    render(() => (
      <WordCard word="jQuery" answer={[{ kind: 'url', url: URL_A }]} pageOrigin={PAGE} />
    ));
    expect(screen.getByText('Undefined')).toBeTruthy();
    expect(verdict().textContent).toBe('In 1 script');
    // happy-dom's name computation pads inline spans with spaces, so the
    // exact name is pinned through the text (Chromium's name, verified in the
    // browser, has no padding).
    const link = screen.getByRole('link', { name: /jquery\.min\.js/ });
    expect(link.textContent).toBe(
      'jquery.min.js?ver=3.7.1, wp-includes/js/jquery/ (opens in a new tab)'
    );
    expect(link.getAttribute('href')).toBe(URL_A);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.querySelector('[title]')?.getAttribute('title')).toBe(URL_A);
    expect(document.querySelector('[data-fdt="script-location"]')?.textContent).toBe(
      'wp-includes/js/jquery/'
    );
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: jquery.min.js' });
    fireEvent.click(copy);
    await vi.waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith('/wp-includes/js/jquery/jquery.min.js');
    });
  });

  it('keeps the host for another origin, so the same file from two hosts reads apart', async () => {
    const clipboard = writer('resolve');
    render(() => (
      <WordCard
        word="jQuery"
        answer={[
          { kind: 'url', url: URL_A },
          { kind: 'url', url: URL_CDN }
        ]}
        pageOrigin={PAGE}
      />
    ));
    const names = screen.getAllByRole('link').map((link) => link.textContent);
    expect(names).toEqual([
      'jquery.min.js?ver=3.7.1, wp-includes/js/jquery/ (opens in a new tab)',
      'jquery.min.js?ver=3.7.1, wp-includes/js/jquery/ · cdn.example.net (opens in a new tab)'
    ]);
    expect(new Set(names).size).toBe(2);
    // The copy controls read apart too: a foreign host is named.
    expect(
      screen
        .getAllByRole('button', { name: /^Copy as exclusion/ })
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual([
      'Copy as exclusion: jquery.min.js',
      'Copy as exclusion: jquery.min.js (cdn.example.net)'
    ]);
    expect(
      [...document.querySelectorAll('[data-fdt="script-location"]')].map((node) => node.textContent)
    ).toEqual(['wp-includes/js/jquery/', 'wp-includes/js/jquery/ · cdn.example.net']);
    // Only the clicked row's pattern reaches the clipboard (the CDN host included).
    const rows = screen.getAllByRole('button', { name: /^Copy as exclusion/ });
    const secondRow = rows[1];
    if (secondRow === undefined) throw new Error('two copy rows expected');
    fireEvent.click(secondRow);
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
    render(() => (
      <WordCard word="jQuery" answer={[{ kind: 'url', url: URL_A }]} pageOrigin={PAGE} />
    ));
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: jquery.min.js' });
    expect(copy.textContent).toBe('Copy as exclusion');
    // The full intent rides the hover hint (not the accessible name).
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
    render(() => (
      <WordCard word="jQuery" answer={[{ kind: 'url', url: URL_A }]} pageOrigin={PAGE} />
    ));
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: jquery.min.js' });
    fireEvent.click(copy);
    expect(copy.getAttribute('aria-busy')).toBe('true');
    // The card routes through the shared control's pending guard: the repeat
    // click must not issue its own write (one report per intent).
    fireEvent.click(copy);
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    resolveWrite();
    await vi.waitFor(() => {
      expect(copy.hasAttribute('aria-busy')).toBe(false);
    });
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    // The single confirmed copy lands its feedback exactly once.
    expect(copy.hasAttribute('data-fdt-copied')).toBe(true);
  });

  it('does not flash on a failed copy; the toast error names the pattern', async () => {
    const clipboard = writer('reject');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(() => (
      <WordCard word="jQuery" answer={[{ kind: 'url', url: URL_A }]} pageOrigin={PAGE} />
    ));
    const copy = screen.getByRole('button', { name: 'Copy as exclusion: jquery.min.js' });
    fireEvent.click(copy);
    await vi.waitFor(() => {
      expect(toastItems().some((item) => item.tone === 'error')).toBe(true);
    });
    expect(copy.hasAttribute('data-fdt-copied')).toBe(false);
    expect(copy.textContent).toBe('Copy as exclusion');
    // The toast error landed (the answer to what went wrong); usable again.
    fireEvent.click(copy);
    await vi.waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledTimes(2);
    });
    warn.mockRestore();
  });

  it('copies through the shared action with no injection (the default clipboard)', async () => {
    const clipboard = writer('resolve');
    render(() => (
      <WordCard word="jQuery" answer={[{ kind: 'url', url: URL_A }]} pageOrigin={PAGE} />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy as exclusion: jquery.min.js' }));
    await vi.waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith('/wp-includes/js/jquery/jquery.min.js');
    });
  });

  it('renders a non-http(s) URL as plain text with no copy action', () => {
    render(() => (
      <WordCard word="x" answer={[{ kind: 'url', url: 'javascript:alert(1)' }]} pageOrigin={PAGE} />
    ));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('javascript:alert(1)')).toBeTruthy();
    expect(document.querySelector('[href]')).toBeNull();
  });

  it('names the copy control with the visible label first (label in name)', () => {
    expect(copyExclusionName('a.js', null)).toBe('Copy as exclusion: a.js');
    expect(copyExclusionName('a.js', 'cdn.example.com')).toBe(
      'Copy as exclusion: a.js (cdn.example.com)'
    );
  });
});

describe('WordCard — definition list', () => {
  it('renders an inline definition as a chip — never a link', () => {
    render(() => <WordCard word="gamma" answer={[{ kind: 'inline' }]} pageOrigin={PAGE} />);
    expect(screen.getByText('Inline Script')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('caps the rows at five behind a "Show all N" disclosure that keeps focus', () => {
    const definitions: ScriptOrigin[] = Array.from({ length: 7 }, (_, i) => ({
      kind: 'url',
      url: `https://example.com/js/file-${String(i)}.js`
    }));
    render(() => <WordCard word="$" answer={definitions} pageOrigin={PAGE} />);
    expect(verdict().textContent).toBe('In 7 scripts');
    const list = screen.getByRole('list', { name: 'Possible definitions of $' });
    expect(list.querySelectorAll('li')).toHaveLength(5);
    const toggle = screen.getByRole('button', { name: 'Show all 7' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(list.id);
    toggle.focus();
    fireEvent.click(toggle);
    expect(list.querySelectorAll('li')).toHaveLength(7);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Show fewer');
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    expect(list.querySelectorAll('li')).toHaveLength(5);
  });

  it('shows no toggle at five rows or fewer', () => {
    const definitions: ScriptOrigin[] = Array.from({ length: 5 }, (_, i) => ({
      kind: 'url',
      url: `https://example.com/js/f${String(i)}.js`
    }));
    render(() => <WordCard word="x" answer={definitions} pageOrigin={PAGE} />);
    expect(document.querySelector('[data-fdt="definitions-toggle"]')).toBeNull();
  });
});

describe('WordCard — single-letter note', () => {
  it('opens a found card with the warn-styled note qualifying its matches', () => {
    render(() => <WordCard word="a" answer={[{ kind: 'inline' }]} pageOrigin={PAGE} />);
    const noteEl = screen.getByText(
      'Single-letter name — usually an artifact of minified code; the matches below are likely coincidental.'
    );
    expect(noteEl.className).toContain('text-status-warn');
    // The warning reads apart from color alone: the vocabulary's icon leads it.
    expect(noteEl.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('Inline Script')).toBeTruthy();
  });

  it('opens a not-found card with the warn-styled note above the explanation', () => {
    render(() => <WordCard word="a" answer={[]} pageOrigin={PAGE} />);
    const noteEl = screen.getByText('Single-letter name — usually an artifact of minified code.');
    expect(noteEl.className).toContain('text-status-warn');
    expect(
      screen.getByText("No declaration or assignment of this name was found in the page's scripts.")
    ).toBeTruthy();
    // The note is the body's first content, the explanation answers under it.
    const body = document.querySelector('[data-fdt="card-body"]');
    const paragraphs = body?.querySelectorAll('p');
    expect(paragraphs?.length).toBe(2);
    expect(paragraphs?.[0]?.textContent).toContain('Single-letter name');
  });

  it('carries the note on no other word or body', () => {
    for (const word of ['$', '_', 'ab']) {
      const { unmount } = render(() => (
        <WordCard word={word} answer={[{ kind: 'inline' }]} pageOrigin={PAGE} />
      ));
      expect(screen.queryByText(/Single-letter name/)).toBeNull();
      unmount();
    }
    // The sentinel's body is its own explanation, and a header-only
    // single-letter card has no body for the note to ride.
    render(() => (
      <WordCard word={UNDEFINED_REFERENCE_EXTERNAL_ERROR} answer={[]} pageOrigin={PAGE} />
    ));
    expect(screen.queryByText(/Single-letter name/)).toBeNull();
    cleanup();
    render(() => <WordCard word="a" answer="pending" pageOrigin={PAGE} />);
    expect(screen.queryByText(/Single-letter name/)).toBeNull();
  });
});

describe('WordCard — verdicts and bodies', () => {
  it('says "No definition found" in text with the explanation below', () => {
    render(() => <WordCard word="nope" answer={[]} pageOrigin={PAGE} />);
    expect(verdict().textContent).toBe('No definition found');
    expect(
      screen.getByText("No declaration or assignment of this name was found in the page's scripts.")
    ).toBeTruthy();
  });

  it('softens not-found when some scripts could not be read', () => {
    const { unmount } = render(() => (
      <WordCard word="nope" answer={[]} pageOrigin={PAGE} unreadable={2} />
    ));
    expect(verdict().textContent).toBe('No definition found in the readable scripts');
    expect(
      screen.getByText(
        "No declaration or assignment of this name was found in the page's readable scripts. 2 scripts could not be read, so a definition may still be in one of them."
      )
    ).toBeTruthy();
    unmount();
    render(() => <WordCard word="nope" answer={[]} pageOrigin={PAGE} unreadable={1} />);
    expect(screen.getByText(/1 script could not be read/)).toBeTruthy();
  });

  it('says when the inline scripts were only partly captured', () => {
    const { unmount } = render(() => (
      <WordCard word="nope" answer={[]} pageOrigin={PAGE} inlineCut={true} />
    ));
    expect(verdict().textContent).toBe('No definition found in the readable scripts');
    expect(
      screen.getByText(
        "No declaration or assignment of this name was found in the page's readable scripts. The inline scripts were only partly captured, so a definition may still be in the part that was cut."
      )
    ).toBeTruthy();
    unmount();
    render(() => (
      <WordCard word="nope" answer={[]} pageOrigin={PAGE} unreadable={1} inlineCut={true} />
    ));
    expect(
      screen.getByText(
        "No declaration or assignment of this name was found in the page's readable scripts. 1 script could not be read and the inline scripts were only partly captured, so a definition may still be in what was not searched."
      )
    ).toBeTruthy();
  });

  it('keeps a found verdict unchanged when scripts were skipped', () => {
    render(() => (
      <WordCard word="x" answer={[{ kind: 'inline' }]} pageOrigin={PAGE} unreadable={3} />
    ));
    expect(verdict().textContent).toBe('In 1 script');
  });

  it('renders the cross-origin sentinel with a neutral badge and its explanation', () => {
    render(() => (
      <WordCard word={UNDEFINED_REFERENCE_EXTERNAL_ERROR} answer={[]} pageOrigin={PAGE} />
    ));
    expect(screen.getByText('Script error.')).toBeTruthy();
    expect(screen.queryByText(UNDEFINED_REFERENCE_EXTERNAL_ERROR)).toBeNull();
    expect(screen.queryByText('Undefined')).toBeNull();
    const badge = screen.getByText('Cross-origin');
    expect(badge.className).toContain('text-status-neutral');
    expect(verdict().textContent).toBe('Details hidden');
    expect(
      screen.getByText(
        'Since the error occurred in a file loaded from an external server, the browser limited the information that can be read from it. Make sure to disable CDNs if there are any.'
      )
    ).toBeTruthy();
  });

  it('renders searching and unsearched words as their heading row alone', () => {
    const { unmount } = render(() => <WordCard word="alpha" answer="pending" pageOrigin={PAGE} />);
    expect(verdict().textContent).toBe('Searching…');
    expect(document.querySelector('[data-fdt="card-header"]')).toBeNull();
    unmount();
    render(() => <WordCard word="alpha" answer={null} pageOrigin={PAGE} />);
    expect(verdict().textContent).toBe('Not searched');
    expect(document.querySelector('[data-fdt="card-header"]')).toBeNull();
    expect(document.querySelectorAll('[data-fdt="card"]')).toHaveLength(1);
  });

  it('renders a page-controlled word as inert text', () => {
    const hostile = '<img src=x onerror="window.__pwned=1">';
    render(() => <WordCard word={hostile} answer={[]} pageOrigin={PAGE} />);
    expect(screen.getByText(hostile)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });
});
