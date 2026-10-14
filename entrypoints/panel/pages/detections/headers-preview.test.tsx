/**
 * The response-headers preview: grouping (caching first, labels only when
 * both groups exist), the disclosure contract (collapsed by default,
 * `aria-expanded`/`aria-controls`, mount on first open then stay mounted),
 * every captured header rendered with its hint, and the empty-capture line.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { buildHeadersViewModel } from '../../../../lib/panel/headers-view-model';
import type { PageHeaders } from '../../../../lib/wp-rocket/types';
import {
  GROUP_LABELS,
  HEADERS_FOOTNOTE,
  HeadersPreview,
  NO_HEADERS_LINE,
  previewGroups
} from './headers-preview';

afterEach(() => {
  cleanup();
});

const HEADERS: PageHeaders = [
  { name: 'Server', value: 'nginx' },
  { name: 'Cache-Control', value: 'no-store' },
  { name: 'X-Flag' },
  { name: 'age', value: '42' }
];

/** The disclosure trigger. */
function toggle(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Response headers/ });
}

describe('previewGroups', () => {
  it('orders caching first and labels both groups when both exist', () => {
    const groups = previewGroups(buildHeadersViewModel(HEADERS));
    expect(groups.map((group) => [group.key, group.label, group.rows.length])).toEqual([
      ['caching', GROUP_LABELS.caching, 2],
      ['other', GROUP_LABELS.other, 2]
    ]);
  });

  it('drops empty groups and leaves a lone group unlabelled', () => {
    expect(previewGroups(buildHeadersViewModel([{ name: 'Server', value: 'x' }]))).toEqual([
      { key: 'other', label: null, rows: [{ name: 'Server', value: 'x', hint: null }] }
    ]);
    expect(previewGroups(buildHeadersViewModel([]))).toEqual([]);
  });
});

describe('HeadersPreview', () => {
  it('starts collapsed with the count, and no body in the DOM', () => {
    render(() => <HeadersPreview headers={HEADERS} />);
    expect(screen.getByRole('heading', { level: 2 }).contains(toggle())).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().hasAttribute('aria-controls')).toBe(false);
    expect(toggle().textContent).toContain('4');
    expect(toggle().textContent).toContain('captured');
    expect(document.querySelector('[data-fdt="headers-preview-body"]')).toBeNull();
  });

  it('mounts the body on first open, renders every header, then keeps it mounted', () => {
    render(() => <HeadersPreview headers={HEADERS} />);
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const body = document.querySelector<HTMLElement>('[data-fdt="headers-preview-body"]');
    expect(body).not.toBeNull();
    expect(toggle().getAttribute('aria-controls')).toBe(body?.id);
    expect(body?.hidden).toBe(false);

    const terms = [...document.querySelectorAll('[data-fdt-key-value-term]')].map(
      (term) => term.textContent
    );
    expect(terms).toEqual(['Cache-Control', 'age', 'Server', 'X-Flag']);
    expect(body?.textContent).toContain('—'); // the value-less row
    expect(body?.textContent).toContain('Instructs receivers not to cache anything');
    expect(body?.textContent).toContain('42 seconds ago');
    expect(body?.textContent).toContain(HEADERS_FOOTNOTE);
    expect(screen.getByRole('region', { name: 'Captured response headers' }).tabIndex).toBe(0);

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    const kept = document.querySelector<HTMLElement>('[data-fdt="headers-preview-body"]');
    expect(kept).toBe(body);
    expect(kept?.hidden).toBe(true);
  });

  it('labels each group list for assistive tech', () => {
    render(() => <HeadersPreview headers={HEADERS} />);
    fireEvent.click(toggle());
    expect(screen.getByRole('list', { name: GROUP_LABELS.caching })).toBeTruthy();
    expect(screen.getByRole('list', { name: GROUP_LABELS.other })).toBeTruthy();
  });

  it('renders the one-line empty state for an empty capture (no disclosure)', () => {
    render(() => <HeadersPreview headers={[]} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Response headers' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(NO_HEADERS_LINE)).toBeTruthy();
  });
});
