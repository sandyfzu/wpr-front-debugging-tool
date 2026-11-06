/**
 * The page side of a RUCSS test on a fake document: every failure leaves
 * the page's styles exactly as they were; a success removes exactly the
 * styles not kept (default markers, the used-CSS carve-out, kept links,
 * alternate sheets untouched) and injects the built CSS once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RucssFetchReply,
  RucssFetchRequest,
  RucssStartRequest
} from '../../../lib/messaging/rucss-test';
import { RUCSS_TEST_LIMITS } from '../../../lib/messaging/rucss-test';
import { RUCSS_SNAPSHOT_TTL_MS } from '../../../lib/rucss-tester/deadlines';
import {
  DEFAULT_INLINE_PRESERVES,
  RUCSS_RESULT_STYLE_ID
} from '../../../lib/rucss-tester/run-plan';
import { createRucssTestExecutor, snapshotStyles, type RucssTestExecutorDeps } from './executor';

const RUN = '0123456789abcdef0123456789abcdef';
const PAGE = 'https://site.test/p';
const REQUEST: RucssStartRequest = {
  safelist: ['.keep'],
  inlinePreserves: [...DEFAULT_INLINE_PRESERVES, 'my-marker'],
  mobile: false,
  home: true
};
const ANSWERED: RucssFetchReply = {
  kind: 'answered',
  requestUrl: 'https://svc.test/?url=p',
  outcome: { ok: true, shakenCss: 'body{color:red}' }
};

/** The fixture page: every kind of style the run judges. */
const PAGE_HEAD = `
  <style id="theme">.a{}</style>
  <style id="wpr-usedcss">/* admin-bar.min.css */ .used{}</style>
  <style id="admin-bar-inline-css">/* admin-bar.min.css */</style>
  <style data-x="my-marker">.mine{}</style>
  <link rel="stylesheet" id="keep-css" href="https://site.test/keep.css">
  <link rel="stylesheet" id="drop-css" href="https://site.test/drop.css">
  <link rel="alternate stylesheet" id="alt-css" href="https://site.test/alt.css">
  <link rel="preload" href="https://site.test/font.woff2">
`;

/** The page's style markup, to compare before/after. */
function styleMarkup(): string {
  return [...document.querySelectorAll('style,link')].map((node) => node.outerHTML).join('\n');
}

/** Executor deps answering `reply` from the background. */
function deps(
  reply: RucssFetchReply | null = ANSWERED,
  overrides: Partial<RucssTestExecutorDeps> = {}
): RucssTestExecutorDeps & { fetchShakenCss: ReturnType<typeof vi.fn> } {
  return {
    document,
    pageUrl: () => PAGE,
    fetchShakenCss: vi.fn<(request: RucssFetchRequest) => Promise<RucssFetchReply | null>>(() =>
      Promise.resolve(reply)
    ),
    newRunId: () => RUN,
    isInvalid: () => false,
    ...overrides
  } as never;
}

beforeEach(() => {
  // Rebuilt from the root: a test may remove the head itself.
  document.documentElement.innerHTML = `<head>${PAGE_HEAD}</head><body><p>x</p><style id="body-style">p{}</style></body>`;
});

describe('start', () => {
  it('asks the background for the page with the request’s flags and safelist only', async () => {
    const d = deps();
    await createRucssTestExecutor(d).start(REQUEST);
    expect(d.fetchShakenCss).toHaveBeenCalledWith({
      pageUrl: PAGE,
      safelist: ['.keep'],
      mobile: false,
      home: true
    });
  });

  it('answers the CSS and the stylesheet URLs to judge, without touching the page', async () => {
    const before = styleMarkup();
    const reply = await createRucssTestExecutor(deps()).start(REQUEST);
    expect(reply).toEqual({
      ok: true,
      runId: RUN,
      requestUrl: 'https://svc.test/?url=p',
      shakenCss: 'body{color:red}',
      links: ['https://site.test/keep.css', 'https://site.test/drop.css']
    });
    expect(styleMarkup()).toBe(before);
  });

  it('answers every failure typed and leaves the page untouched', async () => {
    const fetchFailed: RucssFetchReply = {
      kind: 'answered',
      requestUrl: 'u',
      outcome: { ok: false, failure: { kind: 'timeout' } }
    };
    const cases: [RucssFetchReply | null, unknown][] = [
      [null, { kind: 'background-unreachable' }],
      [{ kind: 'refused' }, { kind: 'refused' }],
      [fetchFailed, { kind: 'fetch', requestUrl: 'u', failure: { kind: 'timeout' } }]
    ];
    for (const [reply, failure] of cases) {
      const before = styleMarkup();
      const executor = createRucssTestExecutor(deps(reply));
      await expect(executor.start(REQUEST)).resolves.toEqual({ ok: false, failure });
      expect(executor.apply({ runId: RUN, css: 'x', keepLinks: [] })).toEqual({
        ok: false,
        failure: 'stale-run'
      });
      expect(styleMarkup()).toBe(before);
      expect(executor.mode()).toEqual({ applied: false, runs: 0 });
    }
  });

  it('answers `superseded` to an older start and only the newest run can apply', async () => {
    let release = (): void => undefined;
    const slow = new Promise<RucssFetchReply>((resolve) => {
      release = () => {
        resolve(ANSWERED);
      };
    });
    let calls = 0;
    let ids = 0;
    const executor = createRucssTestExecutor(
      deps(ANSWERED, {
        fetchShakenCss: () => (calls++ === 0 ? slow : Promise.resolve(ANSWERED)),
        newRunId: () => String(++ids).repeat(32)
      })
    );
    const older = executor.start(REQUEST);
    const newer = await executor.start(REQUEST);
    release();
    await expect(older).resolves.toEqual({ ok: false, failure: { kind: 'superseded' } });
    expect(newer.ok && newer.runId).toBe('1'.repeat(32));
  });

  it('answers `superseded` when the content script’s context died meanwhile', async () => {
    const before = styleMarkup();
    const executor = createRucssTestExecutor(deps(ANSWERED, { isInvalid: () => true }));
    await expect(executor.start(REQUEST)).resolves.toEqual({
      ok: false,
      failure: { kind: 'superseded' }
    });
    expect(styleMarkup()).toBe(before);
  });

  it('refuses a page with too many stylesheet links', async () => {
    document.head.innerHTML = '<link rel="stylesheet" href="https://site.test/a.css">'.repeat(
      RUCSS_TEST_LIMITS.links + 1
    );
    await expect(createRucssTestExecutor(deps()).start(REQUEST)).resolves.toEqual({
      ok: false,
      failure: { kind: 'too-many-styles' }
    });
  });
});

describe('snapshotStyles', () => {
  it('refuses links whose URLs together pass the character bound', () => {
    const long = `https://site.test/${'a'.repeat(RUCSS_TEST_LIMITS.linkChars)}.css`;
    document.head.innerHTML = `<link rel="stylesheet" href="${long}">`;
    expect(snapshotStyles(document, RUN, [])).toBeNull();
  });

  it('reads a link without an address as an empty URL', () => {
    document.head.innerHTML = '<link rel="stylesheet">';
    document.body.innerHTML = '';
    expect(snapshotStyles(document, RUN, [])?.links).toEqual(['']);
  });
});

describe('apply', () => {
  /** A started executor over the fixture page. */
  async function started(): Promise<ReturnType<typeof createRucssTestExecutor>> {
    const executor = createRucssTestExecutor(deps());
    await executor.start(REQUEST);
    return executor;
  }

  it('removes exactly the styles not kept and injects the CSS last in the head', async () => {
    const executor = await started();
    const reply = executor.apply({ runId: RUN, css: '/*built*/', keepLinks: [0] });
    expect(reply).toEqual({
      ok: true,
      summary: { removed: 4, preserved: 2, excluded: 1, gone: 0, cssChars: 9 }
    });
    const ids = [...document.querySelectorAll('style,link')].map(
      (node) => node.id || node.outerHTML
    );
    // Kept: the default-marked admin bar style, the user-marked style, the
    // kept link, the alternate sheet and the preload; WP Rocket's used CSS
    // went despite carrying a marker.
    expect(ids).toEqual([
      'admin-bar-inline-css',
      '<style data-x="my-marker">.mine{}</style>',
      'keep-css',
      'alt-css',
      '<link rel="preload" href="https://site.test/font.woff2">',
      RUCSS_RESULT_STYLE_ID
    ]);
    const result = document.getElementById(RUCSS_RESULT_STYLE_ID);
    expect(result?.parentElement).toBe(document.head);
    expect(result?.textContent).toBe('/*built*/');
    expect(executor.mode()).toEqual({ applied: true, runs: 1 });
  });

  it('applies a run once; a repeat run strips the previous result too', async () => {
    const executor = await started();
    executor.apply({ runId: RUN, css: 'one', keepLinks: [] });
    expect(executor.apply({ runId: RUN, css: 'two', keepLinks: [] })).toEqual({
      ok: false,
      failure: 'stale-run'
    });
    await executor.start(REQUEST);
    executor.apply({ runId: RUN, css: 'two', keepLinks: [] });
    const results = document.querySelectorAll(`#${RUCSS_RESULT_STYLE_ID}`);
    expect([...results].map((node) => node.textContent)).toEqual(['two']);
    expect(executor.mode()).toEqual({ applied: true, runs: 2 });
  });

  it('tells the page surfaces the new state after each applied test only', async () => {
    const onModeChange = vi.fn();
    const executor = createRucssTestExecutor(deps(ANSWERED, { onModeChange }));
    await executor.start(REQUEST);
    expect(onModeChange).not.toHaveBeenCalled();
    executor.apply({ runId: RUN, css: 'one', keepLinks: [] });
    expect(onModeChange).toHaveBeenLastCalledWith({ applied: true, runs: 1 });
    // A refused apply changes nothing, so nothing is told.
    executor.apply({ runId: RUN, css: 'two', keepLinks: [] });
    expect(onModeChange).toHaveBeenCalledTimes(1);
  });

  it('refuses a foreign run, an out-of-range link and a dead context — page untouched', async () => {
    let invalid = false;
    const executor = createRucssTestExecutor(deps(ANSWERED, { isInvalid: () => invalid }));
    await executor.start(REQUEST);
    const before = styleMarkup();
    expect(executor.apply({ runId: 'f'.repeat(32), css: 'x', keepLinks: [] })).toEqual({
      ok: false,
      failure: 'stale-run'
    });
    expect(executor.apply({ runId: RUN, css: 'x', keepLinks: [2] })).toEqual({
      ok: false,
      failure: 'invalid-request'
    });
    invalid = true;
    expect(executor.apply({ runId: RUN, css: 'x', keepLinks: [] })).toEqual({
      ok: false,
      failure: 'stale-run'
    });
    expect(styleMarkup()).toBe(before);
  });

  it('counts styles the page removed meanwhile as gone, and leaves later styles alone', async () => {
    const executor = await started();
    document.getElementById('theme')?.remove();
    document.head.insertAdjacentHTML('beforeend', '<style id="late">.l{}</style>');
    const reply = executor.apply({ runId: RUN, css: '', keepLinks: [] });
    expect(reply).toMatchObject({ ok: true, summary: { removed: 4, gone: 1 } });
    expect(document.getElementById('late')).not.toBeNull();
  });

  it('injects into the root when the head is gone, and refuses without any root', async () => {
    const executor = await started();
    document.head.remove();
    expect(executor.apply({ runId: RUN, css: 'x', keepLinks: [] })).toMatchObject({ ok: true });
    expect(document.getElementById(RUCSS_RESULT_STYLE_ID)?.parentElement).toBe(
      document.documentElement
    );

    const bare = document.implementation.createHTMLDocument('');
    bare.documentElement.remove();
    const empty = createRucssTestExecutor(deps(ANSWERED, { document: bare }));
    await empty.start(REQUEST);
    expect(empty.apply({ runId: RUN, css: 'x', keepLinks: [] })).toEqual({
      ok: false,
      failure: 'no-document'
    });
  });

  it('removes nothing and takes its style back when the page does not take the CSS (CSP)', async () => {
    const executor = await started();
    // What a Content Security Policy blocking inline styles leaves: no style sheet.
    const blocked = vi.spyOn(HTMLStyleElement.prototype, 'sheet', 'get').mockReturnValue(null);
    try {
      const before = styleMarkup();
      expect(executor.apply({ runId: RUN, css: 'x', keepLinks: [] })).toEqual({
        ok: false,
        failure: 'css-blocked'
      });
      expect(styleMarkup()).toBe(before);
      expect(document.getElementById(RUCSS_RESULT_STYLE_ID)).toBeNull();
      expect(executor.mode()).toEqual({ applied: false, runs: 0 });
      // The run is spent: a retry of it is stale.
      expect(executor.apply({ runId: RUN, css: 'x', keepLinks: [] })).toMatchObject({
        failure: 'stale-run'
      });
    } finally {
      blocked.mockRestore();
    }
  });

  it('applies to an SVG document with an HTML style element (never an inert namespace-less one)', async () => {
    const svg = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{}</style><rect/></svg>',
      'image/svg+xml'
    );
    const executor = createRucssTestExecutor(deps(ANSWERED, { document: svg }));
    await executor.start(REQUEST);
    expect(executor.apply({ runId: RUN, css: 'rect{opacity:0.5}', keepLinks: [] })).toMatchObject({
      ok: true,
      summary: { removed: 1 }
    });
    const result = svg.getElementById(RUCSS_RESULT_STYLE_ID);
    expect(result).toBeInstanceOf(HTMLStyleElement);
    expect(result?.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(result?.parentElement).toBe(svg.documentElement);
  });

  it('answers `css-blocked`, page untouched, when the injected style is not an HTML style element', async () => {
    const executor = await started();
    // What an inert element (no `sheet` at all) looks like to the check.
    const createNS = document.createElementNS.bind(document);
    const inert = vi
      .spyOn(document, 'createElementNS')
      .mockImplementation(() => createNS(null, 'style'));
    try {
      const before = styleMarkup();
      expect(executor.apply({ runId: RUN, css: 'x', keepLinks: [] })).toEqual({
        ok: false,
        failure: 'css-blocked'
      });
      expect(styleMarkup()).toBe(before);
      expect(executor.mode()).toEqual({ applied: false, runs: 0 });
    } finally {
      inert.mockRestore();
    }
  });

  it('keeps the CSS’s line breaks', async () => {
    const executor = await started();
    executor.apply({ runId: RUN, css: 'a{}\n/* x */\nb{}', keepLinks: [] });
    expect(document.getElementById(RUCSS_RESULT_STYLE_ID)?.textContent).toBe('a{}\n/* x */\nb{}');
  });

  it('judges SVG style elements against the preserve markers like any inline style', async () => {
    document.body.innerHTML =
      '<svg><style id="wpr_rucss_style">.icon{}</style><style id="plain-svg">.x{}</style></svg>';
    const executor = await started();
    expect(executor.apply({ runId: RUN, css: '', keepLinks: [] })).toMatchObject({ ok: true });
    expect(document.getElementById('wpr_rucss_style')).not.toBeNull();
    expect(document.getElementById('plain-svg')).toBeNull();
  });
});

describe('snapshot expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops an abandoned snapshot after its time to live — a late apply is stale, page untouched', async () => {
    const executor = createRucssTestExecutor(deps());
    await executor.start(REQUEST);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(RUCSS_SNAPSHOT_TTL_MS);
    expect(vi.getTimerCount()).toBe(0);
    const before = styleMarkup();
    expect(executor.apply({ runId: RUN, css: 'x', keepLinks: [] })).toEqual({
      ok: false,
      failure: 'stale-run'
    });
    expect(styleMarkup()).toBe(before);
  });

  it('applies until the last moment, then clears its timer', async () => {
    const executor = createRucssTestExecutor(deps());
    await executor.start(REQUEST);
    vi.advanceTimersByTime(RUCSS_SNAPSHOT_TTL_MS - 1);
    expect(executor.apply({ runId: RUN, css: 'x', keepLinks: [] })).toMatchObject({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a newer start replaces the older snapshot’s timer, and a superseded start arms none', async () => {
    let answer: (reply: RucssFetchReply) => void = () => undefined;
    const executor = createRucssTestExecutor(deps());
    await executor.start(REQUEST);
    const slow = createRucssTestExecutor(
      deps(ANSWERED, {
        fetchShakenCss: () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      })
    );
    await executor.start(REQUEST);
    expect(vi.getTimerCount()).toBe(1);
    const older = slow.start(REQUEST);
    const resolveOlder = answer;
    const newer = slow.start(REQUEST);
    resolveOlder(ANSWERED);
    await expect(older).resolves.toMatchObject({ failure: { kind: 'superseded' } });
    answer(ANSWERED);
    await newer;
    expect(vi.getTimerCount()).toBe(2);
  });
});
