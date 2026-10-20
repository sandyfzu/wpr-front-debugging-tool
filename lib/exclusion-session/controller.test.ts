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
import type { DocumentTransformRunner } from './document-transform';

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
    documentUrl: url
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
    await r.host.interceptionEnded(TAB, 'infobar-cancelled');
    const warning = { state: 'unavailable', cause: 'infobar-cancelled', at: NOW };
    await expect(getExclusionSessionStatus(TAB)).resolves.toEqual(warning);
    expect(r.backend.calls).toEqual([`disarm:${String(TAB)}`]);
    expect(r.panelPushes).toEqual([[TAB, warning]]);
  });

  it('ignores an ended interception without a live session', async () => {
    const r = rig();
    await r.host.interceptionEnded(TAB, 'detached');
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
    await expect(getExclusionSessionStatus(TAB)).resolves.toMatchObject({
      set: EMPTY_EXCLUSION_SET,
      startedAt: NOW + 1
    });
    await expect(getExclusionSessionStatus(4)).resolves.toMatchObject({ set: SET, startedAt: NOW });
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

describe('defaults', () => {
  it('runs with the default logger and in-process runner', async () => {
    const r = rig({ log: undefined, runner: undefined });
    await seedActive();
    await expect(
      r.host.rewriteDocument({
        tabId: TAB,
        body: encoder.encode(DELAYED),
        contentType: null,
        documentUrl: `${ORIGIN}/`
      })
    ).resolves.not.toBeNull();
  });
});
