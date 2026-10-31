/**
 * The banner as rendered: the page's own lines always visible, the session
 * notes behind one collapsed "N session notes" disclosure holding exactly
 * the banner's notes, and none without notes.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Banner } from './banner-model';
import { BannerView } from './banner';

afterEach(cleanup);

/** A banner with the given lines and session notes. */
const banner = (notes: readonly string[], sessionNotes: readonly string[]): Banner => ({
  tone: 'ok',
  glyph: 'check',
  title: 'Applied',
  body: 'Rendered.',
  notes,
  sessionNotes,
  actions: []
});

/** The session-notes toggle (throws when absent). */
const toggle = (): HTMLElement => screen.getByRole('button', { name: /session notes?$/ });

describe('BannerView', () => {
  it('shows the page’s lines and collapses the session notes, then opens onto exactly them', () => {
    const notes = ['Stays on.', 'Service workers are bypassed.', 'Link prefetching is off.'];
    render(() => <BannerView banner={banner(['CSP blocks eval.'], notes)} onAction={vi.fn()} />);
    expect(screen.getByText('CSP blocks eval.')).toBeTruthy();
    expect(toggle().textContent).toBe('3 session notes');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Stays on.')).toBeNull();

    fireEvent.click(toggle());
    const list = document.getElementById(toggle().getAttribute('aria-controls') ?? '');
    expect([...(list?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual(notes);
    // The page's lines stay outside the disclosure.
    expect(list?.textContent).not.toContain('CSP blocks eval.');
  });

  it('says one session note in the singular', () => {
    render(() => <BannerView banner={banner([], ['Stays on.'])} onAction={vi.fn()} />);
    expect(toggle().textContent).toBe('1 session note');
  });

  it('renders no disclosure and no line list without them', () => {
    render(() => <BannerView banner={banner([], [])} onAction={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('.xo-banner-notes')).toBeNull();
  });

  it('gives each banner its own list id', () => {
    render(() => (
      <>
        <BannerView banner={banner([], ['A.'])} onAction={vi.fn()} />
        <BannerView banner={banner([], ['B.'])} onAction={vi.fn()} />
      </>
    ));
    const toggles = screen.getAllByRole('button', { name: '1 session note' });
    for (const button of toggles) fireEvent.click(button);
    const ids = toggles.map((button) => button.getAttribute('aria-controls'));
    expect(new Set(ids).size).toBe(2);
  });
});
