/**
 * The source-link tile: the view decision (http(s) only, clipped, capability)
 * and each rendered state — Sources + companion, new-tab fallback, clipped,
 * plain text — plus the click → opener → toast flow through the real
 * capability over a recording DevTools double.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, toastItems } from '../../../../components/ui/toast-store';
import { OPEN_IN_SOURCES_FAILED, openResourceCapability } from '../open-resource';
import { describeSourceLink, NEW_TAB_LABEL, SourceLink } from './source-link';

/** A `javascript:` URL built at runtime (a literal trips the JSX script-URL lint). */
function scriptedUrl(): string {
  return ['javascript', 'alert(1)'].join(':');
}

const URL = 'https://cdn.example:8443/wp-content/themes/a/app.min.js?ver=6.4#top';

/** {@link URL} as DevTools is asked to open it: the fragment dropped. */
const URL_IN_SOURCES = 'https://cdn.example:8443/wp-content/themes/a/app.min.js?ver=6.4';

afterEach(() => {
  cleanup();
  toast.clear();
  vi.restoreAllMocks();
});

describe('describeSourceLink', () => {
  it('splits an http(s) URL into host (with port) and path + query + fragment', () => {
    expect(describeSourceLink(URL, false, true)).toEqual({
      kind: 'sources',
      href: URL,
      host: 'cdn.example:8443',
      path: '/wp-content/themes/a/app.min.js?ver=6.4#top'
    });
  });

  it('falls back to a new tab without the capability', () => {
    expect(describeSourceLink('http://a.example', false, false)).toEqual({
      kind: 'new-tab',
      href: 'http://a.example/',
      host: 'a.example',
      path: '/'
    });
  });

  it('opens the parsed form (trimmed, scheme case-folded)', () => {
    expect(describeSourceLink('  HTTPS://A.example/x.js ', false, true)).toMatchObject({
      href: 'https://a.example/x.js'
    });
  });

  it('gives a clipped URL no action, even when it parses', () => {
    expect(describeSourceLink(URL, true, true)).toEqual({ kind: 'clipped' });
    expect(describeSourceLink(URL, true, false)).toEqual({ kind: 'clipped' });
  });

  it.each([
    ['relative', '/wp-content/a.js'],
    ['protocol-relative', '//cdn.example/a.js'],
    ['data', 'data:text/javascript,alert(1)'],
    ['scripted', scriptedUrl()],
    ['extension', 'chrome-extension://abc/x.js'],
    ['empty', ''],
    ['garbage', 'http://']
  ])('renders a %s URL as text', (_label, url) => {
    expect(describeSourceLink(url, false, true)).toEqual({ kind: 'text' });
  });
});

/** A recording DevTools double; `response` is what its callback receives. */
function devtools(response?: unknown): {
  api: object;
  calls: Array<[string, number]>;
} {
  const calls: Array<[string, number]> = [];
  const api = {
    devtools: {
      panels: {
        openResource: (url: string, line: number, callback: (r?: unknown) => void) => {
          calls.push([url, line]);
          callback(response);
        }
      }
    }
  };
  return { api, calls };
}

describe('SourceLink with "Open in Sources"', () => {
  it('renders the tile (label · host, path, arrow) and the new-tab companion', () => {
    const { container } = render(() => (
      <SourceLink url={URL} openResource={openResourceCapability(devtools().api)} />
    ));
    const tile = screen.getByRole('button');
    expect(tile.getAttribute('data-fdt-action')).toBe('sources');
    expect(tile.textContent).toContain('Open in Sources · ');
    expect(container.querySelector('[data-fdt="source-link-host"]')?.textContent).toBe(
      'cdn.example:8443'
    );
    expect(container.querySelector('[data-fdt="source-link-path"]')?.textContent).toBe(
      '/wp-content/themes/a/app.min.js?ver=6.4#top'
    );
    expect(tile.getAttribute('title')).toBe(URL);
    const companion = screen.getByRole('link', { name: NEW_TAB_LABEL });
    expect(companion.getAttribute('href')).toBe(URL);
    expect(companion.getAttribute('target')).toBe('_blank');
    expect(companion.getAttribute('rel')).toBe('noopener noreferrer');
    expect(companion.getAttribute('title')).toBe(NEW_TAB_LABEL);
    expect(companion.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('calls the opener exactly once per click, with the fragment-less URL and line 0, and toasts nothing', async () => {
    const { api, calls } = devtools({ code: 'OK' });
    render(() => <SourceLink url={URL} openResource={openResourceCapability(api)} />);
    fireEvent.click(screen.getByRole('button'));
    expect(calls).toEqual([[URL_IN_SOURCES, 0]]);
    await Promise.resolve();
    expect(toastItems()).toHaveLength(0);
  });

  it('sends the parsed URL, fragment dropped, to Sources and the full parsed URL to the companion', () => {
    const { api, calls } = devtools({ code: 'OK' });
    render(() => (
      <SourceLink
        url="  HTTPS://A.example/x.js?v=1#top "
        openResource={openResourceCapability(api)}
      />
    ));
    fireEvent.click(screen.getByRole('button'));
    expect(calls).toEqual([['https://a.example/x.js?v=1', 0]]);
    expect(screen.getByRole('link', { name: NEW_TAB_LABEL }).getAttribute('href')).toBe(
      'https://a.example/x.js?v=1#top'
    );
  });

  it('toasts "Couldn\'t open in Sources" when DevTools reports an error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api } = devtools({
      isError: true,
      code: 'E_NOTFOUND',
      description: 'Object not found: %s'
    });
    render(() => <SourceLink url={URL} openResource={openResourceCapability(api)} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(toastItems()).toMatchObject([{ tone: 'error', title: OPEN_IN_SOURCES_FAILED }]);
    });
  });

  it('toasts when the opener throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = {
      devtools: {
        panels: {
          openResource: () => {
            throw new Error('Extension context invalidated.');
          }
        }
      }
    };
    render(() => <SourceLink url={URL} openResource={openResourceCapability(api)} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(toastItems()).toHaveLength(1);
    });
  });

  it('never underlines or paints the tile link blue; hover tints surface + line, arrow accent', () => {
    render(() => <SourceLink url={URL} openResource={openResourceCapability(devtools().api)} />);
    for (const control of [screen.getByRole('button'), screen.getByRole('link')]) {
      expect(control.className).not.toMatch(/underline|text-accent\b/);
      expect(control.className).toContain('hover:bg-surface-3');
      expect(control.className).toContain('hover:border-line-3');
      expect(control.className).toContain('focus-visible:outline-accent');
      // The trailing icon (↗ on the tile, the new-tab glyph on the companion).
      const icons = control.querySelectorAll('svg');
      expect(icons[icons.length - 1]?.getAttribute('class')).toContain('group-hover:text-accent');
    }
  });
});

describe('SourceLink without the capability (Firefox)', () => {
  it('makes the tile itself a new-tab link and hides the companion', () => {
    render(() => <SourceLink url={URL} openResource={null} />);
    expect(screen.queryByRole('button')).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    const [tile] = links;
    expect(tile?.getAttribute('data-fdt-action')).toBe('new-tab');
    expect(tile?.textContent).toContain('Open in new tab · ');
    expect(tile?.getAttribute('href')).toBe(URL);
    expect(tile?.getAttribute('target')).toBe('_blank');
    expect(tile?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('opens the parsed URL (trimmed, scheme case-folded, fragment kept)', () => {
    render(() => <SourceLink url="  HTTPS://A.example/x.js#top " openResource={null} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://a.example/x.js#top');
  });
});

describe('SourceLink without an action', () => {
  it('keeps the "Clipped" badge and offers no open action for a clipped URL', () => {
    const { container } = render(() => (
      <SourceLink url={URL} clipped openResource={openResourceCapability(devtools().api)} />
    ));
    expect(screen.getByText('Clipped')).toBeTruthy();
    expect(screen.getByText(URL).getAttribute('title')).toBe(URL);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.querySelector('[data-fdt="source-link-clipped"]')).not.toBeNull();
  });

  it.each([
    ['relative', '/wp-content/a.js'],
    ['data', 'data:text/css,body{}'],
    ['scripted', scriptedUrl()]
  ])('renders a %s URL as plain mono text', (_label, url) => {
    const { container } = render(() => (
      <SourceLink url={url} openResource={openResourceCapability(devtools().api)} />
    ));
    const text = container.querySelector('[data-fdt="source-link-text"]');
    expect(text?.textContent).toBe(url);
    expect(text?.className).toContain('font-mono');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('SourceLink at the panel floor (268 px content)', () => {
  // happy-dom has no layout engine: these pin the classes that keep a long URL
  // inside a 268 px column (the shrink chain + wrap + clamp); the real
  // measurement belongs to the browser tier once a page mounts the tile.
  it('lets every level shrink, truncates the host and wraps + clamps the path', () => {
    const longUrl = `https://${'sub.'.repeat(40)}example/${'segment/'.repeat(200)}app.js?${'q=1&'.repeat(200)}`;
    const { container } = render(() => (
      <div style={{ width: '268px' }}>
        <SourceLink url={longUrl} openResource={openResourceCapability(devtools().api)} />
      </div>
    ));
    const root = container.querySelector('[data-fdt="source-link"]');
    expect(root?.className).toContain('min-w-0');
    expect(screen.getByRole('button').className).toMatch(
      /\bmin-w-0\b.*\bflex-1\b|\bflex-1\b.*\bmin-w-0\b/
    );
    expect(container.querySelector('[data-fdt="source-link-host"]')?.className).toContain(
      'truncate'
    );
    const path = container.querySelector('[data-fdt="source-link-path"]');
    expect(path?.className).toContain('line-clamp-2');
    expect(path?.className).toContain('break-all');
    expect(path?.parentElement?.className).toContain('min-w-0');
    // The hover title stays bounded however long the URL is.
    expect(screen.getByRole('button').getAttribute('title')?.length).toBeLessThan(longUrl.length);
  });
});
