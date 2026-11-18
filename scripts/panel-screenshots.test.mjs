import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  checkHostResolverRules,
  createTeardown,
  DEFAULT_SITE_PAGE,
  desktopUserAgent,
  devtoolsShim,
  ERROR_VIEW_SELECTOR,
  errorViewTexts,
  PALETTES,
  parseArgs,
  parseEnvText,
  parseRouteIds,
  resolveSiteUrl,
  selectSurfaces,
  shotFailure,
  shotPlan,
  signalExitCode,
  staleShotFiles,
  WIDTHS
} from './panel-screenshots.mjs';

/* Pure pieces of the screenshot harness; the browser drive (`main`, waits, capture) is thin
 * glue exercised by running the script against a build and the docker site. */

const ROOT = '/repo';

describe('parseArgs', () => {
  it('defaults the folder to .screenshots/<label>/ and the inspected page to the delay fixture', () => {
    expect(parseArgs(['before'], ROOT)).toEqual({
      outDir: join(ROOT, '.screenshots', 'before'),
      page: DEFAULT_SITE_PAGE,
      only: null,
      headed: false
    });
  });

  it('reads every option, --out winning over the label folder', () => {
    const parsed = parseArgs(
      [
        'after',
        '--out',
        '/tmp/shots',
        '--page',
        '/fdt/',
        '--only',
        'javascript, options',
        '--headed'
      ],
      ROOT
    );
    expect(parsed).toEqual({
      outDir: '/tmp/shots',
      page: '/fdt/',
      only: ['javascript', 'options'],
      headed: true
    });
    // --out alone needs no label.
    expect(parseArgs(['--out', '/tmp/x'], ROOT).outDir).toBe('/tmp/x');
  });

  it('refuses a missing label, extra positionals, unknown flags and missing values', () => {
    expect(() => parseArgs([], ROOT)).toThrow('a label (or --out) is required');
    expect(() => parseArgs(['a', 'b'], ROOT)).toThrow('unexpected argument "b"');
    expect(() => parseArgs(['a', '--fast'], ROOT)).toThrow('unknown option --fast');
    expect(() => parseArgs(['a', '--out'], ROOT)).toThrow('--out needs a value');
    expect(() => parseArgs(['a', '--page', '--headed'], ROOT)).toThrow('--page needs a value');
  });

  it('refuses a label that is not a plain folder name, a relative page and an empty --only', () => {
    expect(() => parseArgs(['../up'], ROOT)).toThrow('must be a plain folder name');
    expect(() => parseArgs(['a/b'], ROOT)).toThrow('must be a plain folder name');
    expect(() => parseArgs(['a', '--page', 'fdt/'], ROOT)).toThrow('--page must be a site path');
    expect(() => parseArgs(['a', '--only', ' , '], ROOT)).toThrow('--only needs at least one id');
  });
});

describe('parseEnvText', () => {
  it('keeps KEY=value lines only, the value verbatim', () => {
    expect(parseEnvText('# c\nA_1=x=y\n  B=  \nlower=no\n\nC=http://h:1')).toEqual({
      A_1: 'x=y',
      B: '',
      C: 'http://h:1'
    });
  });
});

describe('resolveSiteUrl', () => {
  const file = '/repo/docker/.env';

  it('prefers the env var, then docker/.env, trimming trailing slashes', () => {
    expect(resolveSiteUrl('http://e:1/', 'WPR_FDT_SITE_URL=http://f:2', file)).toBe('http://e:1');
    expect(resolveSiteUrl(undefined, 'X=1\nWPR_FDT_SITE_URL=http://f:2//', file)).toBe(
      'http://f:2'
    );
    expect(resolveSiteUrl('', 'WPR_FDT_SITE_URL=https://f', file)).toBe('https://f');
  });

  it('names the missing input (and the up.sh fix when the file is absent)', () => {
    expect(() => resolveSiteUrl(undefined, null, file)).toThrow(
      'No site URL: set WPR_FDT_SITE_URL in the environment or in /repo/docker/.env (missing'
    );
    expect(() => resolveSiteUrl(undefined, 'OTHER=1', file)).toThrow(/docker\/\.env$/);
  });

  it('refuses values that are not http(s) URLs', () => {
    expect(() => resolveSiteUrl('nope', null, file)).toThrow('is not a URL: "nope"');
    expect(() => resolveSiteUrl('file:///x', null, file)).toThrow('must be http(s)');
  });
});

describe('parseRouteIds', () => {
  it("reads the panel's real route table, every id once", () => {
    const ids = parseRouteIds(readFileSync('entrypoints/panel/routes.ts', 'utf8'));
    expect(ids[0]).toBe('detections');
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tolerates comments and a trailing comma', () => {
    const source = "export const ROUTE_IDS = [\n  'a', // first\n  'b-c',\n] as const;";
    expect(parseRouteIds(source)).toEqual(['a', 'b-c']);
  });

  it('fails on a missing table, an unreadable entry, an empty table or a duplicate', () => {
    expect(() => parseRouteIds('const X = 1;')).toThrow('no longer declares');
    expect(() => parseRouteIds('export const ROUTE_IDS = [ID_A] as const;')).toThrow(
      'cannot read: ID_A'
    );
    expect(() => parseRouteIds('export const ROUTE_IDS = [] as const;')).toThrow('is empty');
    expect(() => parseRouteIds("export const ROUTE_IDS = ['a', 'a'] as const;")).toThrow(
      'lists "a" twice'
    );
  });
});

describe('selectSurfaces', () => {
  it('captures every route plus options by default, in table order', () => {
    expect(selectSurfaces(['a', 'b'], null)).toEqual(['a', 'b', 'options']);
  });

  it('narrows to --only in capture order and names unknown ids', () => {
    expect(selectSurfaces(['a', 'b'], ['options', 'b'])).toEqual(['b', 'options']);
    expect(() => selectSurfaces(['a'], ['a', 'zz'])).toThrow('--only names unknown ids: zz');
  });
});

describe('shotPlan', () => {
  it('crosses surfaces × palettes × widths with one file name each', () => {
    const shots = shotPlan(['a', 'options']);
    expect(shots).toHaveLength(12);
    expect(shots[0]).toEqual({ surface: 'a', palette: 'dark', width: 420, file: 'a-420-dark.png' });
    expect(shots.at(-1)?.file).toBe('options-1100-light.png');
    expect(new Set(shots.map((shot) => shot.file)).size).toBe(12);
  });

  it('pins the set: 420/760/1100 px × dark/light over 11 surfaces = 66 shots', () => {
    expect(WIDTHS).toEqual([420, 760, 1100]);
    expect(PALETTES).toEqual(['dark', 'light']);
    const routes = parseRouteIds(readFileSync('entrypoints/panel/routes.ts', 'utf8'));
    const surfaces = selectSurfaces(routes, null);
    expect(surfaces).toHaveLength(11);
    expect(shotPlan(surfaces)).toHaveLength(66);
  });
});

describe('checkHostResolverRules', () => {
  it('passes a MAP switch through unchanged', () => {
    const rules = '--host-resolver-rules=MAP a.example ~NOTFOUND, MAP b.example ~NOTFOUND';
    expect(checkHostResolverRules(rules, 'hosts.ts')).toBe(rules);
  });

  it('names the module when the export is missing or not a resolver switch', () => {
    expect(() => checkHostResolverRules(undefined, 'hosts.ts')).toThrow(
      'hosts.ts no longer exports HOST_RESOLVER_RULES'
    );
    expect(() => checkHostResolverRules('--other=1', 'hosts.ts')).toThrow('(got "--other=1")');
    expect(() => checkHostResolverRules('--host-resolver-rules=', 'hosts.ts')).toThrow(
      'no longer exports'
    );
  });
});

describe('errorViewTexts', () => {
  it('reads both error views (chunk failure, unavailable data) with collapsed text, capped', () => {
    document.body.innerHTML = `
      <main data-fdt-page="javascript">
        <div data-fdt="error-state"><h2>Couldn't load
          this page</h2><p>Reload the panel.</p></div>
      </main>
      <div data-fdt="data-unavailable">${'x'.repeat(200)}</div>
      <div data-fdt="skeleton">not an error</div>`;
    const texts = errorViewTexts(ERROR_VIEW_SELECTOR);
    expect(texts).toEqual(["Couldn't load this pageReload the panel.", 'x'.repeat(160)]);
  });

  it('returns nothing for a clean page', () => {
    document.body.innerHTML = '<main data-fdt-page="detections"><h1>Detections</h1></main>';
    expect(errorViewTexts(ERROR_VIEW_SELECTOR)).toEqual([]);
  });
});

describe('shotFailure', () => {
  const shot = { surface: 'javascript', palette: 'dark', width: 420 };

  it('is null for a clean shot', () => {
    expect(shotFailure(shot, [])).toBeNull();
  });

  it('names surface, width, palette and every view (an empty one marked)', () => {
    expect(shotFailure(shot, ["Couldn't load this page", ''])).toBe(
      'javascript at 420 px, dark: error view "Couldn\'t load this page"; "(no text)"'
    );
  });
});

describe('staleShotFiles', () => {
  const files = [
    'detections-420-dark.png',
    'old-route-1100-light.png',
    'notes.txt',
    'diagram.png',
    'detections-420-dark.png.bak',
    'Detections-420-dark.png'
  ];

  it('on a full run, deletes every shot-named PNG and nothing else', () => {
    expect(staleShotFiles(files, null)).toEqual([
      'detections-420-dark.png',
      'old-route-1100-light.png'
    ]);
  });

  it('on an --only run, deletes nothing (other surfaces keep their shots)', () => {
    expect(staleShotFiles(files, ['detections'])).toEqual([]);
  });
});

describe('createTeardown', () => {
  it('closes then removes, once, however often it is called', async () => {
    const order = [];
    const teardown = createTeardown(
      () => {
        order.push('close');
      },
      () => {
        order.push('remove');
      },
      () => {
        order.push('log');
      }
    );
    const first = teardown();
    expect(teardown()).toBe(first);
    await first;
    await teardown();
    expect(order).toEqual(['close', 'remove']);
  });

  it('still removes the profile when closing fails, logging instead of throwing', async () => {
    const remove = vi.fn();
    const log = vi.fn();
    const teardown = createTeardown(() => Promise.reject(new Error('gone')), remove, log);
    await expect(teardown()).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('could not close the browser: gone');
  });

  it('logs a failed removal instead of throwing (the run keeps its own error)', async () => {
    const log = vi.fn();
    const teardown = createTeardown(
      () => undefined,
      () => {
        throw new Error('EBUSY');
      },
      log
    );
    await expect(teardown()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('could not remove the temp profile: EBUSY');
  });
});

describe('signalExitCode', () => {
  it('is 128 + the signal number', () => {
    expect(signalExitCode('SIGINT')).toBe(130);
    expect(signalExitCode('SIGTERM')).toBe(143);
  });
});

describe('desktopUserAgent', () => {
  it('replaces the headless marker and leaves a desktop agent unchanged', () => {
    expect(desktopUserAgent('Mozilla/5.0 HeadlessChrome/156.0.1 Safari/537.36')).toBe(
      'Mozilla/5.0 Chrome/156.0.1 Safari/537.36'
    );
    expect(desktopUserAgent('Mozilla/5.0 Chrome/156.0.1')).toBe('Mozilla/5.0 Chrome/156.0.1');
  });
});

describe('devtoolsShim', () => {
  it('stamps the tab id on both namespace objects, skipping a missing one', () => {
    const window = { chrome: {}, browser: undefined };
    new Function('window', devtoolsShim(7))(window);
    expect(window.chrome).toEqual({ devtools: { inspectedWindow: { tabId: 7 } } });
    expect(window.browser).toBeUndefined();
    const both = { chrome: {}, browser: {} };
    new Function('window', devtoolsShim(0))(both);
    expect(both.browser).toEqual({ devtools: { inspectedWindow: { tabId: 0 } } });
    expect(both.chrome).toEqual(both.browser);
  });

  it('refuses ids that are not non-negative integers (they are interpolated into code)', () => {
    expect(() => devtoolsShim(-1)).toThrow('invalid tab id: -1');
    expect(() => devtoolsShim(1.5)).toThrow('invalid tab id');
    expect(() => devtoolsShim(Number.NaN)).toThrow('invalid tab id');
  });
});
