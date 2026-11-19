/** The "⋯" menu's rows, its trigger words and its contained answer rows. */
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TopBarFoldPart } from '../../../lib/panel/top-bar-fold';
import { makeFdtData } from '../state/fixtures';
import { TopBarMenu, topBarMenuRows, topBarMenuWords, type TopBarMenuRow } from './overflow-menu';
import { topBarSegments, type TopBarSegments } from './selectors';

/** The pinned clock (ms). */
const NOW_MS = 1_727_000_000_000;

/** Ready segments for a cached page three minutes old, served by nginx. */
function cachedSegments(): TopBarSegments {
  const base = makeFdtData();
  const data = {
    ...base,
    wprDetections: {
      ...base.wprDetections,
      wpr: {
        present: true,
        cacheMarkerFound: true,
        cached: true,
        version: '3.20.1',
        timeStamp: (NOW_MS - 180_000) / 1000
      }
    },
    pageHeaders: [{ name: 'Server', value: 'nginx' }]
  };
  return topBarSegments({ status: 'ready', data, fetchedAt: NOW_MS }, NOW_MS);
}

/** Every part folded (nothing inline). */
const NOTHING_INLINE = (): boolean => false;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('topBarMenuWords', () => {
  it.each([
    [[], false, 'More', 'More'],
    [['exclusions'], false, 'More: Exclusions', 'Exclusions'],
    [['address', 'server'], false, 'More: address, server', 'Address and server'],
    [
      ['address', 'freshness', 'cacheAge', 'server', 'exclusions'],
      false,
      'More: address, freshness, cache age, server, Exclusions',
      'Address, freshness, cache age, server and Exclusions'
    ],
    [
      ['freshness', 'server'],
      true,
      'More: freshness (data is stale), server',
      'Freshness (data is stale) and server'
    ],
    // Stale data names itself only through the freshness it holds.
    [['server'], true, 'More: server', 'Server']
  ] as const)('%j (stale: %s) → "%s"', (rows, stale, label, tooltip) => {
    expect(topBarMenuWords(rows, stale)).toEqual({ label, tooltip });
  });
});

describe('topBarMenuRows', () => {
  /** The facts for a full bar where `folded` parts are not inline. */
  function facts(folded: readonly TopBarFoldPart[], overrides: object = {}) {
    return {
      hasAddress: true,
      segments: cachedSegments(),
      inline: (part: TopBarFoldPart) => !folded.includes(part),
      compact: false,
      hasBuilder: true,
      ...overrides
    };
  }

  it('holds nothing while every part is inline on a full bar', () => {
    expect(topBarMenuRows(facts([]))).toEqual([]);
  });

  it('holds exactly the folded parts, in plate order', () => {
    expect(topBarMenuRows(facts(['server', 'address']))).toEqual(['address', 'server']);
    expect(topBarMenuRows(facts(['address', 'server', 'cacheAge', 'freshness', 'brand']))).toEqual<
      TopBarMenuRow[]
    >(['address', 'freshness', 'cacheAge', 'server']);
  });

  it('adds the Exclusions action on a compact bar (when the builder state exists)', () => {
    expect(topBarMenuRows(facts(['server'], { compact: true }))).toEqual(['server', 'exclusions']);
    expect(topBarMenuRows(facts(['server'], { compact: true, hasBuilder: false }))).toEqual([
      'server'
    ]);
  });

  it('skips what has nothing to show: no address, no answers, an unstamped cache', () => {
    expect(topBarMenuRows(facts(['address'], { hasAddress: false }))).toEqual([]);
    expect(topBarMenuRows(facts(['server', 'freshness'], { segments: null }))).toEqual([]);
    const unstamped = cachedSegments();
    const noAge: TopBarSegments = {
      ...unstamped,
      cache: { kind: 'cached', age: null, copy: { chip: '✓ Cached', tooltip: 'Cached.' } }
    } as TopBarSegments;
    expect(topBarMenuRows(facts(['cacheAge'], { segments: noAge }))).toEqual([]);
  });
});

describe('TopBarMenu', () => {
  /** Render a shown "⋯" holding every part, then open it. */
  async function openMenu(segments: () => TopBarSegments | null): Promise<HTMLElement> {
    render(() => (
      <TopBarMenu
        segments={segments}
        address={() => ({ url: 'https://example.com/shop/', label: 'example.com/shop/' })}
        builder={null}
        stale={false}
        visible
        inline={NOTHING_INLINE}
        compact={false}
        attach={() => undefined}
      />
    ));
    fireEvent.pointerDown(screen.getByRole('button', { name: /^More: / }));
    return await screen.findByRole('menu');
  }

  it('holds the name, address, freshness, cache age and server', async () => {
    const menu = await openMenu(cachedSegments);
    expect(within(menu).getByText('WPR FDT')).toBeTruthy();
    expect(within(menu).getByText('example.com/shop/')).toBeTruthy();
    expect(within(menu).getByText('Cache generated 3 min ago')).toBeTruthy();
    expect(menu.querySelector('[data-fdt="top-bar-menu-freshness"]')).not.toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /nginx/ })).toBeTruthy();
  });

  it('contains a crashing answer row to one quiet line; the plate survives', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const segments = cachedSegments();
    const hostile = {
      ...segments,
      get freshness(): never {
        throw new Error('hostile freshness');
      }
    } as TopBarSegments;
    const menu = await openMenu(() => hostile);
    expect(within(menu).getByText('Status unavailable')).toBeTruthy();
    expect(within(menu).getByText('WPR FDT')).toBeTruthy();
    expect(within(menu).getByText('example.com/shop/')).toBeTruthy();
    expect(
      error.mock.calls.some((call) => /Top bar menu answers crashed/.test(String(call[0])))
    ).toBe(true);
  });

  it('renders without answers (the bar’s own downtime line covers them)', async () => {
    const menu = await openMenu(() => null);
    expect(within(menu).getByText('example.com/shop/')).toBeTruthy();
    expect(menu.querySelector('[data-fdt="top-bar-menu-freshness"]')).toBeNull();
  });
});
