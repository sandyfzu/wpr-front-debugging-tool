/**
 * The session controller over the real `session:`/`local:` stores (fake
 * browser) with a fake backend, fake pushes and a fake logger: every
 * channel's answers, the apply arms (armed / unavailable / cap / faults),
 * Stop, tab close, the host side (origin gate, rewrite + record, body
 * unavailable, interception ended), wake re-validation, reset, push
 * failures, and serialized races.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logger';
import { applyPipeline } from '../exclusion-builder/pipeline';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../exclusion-builder/set';
import type { ExclusionSessionStatus } from '../messaging/exclusion-session';
import type { LooseMessageSender } from '../messaging/sender';
import {
  EXCLUSION_SESSION_LIMIT,
  getExclusionSessionRecords,
  getExclusionSessionStatus,
  putExclusionSessionRecord,
  removeExclusionSessionRecord
} from '../storage/exclusion-sessions';
import { getSavedExclusionSet, saveExclusionSet } from '../storage/exclusion-sets';
import type { ArmResult, InterceptionBackend, InterceptionHost } from './backend';
import {
  createExclusionSessionController,
  type ExclusionSessionController,
  type ExclusionSessionControllerDeps
} from './controller';
import { DOCUMENT_TRANSFORM_BUDGET_MS, type DocumentTransformRunner } from './document-transform';
import type { ScheduleTimer } from '../messaging/bounded-ask';
import { INTERCEPTION_HOST_BOUNDS_MS, SESSION_STEP_TIMEOUTS_MS } from './timeouts';

const TAB = 3;
const ORIGIN = 'https://site.test';
const EXTENSION_ID = 'ext-id';
const NOW = 1_800_000_000_000;
const DELAYED = '<script type="rocketlazyloadscript" data-rocket-src="a.js"></script>';
const SET: ExclusionSet = {
  rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['a\\.js'] },
  disable: EMPTY_EXCLUSION_SET.disable
};

/** A top-frame content-script sender for a tab. */
function page(tabId = TAB, url = `${ORIGIN}/page`): LooseMessageSender {
  return { tab: { id: tabId }, frameId: 0, url, id: EXTENSION_ID };
}

/** The panel's sender (tab-less extension page). */
const PANEL: LooseMessageSender = {
  id: EXTENSION_ID,
  url: `chrome-extension://${EXTENSION_ID}/panel.html`
};

/** A fake backend recording its calls. */
class FakeBackend implements InterceptionBackend {
  armResult: ArmResult | Error = { armed: true };
  resumeResult: boolean | Error = true;
  disarmError: Error | null = null;
  runner?: DocumentTransformRunner;
  readonly calls: string[] = [];

  arm(tabId: number): Promise<ArmResult> {
    this.calls.push(`arm:${String(tabId)}`);
    return this.armResult instanceof Error
      ? Promise.reject(this.armResult)
      : Promise.resolve(this.armResult);
  }

  disarm(tabId: number): Promise<void> {
    this.calls.push(`disarm:${String(tabId)}`);
    return this.disarmError === null ? Promise.resolve() : Promise.reject(this.disarmError);
  }

  resume(tabId: number): Promise<boolean> {
    this.calls.push(`resume:${String(tabId)}`);
    return this.resumeResult instanceof Error
      ? Promise.reject(this.resumeResult)
      : Promise.resolve(this.resumeResult);
  }
}

/** A logger recording every line. */
function fakeLog(): Logger & { lines: { level: string; message: string }[] } {
  const lines: { level: string; message: string }[] = [];
  const at = (level: string) => (message: string) => {
    lines.push({ level, message });
  };
  return { lines, debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

/** Whether a line at `level` matching `pattern` was logged. */
function logged(log: ReturnType<typeof fakeLog>, level: string, pattern: RegExp): boolean {
  return log.lines.some((line) => line.level === level && pattern.test(line.message));
}

/** The test rig: controller + its fakes. */
interface Rig {
  controller: ExclusionSessionController;
  backend: FakeBackend;
  host: InterceptionHost;
  log: ReturnType<typeof fakeLog>;
  tabPushes: [number, ExclusionSessionStatus][];
  panelPushes: [number, ExclusionSessionStatus][];
  reloads: number[];
  existingTabs: Set<number>;
  deps: ExclusionSessionControllerDeps;
}

/** Build a rig; `overrides` replace deps (a `null` backend means none). */
function rig(
  overrides: Partial<ExclusionSessionControllerDeps> & { noBackend?: boolean } = {}
): Rig {
  const backend = new FakeBackend();
  const log = fakeLog();
  const tabPushes: [number, ExclusionSessionStatus][] = [];
  const panelPushes: [number, ExclusionSessionStatus][] = [];
  const reloads: number[] = [];
  const existingTabs = new Set([TAB, 4, 5]);
  const deps: ExclusionSessionControllerDeps = {
    createBackend: () => (overrides.noBackend === true ? null : backend),
    sessions: {
      read: getExclusionSessionStatus,
      readAll: getExclusionSessionRecords,
      put: putExclusionSessionRecord,
      remove: removeExclusionSessionRecord
    },
    savedSets: {
      get: getSavedExclusionSet,
      save: (origin, set) => saveExclusionSet(origin, set, NOW)
    },
    pushToTab: (tabId, status) => {
      tabPushes.push([tabId, status]);
      return Promise.resolve();
    },
    pushToPanels: (tabId, status) => {
      panelPushes.push([tabId, status]);
      return Promise.resolve();
    },
    reload: (tabId) => {
      reloads.push(tabId);
    },
    tabExists: (tabId) => Promise.resolve(existingTabs.has(tabId)),
    now: () => NOW,
    extensionId: EXTENSION_ID,
    log,
    ...overrides
  };
  const controller = createExclusionSessionController(deps);
  return {
    controller,
    backend,
    host: controller.host,
    log,
    tabPushes,
    panelPushes,
    reloads,
    existingTabs,
    deps
  };
}

/** An active record for a tab. */
async function seedActive(tabId = TAB, startedAt = NOW - 1000): Promise<void> {
  await putExclusionSessionRecord(tabId, {
    state: 'active',
    origin: ORIGIN,
    set: SET,
    startedAt,
    document: null
  });
}

/** Let queued, unawaited work settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const encoder = new TextEncoder();

/** An HTML document of the tab (eligible, same origin as the session). */
function htmlDoc(url = `${ORIGIN}/next`, html = DELAYED) {
  return {
    tabId: TAB,
    body: encoder.encode(html),
    contentType: 'text/html; charset=utf-8',
    documentUrl: url,
    status: 200,
    method: 'GET'
  };
}

/** A promise that never settles (a hung browser API). */
function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

/**
 * Manual timers: `fire()` runs every pending deadline (settled steps cancel
 * theirs), or only those of `ms` when given (the shortest stuck step first).
 */
function manualTimers(): {
  schedule: ScheduleTimer;
  fire: (ms?: number) => void;
  delays: number[];
} {
  const pending = new Set<{ run: () => void; ms: number }>();
  const delays: number[] = [];
  return {
    schedule: (run, ms) => {
      const timer = { run, ms };
      delays.push(ms);
      pending.add(timer);
      return () => pending.delete(timer);
    },
    fire: (ms) => {
      for (const timer of [...pending]) {
        if (ms !== undefined && timer.ms !== ms) continue;
        pending.delete(timer);
        timer.run();
      }
    },
    delays
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('apply', () => {
  it('arms, stores the active record, saves the set, notifies, then reloads', async () => {
    const r = rig();
    await expect(r.controller.apply(page(), { set: SET })).resolves.toEqual({
      outcome: 'applying'
    });
    const active = { state: 'active', origin: ORIGIN, set: SET, startedAt: NOW, document: null };
    await expect(getExclusionSessionStatus(TAB)).resolves.toEqual(active);
    await expect(getSavedExclusionSet(ORIGIN)).resolves.toEqual(SET);
    expect(r.backend.calls).toEqual([`arm:${String(TAB)}`]);
    expect(r.tabPushes).toEqual([[TAB, active]]);
    expect(r.panelPushes).toEqual([[TAB, active]]);
    expect(r.reloads).toEqual([TAB]);
  });

  it('refuses a sender that is not a top-frame http(s) page as unsupported-page', async () => {
    const r = rig();
    const subframe = { ...page(), frameId: 2 };
    await expect(r.controller.apply(subframe, { set: SET })).resolves.toEqual({
      outcome: 'unavailable',
      cause: 'unsupported-page'
    });
    await expect(r.controller.apply(undefined, { set: SET })).resolves.toMatchObject({
      cause: 'unsupported-page'
    });
    expect(r.backend.calls).toEqual([]);
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
  });

  it('rejects a malformed payload (the sender sees `failed`)', async () => {
    const r = rig();
    await expect(r.controller.apply(page(), { set: 'nope' })).rejects.toThrow(/malformed payload/);
    expect(r.backend.calls).toEqual([]);
  });

  it('answers invalid rows without arming or saving', async () => {
    const r = rig();
    const reply = await r.controller.apply(page(), {
      set: { ...SET, rows: { ...SET.rows, delayJs: ['('] } }
    });
    expect(reply).toMatchObject({
      outcome: 'invalid',
      invalid: [{ feature: 'delay_js', index: 0, row: '(' }]
    });
    expect(r.backend.calls).toEqual([]);
    await expect(getSavedExclusionSet(ORIGIN)).resolves.toBeNull();
  });

  it('answers unsupported-browser without a backend and stores the warning', async () => {
    const r = rig({ noBackend: true });
    await expect(r.controller.apply(page(), { set: SET })).resolves.toEqual({
      outcome: 'unavailable',
      cause: 'unsupported-browser'
    });
    const warning = { state: 'unavailable', cause: 'unsupported-browser', at: NOW };
    await expect(getExclusionSessionStatus(TAB)).resolves.toEqual(warning);
    await expect(getSavedExclusionSet(ORIGIN)).resolves.toBeNull();
    expect(r.tabPushes).toEqual([[TAB, warning]]);
    expect(r.reloads).toEqual([]);
  });

  it('degrades to unsupported-browser when the backend fails to start', async () => {
    const r = rig({
      createBackend: () => {
        throw new Error('boom');
      }
    });
    await expect(r.controller.apply(page(), { set: SET })).resolves.toMatchObject({
      cause: 'unsupported-browser'
    });
    expect(logged(r.log, 'error', /backend failed to start/)).toBe(true);
  });

  it('answers the backend cause, disarms, stores the warning, saves nothing', async () => {
    const r = rig();
    r.backend.armResult = { armed: false, cause: 'debugging-policy' };
    await expect(r.controller.apply(page(), { set: SET })).resolves.toEqual({
      outcome: 'unavailable',
      cause: 'debugging-policy'
    });
    expect(r.backend.calls).toEqual([`arm:${String(TAB)}`, `disarm:${String(TAB)}`]);
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      cause: 'debugging-policy'
    });
    await expect(getSavedExclusionSet(ORIGIN)).resolves.toBeNull();
    expect(r.reloads).toEqual([]);
  });

  it('refuses past the live-session cap without arming', async () => {
    const r = rig();
    for (let tab = 100; tab < 100 + EXCLUSION_SESSION_LIMIT; tab++) await seedActive(tab);
    await expect(r.controller.apply(page(), { set: SET })).resolves.toEqual({
      outcome: 'unavailable',
      cause: 'session-limit'
    });
    expect(r.backend.calls).toEqual([`disarm:${String(TAB)}`]);
  });

  it('maps a store-side cap refusal (a racing tab) to session-limit and disarms', async () => {
    const r = rig();
    r.deps.sessions.put = vi
      .fn<ExclusionSessionControllerDeps['sessions']['put']>()
      .mockResolvedValueOnce('limit-reached')
      .mockImplementation(putExclusionSessionRecord);
    await expect(r.controller.apply(page(), { set: SET })).resolves.toMatchObject({
      cause: 'session-limit'
    });
    expect(r.backend.calls).toEqual([`arm:${String(TAB)}`, `disarm:${String(TAB)}`]);
  });

  it('rejects when the backend arm faults, leaving no session', async () => {
    const r = rig();
    r.backend.armResult = new Error('cdp broke');
    await expect(r.controller.apply(page(), { set: SET })).rejects.toThrow(/could not be armed/);
    expect(r.backend.calls).toEqual([`arm:${String(TAB)}`, `disarm:${String(TAB)}`]);
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
    expect(logged(r.log, 'error', /Arming failed/)).toBe(true);
  });

  it('rejects when the active record cannot be stored', async () => {
    const r = rig();
    r.deps.sessions.put = () => Promise.reject(new Error('quota'));
    await expect(r.controller.apply(page(), { set: SET })).rejects.toThrow(/could not be armed/);
    expect(r.reloads).toEqual([]);
  });

  it('re-applies over an active session (Reset) with a newer start and the new set', async () => {
    const r = rig();
    await seedActive(TAB, NOW);
    const other: ExclusionSet = { ...SET, disable: { ...SET.disable, deferJs: true } };
    await expect(r.controller.apply(page(), { set: other })).resolves.toEqual({
      outcome: 'applying'
    });
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      startedAt: NOW + 1,
      set: other
    });
    expect(r.backend.calls).toEqual([`arm:${String(TAB)}`]);
  });

  it('stays applying when saving the set, the reload or a push fails (logged)', async () => {
    const r = rig({
      savedSets: { get: getSavedExclusionSet, save: () => Promise.reject(new Error('disk')) },
      reload: () => {
        throw new Error('tab gone');
      },
      pushToTab: () =>
        Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')),
      pushToPanels: () => Promise.reject(new Error('real failure'))
    });
    await expect(r.controller.apply(page(), { set: SET })).resolves.toEqual({
      outcome: 'applying'
    });
    const messages = r.log.lines.map((line) => `${line.level}:${line.message}`);
    expect(messages).toContain('error:Applied set not saved for its origin');
    expect(messages).toContain('error:Tab reload could not be scheduled');
    expect(messages).toContain('debug:Session push without a listener (expected)');
    expect(messages).toContain('error:Session push failed');
  });
});

describe('stop', () => {
  it('ends an active session: disarm, clear, notify inactive', async () => {
    const r = rig();
    await seedActive();
    await expect(r.controller.stop(page())).resolves.toEqual({ state: 'inactive' });
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
    expect(r.backend.calls).toEqual([`disarm:${String(TAB)}`]);
    expect(r.tabPushes).toEqual([[TAB, { state: 'inactive' }]]);
  });

  it('clears an unavailable warning', async () => {
    const r = rig();
    await putExclusionSessionRecord(TAB, { state: 'unavailable', cause: 'detached', at: 1 });
    await expect(r.controller.stop(page())).resolves.toEqual({ state: 'inactive' });
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
  });

  it('answers inactive for a non-page sender without touching anything', async () => {
    const r = rig();
    await expect(r.controller.stop(PANEL)).resolves.toEqual({ state: 'inactive' });
    expect(r.backend.calls).toEqual([]);
  });

  it('rejects when the record cannot be removed (retryable), still disarming and logging a disarm fault', async () => {
    const r = rig();
    await seedActive();
    r.backend.disarmError = new Error('detach failed');
    r.deps.sessions.remove = () => Promise.reject(new Error('storage down'));
    await expect(r.controller.stop(page())).rejects.toThrow('storage down');
    expect(r.log.lines).toContainEqual({ level: 'error', message: 'Disarm failed' });
  });

  it('wraps a non-Error removal failure', async () => {
    const r = rig();
    await seedActive();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection is the case under test
    r.deps.sessions.remove = () => Promise.reject('nope');
    await expect(r.controller.stop(page())).rejects.toThrow('Session record removal failed');
  });
});

describe('status asks', () => {
  it('answers the stored status for the sender tab, inactive for non-pages', async () => {
    const r = rig();
    await seedActive();
    await expect(r.controller.status(page())).resolves.toMatchObject({ state: 'active' });
    await expect(r.controller.status(page(4))).resolves.toEqual({ state: 'inactive' });
    await expect(r.controller.status(PANEL)).resolves.toEqual({ state: 'inactive' });
  });

  it('answers the panel by payload tab id, only for this extension’s tab-less pages', async () => {
    const r = rig();
    await seedActive();
    await expect(r.controller.statusForTab(PANEL, { tabId: TAB })).resolves.toMatchObject({
      state: 'active'
    });
    await expect(r.controller.statusForTab(page(), { tabId: TAB })).rejects.toThrow(
      /only extension pages/
    );
    await expect(r.controller.statusForTab({ id: 'other' }, { tabId: TAB })).rejects.toThrow(
      /only extension pages/
    );
    await expect(r.controller.statusForTab(PANEL, { tabId: -1 })).rejects.toThrow(
      /malformed query/
    );
  });
});

describe('saved sets', () => {
  it('reads the sender origin’s saved set (null when none, or for non-pages)', async () => {
    const r = rig();
    await expect(r.controller.savedSet(page())).resolves.toEqual({ set: null });
    await saveExclusionSet(ORIGIN, SET, NOW);
    await expect(r.controller.savedSet(page())).resolves.toEqual({ set: SET });
    await expect(r.controller.savedSet(PANEL)).resolves.toEqual({ set: null });
  });

  it('rejects when the store read fails', async () => {
    const r = rig({
      savedSets: { get: () => Promise.reject(new Error('io')), save: () => Promise.resolve() }
    });
    await expect(r.controller.savedSet(page())).rejects.toThrow('io');
  });

  it('saves any wire-valid draft, engine-invalid rows included', async () => {
    const r = rig();
    const draft = { ...SET, rows: { ...SET.rows, delayJs: ['('] } };
    await expect(r.controller.save(page(), { set: draft })).resolves.toEqual({ outcome: 'saved' });
    await expect(getSavedExclusionSet(ORIGIN)).resolves.toEqual(draft);
  });

  it('answers each not-saved reason', async () => {
    const r = rig();
    await expect(r.controller.save(PANEL, { set: SET })).resolves.toEqual({
      outcome: 'not-saved',
      reason: 'unsupported-page'
    });
    await expect(r.controller.save(page(), { set: SET, extra: 1 })).resolves.toEqual({
      outcome: 'not-saved',
      reason: 'invalid-request'
    });
    const failing = rig({
      savedSets: { get: getSavedExclusionSet, save: () => Promise.reject(new Error('q')) }
    });
    await expect(failing.controller.save(page(), { set: SET })).resolves.toEqual({
      outcome: 'not-saved',
      reason: 'storage-failed'
    });
  });
});

describe('tab close', () => {
  it('clears the record and disarms, pushing nothing', async () => {
    const r = rig();
    await seedActive();
    await r.controller.tabClosed(TAB);
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
    expect(r.backend.calls).toEqual([`disarm:${String(TAB)}`]);
    expect(r.tabPushes).toEqual([]);
  });

  it('never rejects (a failing removal is logged)', async () => {
    const r = rig();
    await seedActive();
    r.deps.sessions.remove = () => Promise.reject(new Error('io'));
    await expect(r.controller.tabClosed(TAB)).resolves.toBeUndefined();
    expect(r.log.lines).toContainEqual({
      level: 'error',
      message: 'Session tab-close cleanup failed'
    });
  });
});

describe('host', () => {
  const doc = (url = `${ORIGIN}/next`, html = DELAYED) => ({
    tabId: TAB,
    body: encoder.encode(html),
    contentType: 'text/html; charset=utf-8',
    documentUrl: url,
    status: 200,
    method: 'GET'
  });

  it('gates interception on an active session of the document’s origin', async () => {
    const r = rig();
    await expect(r.host.shouldIntercept(TAB, `${ORIGIN}/x`)).resolves.toBe(false);
    await seedActive();
    await expect(r.host.shouldIntercept(TAB, `${ORIGIN}/x`)).resolves.toBe(true);
    await expect(r.host.shouldIntercept(TAB, 'https://other.test/x')).resolves.toBe(false);
    await expect(r.host.shouldIntercept(TAB, 'not a url')).resolves.toBe(false);
  });

  it('rewrites a session document and records its outcome', async () => {
    const r = rig();
    await seedActive();
    const body = await r.host.rewriteDocument(doc());
    const expected = applyPipeline(DELAYED, SET);
    expect(body).toEqual(encoder.encode(expected.html));
    await flush();
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      document: { outcome: 'rewritten', reports: expected.reports }
    });
    expect(r.tabPushes.at(-1)?.[1]).toMatchObject({ document: { outcome: 'rewritten' } });
  });

  it('passes other origins and session-less tabs through without recording', async () => {
    const r = rig();
    await expect(r.host.rewriteDocument(doc())).resolves.toBeNull();
    await seedActive();
    await expect(r.host.rewriteDocument(doc('https://other.test/'))).resolves.toBeNull();
    await flush();
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({ document: null });
  });

  it('uses the backend’s runner when it has one, and logs an engine failure', async () => {
    const r = rig();
    await seedActive();
    r.backend.runner = () =>
      Promise.resolve({
        ok: false,
        outcome: { outcome: 'failed', reason: 'engine-failed' },
        cause: new Error('x')
      });
    await expect(r.host.rewriteDocument(doc())).resolves.toBeNull();
    await flush();
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      document: { outcome: 'failed', reason: 'engine-failed' }
    });
    expect(logged(r.log, 'error', /engine failed/)).toBe(true);
  });

  it('serves unmodified when the session read fails', async () => {
    const r = rig();
    r.deps.sessions.read = () => Promise.reject(new Error('io'));
    await expect(r.host.rewriteDocument(doc())).resolves.toBeNull();
    expect(logged(r.log, 'error', /Session read failed/)).toBe(true);
  });

  it('drops a document record that lands after a re-apply (the old session’s)', async () => {
    let release: () => void = () => undefined;
    const r = rig();
    await seedActive(TAB, NOW - 5);
    r.backend.runner = (request) =>
      new Promise((resolve) => {
        release = () => {
          resolve({ ok: true, html: request.html, outcome: { outcome: 'rewritten', reports: [] } });
        };
      });
    const pending = r.host.rewriteDocument(doc());
    await flush();
    await r.controller.apply(page(), { set: SET });
    release();
    await pending;
    await flush();
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      startedAt: NOW,
      document: null
    });
  });

  it('records an unreadable body for the session', async () => {
    const r = rig();
    await seedActive();
    await r.host.documentBodyUnavailable(TAB, `${ORIGIN}/x`);
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      document: { outcome: 'failed', reason: 'body-unavailable' }
    });
    await r.host.documentBodyUnavailable(4, `${ORIGIN}/x`);
    await expect(getExclusionSessionStatus(4)).resolves.toEqual({ state: 'inactive' });
  });

  it('turns an ended interception into the warning and notifies', async () => {
    const r = rig();
    await seedActive();
    await r.host.interceptionEnded(TAB, 'infobar-cancelled', NOW - 1000);
    const warning = { state: 'unavailable', cause: 'infobar-cancelled', at: NOW };
    await expect(getExclusionSessionStatus(TAB)).resolves.toEqual(warning);
    expect(r.backend.calls).toEqual([`disarm:${String(TAB)}`]);
    expect(r.panelPushes).toEqual([[TAB, warning]]);
  });

  it('ignores an ended interception without a live session', async () => {
    const r = rig();
    await r.host.interceptionEnded(TAB, 'detached', NOW - 1000);
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
    expect(r.tabPushes).toEqual([]);
  });

  it('logs a failing document-record write without failing the document', async () => {
    const r = rig();
    await seedActive();
    r.deps.sessions.put = () => Promise.reject(new Error('quota'));
    await expect(r.host.rewriteDocument(doc())).resolves.not.toBeNull();
    await flush();
    expect(r.log.lines).toContainEqual({ level: 'error', message: 'Session record write failed' });
  });

  it('logs a record refused at the cap', async () => {
    const r = rig();
    await seedActive();
    r.deps.sessions.put = () => Promise.resolve('limit-reached');
    await r.host.documentBodyUnavailable(TAB, `${ORIGIN}/x`);
    expect(r.log.lines).toContainEqual({
      level: 'warn',
      message: 'Session record refused at the cap'
    });
  });
});

describe('wake re-validation', () => {
  it('keeps a session the backend resumes', async () => {
    await seedActive();
    const r = rig();
    await r.controller.revalidate();
    expect(r.backend.calls).toEqual([`resume:${String(TAB)}`]);
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({ state: 'active' });
  });

  it.each([
    ['the backend reports it stale', (b: FakeBackend) => (b.resumeResult = false)],
    ['the resume faults', (b: FakeBackend) => (b.resumeResult = new Error('x'))]
  ])('clears a session when %s, notifying inactive', async (_case, arrange) => {
    await seedActive();
    const r = rig();
    arrange(r.backend);
    await r.controller.revalidate();
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
    expect(r.tabPushes).toEqual([[TAB, { state: 'inactive' }]]);
  });

  it('clears active sessions when no backend exists', async () => {
    await seedActive();
    const r = rig({ noBackend: true });
    await r.controller.revalidate();
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
  });

  it('clears records of tabs that are gone (active and warnings), without resuming', async () => {
    await seedActive(9);
    await putExclusionSessionRecord(10, { state: 'unavailable', cause: 'detached', at: 1 });
    await putExclusionSessionRecord(4, { state: 'unavailable', cause: 'detached', at: 1 });
    const r = rig();
    await r.controller.revalidate();
    await expect(getExclusionSessionRecords()).resolves.toEqual({
      '4': { state: 'unavailable', cause: 'detached', at: 1 }
    });
    expect(r.backend.calls).toEqual(['disarm:9', 'disarm:10']);
  });

  it('keeps a record when the tab probe fails (logged)', async () => {
    await seedActive();
    const r = rig({ tabExists: () => Promise.reject(new Error('io')) });
    await r.controller.revalidate();
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({ state: 'active' });
    expect(r.log.lines).toContainEqual({
      level: 'error',
      message: 'Wake tab probe failed — record kept'
    });
  });

  it('never rejects when the sessions cannot be read', async () => {
    const r = rig();
    r.deps.sessions.readAll = () => Promise.reject(new Error('io'));
    await expect(r.controller.revalidate()).resolves.toBeUndefined();
    expect(r.log.lines).toContainEqual({
      level: 'error',
      message: 'Wake re-validation could not read the sessions'
    });
  });

  it('holds asks and documents until it settles', async () => {
    await seedActive();
    const r = rig();
    let resolveResume: (live: boolean) => void = () => undefined;
    r.backend.resume = () =>
      new Promise((resolve) => {
        resolveResume = resolve;
      });
    const revalidation = r.controller.revalidate();
    const status = r.controller.status(page());
    const gate = r.host.shouldIntercept(TAB, `${ORIGIN}/`);
    await flush();
    resolveResume(false);
    await revalidation;
    await expect(status).resolves.toEqual({ state: 'inactive' });
    await expect(gate).resolves.toBe(false);
  });
});

describe('reset (install/update)', () => {
  it('ends every session and warning', async () => {
    await seedActive(TAB);
    await seedActive(4);
    await putExclusionSessionRecord(5, { state: 'unavailable', cause: 'detached', at: 1 });
    const r = rig();
    await r.controller.resetAll();
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
    expect([...r.backend.calls].sort()).toEqual(['disarm:3', 'disarm:4', 'disarm:5']);
  });

  it('never rejects when the sessions cannot be read', async () => {
    const r = rig();
    r.deps.sessions.readAll = () => Promise.reject(new Error('io'));
    await expect(r.controller.resetAll()).resolves.toBeUndefined();
  });
});

describe('serialized races', () => {
  it('apply then stop, sent together: both run in order, the stop wins', async () => {
    const r = rig();
    let releaseArm: () => void = () => undefined;
    r.backend.arm = (tabId) => {
      r.backend.calls.push(`arm:${String(tabId)}`);
      return new Promise((resolve) => {
        releaseArm = () => {
          resolve({ armed: true });
        };
      });
    };
    const applying = r.controller.apply(page(), { set: SET });
    const stopping = r.controller.stop(page());
    await flush();
    expect(r.backend.calls).toEqual([`arm:${String(TAB)}`]);
    releaseArm();
    await expect(applying).resolves.toEqual({ outcome: 'applying' });
    await expect(stopping).resolves.toEqual({ state: 'inactive' });
    expect(r.backend.calls).toEqual([`arm:${String(TAB)}`, `disarm:${String(TAB)}`]);
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
  });

  it('two applies in one tab arm one after the other; tabs are independent', async () => {
    const r = rig();
    const replies = await Promise.all([
      r.controller.apply(page(), { set: SET }),
      r.controller.apply(page(), { set: EMPTY_EXCLUSION_SET }),
      r.controller.apply(page(4), { set: SET })
    ]);
    expect(replies).toEqual([
      { outcome: 'applying' },
      { outcome: 'applying' },
      { outcome: 'applying' }
    ]);
    // Starts are issued per controller in task-start order (tab 3, tab 4, tab 3's second
    // apply), so with a fixed clock every session gets a distinct, increasing start.
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      set: EMPTY_EXCLUSION_SET,
      startedAt: NOW + 2
    });
    await expect(getExclusionSessionStatus(4)).resolves.toMatchObject({
      set: SET,
      startedAt: NOW + 1
    });
  });

  it('a failed task does not stall the tab’s next one', async () => {
    const r = rig();
    r.backend.armResult = new Error('once');
    await expect(r.controller.apply(page(), { set: SET })).rejects.toThrow();
    r.backend.armResult = { armed: true };
    await expect(r.controller.apply(page(), { set: SET })).resolves.toEqual({
      outcome: 'applying'
    });
  });
});

describe('response eligibility (rewrite gate)', () => {
  it.each([
    ['plain text', { contentType: 'text/plain' }],
    ['REST JSON', { contentType: 'application/json; charset=UTF-8' }],
    ['an RSS feed', { contentType: 'application/rss+xml; charset=UTF-8' }],
    ['SVG', { contentType: 'image/svg+xml' }],
    ['XHTML', { contentType: 'application/xhtml+xml' }],
    ['a redirect', { status: 301 }],
    ['304 Not Modified', { status: 304 }],
    ['206 Partial Content', { status: 206 }],
    ['a HEAD response', { method: 'HEAD' }]
  ])('passes %s through unrecorded, without running the engine', async (_case, override) => {
    const r = rig();
    await seedActive();
    const runner = vi.fn<DocumentTransformRunner>();
    r.backend.runner = runner;
    await expect(r.host.rewriteDocument({ ...htmlDoc(), ...override })).resolves.toBeNull();
    await flush();
    expect(runner).not.toHaveBeenCalled();
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({ document: null });
    expect(r.tabPushes).toEqual([]);
  });

  it('rewrites a themed 404 page', async () => {
    const r = rig();
    await seedActive();
    await expect(r.host.rewriteDocument({ ...htmlDoc(), status: 404 })).resolves.not.toBeNull();
  });
});

describe('time bounds', () => {
  it('answers attach-denied when the arm never settles, and the tab queue moves on', async () => {
    const timers = manualTimers();
    const r = rig({ schedule: timers.schedule });
    r.backend.arm = () => never();
    const applying = r.controller.apply(page(), { set: SET });
    await flush();
    expect(timers.delays).toContain(SESSION_STEP_TIMEOUTS_MS.arm);
    timers.fire();
    await expect(applying).resolves.toEqual({ outcome: 'unavailable', cause: 'attach-denied' });
    expect(logged(r.log, 'warn', /arm timed out/)).toBe(true);
    // The queue is not wedged: the next event of the tab runs.
    await expect(r.controller.stop(page())).resolves.toEqual({ state: 'inactive' });
  });

  it('disarms after an arm that times out, even when it succeeds late', async () => {
    const timers = manualTimers();
    const r = rig({ schedule: timers.schedule });
    let settleArm: (result: ArmResult) => void = () => undefined;
    r.backend.arm = () =>
      new Promise((resolve) => {
        settleArm = resolve;
      });
    const applying = r.controller.apply(page(), { set: SET });
    await flush();
    timers.fire(SESSION_STEP_TIMEOUTS_MS.arm);
    await expect(applying).resolves.toMatchObject({ cause: 'attach-denied' });
    settleArm({ armed: true }); // the late success
    await flush();
    expect(r.backend.calls).toEqual([`disarm:${String(TAB)}`]);
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      state: 'unavailable'
    });
  });

  it('clears and disarms after a resume that times out, even when it confirms late', async () => {
    await seedActive();
    const timers = manualTimers();
    const r = rig({ schedule: timers.schedule });
    let settleResume: (live: boolean) => void = () => undefined;
    r.backend.resume = (tabId) => {
      r.backend.calls.push(`resume:${String(tabId)}`);
      return new Promise((resolve) => {
        settleResume = resolve;
      });
    };
    const revalidation = r.controller.revalidate();
    await flush();
    timers.fire(SESSION_STEP_TIMEOUTS_MS.resume);
    await revalidation;
    settleResume(true); // the late confirmation
    await flush();
    expect(r.backend.calls).toEqual([`resume:${String(TAB)}`, `disarm:${String(TAB)}`]);
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
  });

  it('refuses an ask stuck behind its tab’s earlier events past the queue wait', async () => {
    const timers = manualTimers();
    const r = rig({ schedule: timers.schedule });
    r.backend.arm = () => never();
    const applying = r.controller.apply(page(), { set: SET });
    await flush();
    const stopping = r.controller.stop(page());
    const status = r.controller.status(page());
    await flush();
    timers.fire(SESSION_STEP_TIMEOUTS_MS.queueWait);
    timers.fire(SESSION_STEP_TIMEOUTS_MS.arm);
    await expect(applying).resolves.toMatchObject({ cause: 'attach-denied' });
    await expect(stopping).rejects.toThrow(/stopExclusionSession queue wait/);
    await expect(status).rejects.toThrow(/getExclusionSession queue wait/);
    expect(logged(r.log, 'warn', /waited too long/)).toBe(true);
    // Refused asks never ran: the warning the apply stored is still there.
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      state: 'unavailable'
    });
  });

  it('treats a never-settling resume as stale and still answers the asks waiting on the wake', async () => {
    await seedActive();
    const timers = manualTimers();
    const r = rig({ schedule: timers.schedule });
    r.backend.resume = () => never();
    const revalidation = r.controller.revalidate();
    const gate = r.host.shouldIntercept(TAB, `${ORIGIN}/`);
    await flush();
    timers.fire(); // the resume deadline (and any wait on it)
    await flush();
    timers.fire();
    await revalidation;
    await expect(gate).resolves.toBe(false);
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
  });

  it('still resumes an active record when the tab probe never answers', async () => {
    await seedActive();
    const timers = manualTimers();
    const r = rig({ schedule: timers.schedule, tabExists: () => never() });
    const revalidation = r.controller.revalidate();
    await flush();
    timers.fire();
    await revalidation;
    expect(r.backend.calls).toEqual([`resume:${String(TAB)}`]);
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({ state: 'active' });
  });

  it('serves unmodified when the session store never answers (host bound)', async () => {
    const timers = manualTimers();
    const r = rig({ schedule: timers.schedule });
    r.deps.sessions.read = () => never();
    const gate = r.host.shouldIntercept(TAB, `${ORIGIN}/`);
    const rewrite = r.host.rewriteDocument(htmlDoc());
    await flush();
    timers.fire();
    await expect(gate).resolves.toBe(false);
    await expect(rewrite).resolves.toBeNull();
  });

  it('answers within the host bound even when every inner step is stuck', async () => {
    const timers = manualTimers();
    const r = rig({ schedule: timers.schedule });
    await seedActive();
    // A wake that never ends: the host waits for it only within its own bound.
    r.deps.sessions.readAll = () => never();
    void r.controller.revalidate();
    const ended = r.host.interceptionEnded(TAB, 'detached', NOW - 1000);
    await flush();
    timers.fire();
    await flush();
    timers.fire();
    await expect(ended).resolves.toBeUndefined();
  });

  it('records engine-failed when the runner never answers', async () => {
    const timers = manualTimers();
    const r = rig({ schedule: timers.schedule });
    await seedActive();
    r.backend.runner = () => never();
    const rewrite = r.host.rewriteDocument(htmlDoc());
    await flush();
    timers.fire(DOCUMENT_TRANSFORM_BUDGET_MS + SESSION_STEP_TIMEOUTS_MS.runnerOverhead);
    await expect(rewrite).resolves.toBeNull();
    await flush();
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      document: { outcome: 'failed', reason: 'engine-failed' }
    });
  });

  it('stops even when the disarm and the pushes never settle', async () => {
    const timers = manualTimers();
    const r = rig({
      schedule: timers.schedule,
      pushToTab: () => never(),
      pushToPanels: () => never()
    });
    await seedActive();
    r.backend.disarm = () => never();
    const stopping = r.controller.stop(page());
    for (let i = 0; i < 3; i++) {
      await flush();
      timers.fire();
    }
    await expect(stopping).resolves.toEqual({ state: 'inactive' });
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
    expect(logged(r.log, 'error', /Disarm failed/)).toBe(true);
    expect(logged(r.log, 'error', /Session push failed/)).toBe(true);
  });

  it('fails a stuck store step without wedging the tab', async () => {
    const timers = manualTimers();
    const r = rig({ schedule: timers.schedule });
    r.deps.sessions.put = () => never();
    const applying = r.controller.apply(page(), { set: SET });
    await flush();
    timers.fire();
    await expect(applying).rejects.toThrow(/could not be armed/);
    r.deps.sessions.put = putExclusionSessionRecord;
    await expect(r.controller.apply(page(), { set: SET })).resolves.toEqual({
      outcome: 'applying'
    });
  });
});

describe('host safety nets', () => {
  it('serves unmodified and records nothing when a rewrite runs past its host bound', async () => {
    const timers = manualTimers();
    const r = rig({ schedule: timers.schedule });
    await seedActive();
    let release: () => void = () => undefined;
    r.backend.runner = (request) =>
      new Promise((resolve) => {
        release = () => {
          resolve({
            ok: true,
            html: `${request.html}x`,
            outcome: { outcome: 'rewritten', reports: [] }
          });
        };
      });
    const rewrite = r.host.rewriteDocument(htmlDoc());
    await flush();
    timers.fire(INTERCEPTION_HOST_BOUNDS_MS.rewriteDocument);
    await expect(rewrite).resolves.toBeNull();
    release();
    await flush();
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({ document: null });
    expect(logged(r.log, 'warn', /past its bound/)).toBe(true);
  });

  it('answers the safe default when a backend hands over a malformed document', async () => {
    const r = rig();
    await seedActive();
    const malformed = { ...htmlDoc(), method: undefined } as unknown as ReturnType<typeof htmlDoc>;
    await expect(r.host.rewriteDocument(malformed)).resolves.toBeNull();
    expect(logged(r.log, 'error', /Host call failed/)).toBe(true);
  });
});

describe('generations', () => {
  it('drops a replaced interception’s late end after a re-apply', async () => {
    const r = rig();
    await seedActive(TAB, NOW - 1000);
    await r.controller.apply(page(), { set: SET });
    await r.host.interceptionEnded(TAB, 'detached', NOW - 1000);
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      state: 'active',
      startedAt: NOW
    });
    // The live generation's end still lands.
    await r.host.interceptionEnded(TAB, 'detached', NOW);
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({ state: 'unavailable' });
  });

  it('hands the session start to arm and the stored start to resume', async () => {
    const r = rig();
    const arm = vi.spyOn(r.backend, 'arm');
    await r.controller.apply(page(), { set: SET });
    expect(arm).toHaveBeenCalledWith(TAB, NOW);
    const resume = vi.spyOn(r.backend, 'resume');
    await r.controller.revalidate();
    expect(resume).toHaveBeenCalledWith(TAB, NOW);
  });

  it('issues a fresh start after stop → apply on a fixed clock: the old document never lands', async () => {
    let release: () => void = () => undefined;
    const r = rig();
    await seedActive(TAB, NOW);
    r.backend.runner = (request) =>
      new Promise((resolve) => {
        release = () => {
          resolve({ ok: true, html: request.html, outcome: { outcome: 'rewritten', reports: [] } });
        };
      });
    const pending = r.host.rewriteDocument(htmlDoc());
    await flush();
    await r.controller.stop(page());
    await r.controller.apply(page(), { set: SET });
    release();
    await expect(pending).resolves.toBeNull();
    await flush();
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      startedAt: NOW + 1,
      document: null
    });
  });

  it('issues past a stored start with a backward clock (after a wake)', async () => {
    await seedActive(4, NOW + 5_000);
    const r = rig();
    await r.controller.revalidate();
    await r.controller.apply(page(), { set: SET });
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      startedAt: NOW + 5_001
    });
  });
});

describe('stored-state pushes', () => {
  it('pushes the stored record when a document record write fails', async () => {
    const r = rig();
    await seedActive();
    r.deps.sessions.put = () => Promise.reject(new Error('quota'));
    await r.host.rewriteDocument(htmlDoc());
    await flush();
    expect(r.tabPushes).toEqual([[TAB, expect.objectContaining({ document: null })]]);
    expect(r.panelPushes.at(-1)?.[1]).toMatchObject({ document: null });
  });

  it('pushes the stored (inactive) state when the warning write fails', async () => {
    const r = rig();
    r.backend.armResult = { armed: false, cause: 'debugging-policy' };
    r.deps.sessions.put = () => Promise.reject(new Error('quota'));
    await r.controller.apply(page(), { set: SET });
    expect(r.tabPushes).toEqual([[TAB, { state: 'inactive' }]]);
  });

  it('skips the push when the record cannot be re-read', async () => {
    const r = rig();
    await seedActive();
    r.deps.sessions.put = () => Promise.resolve('limit-reached');
    let reads = 0;
    r.deps.sessions.read = (tabId) =>
      reads++ < 2 ? getExclusionSessionStatus(tabId) : Promise.reject(new Error('io'));
    await r.host.documentBodyUnavailable(TAB, `${ORIGIN}/x`);
    await flush();
    expect(r.tabPushes).toEqual([]);
    expect(logged(r.log, 'error', /re-read failed/)).toBe(true);
  });

  it('records engine-failed (served unmodified) for a runner outcome the record guard refuses', async () => {
    const r = rig();
    await seedActive();
    r.backend.runner = (request) =>
      Promise.resolve({
        ok: true,
        html: `${request.html}<!-- changed -->`,
        outcome: {
          outcome: 'rewritten',
          reports: [
            {
              feature: 'delay_js',
              featureWide: false,
              candidates: 1,
              rewritten: 1,
              regionRemovals: 0,
              matchedRows: [{ row: 'not-in-the-set', rowKind: 'pattern', matches: 1 }],
              unmatchedRows: []
            }
          ]
        }
      });
    await expect(r.host.rewriteDocument(htmlDoc())).resolves.toBeNull();
    await flush();
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      document: { outcome: 'failed', reason: 'engine-failed' }
    });
    expect(logged(r.log, 'error', /failed validation/)).toBe(true);
  });
});

describe('stop during a rewrite', () => {
  it('serves unmodified and records nothing when Stop lands while the engine runs', async () => {
    let release: () => void = () => undefined;
    const r = rig();
    await seedActive();
    r.backend.runner = (request) =>
      new Promise((resolve) => {
        release = () => {
          resolve({
            ok: true,
            html: `${request.html}x`,
            outcome: { outcome: 'rewritten', reports: [] }
          });
        };
      });
    const pending = r.host.rewriteDocument(htmlDoc());
    await flush();
    await r.controller.stop(page());
    release();
    await expect(pending).resolves.toBeNull();
    await flush();
    await expect(getExclusionSessionRecords()).resolves.toEqual({});
  });
});

describe('post-run session re-check', () => {
  it('serves unmodified and records nothing when the re-check read fails', async () => {
    const r = rig();
    await seedActive();
    let reads = 0;
    r.deps.sessions.read = (tabId) =>
      reads++ < 1 ? getExclusionSessionStatus(tabId) : Promise.reject(new Error('io'));
    await expect(r.host.rewriteDocument(htmlDoc())).resolves.toBeNull();
    await flush();
    expect(logged(r.log, 'error', /re-check failed/)).toBe(true);
    expect(r.tabPushes).toEqual([]);
  });
});

describe('live-session cap', () => {
  it('exempts the applying tab itself: its own live session + 7 others re-applies', async () => {
    const r = rig();
    await seedActive(TAB);
    for (let tab = 100; tab < 100 + EXCLUSION_SESSION_LIMIT - 1; tab++) await seedActive(tab);
    await expect(r.controller.apply(page(), { set: SET })).resolves.toEqual({
      outcome: 'applying'
    });
  });
});

describe('defaults', () => {
  it('runs with the default logger and in-process runner', async () => {
    const r = rig({ log: undefined, runner: undefined });
    await seedActive();
    await expect(
      r.host.rewriteDocument({
        tabId: TAB,
        body: encoder.encode(DELAYED),
        contentType: 'text/html',
        documentUrl: `${ORIGIN}/`,
        status: 200,
        method: 'GET'
      })
    ).resolves.not.toBeNull();
  });
});
