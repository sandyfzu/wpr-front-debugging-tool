/**
 * The Preloaded Resources page on the calm list: summary ("WP Rocket
 * hints" state, total, notes), rows (icon by type, name, kind + URL
 * preview, attribution chip) in inventory order (WP Rocket first), facets
 * and search, the detail (attribution and why, the URL's tile — none for a
 * srcset-only preload —, rel/as/stamp facts, copy), refreshes keeping the
 * selection by content key, and the two distinct empty states.
 */
import { cleanup, fireEvent, screen, within } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DNS_PREFETCH_LIMIT } from '../../../../lib/detection/hud';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import type { FdtData, PreloadedResources } from '../../../../lib/wp-rocket/types';
import { makeFdtData } from '../../state/fixtures';
import { SEARCH_DEBOUNCE_MS } from '../../state/search';
import type { OpenResource } from '../open-resource';
import {
  installFakeResizeObserver,
  type FakeResizeObservers
} from '../resource-list/fake-resize-observer';
import { renderPage, type PageHarness } from '../resource-list/page-harness';
import { PreloadedResourcesPage, type PreloadedResourcesPageProps } from './page';
import { NO_URL_NOTE, SRCSET_ONLY_NOTE } from './preloaded-view';

/** A payload carrying the given report (Optimize Critical Images detected unless told). */
function withReport(preloadedResources: PreloadedResources, oci = true): FdtData {
  const data = makeFdtData({ preloadedResources });
  data.wprDetections.rocket_above_the_fold_optimization.present = oci;
  return data;
}

/**
 * The standard fixture, capture order: a plain DNS hint, stamped image
 * preloads (one srcset-only), a plain image preload, a stamped font preload,
 * a plain module preload, a stamped preconnect.
 */
function fixture(): FdtData {
  return withReport({
    present: true,
    resources: [],
    hints: [
      { rel: 'dns-prefetch', href: 'https://dns.example/', as: '' },
      { rel: 'preload', href: 'https://cdn.example/wp/hero.webp', as: 'image', mark: 'preload' },
      { rel: 'preload', href: 'https://cdn.example/wp/logo.png', as: 'image' },
      { rel: 'preload', href: 'https://cdn.example/wp/inter.woff2', as: 'font', mark: 'preload' },
      { rel: 'modulepreload', href: 'https://cdn.example/wp/app.js', as: '' },
      { rel: 'preconnect', href: 'https://fonts.example/', as: '', mark: 'preconnect' },
      { rel: 'preload', href: '', as: 'image', mark: 'preload' }
    ]
  });
}

let observers: FakeResizeObservers;

beforeEach(() => {
  vi.useFakeTimers();
  observers = installFakeResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Render the page at a list width (pane from 830).
 *
 * @param data The payload.
 * @param seams The page seams.
 */
function mount(data: FdtData = fixture(), seams: PreloadedResourcesPageProps = {}): PageHarness {
  const harness = renderPage(
    (props): JSX.Element => <PreloadedResourcesPage {...props} openResource={null} {...seams} />,
    data
  );
  observers.resize(1000);
  return harness;
}

/** Every rendered row. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-fdt="hint-row"]')];
}

/**
 * A field's text in a row.
 *
 * @param row The row.
 * @param hook The field's hook.
 */
function field(row: HTMLElement | undefined, hook: string): string | undefined {
  return row?.querySelector(`[data-fdt="${hook}"]`)?.textContent ?? undefined;
}

/** The rendered rows' names, in order. */
function names(): string[] {
  return rows().map((row) => field(row, 'list-row-name') ?? '');
}

/** Each row's preview and attribution chip text, in order. */
function rowWords(): string[][] {
  return rows().map((row) => [
    field(row, 'list-row-preview') ?? '',
    field(row, 'hint-attribution') ?? ''
  ]);
}

/** Open the row at a position. */
function openAt(index: number): void {
  const button = rows()[index]?.querySelector<HTMLButtonElement>('[data-fdt-row-open]');
  if (button === null || button === undefined) throw new Error(`no row ${String(index)}`);
  fireEvent.click(button);
}

/** The side pane (throws when closed). */
function pane(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-fdt="detail-pane"]');
  if (found === null) throw new Error('no detail pane');
  return found;
}

/** A facet segment's radio. */
function segment(value: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    `[data-fdt="facet-bar"] [data-fdt-choice-value="${value}"] input`
  );
  if (input === null) throw new Error(`no segment ${value}`);
  return input;
}

/** Every facet value's count, keyed `facet:value`. */
function counts(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const group of document.querySelectorAll('[data-fdt="facet-bar"] [role="radiogroup"]')) {
    const labelId = group.getAttribute('aria-labelledby') ?? '';
    const facet = document.getElementById(labelId)?.textContent ?? '';
    for (const choice of group.querySelectorAll<HTMLElement>('[data-fdt-choice-value]')) {
      result[`${facet}:${choice.dataset['fdtChoiceValue'] ?? ''}`] =
        choice.querySelector('[data-fdt-choice-count]')?.textContent ?? '';
    }
  }
  return result;
}

describe('PreloadedResourcesPage — summary and rows', () => {
  it('renders the frame, the "WP Rocket hints" state and the hint total', () => {
    const { root } = mount();
    expect(root.getAttribute('data-fdt-page')).toBe('preloaded-resources');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Preloaded Resources');
    const summary = root.querySelector('[data-fdt="resource-summary"]');
    expect(summary?.textContent).toContain('WP Rocket hints');
    expect(summary?.querySelector('[data-fdt="status-badge"]')?.textContent).toBe('Detected');
    expect(root.querySelector('[data-fdt="resource-total"]')?.textContent).toBe('7 hints');
    expect(root.querySelectorAll('[data-fdt="resource-note"]')).toHaveLength(0);
    expect(document.querySelector('[data-fdt="list-head"]')?.textContent).toBe('HintSource');
    // The attribution chip is no state with a source: no legend.
    expect(root.querySelector('[data-fdt="state-source-legend"]')).toBeNull();
  });

  it('keeps WP Rocket hints apart, first, grouped by kind; names features only on proof', () => {
    mount();
    expect(names()).toEqual([
      'hero.webp',
      'No URL (srcset only)',
      'inter.woff2',
      'fonts.example',
      'logo.png',
      'app.js',
      'dns.example'
    ]);
    expect(rowWords()).toEqual([
      ['preload · image · cdn.example/wp/hero.webp', 'WP Rocket (Optimize Critical Images)'],
      ['preload · image', 'WP Rocket (Optimize Critical Images)'],
      // Preload fonts is not detected: the shared stamp names WP Rocket only.
      ['preload · font · cdn.example/wp/inter.woff2', 'WP Rocket'],
      ['preconnect · fonts.example/', 'WP Rocket (Preconnect to External Domains)'],
      ['preload · image · cdn.example/wp/logo.png', 'Unattributed'],
      ['modulepreload · cdn.example/wp/app.js', 'Unattributed'],
      ['dns-prefetch · dns.example/', 'Unattributed']
    ]);
    // The chip's hover names the stamp and why.
    expect(
      rows()[0]?.querySelector('[data-fdt="hint-attribution"] [title]')?.getAttribute('title')
    ).toBe('data-rocket-preload: written by Optimize Critical Images, detected on this page.');
  });

  it('leads each row with an icon by what it fetches', () => {
    mount();
    const icons = rows().map(
      (row) =>
        [...(row.querySelector('[data-fdt="list-row-icon"] svg')?.classList ?? [])].find(
          (name) => name.startsWith('lucide-') && name !== 'lucide-icon'
        ) ?? ''
    );
    expect(icons).toEqual([
      'lucide-image',
      'lucide-image',
      'lucide-type',
      'lucide-globe',
      'lucide-image',
      'lucide-file-code',
      'lucide-globe'
    ]);
  });

  it('names no feature on an image preload without the critical-images row', () => {
    const data = fixture();
    data.wprDetections.rocket_above_the_fold_optimization.present = false;
    mount(data);
    expect(rowWords()[0]).toEqual(['preload · image · cdn.example/wp/hero.webp', 'WP Rocket']);
    expect(rows()[0]?.querySelector('[data-fdt="hint-attribution-mark"]')).toBeNull();
  });

  it('shows plain hints alone without any WP Rocket wording', () => {
    const { root } = mount(
      withReport({
        present: false,
        hints: [{ rel: 'modulepreload', href: 'https://site.example/m.js', as: '' }]
      })
    );
    expect(
      root.querySelector('[data-fdt="resource-summary"] [data-fdt="status-badge"]')?.textContent
    ).toBe('Not detected');
    expect(rowWords()).toEqual([['modulepreload · site.example/m.js', 'Unattributed']]);
  });

  it('flags a clipped URL on a marked list', () => {
    const href = `https://cdn.example/${'a'.repeat(PAYLOAD_LIMITS.preloaded.href)}`;
    mount(
      withReport({
        present: false,
        hints: [{ rel: 'preload', href, as: 'image' }],
        hintsTruncated: true
      })
    );
    expect(within(rows()[0] as HTMLElement).getByText('Clipped')).toBeTruthy();
  });

  it('notes the DNS prefetch limit when the row is declared beside plain DNS hints', () => {
    const data = fixture();
    data.wprDetections.dns_prefetch.present = true;
    const { root } = mount(data);
    expect(
      [...root.querySelectorAll('[data-fdt="resource-note"]')].map((note) => note.textContent)
    ).toEqual([DNS_PREFETCH_LIMIT]);
  });

  it('reads a capture without the inventory as its WP Rocket preloads, and says so', () => {
    const { root } = mount(
      withReport({ present: true, resources: [{ href: 'https://a.example/x.png', type: 'IMAGE' }] })
    );
    expect(rowWords()).toEqual([
      ['preload · image · a.example/x.png', 'WP Rocket (Optimize Critical Images)']
    ]);
    expect(root.querySelector('[data-fdt="resource-note"]')?.textContent).toBe(
      "This capture lists WP Rocket's preloads only. Reload the inspected page to list every resource hint."
    );
  });
});

describe('PreloadedResourcesPage — facets and search', () => {
  it('counts every facet value', () => {
    mount();
    expect(counts()).toEqual({
      'Source:any': '7',
      'Source:wp-rocket': '4',
      'Source:unattributed': '3',
      'Hint:any': '7',
      'Hint:preload': '4',
      'Hint:modulepreload': '1',
      'Hint:preconnect': '1',
      'Hint:dns-prefetch': '1',
      'Preload type:any': '7',
      'Preload type:images': '3',
      'Preload type:fonts': '1'
    });
  });

  it('combines attribution and type, then searches by URL', () => {
    mount();
    fireEvent.click(segment('unattributed'));
    expect(names()).toEqual(['logo.png', 'app.js', 'dns.example']);
    fireEvent.click(segment('images'));
    expect(names()).toEqual(['logo.png']);
    // Back to Any in both facets.
    for (const facet of ['Source', 'Preload type']) {
      const any = within(screen.getByRole('radiogroup', { name: facet })).getByRole('radio', {
        name: /^Any/
      });
      fireEvent.click(any);
    }
    expect(names()).toHaveLength(7);
    fireEvent.input(screen.getByRole('searchbox', { name: 'Search hint URLs' }), {
      target: { value: 'WOFF2' }
    });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(names()).toEqual(['inter.woff2']);
  });
});

describe('PreloadedResourcesPage — detail', () => {
  it('opens a WP Rocket preload: kind, name, attribution and why, tile, facts, copy', () => {
    mount();
    openAt(0);
    expect(pane().querySelector('[data-fdt="detail-kind"]')?.textContent).toBe('Preload');
    expect(pane().querySelector('[data-fdt="detail-title"]')?.textContent).toBe('hero.webp');
    expect(pane().querySelector('[data-fdt="hint-attribution"]')?.textContent).toBe(
      'WP Rocket (Optimize Critical Images)'
    );
    expect(pane().querySelector('[data-fdt="hint-attribution-why"]')?.textContent).toBe(
      'data-rocket-preload: written by Optimize Critical Images, detected on this page.'
    );
    expect(pane().querySelector('[data-fdt="source-link-open"]')?.getAttribute('href')).toBe(
      'https://cdn.example/wp/hero.webp'
    );
    expect(pane().querySelector('[data-fdt="hint-facts"]')?.textContent).toBe(
      'RelpreloadAsimageWP Rocket stampdata-rocket-preloadFeatureOptimize Critical Images'
    );
    expect(within(pane()).getByRole('button', { name: 'Hint URL — copy' })).toBeTruthy();
  });

  it('a srcset-only preload has no tile and no copy, and says why', () => {
    mount();
    openAt(1);
    expect(pane().querySelector('[data-fdt="source-link"]')).toBeNull();
    expect(pane().querySelector('[data-fdt="hint-no-url"]')?.textContent).toBe(SRCSET_ONLY_NOTE);
    expect(within(pane()).queryByRole('button', { name: /copy/ })).toBeNull();
  });

  it('any other hint without a URL says it carries none', () => {
    mount(withReport({ present: false, hints: [{ rel: 'modulepreload', href: '', as: '' }] }));
    expect(names()).toEqual(['No URL']);
    openAt(0);
    expect(pane().querySelector('[data-fdt="hint-no-url"]')?.textContent).toBe(NO_URL_NOTE);
  });

  it('opens a file in Sources, an origin in a new tab', () => {
    const openResource: OpenResource = vi.fn();
    mount(fixture(), { openResource });
    const action = (): string | null | undefined =>
      pane().querySelector('[data-fdt="source-link-open"]')?.getAttribute('data-fdt-action');
    openAt(0);
    expect(action()).toBe('sources');
    openAt(5);
    expect(pane().querySelector('[data-fdt="detail-kind"]')?.textContent).toBe('Module preload');
    expect(action()).toBe('sources');
    openAt(3);
    expect(pane().querySelector('[data-fdt="detail-kind"]')?.textContent).toBe('Preconnect');
    expect(action()).toBe('new-tab');
    openAt(6);
    expect(pane().querySelector('[data-fdt="detail-kind"]')?.textContent).toBe('DNS prefetch');
    expect(action()).toBe('new-tab');
  });

  it('an unattributed hint says why its author is unproven', () => {
    mount();
    openAt(4);
    expect(pane().querySelector('[data-fdt="hint-attribution"]')?.textContent).toBe('Unattributed');
    expect(pane().querySelector('[data-fdt="hint-attribution-why"]')?.textContent).toContain(
      'No WP Rocket stamp'
    );
    expect(pane().querySelector('[data-fdt="hint-facts"]')?.textContent).toBe('RelpreloadAsimage');
  });

  it('follows a refresh that attributes the open hint, keeping the selection', () => {
    const data = fixture();
    data.wprDetections.auto_preload_fonts.present = false;
    const page = mount(data);
    openAt(2);
    expect(pane().querySelector('[data-fdt="hint-attribution"]')?.textContent).toBe('WP Rocket');
    const next = fixture();
    next.wprDetections.auto_preload_fonts.present = true;
    page.refresh(next);
    expect(pane().querySelector('[data-fdt="detail-title"]')?.textContent).toBe('inter.woff2');
    expect(pane().querySelector('[data-fdt="hint-attribution"]')?.textContent).toBe(
      'WP Rocket (Preload fonts)'
    );
  });

  it('keeps the open hint across a refresh that inserts a hint above it', () => {
    const page = mount();
    openAt(4);
    expect(pane().querySelector('[data-fdt="detail-title"]')?.textContent).toBe('logo.png');
    const next = fixture();
    // A plain image preload captured first lands right above logo.png.
    next.preloadedResources.hints?.unshift({
      rel: 'preload',
      href: 'https://cdn.example/wp/new.png',
      as: 'image'
    });
    page.refresh(next);
    expect(names().slice(4, 6)).toEqual(['new.png', 'logo.png']);
    expect(pane().querySelector('[data-fdt="detail-title"]')?.textContent).toBe('logo.png');
  });
});

describe('PreloadedResourcesPage — empty states', () => {
  it('says "No resource hints on this page" without any hint, compactly', () => {
    const { root } = mount(withReport({ present: false, hints: [] }));
    expect(screen.getByText('No resource hints on this page')).toBeTruthy();
    expect(screen.queryByText('Hint inventory not collected')).toBeNull();
    expect(root.querySelector('[data-fdt="facet-bar"]')).toBeNull();
    expect(
      root.querySelector('[data-fdt="resource-summary"] [data-fdt="status-badge"]')?.textContent
    ).toBe('Not detected');
    // No "0 hints" beside an empty state that already says so.
    expect(root.querySelector('[data-fdt="resource-total"]')).toBeNull();
    expect(root.querySelector('[data-fdt="empty-state"]')?.className).not.toContain('self-center');
  });

  it('says "not collected" for a capture without a hint list, marker or not', () => {
    const page = mount(withReport({ present: false }));
    for (const report of [{ present: false }, { present: true }]) {
      page.refresh(withReport(report));
      expect(screen.getByText('Hint inventory not collected')).toBeTruthy();
      expect(
        screen.getByText(
          'This capture carries no hint list. Reload the inspected page to list every resource hint.'
        )
      ).toBeTruthy();
      expect(screen.queryByText('No resource hints on this page')).toBeNull();
    }
  });

  it('follows a refresh from rows to the empty state and back', () => {
    const page = mount();
    page.refresh(withReport({ present: false, hints: [] }));
    expect(screen.getByText('No resource hints on this page')).toBeTruthy();
    page.refresh(fixture());
    observers.resize(1000);
    expect(rows()).toHaveLength(7);
  });
});
