/**
 * The word card's render branches: inline chips vs script links, the
 * verdict as visible text, the sentinel and not-found bodies, the unsearched
 * header-only card, untrusted words and URLs rendered inertly, and the copy
 * action wiring.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScriptOrigin } from '../../../../lib/panel/undefined-refs';
import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../../../../lib/wp-rocket/constants';
import { COPY_LABEL, CROSS_ORIGIN_EXPLANATION, NOT_FOUND_EXPLANATION, WordCard } from './word-card';

afterEach(() => {
  cleanup();
});

const URL_A = 'https://example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1';

/** The rendered verdict span. */
function verdict(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-fdt-verdict]');
  if (!node) throw new Error('no verdict rendered');
  return node;
}

describe('WordCard', () => {
  it('renders a URL definition as a new-tab link named by its file, plus its copy action', () => {
    const onCopy = vi.fn();
    render(() => (
      <WordCard word="jQuery" definitions={[{ kind: 'url', url: URL_A }]} onCopy={onCopy} />
    ));
    expect(screen.getByText('Undefined')).toBeTruthy();
    expect(screen.getByText('jQuery')).toBeTruthy();
    expect(verdict().dataset.fdtVerdict).toBe('found');
    expect(verdict().textContent).toBe('In 1 script');

    const link = screen.getByRole('link', {
      name: 'jquery.min.js?ver=3.7.1 (opens in a new tab)'
    });
    expect(link.getAttribute('href')).toBe(URL_A);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.querySelector('[title]')?.getAttribute('title')).toBe(URL_A);
    expect(screen.getByText('example.com/wp-includes/js/jquery/')).toBeTruthy();

    const list = screen.getByRole('list', { name: 'Possible definitions of jQuery' });
    expect(list.querySelectorAll('li')).toHaveLength(1);

    const copy = screen.getByRole('button', { name: COPY_LABEL });
    // Icon-only below the regular tier: the label stays as the accessible name.
    expect(copy.querySelector('span')?.className).toContain('@max-regular:sr-only');
    fireEvent.click(copy);
    expect(onCopy).toHaveBeenCalledWith(URL_A);
  });

  it('renders an inline definition as a chip — never a link (no pseudo-URL anchor)', () => {
    render(() => <WordCard word="gamma" definitions={[{ kind: 'inline' }]} />);
    expect(screen.getByText('Inline Script')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('[data-fdt-definition="inline"]')).not.toBeNull();
  });

  it('lists mixed definitions in order and pluralizes the verdict', () => {
    const definitions: ScriptOrigin[] = [
      { kind: 'url', url: URL_A },
      { kind: 'inline' },
      { kind: 'url', url: 'https://example.com/b.js' }
    ];
    render(() => <WordCard word="x" definitions={definitions} onCopy={vi.fn()} />);
    expect(verdict().textContent).toBe('In 3 scripts');
    const kinds = [...document.querySelectorAll<HTMLElement>('[data-fdt-definition]')].map(
      (row) => row.dataset.fdtDefinition
    );
    expect(kinds).toEqual(['url', 'inline', 'url']);
    expect(screen.getAllByRole('button', { name: COPY_LABEL })).toHaveLength(2);
  });

  it('renders a non-http(s) URL as plain text (page-derived; never an href)', () => {
    render(() => (
      <WordCard
        word="x"
        definitions={[{ kind: 'url', url: 'javascript:alert(1)' }]}
        onCopy={vi.fn()}
      />
    ));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('javascript:alert(1)')).toBeTruthy();
    expect(document.querySelector('[href]')).toBeNull();
  });

  it('says "No definition found" in text with the explanation below', () => {
    render(() => <WordCard word="nope" definitions={[]} />);
    expect(verdict().textContent).toBe('No definition found');
    expect(screen.getByText(NOT_FOUND_EXPLANATION)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders the cross-origin sentinel as "Script error." with its explanation', () => {
    render(() => <WordCard word={UNDEFINED_REFERENCE_EXTERNAL_ERROR} definitions={[]} />);
    expect(screen.getByText('Script error.')).toBeTruthy();
    expect(screen.queryByText(UNDEFINED_REFERENCE_EXTERNAL_ERROR)).toBeNull();
    expect(verdict().textContent).toBe('Details hidden');
    expect(screen.getByText(CROSS_ORIGIN_EXPLANATION)).toBeTruthy();
    expect(CROSS_ORIGIN_EXPLANATION).toContain('occurred');
    expect(CROSS_ORIGIN_EXPLANATION).not.toContain('ocurred');
  });

  it('renders an unsearched word as its header row alone', () => {
    render(() => <WordCard word="alpha" definitions={null} />);
    expect(verdict().textContent).toBe('Not searched');
    expect(document.querySelector('[data-fdt="card-header"]')).toBeNull();
    expect(document.querySelectorAll('[data-fdt="card"]')).toHaveLength(1);
  });

  it('renders a page-controlled word as inert text', () => {
    const hostile = '<img src=x onerror="window.__pwned=1">';
    render(() => <WordCard word={hostile} definitions={[]} />);
    expect(screen.getByText(hostile)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('copies through the real action when no override is given', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      render(() => <WordCard word="jQuery" definitions={[{ kind: 'url', url: URL_A }]} />);
      fireEvent.click(screen.getByRole('button', { name: COPY_LABEL }));
      await vi.waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(URL_A);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
