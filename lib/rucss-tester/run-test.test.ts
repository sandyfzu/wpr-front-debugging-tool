/**
 * The run order: config → compile → start → build → apply, each failure
 * stopping before any later step (so nothing reaches the page after a
 * failure), and the tab steps' bounded, guarded asks.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logger';
import type { AskOutcome } from '../messaging/bounded-ask';
import type { RucssApplyReply, RucssStartReply } from '../messaging/rucss-test';
import type { TabAsks } from '../messaging/tab-asks';
import type { RucssBuildOutcome } from './build-client';
import { DEFAULT_RUCSS_TESTER_CONFIG, type RucssTesterConfig } from './config';
import { DEFAULT_INLINE_PRESERVES } from './run-plan';
import { rucssTabSteps, runRucssTest, type RucssTestDeps } from './run-test';

const RUN = '0123456789abcdef0123456789abcdef';
const SUMMARY = { removed: 2, preserved: 1, excluded: 1, gone: 0, cssChars: 5 };
const STARTED: RucssStartReply = {
  ok: true,
  runId: RUN,
  requestUrl: 'https://svc.test/?url=p',
  shakenCss: 'a{}',
  links: ['https://a.test/keep.css', 'https://a.test/x.css']
};
const BUILT: RucssBuildOutcome = { ok: true, css: 'b{}', applied: [], keepLinks: [0] };
const APPLIED: RucssApplyReply = { ok: true, summary: SUMMARY };

/** A silent logger recording its calls. */
function logDouble(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** A reply outcome. */
function reply<T>(value: T): AskOutcome<T> {
  return { kind: 'reply', reply: value };
}

/** Deps answering a full successful run unless overridden. */
function deps(
  overrides: Partial<RucssTestDeps> = {},
  config: RucssTesterConfig = DEFAULT_RUCSS_TESTER_CONFIG
): RucssTestDeps & {
  start: ReturnType<typeof vi.fn>;
  build: ReturnType<typeof vi.fn>;
  apply: ReturnType<typeof vi.fn>;
} {
  return {
    readConfig: vi.fn(() => Promise.resolve(config)),
    start: vi.fn(() => Promise.resolve(reply(STARTED))),
    build: vi.fn(() => Promise.resolve(BUILT)),
    apply: vi.fn(() => Promise.resolve(reply(APPLIED))),
    log: logDouble(),
    ...overrides
  } as never;
}

describe('runRucssTest', () => {
  it('runs every step in order with one configuration snapshot and answers `applied`', async () => {
    const config = {
      ...DEFAULT_RUCSS_TESTER_CONFIG,
      safelist: 'a\nb',
      inlinePreserve: 'mine',
      mobile: true
    };
    const d = deps({}, config);
    await expect(runRucssTest(d)).resolves.toEqual({
      kind: 'applied',
      requestUrl: STARTED.requestUrl,
      summary: SUMMARY,
      applied: []
    });
    expect(d.readConfig).toHaveBeenCalledTimes(1);
    expect(d.start).toHaveBeenCalledWith({
      safelist: ['a', 'b'],
      inlinePreserves: [...DEFAULT_INLINE_PRESERVES, 'mine'],
      mobile: true,
      home: false
    });
    expect(d.build).toHaveBeenCalledWith({
      config,
      shakenCss: STARTED.shakenCss,
      links: STARTED.links
    });
    expect(d.apply).toHaveBeenCalledWith({ runId: RUN, css: 'b{}', keepLinks: [0] });
  });

  it('stops before any request when the configuration cannot be read', async () => {
    const d = deps({ readConfig: () => Promise.reject(new Error('context invalidated')) });
    await expect(runRucssTest(d)).resolves.toEqual({ kind: 'config-unreadable' });
    expect(d.start).not.toHaveBeenCalled();
  });

  it('logs a non-Error send failure as it is', async () => {
    const warn = vi.fn();
    const failedApply = deps({
      apply: () => Promise.resolve({ kind: 'failed', cause: 'gone' }),
      log: { ...logDouble(), warn }
    });
    await expect(runRucssTest(failedApply)).resolves.toEqual({
      kind: 'page-unreachable',
      step: 'apply',
      miss: 'failed'
    });
    expect(warn).toHaveBeenCalledWith('RUCSS test apply failed', 'gone');
  });

  it('stops before any request on an invalid pattern, naming every problem', async () => {
    const d = deps({}, { ...DEFAULT_RUCSS_TESTER_CONFIG, excludeFiles: '(' });
    const outcome = await runRucssTest(d);
    expect(outcome.kind).toBe('invalid-config');
    expect(d.start).not.toHaveBeenCalled();
  });

  it('answers a start miss without building or applying', async () => {
    for (const miss of ['no-receiver', 'timeout', 'invalid-reply'] as const) {
      const d = deps({ start: () => Promise.resolve({ kind: miss }) });
      await expect(runRucssTest(d)).resolves.toEqual({
        kind: 'page-unreachable',
        step: 'start',
        miss
      });
      expect(d.build).not.toHaveBeenCalled();
      expect(d.apply).not.toHaveBeenCalled();
    }
    const warn = vi.fn();
    const d = deps({
      start: () => Promise.resolve({ kind: 'failed', cause: new Error('boom') }),
      log: { ...logDouble(), warn }
    });
    await expect(runRucssTest(d)).resolves.toMatchObject({ miss: 'failed' });
    expect(warn).toHaveBeenCalledWith('RUCSS test start failed', 'boom');
  });

  it('answers a start failure without building or applying', async () => {
    const failure = { kind: 'fetch', requestUrl: 'u', failure: { kind: 'timeout' } } as const;
    const d = deps({ start: () => Promise.resolve(reply({ ok: false, failure })) });
    await expect(runRucssTest(d)).resolves.toEqual({ kind: 'start-failed', failure });
    expect(d.build).not.toHaveBeenCalled();
    expect(d.apply).not.toHaveBeenCalled();
  });

  it('answers a build failure without applying', async () => {
    for (const failure of [
      { ok: false, problem: 'timeout' },
      { ok: false, problem: 'oversize', index: 1 },
      { ok: false, problem: 'pattern-failed', index: 0, message: 'stack' }
    ] as const) {
      const d = deps({ build: () => Promise.resolve(failure) });
      await expect(runRucssTest(d)).resolves.toEqual({
        kind: 'build-failed',
        requestUrl: STARTED.requestUrl,
        failure
      });
      expect(d.apply).not.toHaveBeenCalled();
    }
  });

  it('answers an apply miss (page state unknown) and an apply refusal', async () => {
    const missed = deps({ apply: () => Promise.resolve({ kind: 'timeout' }) });
    await expect(runRucssTest(missed)).resolves.toEqual({
      kind: 'page-unreachable',
      step: 'apply',
      miss: 'timeout'
    });
    const refused = deps({
      apply: () => Promise.resolve(reply({ ok: false, failure: 'stale-run' }))
    });
    await expect(runRucssTest(refused)).resolves.toEqual({
      kind: 'apply-failed',
      failure: 'stale-run'
    });
  });
});

describe('rucssTabSteps', () => {
  /** Tab asks answering the RUCSS steps with the given raw answers. */
  function asks(start: unknown, apply: unknown): TabAsks {
    return {
      processPageData: vi.fn(),
      getFdtData: vi.fn(),
      getScriptSourceChunk: vi.fn(),
      startRucssTest: vi.fn(() => Promise.resolve(start)),
      applyRucssTest: vi.fn(() => Promise.resolve(apply)),
      runBeaconTest: vi.fn(),
      runLcpAnalysis: vi.fn(),
      getScriptRuntimeStatuses: vi.fn(),
      getCurrentVisitVitals: vi.fn()
    };
  }

  it('asks the bound tab and guards the answers', async () => {
    const tab = asks(STARTED, APPLIED);
    const steps = rucssTabSteps(tab, 9);
    const request = { safelist: [], inlinePreserves: [], mobile: false, home: false };
    await expect(steps.start(request)).resolves.toEqual(reply(STARTED));
    expect(tab.startRucssTest).toHaveBeenCalledWith(9, request);
    const apply = { runId: RUN, css: '', keepLinks: [] };
    await expect(steps.apply(apply)).resolves.toEqual(reply(APPLIED));
    expect(tab.applyRucssTest).toHaveBeenCalledWith(9, apply);
  });

  it('reads a malformed answer as `invalid-reply`', async () => {
    const steps = rucssTabSteps(asks({ ok: true }, { ok: true }), 1);
    await expect(
      steps.start({ safelist: [], inlinePreserves: [], mobile: false, home: false })
    ).resolves.toEqual({ kind: 'invalid-reply' });
    await expect(steps.apply({ runId: RUN, css: '', keepLinks: [] })).resolves.toEqual({
      kind: 'invalid-reply'
    });
  });
});
