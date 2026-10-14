/**
 * Render tests for the page seam: the frame contract (entrance class,
 * container root, focus target, single `h1`, fill mode), the filtered-empty
 * view (sentence per input, one button per handler), and the external link
 * (new-tab safety, accessible name, unsafe-scheme fallback).
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_HEADING_SELECTOR } from '../palette/focus';
import {
  ExternalLink,
  NO_MATCHES_QUERY_MAX,
  NoMatches,
  PAGE_FILL_SCROLLER,
  PageFrame,
  noMatchesSentence
} from './page-frame';

afterEach(() => {
  cleanup();
});

/** The frame's root section (the only `[data-fdt-page]` in a test render). */
function frameRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>('[data-fdt-page]');
  if (!root) throw new Error('no [data-fdt-page] root rendered');
  return root;
}

describe('PageFrame', () => {
  it('renders the entrance + container root tagged with the route id', () => {
    render(() => <PageFrame id="javascript" title="JavaScript" />);
    const root = frameRoot();
    expect(root.tagName).toBe('SECTION');
    expect(root.dataset.fdtPage).toBe('javascript');
    for (const token of ['fdt-page', '@container', 'flex', 'flex-col', 'gap-3', 'p-3']) {
      expect(root.classList).toContain(token);
    }
    // Natural height unless fill is asked for.
    expect(root.classList).not.toContain('h-full');
  });

  it('renders exactly one h1 — the shell’s route-switch focus target', () => {
    render(() => (
      <PageFrame id="lazyload" title="Lazyload" subtitle="Images the page deferred">
        <h2>Section</h2>
      </PageFrame>
    ));
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    const heading = screen.getByRole('heading', { level: 1, name: 'Lazyload' });
    expect(document.querySelector(ROUTE_HEADING_SELECTOR)).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByText('Images the page deferred')).toBeTruthy();
  });

  it('renders actions in the header and children after it, in order', () => {
    render(() => (
      <PageFrame id="detections" title="Detections" actions={<button type="button">Copy</button>}>
        <p>first</p>
        <p>second</p>
      </PageFrame>
    ));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    const kids = [...frameRoot().children];
    expect(kids[0]?.getAttribute('data-fdt')).toBe('page-header');
    expect(kids.slice(1).map((el) => el.textContent)).toEqual(['first', 'second']);
  });

  it('fill mode makes the frame a full-height column for one flex scroller', () => {
    render(() => (
      <PageFrame id="javascript" title="JavaScript" fill>
        <div class={PAGE_FILL_SCROLLER} />
      </PageFrame>
    ));
    expect(frameRoot().classList).toContain('h-full');
    expect(PAGE_FILL_SCROLLER).toBe('min-h-48 flex-1');
  });
});

describe('noMatchesSentence', () => {
  it('names the chip and the query when both are set', () => {
    expect(noMatchesSentence('Delayed', 'jquery')).toBe('Nothing in "Delayed" matches "jquery".');
  });

  it('names whichever one is set', () => {
    expect(noMatchesSentence('Delayed')).toBe('Nothing matches the "Delayed" filter.');
    expect(noMatchesSentence(undefined, 'jquery')).toBe('Nothing matches "jquery".');
  });

  it('treats blank inputs as unset and trims the rest', () => {
    expect(noMatchesSentence('  ', '\t')).toBe('Nothing matches the current filters.');
    expect(noMatchesSentence()).toBe('Nothing matches the current filters.');
    expect(noMatchesSentence(' Fonts ', ' woff ')).toBe('Nothing in "Fonts" matches "woff".');
  });

  it('elides an over-long query, keeping one at the cap verbatim', () => {
    const atCap = 'a'.repeat(NO_MATCHES_QUERY_MAX);
    expect(noMatchesSentence(undefined, atCap)).toBe(`Nothing matches "${atCap}".`);
    expect(noMatchesSentence(undefined, `${atCap}b`)).toBe(`Nothing matches "${atCap}…".`);
  });
});

describe('NoMatches', () => {
  it('renders the "No matches" title with the sentence and no buttons by default', () => {
    render(() => <NoMatches chipLabel="Inline" />);
    expect(screen.getByText('No matches')).toBeTruthy();
    expect(screen.getByText('Nothing matches the "Inline" filter.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // No empty action slot is left behind.
    expect(document.querySelector('[data-fdt="empty-state"] .mt-2')).toBeNull();
    // Decorative icon stays out of the accessibility tree.
    expect(document.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders one button per handler and wires each to its own handler', () => {
    const clear = vi.fn();
    const showAll = vi.fn();
    render(() => (
      <NoMatches chipLabel="Inline" query="x" onClearSearch={clear} onShowAll={showAll} />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(clear).toHaveBeenCalledTimes(1);
    expect(showAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(showAll).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('renders only the button whose handler is given', () => {
    render(() => <NoMatches query="x" onClearSearch={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
  });

  it('lets an unbroken long query wrap instead of scrolling sideways', () => {
    render(() => <NoMatches query={'x'.repeat(200)} />);
    expect(document.querySelector('[data-fdt="empty-state"]')?.classList).toContain(
      'wrap-anywhere'
    );
  });
});

describe('ExternalLink', () => {
  const url = 'https://example.com/wp-content/a.js?ver=1';

  it('opens http(s) URLs in a new tab without opener or referrer', () => {
    render(() => <ExternalLink href={url} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('names the new tab in the accessible name and keeps the full URL in title', () => {
    render(() => <ExternalLink href={url} />);
    const link = screen.getByRole('link', { name: `${url} (opens in a new tab)` });
    expect(link.getAttribute('title')).toBe(url);
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders mono, truncating, keyboard-focus-ringed text and merges caller classes', () => {
    render(() => <ExternalLink href="http://example.com/" class="text-2xs" />);
    const link = screen.getByRole('link');
    expect(link.classList).toContain('font-mono');
    expect(link.classList).toContain('min-w-0');
    expect(link.classList).toContain('focus-visible:outline-accent');
    expect(link.classList).toContain('text-2xs');
    expect(link.classList).not.toContain('text-xs');
    expect(link.querySelector('.truncate')?.textContent).toBe('http://example.com/');
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<p>x</p>',
    'chrome-extension://abc/page.html',
    '/relative/path.js',
    '//cdn.example.com/a.js',
    'not a url',
    ''
  ])('renders %j as plain text, never a link', (href) => {
    render(() => <ExternalLink href={href} />);
    expect(screen.queryByRole('link')).toBeNull();
    const plain = document.querySelector('[data-fdt="external-link"]');
    expect(plain?.tagName).toBe('SPAN');
    expect(plain?.getAttribute('title')).toBe(href);
    expect(plain?.textContent).toBe(href);
    expect(plain?.querySelector('svg')).toBeNull();
  });
});
