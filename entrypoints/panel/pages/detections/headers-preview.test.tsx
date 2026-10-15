/**
 * The response-headers preview: the preview model (caching first, labels
 * only when both groups exist, stable keys incl. repeated names, the row
 * cap), the disclosure contract (collapsed by default, `aria-expanded`/
 * `aria-controls`, mount on first open then stay mounted), every header in
 * the page flow (no nested scroller), the capped line, the empty-capture
 * line, and DOM-node survival across a refresh.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { buildHeadersViewModel } from '../../../../lib/panel/headers-view-model';
import { REDACTED } from '../../../../lib/panel/redaction';
import { WITHHELD_LEGEND, WITHHELD_NOTE } from '../withheld-value';
import type { PageHeaders } from '../../../../lib/wp-rocket/types';
import {
  cappedLine,
  GROUP_LABELS,
  HEADERS_FOOTNOTE,
  HeadersPreview,
  NO_HEADERS_LINE,
  PREVIEW_ROW_LIMIT,
  previewModel
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

/** `count` filler headers named `x-fill-<i>`. */
function filler(count: number): PageHeaders {
  return Array.from({ length: count }, (_, index) => ({
    name: `x-fill-${index.toString()}`,
    value: 'v'
  }));
}

describe('previewModel', () => {
  it('orders caching first and labels both groups when both exist', () => {
    const preview = previewModel(buildHeadersViewModel(HEADERS));
    expect(preview.groups.map((group) => [group.key, group.label, group.rows.length])).toEqual([
      ['caching', GROUP_LABELS.caching, 2],
      ['other', GROUP_LABELS.other, 2]
    ]);
    expect(preview).toMatchObject({ shown: 4, total: 4 });
  });

  it('drops empty groups and leaves a lone group unlabelled', () => {
    expect(previewModel(buildHeadersViewModel([{ name: 'Server', value: 'x' }])).groups).toEqual([
      {
        key: 'other',
        label: null,
        rows: [
          {
            key: 'other:server#0',
            header: { name: 'Server', value: 'x', hint: null, redacted: false }
          }
        ]
      }
    ]);
    expect(previewModel(buildHeadersViewModel([]))).toEqual({ groups: [], shown: 0, total: 0 });
  });

  it('keys repeated names by occurrence, case-insensitively', () => {
    const preview = previewModel(
      buildHeadersViewModel([
        { name: 'Vary', value: 'a' },
        { name: 'vary', value: 'b' }
      ])
    );
    expect(preview.groups[0]?.rows.map((row) => row.key)).toEqual(['other:vary#0', 'other:vary#1']);
  });

  it('caps the rows, caching rows first, and counts the rest', () => {
    const preview = previewModel(
      buildHeadersViewModel([...filler(5), { name: 'Cache-Control', value: 'no-cache' }]),
      3
    );
    expect(preview.shown).toBe(3);
    expect(preview.total).toBe(6);
    expect(preview.groups[0]?.key).toBe('caching');
    expect(preview.groups.flatMap((group) => group.rows.map((row) => row.header.name))).toEqual([
      'Cache-Control',
      'x-fill-0',
      'x-fill-1'
    ]);
    expect(previewModel(buildHeadersViewModel(filler(2)), -1).shown).toBe(0);
  });
});

describe('HeadersPreview', () => {
  it('starts collapsed with the count, and no body in the DOM', () => {
    render(() => <HeadersPreview headers={HEADERS} />);
    expect(screen.getByRole('heading', { level: 2 }).contains(toggle())).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().hasAttribute('aria-controls')).toBe(false);
    expect(toggle().textContent).toBe('Response headers (4 captured)');
    expect(document.querySelector('[data-fdt="headers-preview-body"]')).toBeNull();
  });

  it('mounts the body on first open, renders every header in flow, then keeps it mounted', () => {
    render(() => <HeadersPreview headers={HEADERS} />);
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const body = document.querySelector<HTMLElement>('[data-fdt="headers-preview-body"]');
    expect(body).not.toBeNull();
    expect(toggle().getAttribute('aria-controls')).toBe(body?.id);
    expect(body?.hidden).toBe(false);
    // Expand/collapse is instant: no transition on the body.
    expect(body?.className).not.toMatch(/transition|starting:/);
    // In the page flow: no capped, separately scrolling region.
    expect(body?.querySelector('[class*="overflow-y-auto"], [class*="max-h-"]')).toBeNull();

    const terms = [...document.querySelectorAll('[data-fdt-key-value-term]')].map(
      (term) => term.textContent
    );
    expect(terms).toEqual(['Cache-Control', 'age', 'Server', 'X-Flag']);
    expect(body?.textContent).toContain('—'); // the value-less row
    expect(body?.textContent).toContain('Instructs receivers not to cache anything');
    expect(body?.textContent).toContain('42 seconds ago');
    expect(body?.textContent).toContain(HEADERS_FOOTNOTE);
    expect(document.querySelector('[data-fdt="headers-preview-capped"]')).toBeNull();

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    const kept = document.querySelector<HTMLElement>('[data-fdt="headers-preview-body"]');
    expect(kept).toBe(body);
    expect(kept?.hidden).toBe(true);
  });

  it('labels each group list for assistive tech (a lone group as "Headers")', () => {
    render(() => <HeadersPreview headers={HEADERS} />);
    fireEvent.click(toggle());
    expect(screen.getByRole('list', { name: GROUP_LABELS.caching })).toBeTruthy();
    expect(screen.getByRole('list', { name: GROUP_LABELS.other })).toBeTruthy();
    cleanup();
    render(() => <HeadersPreview headers={[{ name: 'Server', value: 'x' }]} />);
    fireEvent.click(toggle());
    expect(screen.getByRole('list', { name: 'Headers' })).toBeTruthy();
  });

  it('caps a large capture and says where the rest is', () => {
    const many = filler(PREVIEW_ROW_LIMIT + 20);
    render(() => <HeadersPreview headers={many} />);
    fireEvent.click(toggle());
    expect(document.querySelectorAll('[data-fdt-key-value-term]')).toHaveLength(PREVIEW_ROW_LIMIT);
    expect(document.querySelector('[data-fdt="headers-preview-capped"]')?.textContent).toBe(
      cappedLine(PREVIEW_ROW_LIMIT, PREVIEW_ROW_LIMIT + 20)
    );
    expect(cappedLine(100, 120)).toBe(
      'Showing the first 100 of 120 headers — Copy report includes all of them.'
    );
  });

  it('keeps row DOM nodes across a refresh with the same headers', () => {
    const [headers, setHeaders] = createSignal<PageHeaders>(HEADERS);
    render(() => <HeadersPreview headers={headers()} />);
    fireEvent.click(toggle());
    const before = document.querySelector('[data-fdt-key-value-term]')?.closest('li');
    setHeaders(HEADERS.map((row) => ({ ...row })));
    expect(document.querySelector('[data-fdt-key-value-term]')?.closest('li')).toBe(before);
    setHeaders([...HEADERS.map((row) => ({ ...row })), { name: 'Via', value: 'proxy' }]);
    expect(document.querySelector('[data-fdt-key-value-term]')?.closest('li')).toBe(before);
    expect(document.querySelectorAll('[data-fdt-key-value-term]')).toHaveLength(5);
  });

  it('renders the one-line empty state for an empty capture (no disclosure)', () => {
    render(() => <HeadersPreview headers={[]} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Response headers' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(NO_HEADERS_LINE)).toBeTruthy();
  });
});

describe('HeadersPreview — secrets', () => {
  it('withholds secret values exactly as the Headers & Cookies page does', () => {
    render(() => (
      <HeadersPreview
        headers={[
          { name: 'Set-Cookie', value: 'sid=COOKIESECRET; Path=/; HttpOnly' },
          { name: 'Set-Cookie', value: 'NAMELESSSECRET' },
          { name: 'Authorization', value: 'Bearer AUTHSECRET' },
          { name: 'location', value: '/next?token=LOCSECRET' },
          { name: 'Server', value: 'nginx' }
        ]}
      />
    ));
    fireEvent.click(toggle());
    const html = document.body.innerHTML;
    for (const leak of ['COOKIESECRET', 'NAMELESSSECRET', 'AUTHSECRET', 'LOCSECRET', 'HttpOnly']) {
      expect(html).not.toContain(leak);
    }
    const markers = [...document.querySelectorAll('[data-fdt-redacted]')];
    expect(markers.map((marker) => marker.getAttribute('title'))).toEqual([
      WITHHELD_NOTE,
      WITHHELD_NOTE,
      WITHHELD_NOTE
    ]);
    expect(markers.map((marker) => marker.textContent.replace(` — ${WITHHELD_NOTE}`, ''))).toEqual([
      `sid=${REDACTED}`,
      REDACTED,
      REDACTED
    ]);
    expect(document.body.textContent).toContain('/next?token=[redacted]');
    expect(document.body.textContent).toContain('nginx');
    expect(document.querySelectorAll('[data-fdt="withheld-legend"]')).toHaveLength(1);
    expect(document.body.textContent).toContain(WITHHELD_LEGEND);
  });

  it('shows no withheld legend when nothing is withheld', () => {
    render(() => <HeadersPreview headers={HEADERS} />);
    fireEvent.click(toggle());
    expect(document.querySelector('[data-fdt="withheld-legend"]')).toBeNull();
  });
});

describe('HeadersPreview — the truncation note', () => {
  it('shows a muted note for a marked capture, and none otherwise', () => {
    const headers: PageHeaders = [...filler(255), { name: 'csp', value: 'x'.repeat(4096) }];
    render(() => <HeadersPreview headers={headers} truncated />);
    fireEvent.click(toggle());
    const note = document.querySelector('[data-fdt="headers-preview-truncated"]');
    expect(note?.textContent).toBe(
      'Some header values were clipped to 4,096 characters; the list was capped at 256 headers.'
    );
    expect(note?.className).toContain('text-fg-muted');
    cleanup();

    render(() => <HeadersPreview headers={headers} />);
    fireEvent.click(toggle());
    expect(document.querySelector('[data-fdt="headers-preview-truncated"]')).toBeNull();
  });
});
