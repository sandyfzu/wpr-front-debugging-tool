/**
 * Render tests for the page seam: the frame contract (entrance class, unpadded
 * container root, focus target, single `h1`, fill mode), the filtered-empty
 * view (sentence per input, gated buttons, the focus hand-off), and the page
 * layout tiers.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_HEADING_SELECTOR } from '../palette/focus';
import type { RouteId } from '../routes';
import { createDetailPresence, DetailPresenceContext } from '../state/detail-presence';
import {
  canvasSizeOf,
  NO_MATCHES_QUERY_MAX,
  NoMatches,
  type NoMatchesFocusTarget,
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

/** The frame's padded body column. */
function frameBody(): HTMLElement {
  const body = frameRoot().querySelector<HTMLElement>(':scope > [data-fdt="page-body"]');
  if (!body) throw new Error('no page-body column rendered');
  return body;
}

describe('PageFrame', () => {
  it('renders the entrance + unpadded container root tagged with the route id', () => {
    render(() => <PageFrame id="javascript" title="JavaScript" />);
    const root = frameRoot();
    expect(root.tagName).toBe('SECTION');
    expect(root.dataset.fdtPage).toBe('javascript');
    expect(root.classList).toContain('fdt-page');
    expect(root.classList).toContain('@container');
    // Padding lives inside, so container queries read the full region width.
    expect([...root.classList].some((c) => /^p[xytrbl]?-/.test(c))).toBe(false);
    for (const token of ['flex', 'flex-col', 'gap-3', 'p-3']) {
      expect(frameBody().classList).toContain(token);
    }
    // Natural height unless fill is asked for.
    expect(root.classList).not.toContain('min-h-full');
    expect(frameBody().classList).not.toContain('flex-1');
  });

  it('hands its ref the container root (the box tier variants read)', () => {
    let received: HTMLElement | undefined;
    render(() => (
      <PageFrame
        id="javascript"
        title="JavaScript"
        ref={(element) => {
          received = element;
        }}
      />
    ));
    expect(received).toBe(frameRoot());
  });

  it('renders exactly one h1 — the shell’s route-switch focus target', () => {
    render(() => (
      <PageFrame id="lazyload" title="LazyLoad" subtitle="Images the page deferred">
        <h2>Section</h2>
      </PageFrame>
    ));
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    const heading = screen.getByRole('heading', { level: 1, name: 'LazyLoad' });
    expect(document.querySelector(ROUTE_HEADING_SELECTOR)).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByText('Images the page deferred')).toBeTruthy();
  });

  it('centers and bounds the entire workspace, including its header', () => {
    render(() => <PageFrame id="lcp-vitals" title="LCP & Vitals" />);
    for (const token of ['mx-auto', 'w-full', 'min-w-0', 'max-w-7xl']) {
      expect(frameBody().classList).toContain(token);
    }
    expect(frameBody().classList).not.toContain('max-w-4xl');
  });

  it('keeps master–detail list routes on the standard canvas until a detail opens, then spans the content', () => {
    for (const [id, title] of [
      ['javascript', 'JavaScript'],
      ['stylesheets', 'Stylesheets'],
      ['lazyload', 'LazyLoad'],
      ['preloaded-resources', 'Preloaded Resources']
    ] as const) {
      let open: ((value: boolean) => void) | undefined;
      render(() => {
        const presence = createDetailPresence(() => id);
        const claim = presence.claim();
        open = (value) => {
          claim.set(value);
        };
        return (
          <DetailPresenceContext.Provider value={presence}>
            <PageFrame id={id} title={title} fill />
          </DetailPresenceContext.Provider>
        );
      });
      expect(frameBody().classList, id).toContain('max-w-7xl');
      expect(frameBody().dataset.fdtCanvas, id).toBe('standard');
      open?.(true);
      expect(frameBody().classList, id).toContain('max-w-none');
      expect(frameBody().classList, id).not.toContain('max-w-7xl');
      expect(frameBody().dataset.fdtCanvas, id).toBe('full');
      open?.(false);
      expect(frameBody().classList, id).toContain('max-w-7xl');
      expect(frameRoot().classList, id).toContain('@container');
      cleanup();
    }
  });

  it('never widens a standard or reading route for an open detail', () => {
    render(() => {
      const presence = createDetailPresence(() => 'lcp-vitals');
      presence.claim().set(true);
      return (
        <DetailPresenceContext.Provider value={presence}>
          <PageFrame id="lcp-vitals" title="LCP & Vitals" />
        </DetailPresenceContext.Provider>
      );
    });
    expect(frameBody().classList).toContain('max-w-7xl');
  });

  it('uses a shorter reading canvas without changing the query container', () => {
    render(() => <PageFrame id="undefined-references" title="Undefined References" />);
    expect(frameBody().classList).toContain('max-w-4xl');
    expect(frameBody().classList).not.toContain('max-w-7xl');
    expect(frameRoot().classList).toContain('@container');
  });

  it('renders actions in the header and children after it, in order', () => {
    render(() => (
      <PageFrame id="detections" title="Detections" actions={<button type="button">Copy</button>}>
        <p>first</p>
        <p>second</p>
      </PageFrame>
    ));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    const kids = [...frameBody().children];
    expect(kids[0]?.getAttribute('data-fdt')).toBe('page-header');
    expect(kids.slice(1).map((el) => el.textContent)).toEqual(['first', 'second']);
  });

  it('ties `actions` to the route registry at compile time', () => {
    // Type-level pins (`pnpm compile` checks them): each line stops compiling
    // — failing the build on the unused directive — once the route list and
    // a page's actions slot drift apart.
    // Widened on purpose: a `RouteId`-typed const would narrow to its literal.
    const loose = 'javascript' as RouteId;
    render(() => (
      <>
        {/* @ts-expect-error a header-action route must pass its actions */}
        <PageFrame id="headers-cookies" title="Headers & Cookies" />
        {/* @ts-expect-error a route outside the list cannot take actions */}
        <PageFrame id="javascript" title="JavaScript" actions={<span />} />
        {/* A route known only as some RouteId (the shell's frames) may do either. */}
        <PageFrame id={loose} title="Loose" actions={<span />} />
        <PageFrame id={loose} title="Loose" />
      </>
    ));
    expect(document.querySelectorAll('[data-fdt-page]')).toHaveLength(4);
  });

  it('fill mode makes the frame an at-least-full-height column for one flex scroller', () => {
    render(() => (
      <PageFrame id="javascript" title="JavaScript" fill>
        <div class={PAGE_FILL_SCROLLER} />
      </PageFrame>
    ));
    // min-h (not h): at short heights the frame grows and keeps its bottom padding.
    for (const token of ['flex', 'flex-col', 'min-h-full']) {
      expect(frameRoot().classList).toContain(token);
    }
    expect(frameRoot().classList).not.toContain('h-full');
    expect(frameBody().classList).toContain('flex-1');
    expect(PAGE_FILL_SCROLLER).toBe('min-h-48 flex-1 contain-size');
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

  it('counts and cuts by code point, never splitting a surrogate pair', () => {
    const emoji = '😀'; // two UTF-16 units, one code point
    const atCap = emoji.repeat(NO_MATCHES_QUERY_MAX);
    expect(noMatchesSentence(undefined, atCap)).toBe(`Nothing matches "${atCap}".`);
    const head = 'a'.repeat(NO_MATCHES_QUERY_MAX - 1);
    const cut = noMatchesSentence(undefined, `${head}${emoji}x`);
    expect(cut).toBe(`Nothing matches "${head}${emoji}…".`);
    expect(cut.isWellFormed()).toBe(true);
  });
});

describe('noMatchesSentence with facet values', () => {
  it('quotes one value as the chip sentence does', () => {
    expect(noMatchesSentence(undefined, undefined, ['Delayed'])).toBe(
      'Nothing matches the "Delayed" filter.'
    );
  });

  it('lists several values in order, plural, and pairs them with the query', () => {
    expect(noMatchesSentence(undefined, '', ['Delayed', 'Inline'])).toBe(
      'Nothing matches the "Delayed", "Inline" filters.'
    );
    expect(noMatchesSentence(undefined, ' jq ', ['Delayed', 'Inline'])).toBe(
      'Nothing in "Delayed", "Inline" matches "jq".'
    );
  });

  it('ignores blank values, falls back to the chip, then to the query alone', () => {
    expect(noMatchesSentence('Inline', 'x', [' ', ''])).toBe('Nothing in "Inline" matches "x".');
    expect(noMatchesSentence(undefined, 'x', [])).toBe('Nothing matches "x".');
    expect(noMatchesSentence(undefined, undefined, [' '])).toBe(
      'Nothing matches the current filters.'
    );
  });

  it('values win over a chip label (the two inputs are exclusive; values are what narrows)', () => {
    expect(noMatchesSentence('Inline', undefined, ['Delayed'])).toBe(
      'Nothing matches the "Delayed" filter.'
    );
  });
});

describe('NoMatches with facets', () => {
  it('offers Clear filters (it clears the query too), replacing Clear search', () => {
    const clearFilters = vi.fn();
    const clearSearch = vi.fn();
    render(() => (
      <NoMatches
        filterLabels={['Delayed', 'Inline']}
        query="jq"
        onClearFilters={clearFilters}
        onClearSearch={clearSearch}
      />
    ));
    expect(screen.getByText('Nothing in "Delayed", "Inline" matches "jq".')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Clear filters' });
    expect(button.dataset.fdtNoMatchesAction).toBe('clear-filters');
    fireEvent.click(button);
    expect(clearFilters).toHaveBeenCalledOnce();
    expect(clearSearch).not.toHaveBeenCalled();
  });

  it('falls back to Clear search while no facet narrows (labels blank or none)', () => {
    const [labels, setLabels] = createSignal<readonly string[]>([' ']);
    render(() => (
      <NoMatches
        filterLabels={labels()}
        query="jq"
        onClearFilters={vi.fn()}
        onClearSearch={vi.fn()}
      />
    ));
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
    setLabels(['Excluded']);
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('offers no Clear filters without its handler', () => {
    render(() => <NoMatches filterLabels={['Delayed']} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('hands focus to the declared target after Clear filters unmounts the view', () => {
    const [narrowed, setNarrowed] = createSignal(true);
    render(() => (
      <div data-fdt-page="javascript">
        <h1 tabIndex={-1}>JavaScript</h1>
        <input type="search" aria-label="Search scripts" />
        <Show when={narrowed()}>
          <NoMatches
            filterLabels={['Delayed']}
            onClearFilters={() => setNarrowed(false)}
            focusAfter={(action) =>
              action === 'clear-filters'
                ? screen.getByRole('searchbox', { name: 'Search scripts' })
                : null
            }
          />
        </Show>
      </div>
    ));
    const button = screen.getByRole('button', { name: 'Clear filters' });
    button.focus();
    fireEvent.click(button);
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search scripts' }));
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
    // Decorative icon stays out of the accessibility tree, rendered once.
    const icons = document.querySelectorAll('[data-fdt="empty-state"] svg');
    expect(icons).toHaveLength(1);
    expect(icons[0]?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders one button per applicable handler and wires each to its own handler', () => {
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

  it('offers Clear search only with a non-blank query', () => {
    const [query, setQuery] = createSignal<string | undefined>('  ');
    render(() => <NoMatches chipLabel="Inline" query={query()} onClearSearch={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    setQuery('jquery');
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
    setQuery(undefined);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('offers Show all only with a non-blank chip label', () => {
    const [chip, setChip] = createSignal<string | undefined>(' ');
    render(() => <NoMatches chipLabel={chip()} query="x" onShowAll={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    setChip('Delayed');
    expect(screen.getByRole('button', { name: 'Show all' })).toBeTruthy();
    setChip(undefined);
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
  });

  it('names the reset button by showAllLabel when given', () => {
    const showAll = vi.fn();
    render(() => (
      <NoMatches chipLabel="Active" onShowAll={showAll} showAllLabel="Show all optimizations" />
    ));
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all optimizations' }));
    expect(showAll).toHaveBeenCalledOnce();
  });

  it('lets an unbroken long query wrap instead of scrolling sideways', () => {
    render(() => <NoMatches query={'x'.repeat(200)} />);
    expect(document.querySelector('[data-fdt="empty-state"]')?.classList).toContain(
      'wrap-anywhere'
    );
  });
});

/** Props of the {@link FilteredPage} harness. */
interface FilteredPageProps {
  /** Forwarded to `NoMatches`. */
  focusAfter?: NoMatchesFocusTarget;
  /** Extra work after the clear-search state change (e.g. moving focus itself). */
  onClear?: () => void;
}

/**
 * A minimal list page: a search field, an "All" chip, and `NoMatches` while the
 * chip + query filter everything out — the shape every list page has.
 *
 * @param props See {@link FilteredPageProps}.
 */
function FilteredPage(props: FilteredPageProps): JSX.Element {
  const [query, setQuery] = createSignal('nothing-matches');
  const [chip, setChip] = createSignal('Inline');
  return (
    <PageFrame id="javascript" title="JavaScript">
      <input aria-label="Search scripts" value={query()} />
      <button type="button">All</button>
      <Show when={query() !== '' && chip() !== ''}>
        <NoMatches
          chipLabel={chip()}
          query={query()}
          onClearSearch={() => {
            setQuery('');
            props.onClear?.();
          }}
          onShowAll={() => {
            setChip('');
          }}
          focusAfter={props.focusAfter}
        />
      </Show>
    </PageFrame>
  );
}

/** Click a `NoMatches` button the keyboard way: focused first, then activated. */
function activate(name: string): void {
  const button = screen.getByRole('button', { name });
  button.focus();
  fireEvent.click(button);
}

describe('NoMatches focus hand-off', () => {
  it('moves focus to the declared target when the action unmounts the view', () => {
    render(() => (
      <FilteredPage
        focusAfter={(action) =>
          action === 'clear-search'
            ? screen.getByRole('textbox', { name: 'Search scripts' })
            : screen.getByRole('button', { name: 'All' })
        }
      />
    ));
    activate('Clear search');
    expect(screen.queryByText('No matches')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search scripts' }));
  });

  it('targets per action (Show all → the All chip)', () => {
    render(() => (
      <FilteredPage
        focusAfter={(action) =>
          action === 'show-all' ? screen.getByRole('button', { name: 'All' }) : null
        }
      />
    ));
    activate('Show all');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'All' }));
  });

  it('defaults to the page h1 without a target (never <body>)', () => {
    render(() => <FilteredPage />);
    activate('Clear search');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('falls back to the h1 when the declared target is detached', () => {
    const detached = document.createElement('input');
    render(() => <FilteredPage focusAfter={() => detached} />);
    activate('Show all');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('respects a handler that moved focus itself', () => {
    render(() => (
      <FilteredPage
        onClear={() => {
          screen.getByRole('button', { name: 'All' }).focus();
        }}
        focusAfter={() => screen.getByRole('textbox', { name: 'Search scripts' })}
      />
    ));
    activate('Clear search');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'All' }));
  });

  it('hands focus off when only the clicked button disappears (the view stays)', () => {
    const [query, setQuery] = createSignal('x');
    render(() => (
      <PageFrame id="javascript" title="JavaScript">
        <NoMatches
          chipLabel="Inline"
          query={query()}
          onClearSearch={() => {
            setQuery('');
          }}
          onShowAll={vi.fn()}
        />
      </PageFrame>
    ));
    activate('Clear search');
    expect(screen.getByText('No matches')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('leaves focus alone when the button was not focused (pointer click)', () => {
    const target = vi.fn(() => null);
    render(() => <FilteredPage focusAfter={target} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(target).not.toHaveBeenCalled();
  });
});

describe('page layout tiers', () => {
  /** Every non-test page source under `pages/`, recursively. */
  function pageSources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return pageSources(path);
      const source = /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.');
      return source ? [path] : [];
    });
  }

  it('page sources write the tier variants, never the tier pixel literals', () => {
    const sources = pageSources(import.meta.dirname);
    expect(sources.length).toBeGreaterThan(0);
    const strays = sources.filter((path) =>
      /@(min|max)-\[(480|768)px\]/.test(readFileSync(path, 'utf8'))
    );
    expect(strays).toEqual([]);
  });
});

describe('canvasSizeOf', () => {
  it('widens only a split route, only while a detail is open', () => {
    expect(canvasSizeOf('split', true)).toBe('full');
    expect(canvasSizeOf('split', false)).toBe('standard');
    expect(canvasSizeOf(undefined, true)).toBe('standard');
    expect(canvasSizeOf(undefined, false)).toBe('standard');
    expect(canvasSizeOf('reading', true)).toBe('reading');
    expect(canvasSizeOf('reading', false)).toBe('reading');
  });
});
