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
import {
  RUCSS_INLINE_CHECK_BUDGET_MS,
  RUCSS_INLINE_CHECK_SLICE_MS,
  RUCSS_INLINE_CHECK_YIELD_FALLBACK_MS,
  RUCSS_SNAPSHOT_TTL_MS
} from '../../../lib/rucss-tester/deadlines';
import {
  DEFAULT_INLINE_PRESERVES,
  RUCSS_RESULT_STYLE_ID
} from '../../../lib/rucss-tester/run-plan';
import {
  createInlineCheckPacer,
  createRucssTestExecutor,
  snapshotStyles,
  yieldThroughMessage,
  type RucssTestExecutorDeps
} from './executor';

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

  it('judges inline styles in slices, handing the page its thread back, with the same result', async () => {
    const clock = steppingClock(RUCSS_INLINE_CHECK_SLICE_MS / 2);
    const executor = createRucssTestExecutor(deps(ANSWERED, clock));
    const reply = await executor.start(REQUEST);
    expect(reply.ok).toBe(true);
    expect(clock.yieldToPage).toHaveBeenCalled();
    expect(executor.apply({ runId: RUN, css: '/*built*/', keepLinks: [0] })).toEqual({
      ok: true,
      summary: { removed: 4, preserved: 2, excluded: 1, gone: 0, cssChars: 9 }
    });
  });

  it('yields through the platform by default (a message-channel turn)', async () => {
    const clock = steppingClock(RUCSS_INLINE_CHECK_SLICE_MS);
    const executor = createRucssTestExecutor(deps(ANSWERED, { now: clock.now }));
    await expect(executor.start(REQUEST)).resolves.toMatchObject({ ok: true });
  });

  it('stops the inline judging past its budget: typed failure, page untouched, nothing to apply', async () => {
    const before = styleMarkup();
    const clock = steppingClock(RUCSS_INLINE_CHECK_BUDGET_MS / 4);
    const executor = createRucssTestExecutor(deps(ANSWERED, clock));
    await expect(executor.start(REQUEST)).resolves.toEqual({
      ok: false,
      failure: { kind: 'inline-check-too-slow' }
    });
    expect(executor.apply({ runId: RUN, css: 'x', keepLinks: [] })).toEqual({
      ok: false,
      failure: 'stale-run'
    });
    expect(styleMarkup()).toBe(before);
  });

  it('answers `superseded` when a newer start began while the judging yielded', async () => {
    let ids = 0;
    let first = true;
    let executor: ReturnType<typeof createRucssTestExecutor> | null = null;
    let newer: Promise<unknown> = Promise.resolve();
    const clock = steppingClock(RUCSS_INLINE_CHECK_SLICE_MS);
    executor = createRucssTestExecutor(
      deps(ANSWERED, {
        now: clock.now,
        // The first yield starts a newer test (as a second panel click would).
        yieldToPage: () => {
          if (first && executor !== null) {
            first = false;
            newer = executor.start(REQUEST);
          }
          return Promise.resolve();
        },
        newRunId: () => String(++ids).repeat(32)
      })
    );
    await expect(executor.start(REQUEST)).resolves.toEqual({
      ok: false,
      failure: { kind: 'superseded' }
    });
    await expect(newer).resolves.toMatchObject({ ok: true, runId: '2'.repeat(32) });
  });

  it('stops the superseded judging at its next hand-back, sparing the page the rest', async () => {
    let pending = false;
    const fetchShakenCss = vi.fn(() => {
      // The newer start's request stays in flight: only the older judging yields.
      if (pending) return new Promise<never>(() => undefined);
      pending = true;
      return Promise.resolve(ANSWERED);
    });
    let executor: ReturnType<typeof createRucssTestExecutor> | null = null;
    const clock = steppingClock(RUCSS_INLINE_CHECK_SLICE_MS);
    const yieldToPage = vi.fn(() => {
      if (yieldToPage.mock.calls.length === 1) void executor?.start(REQUEST);
      return Promise.resolve();
    });
    executor = createRucssTestExecutor(
      deps(ANSWERED, { now: clock.now, yieldToPage, fetchShakenCss })
    );
    await expect(executor.start(REQUEST)).resolves.toEqual({
      ok: false,
      failure: { kind: 'superseded' }
    });
    expect(yieldToPage).toHaveBeenCalledOnce();
  });

  it('stops the judging at its next hand-back once the context died', async () => {
    let dead = false;
    const clock = steppingClock(RUCSS_INLINE_CHECK_SLICE_MS);
    const yieldToPage = vi.fn(() => {
      dead = true;
      return Promise.resolve();
    });
    const executor = createRucssTestExecutor(
      deps(ANSWERED, { now: clock.now, yieldToPage, isInvalid: () => dead })
    );
    await expect(executor.start(REQUEST)).resolves.toEqual({
      ok: false,
      failure: { kind: 'superseded' }
    });
    expect(yieldToPage).toHaveBeenCalledOnce();
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

/** A pacer that never yields nor runs out. */
const UNPACED = { checkpoint: (): true => true };

/** A clock advancing `step` ms per read, and a yield counter. */
function steppingClock(step: number): {
  now: () => number;
  yieldToPage: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  let time = 0;
  return {
    now: () => (time += step),
    yieldToPage: vi.fn<() => Promise<void>>(() => Promise.resolve())
  };
}

describe('snapshotStyles', () => {
  it('refuses links whose URLs together pass the character bound', async () => {
    const long = `https://site.test/${'a'.repeat(RUCSS_TEST_LIMITS.linkChars)}.css`;
    document.head.innerHTML = `<link rel="stylesheet" href="${long}">`;
    await expect(snapshotStyles(document, RUN, [], UNPACED)).resolves.toBe('too-many-links');
  });

  it('reads a link without an address as an empty URL', async () => {
    document.head.innerHTML = '<link rel="stylesheet">';
    document.body.innerHTML = '';
    const snapshot = await snapshotStyles(document, RUN, [], UNPACED);
    expect(typeof snapshot === 'object' && snapshot.links).toEqual(['']);
  });

  it('checks every marker until one keeps the style (the used-CSS style never kept)', async () => {
    document.head.innerHTML =
      '<style id="a">/* m2 */</style><style id="b">x</style><style id="wpr-usedcss">/* m1 */</style>';
    document.body.innerHTML = '';
    const snapshot = await snapshotStyles(document, RUN, ['m1', 'm2'], UNPACED);
    expect(
      typeof snapshot === 'object' &&
        snapshot.entries.map((entry) => entry.kind === 'inline' && entry.preserved)
    ).toEqual([true, false, false]);
  });
});

describe('yieldThroughMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves after a message-channel turn', async () => {
    await expect(yieldThroughMessage()).resolves.toBeUndefined();
  });

  it('falls back to a timer turn where a channel cannot be made', async () => {
    vi.stubGlobal('MessageChannel', () => {
      throw new Error('not here');
    });
    await expect(yieldThroughMessage()).resolves.toBeUndefined();
  });
  it('resolves once on the fallback timer when the channel never delivers, closing it', async () => {
    vi.useFakeTimers();
    try {
      const ports: { port1: SilentPort; port2: SilentPort }[] = [];
      vi.stubGlobal(
        'MessageChannel',
        class {
          readonly port1 = new SilentPort();
          readonly port2 = new SilentPort();
          constructor() {
            ports.push(this);
          }
        }
      );
      let resolved = 0;
      void yieldThroughMessage().then(() => resolved++);
      await vi.advanceTimersByTimeAsync(RUCSS_INLINE_CHECK_YIELD_FALLBACK_MS - 1);
      expect(resolved).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(1);
      const [channel] = ports;
      expect(channel?.port1.close).toHaveBeenCalledOnce();
      // A late delivery changes nothing.
      channel?.port1.onmessage?.();
      await vi.advanceTimersByTimeAsync(RUCSS_INLINE_CHECK_YIELD_FALLBACK_MS);
      expect(channel?.port1.close).toHaveBeenCalledOnce();
      expect(resolved).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the fallback timer when the channel delivers first', async () => {
    vi.useFakeTimers();
    try {
      let deliver: (() => void) | undefined;
      vi.stubGlobal(
        'MessageChannel',
        class {
          readonly port1 = new SilentPort();
          readonly port2 = {
            postMessage: () => {
              deliver = () => this.port1.onmessage?.();
            }
          };
        }
      );
      const turn = yieldThroughMessage();
      expect(vi.getTimerCount()).toBe(1);
      deliver?.();
      await expect(turn).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** A message port double that never delivers on its own. */
class SilentPort {
  onmessage: (() => void) | null = null;
  readonly close = vi.fn();
  readonly postMessage = vi.fn();
}

describe('createInlineCheckPacer', () => {
  it('ends the judging right after a hand-back once told to stop', async () => {
    let time = 0;
    let stop = false;
    const yieldToPage = vi.fn(() => {
      stop = true;
      return Promise.resolve();
    });
    const pacer = createInlineCheckPacer(
      () => time,
      yieldToPage,
      () => stop
    );
    time = RUCSS_INLINE_CHECK_SLICE_MS;
    await expect(pacer.checkpoint()).resolves.toBe(false);
    expect(yieldToPage).toHaveBeenCalledOnce();
  });

  it('goes on within a slice, yields once a slice is used up, stops past the budget', async () => {
    let time = 0;
    const yieldToPage = vi.fn(() => Promise.resolve());
    const pacer = createInlineCheckPacer(() => time, yieldToPage);
    time = RUCSS_INLINE_CHECK_SLICE_MS - 1;
    expect(pacer.checkpoint()).toBe(true);
    time = RUCSS_INLINE_CHECK_SLICE_MS;
    await expect(pacer.checkpoint()).resolves.toBe(true);
    expect(yieldToPage).toHaveBeenCalledOnce();
    // A new slice starts after the yield.
    expect(pacer.checkpoint()).toBe(true);
    time = RUCSS_INLINE_CHECK_BUDGET_MS + 1;
    await expect(pacer.checkpoint()).resolves.toBe(false);
    expect(yieldToPage).toHaveBeenCalledOnce();
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
