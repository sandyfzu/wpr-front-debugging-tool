/**
 * The Chromium backend over a fake debugger port, a fake host, a fake
 * logger and a manual timer: arming (attach + enable, refusals, adoption,
 * mid-arm detaches, liveness re-check, re-tagging), serialization (the
 * latest of arm/resume/disarm wins), disarm, browser detaches (cause
 * mapping, generations, closed tabs), and paused requests — every path
 * releasing the request exactly once — simulated-runtime script requests
 * included.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Logger } from '../../logger';
import type { ScheduleTimer } from '../../messaging/bounded-ask';
import { bytesToBase64 } from '../../../utils/base64';
import type {
  InterceptedDocument,
  InterceptedResponseIdentity,
  InterceptionBackend,
  InterceptionGrant,
  InterceptionHost
} from '../backend';
import type { PackagedRuntimeFile } from '../simulation-sources';
import { DOCUMENT_BODY_BYTE_LIMIT, DOCUMENT_TRANSFORM_BUDGET_MS } from '../document-transform';
import { speculationRulesGuardSource } from '../speculation-rules';
import {
  INTERCEPTION_HOST_BOUNDS_MS,
  rewriteDocumentBoundMs,
  SESSION_STEP_TIMEOUTS_MS,
  SIMULATION_PREPARATION_BOUND_MS
} from '../timeouts';
import {
  CHROMIUM_OPERATION_BUDGETS_MS,
  CHROMIUM_TIMEOUTS_MS,
  chromiumReleaseMs,
  createChromiumInterceptionBackend
} from './backend';
import type { DebuggerEventHandlers, DebuggerPort, DebuggerTarget, TabPresence } from './port';

const TAB = 4;
/** The commands that enable a session after attaching, in order. */
const SESSION = ['Fetch.enable', 'Network.enable', 'Network.setBypassServiceWorker', 'Page.enable'];
/** A fresh attachment with no session origin: attach, the session, the page target. */
const FRESH = [`attach:${String(TAB)}`, ...SESSION, 'pageTargetId'];
/** The session origin of the guard tests. */
const ORIGIN = 'https://site.test';
/** A fresh attachment for {@link ORIGIN}: the guard installed before the page target. */
const GUARDED = [
  `attach:${String(TAB)}`,
  ...SESSION,
  'Page.addScriptToEvaluateOnNewDocument',
  'pageTargetId'
];
const MAIN = 'MAIN-FRAME';
const BODY = new TextEncoder().encode('<p>served</p>');
const REWRITTEN = new TextEncoder().encode('<p>rewritten</p>');
/** The epoch the fake `now` answers. */
const EPOCH = 1_800_000_000_000;
/** The wall clock at a response's arrival (a different clock domain than EPOCH's). */
const WALL_AT = EPOCH + 7;

/** A settable monotonic clock. */
function fakeClock(): {
  now: () => number;
  set: (ms: number) => void;
  advance: (ms: number) => void;
} {
  let at = 0;
  return {
    now: () => at,
    set: (ms) => {
      at = ms;
    },
    advance: (ms) => {
      at += ms;
    }
  };
}

/** A logger recording its lines. */
function fakeLog(): Logger & { lines: { level: string; message: string }[] } {
  const lines: { level: string; message: string }[] = [];
  const at = (level: string) => (message: string) => {
    lines.push({ level, message });
  };
  return { lines, debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

/** A timer seam whose timers fire only when the test says so. */
function manualTimers(): { schedule: ScheduleTimer; fire: (ms: number) => void } {
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  return {
    schedule: (run, ms) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    fire: (ms) => {
      for (const timer of timers.filter((t) => t.live && t.ms === ms)) {
        timer.live = false;
        timer.run();
      }
    }
  };
}

/** Let every pending promise chain settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

/** A promise with its settle functions exposed. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type Command = (
  target: DebuggerTarget,
  params: Record<string, unknown> | undefined
) => Promise<unknown>;

/** A fake debugger port: scriptable answers, a call log. */
class FakePort implements DebuggerPort {
  handlers!: DebuggerEventHandlers;
  readonly calls: string[] = [];
  readonly sent: { target: DebuggerTarget; method: string; params?: Record<string, unknown> }[] =
    [];
  attachImpl: (tabId: number) => Promise<void> = () => Promise.resolve();
  detachImpl: (tabId: number) => Promise<void> = () => Promise.resolve();
  pageTarget: () => Promise<string | null> = () => Promise.resolve(MAIN);
  presence: () => Promise<TabPresence> = () => Promise.resolve('web');
  readonly commands = new Map<string, Command>();

  attach(tabId: number): Promise<void> {
    this.calls.push(`attach:${String(tabId)}`);
    return this.attachImpl(tabId);
  }

  detach(tabId: number): Promise<void> {
    this.calls.push(`detach:${String(tabId)}`);
    return this.detachImpl(tabId);
  }

  send(target: DebuggerTarget, method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.calls.push(method);
    this.sent.push(params === undefined ? { target, method } : { target, method, params });
    return this.commands.get(method)?.(target, params) ?? Promise.resolve({});
  }

  pageTargetId(): Promise<string | null> {
    this.calls.push('pageTargetId');
    return this.pageTarget();
  }

  tabPresence(): Promise<TabPresence> {
    this.calls.push('tabPresence');
    return this.presence();
  }

  listen(handlers: DebuggerEventHandlers): void {
    this.handlers = handlers;
  }

  /** Every release command sent for a request id. */
  releases(requestId: string): string[] {
    return this.sent
      .filter(
        (call) =>
          ['Fetch.continueRequest', 'Fetch.continueResponse', 'Fetch.fulfillRequest'].includes(
            call.method
          ) && call.params?.requestId === requestId
      )
      .map((call) => call.method);
  }
}

/** A fake host recording its calls. */
class FakeHost implements InterceptionHost {
  rewrite: (document: InterceptedDocument) => Promise<Uint8Array | null> = () =>
    Promise.resolve(REWRITTEN);
  readonly documents: InterceptedDocument[] = [];
  readonly unavailable: [number, string, InterceptedResponseIdentity | undefined][] = [];
  readonly ended: [number, string, number][] = [];

  intercept = true;
  /** The grant when intercepting (an exclusions-only session by default). */
  grant: InterceptionGrant = { rewriteBoundMs: INTERCEPTION_HOST_BOUNDS_MS.rewriteDocument };
  readonly gated: [number, string][] = [];

  shouldIntercept(tabId: number, documentUrl: string): Promise<InterceptionGrant | null> {
    this.gated.push([tabId, documentUrl]);
    return Promise.resolve(this.intercept ? this.grant : null);
  }

  rewriteDocument(document: InterceptedDocument): Promise<Uint8Array | null> {
    this.documents.push(document);
    return this.rewrite(document);
  }

  documentBodyUnavailable(
    tabId: number,
    documentUrl: string,
    identity?: InterceptedResponseIdentity
  ): Promise<void> {
    this.unavailable.push([tabId, documentUrl, identity]);
    return Promise.resolve();
  }

  readonly notServed: [number, string, InterceptedResponseIdentity | undefined][] = [];

  documentNotServed(
    tabId: number,
    documentUrl: string,
    identity?: InterceptedResponseIdentity
  ): Promise<void> {
    this.notServed.push([tabId, documentUrl, identity]);
    return Promise.resolve();
  }

  interceptionEnded(tabId: number, cause: string, generation: number): Promise<void> {
    this.ended.push([tabId, cause, generation]);
    return Promise.resolve();
  }

  /** The file named for {@link RUNTIME_URL} (null: the host names none). */
  runtime: PackagedRuntimeFile | null = RUNTIME_FILE;
  readonly runtimeAsks: [number, string, string][] = [];

  simulatedRuntime(
    tabId: number,
    requestUrl: string,
    documentUrl: string
  ): Promise<PackagedRuntimeFile | null> {
    this.runtimeAsks.push([tabId, requestUrl, documentUrl]);
    return Promise.resolve(requestUrl === RUNTIME_URL ? this.runtime : null);
  }
}

/** A simulated page's runtime URL and the packaged file answering it. */
const RUNTIME_URL =
  'https://site.test/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js';
/** The tab's top-level document requesting {@link RUNTIME_URL}. */
const PAGE_URL = 'https://site.test/post';
const RUNTIME_FILE: PackagedRuntimeFile = {
  url: 'chrome-extension://id/wp-rocket-simulation/lazyload/17.8.3/lazyload.min.js',
  bytes: new TextEncoder().encode('/*! lazyload */')
};

/** A request-stage top-frame script pause for {@link RUNTIME_URL}. */
function scriptPause(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return pauseEvent({
    requestId: 'js-1',
    request: { url: RUNTIME_URL, method: 'GET' },
    resourceType: 'Script',
    responseStatusCode: undefined,
    responseStatusText: undefined,
    responseHeaders: undefined,
    ...overrides
  });
}

/** A response-stage top-frame document pause. */
function pauseEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'req-1',
    request: { url: 'https://site.test/page', method: 'GET' },
    frameId: MAIN,
    resourceType: 'Document',
    responseStatusCode: 200,
    responseStatusText: 'OK',
    responseHeaders: [
      { name: 'Content-Type', value: 'text/html; charset=utf-8' },
      { name: 'Content-Encoding', value: 'gzip' }
    ],
    ...overrides
  };
}

interface Rig {
  port: FakePort;
  host: FakeHost;
  log: ReturnType<typeof fakeLog>;
  timers: ReturnType<typeof manualTimers>;
  clock: ReturnType<typeof fakeClock>;
  backend: InterceptionBackend;
  /** Deliver a pause event and let it settle. */
  pause(overrides?: Record<string, unknown>, source?: unknown): Promise<void>;
  /** Deliver a detach signal and let it settle. */
  detach(reason: string, source?: unknown): Promise<void>;
}

let rig: Rig;

beforeEach(() => {
  const port = new FakePort();
  const host = new FakeHost();
  const log = fakeLog();
  const timers = manualTimers();
  port.commands.set('Fetch.getResponseBody', () =>
    Promise.resolve({ body: bytesToBase64(BODY), base64Encoded: true })
  );
  let guardIds = 0;
  port.commands.set('Page.addScriptToEvaluateOnNewDocument', () =>
    Promise.resolve({ identifier: `guard-${String(++guardIds)}` })
  );
  const clock = fakeClock();
  const backend = createChromiumInterceptionBackend({
    port,
    host,
    log,
    schedule: timers.schedule,
    clock: clock.now,
    stamp: () => EPOCH,
    wallNow: () => WALL_AT
  });
  rig = {
    port,
    host,
    log,
    timers,
    clock,
    backend,
    async pause(overrides = {}, source = { tabId: TAB }) {
      port.handlers.event(source, 'Fetch.requestPaused', pauseEvent(overrides));
      await flush();
    },
    async detach(reason, source = { tabId: TAB }) {
      port.handlers.detach(source, reason);
      await flush();
    }
  };
});

/** Whether a line at `level` matching `pattern` was logged. */
function logged(level: string, pattern: RegExp): boolean {
  return rig.log.lines.some((line) => line.level === level && pattern.test(line.message));
}

describe('arm', () => {
  it('attaches, enables interception and the service-worker bypass, then learns the page target', async () => {
    await expect(rig.backend.arm(TAB, 10)).resolves.toEqual({ armed: true });
    expect(rig.port.calls).toEqual(FRESH);
    expect(rig.port.sent).toEqual([
      {
        target: { tabId: TAB },
        method: 'Fetch.enable',
        params: {
          patterns: [
            { urlPattern: '*', resourceType: 'Document', requestStage: 'Response' },
            { urlPattern: '*/lazyload.min.js', resourceType: 'Script', requestStage: 'Request' }
          ]
        }
      },
      {
        target: { tabId: TAB },
        method: 'Network.enable',
        params: { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 }
      },
      {
        target: { tabId: TAB },
        method: 'Network.setBypassServiceWorker',
        params: { bypass: true }
      },
      { target: { tabId: TAB }, method: 'Page.enable', params: {} }
    ]);
  });

  it('installs the speculation-rules guard for the session origin', async () => {
    await expect(rig.backend.arm(TAB, 10, ORIGIN)).resolves.toEqual({ armed: true });
    expect(rig.port.calls).toEqual(GUARDED);
    expect(rig.port.sent.at(-1)).toEqual({
      target: { tabId: TAB },
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: { source: speculationRulesGuardSource(ORIGIN) }
    });
  });

  it('keeps the guard on a re-arm for the same origin, replaces it for another', async () => {
    await rig.backend.arm(TAB, 10, ORIGIN);
    rig.port.calls.length = 0;
    await rig.backend.arm(TAB, 20, ORIGIN);
    expect(rig.port.calls).toEqual(SESSION);
    rig.port.calls.length = 0;
    rig.port.sent.length = 0;
    await rig.backend.arm(TAB, 30, 'https://other.test');
    expect(rig.port.calls).toEqual([
      ...SESSION,
      'Page.removeScriptToEvaluateOnNewDocument',
      'Page.addScriptToEvaluateOnNewDocument'
    ]);
    expect(rig.port.sent.at(-2)?.params).toEqual({ identifier: 'guard-1' });
    expect(rig.port.sent.at(-1)?.params).toEqual({
      source: speculationRulesGuardSource('https://other.test')
    });
  });

  it('installs a new guard after a re-attach (the old one ended with its session)', async () => {
    await rig.backend.arm(TAB, 10, ORIGIN);
    await rig.detach('target_closed');
    rig.port.calls.length = 0;
    await rig.backend.arm(TAB, 20, ORIGIN);
    expect(rig.port.calls).toEqual(GUARDED);
  });

  it('fails like an enable failure when the guard install answers no identifier', async () => {
    rig.port.commands.set('Page.addScriptToEvaluateOnNewDocument', () => Promise.resolve({}));
    await expect(rig.backend.arm(TAB, 10, ORIGIN)).resolves.toEqual({
      armed: false,
      cause: 'attach-denied'
    });
  });

  it('fails like any enable failure when the service-worker bypass is refused', async () => {
    rig.port.commands.set('Network.setBypassServiceWorker', () =>
      Promise.reject(new Error('Network domain not enabled'))
    );
    await expect(rig.backend.arm(TAB, 10)).resolves.toEqual({
      armed: false,
      cause: 'attach-denied'
    });
    expect(rig.port.calls.at(-1)).toBe(`detach:${String(TAB)}`);
  });

  it('arms even when the page target cannot be learned (read on the first pause)', async () => {
    rig.port.pageTarget = () => Promise.reject(new Error('targets failed'));
    await expect(rig.backend.arm(TAB, 10)).resolves.toEqual({ armed: true });
    rig.port.pageTarget = () => Promise.resolve(MAIN);
    await rig.pause();
    expect(rig.port.releases('req-1')).toEqual(['Fetch.fulfillRequest']);
  });

  it('maps a refused attach to its cause without enabling', async () => {
    rig.port.attachImpl = () => Promise.reject(new Error('Cannot access a chrome:// URL'));
    await expect(rig.backend.arm(TAB, 10)).resolves.toEqual({
      armed: false,
      cause: 'unsupported-page'
    });
    expect(rig.port.calls).toEqual([`attach:${String(TAB)}`]);
    expect(logged('info', /attach refused/)).toBe(true);
  });

  it('answers attach-denied for an unrecognized attach failure (warned)', async () => {
    rig.port.attachImpl = () => Promise.reject(new Error('brand new failure'));
    await expect(rig.backend.arm(TAB, 10)).resolves.toEqual({
      armed: false,
      cause: 'attach-denied'
    });
    expect(logged('warn', /unrecognized attach failure/)).toBe(true);
  });

  it('answers attach-denied when attach never answers (command deadline)', async () => {
    rig.port.attachImpl = () => new Promise(() => undefined);
    const armed = rig.backend.arm(TAB, 10);
    await flush();
    rig.timers.fire(CHROMIUM_TIMEOUTS_MS.command);
    await expect(armed).resolves.toEqual({ armed: false, cause: 'attach-denied' });
  });

  it('replaces this extension’s earlier session ("already attached"): detach, attach afresh', async () => {
    let attaches = 0;
    rig.port.attachImpl = () =>
      attaches++ === 0
        ? Promise.reject(new Error('Another debugger is already attached to the tab with id: 4.'))
        : Promise.resolve();
    await expect(rig.backend.arm(TAB, 10, ORIGIN)).resolves.toEqual({ armed: true });
    // A clean session: one guard, never stacked on the earlier session's.
    expect(rig.port.calls).toEqual([`attach:${String(TAB)}`, `detach:${String(TAB)}`, ...GUARDED]);
    expect(logged('info', /Replacing/)).toBe(true);
  });

  it('answers attach-denied when the earlier session survives its detach', async () => {
    rig.port.attachImpl = () =>
      Promise.reject(new Error('Another debugger is already attached to the tab with id: 4.'));
    await expect(rig.backend.arm(TAB, 10)).resolves.toEqual({
      armed: false,
      cause: 'attach-denied'
    });
    expect(rig.port.calls).toEqual([
      `attach:${String(TAB)}`,
      `detach:${String(TAB)}`,
      `attach:${String(TAB)}`
    ]);
  });

  it('detaches and answers attach-denied when enabling fails', async () => {
    rig.port.commands.set('Fetch.enable', () => Promise.reject(new Error('enable failed')));
    await expect(rig.backend.arm(TAB, 10)).resolves.toEqual({
      armed: false,
      cause: 'attach-denied'
    });
    expect(rig.port.calls).toEqual([
      `attach:${String(TAB)}`,
      'Fetch.enable',
      `detach:${String(TAB)}`
    ]);
  });

  it('fails with the detach’s cause when the user cancels the infobar mid-arm (no detach, no end)', async () => {
    rig.port.commands.set('Fetch.enable', () => {
      rig.port.handlers.detach({ tabId: TAB }, 'canceled_by_user');
      return Promise.reject(new Error('Detached while handling command.'));
    });
    await expect(rig.backend.arm(TAB, 10)).resolves.toEqual({
      armed: false,
      cause: 'infobar-cancelled'
    });
    expect(rig.port.calls).not.toContain(`detach:${String(TAB)}`);
    expect(rig.host.ended).toEqual([]);
  });

  it('fails as detached when the browser ends the session right after enabling', async () => {
    rig.port.commands.set('Fetch.enable', () => {
      rig.port.handlers.detach({ tabId: TAB }, 'target_closed');
      return Promise.resolve({});
    });
    rig.port.presence = () => Promise.resolve('gone');
    await expect(rig.backend.arm(TAB, 10)).resolves.toEqual({ armed: false, cause: 'detached' });
  });

  it('fails like any enable failure when the guard cannot be installed', async () => {
    rig.port.commands.set('Page.addScriptToEvaluateOnNewDocument', () =>
      Promise.reject(new Error('Page domain not enabled'))
    );
    await expect(rig.backend.arm(TAB, 10, ORIGIN)).resolves.toEqual({
      armed: false,
      cause: 'attach-denied'
    });
  });

  it('confirms an armed tab by re-enabling its session only (no second guard), re-tagging it', async () => {
    await rig.backend.arm(TAB, 10);
    rig.port.calls.length = 0;
    await expect(rig.backend.arm(TAB, 20)).resolves.toEqual({ armed: true });
    expect(rig.port.calls).toEqual(SESSION);
    await rig.detach('target_closed');
    expect(rig.host.ended).toEqual([[TAB, 'detached', 20]]);
  });

  it('re-attaches an armed tab whose session is gone', async () => {
    await rig.backend.arm(TAB, 10);
    let first = true;
    rig.port.commands.set('Fetch.enable', () => {
      if (!first) return Promise.resolve({});
      first = false;
      return Promise.reject(new Error('Debugger is not attached to the tab with id: 4.'));
    });
    rig.port.calls.length = 0;
    await expect(rig.backend.arm(TAB, 20)).resolves.toEqual({ armed: true });
    expect(rig.port.calls).toEqual(['Fetch.enable', ...FRESH]);
  });
});

describe('operation budgets (each answers before the controller’s deadline for it)', () => {
  it('derives every budget from the controller’s step deadline minus a margin', () => {
    expect(CHROMIUM_OPERATION_BUDGETS_MS.arm).toBeLessThan(SESSION_STEP_TIMEOUTS_MS.arm);
    expect(CHROMIUM_OPERATION_BUDGETS_MS.resume).toBeLessThan(SESSION_STEP_TIMEOUTS_MS.resume);
    expect(CHROMIUM_OPERATION_BUDGETS_MS.disarm).toBeLessThan(SESSION_STEP_TIMEOUTS_MS.disarm);
  });

  it('never starts a call once a slow re-arm has spent the arm budget', async () => {
    await rig.backend.arm(TAB, 10);
    rig.port.calls.length = 0;
    rig.clock.set(0);
    // Each call takes 1.7 s of clock: enable (dead) → attach → enable (fails at 5.1 s).
    rig.port.commands.set('Fetch.enable', () => {
      rig.clock.advance(1_700);
      return Promise.reject(new Error('Debugger is not attached to the tab with id: 4.'));
    });
    rig.port.attachImpl = () => {
      rig.clock.advance(1_700);
      return Promise.resolve();
    };
    await expect(rig.backend.arm(TAB, 20)).resolves.toEqual({
      armed: false,
      cause: 'attach-denied'
    });
    // The detach left once the budget ran out was never started (the
    // controller's follow-up disarm ends the session).
    expect(rig.port.calls).toEqual(['Fetch.enable', `attach:${String(TAB)}`, 'Fetch.enable']);
  });

  it('counts the queue wait: a resume queued behind a slow arm of its generation answers armed at once', async () => {
    const attach = deferred();
    rig.port.attachImpl = () => attach.promise;
    rig.clock.set(0);
    const armed = rig.backend.arm(TAB, 10);
    const resumed = rig.backend.resume(TAB, 10);
    await flush();
    rig.clock.advance(CHROMIUM_OPERATION_BUDGETS_MS.resume + 1);
    attach.resolve();
    await expect(armed).resolves.toEqual({ armed: true });
    rig.port.calls.length = 0;
    // Armed by the arm ahead of it, after the resume was called: confirmed, no calls.
    await expect(resumed).resolves.toBe(true);
    expect(rig.port.calls).toEqual([]);
  });

  it('answers within its budget when queued behind a slow arm of another generation', async () => {
    const attach = deferred();
    rig.port.attachImpl = () => attach.promise;
    rig.clock.set(0);
    const armed = rig.backend.arm(TAB, 10);
    const resumed = rig.backend.resume(TAB, 9);
    await flush();
    rig.clock.advance(CHROMIUM_OPERATION_BUDGETS_MS.resume + 1);
    attach.resolve();
    await expect(armed).resolves.toEqual({ armed: true });
    // Its own re-enable found no time left: not confirmed (no call started).
    await expect(resumed).resolves.toBe(false);
  });

  it('re-confirms an armed tab whose confirmation predates the call', async () => {
    await rig.backend.arm(TAB, 10);
    rig.clock.advance(5);
    rig.port.calls.length = 0;
    await expect(rig.backend.resume(TAB, 10)).resolves.toBe(true);
    expect(rig.port.calls).toEqual(SESSION);
  });

  it('caps a single call at the per-call deadline inside a larger budget', async () => {
    rig.port.attachImpl = () => new Promise(() => undefined);
    const armed = rig.backend.arm(TAB, 10);
    await flush();
    rig.timers.fire(CHROMIUM_TIMEOUTS_MS.command);
    await expect(armed).resolves.toEqual({ armed: false, cause: 'attach-denied' });
  });

  it('bounds a disarm’s detach by the disarm budget', async () => {
    await rig.backend.arm(TAB, 10);
    rig.port.detachImpl = () => new Promise(() => undefined);
    const disarmed = rig.backend.disarm(TAB);
    await flush();
    rig.timers.fire(CHROMIUM_OPERATION_BUDGETS_MS.disarm);
    await expect(disarmed).resolves.toBeUndefined();
  });
});

describe('resume', () => {
  it('answers true when interception is (re-)established', async () => {
    await expect(rig.backend.resume(TAB, 10)).resolves.toBe(true);
    await rig.detach('target_closed');
    expect(rig.host.ended).toEqual([[TAB, 'detached', 10]]);
  });

  it('answers false when it cannot be', async () => {
    rig.port.attachImpl = () => Promise.reject(new Error('Cannot attach to this target.'));
    await expect(rig.backend.resume(TAB, 10)).resolves.toBe(false);
  });
});

describe('disarm', () => {
  it('detaches an armed tab; a later browser signal reports nothing', async () => {
    await rig.backend.arm(TAB, 10);
    await rig.backend.disarm(TAB);
    expect(rig.port.calls.at(-1)).toBe(`detach:${String(TAB)}`);
    await rig.detach('target_closed');
    expect(rig.host.ended).toEqual([]);
  });

  it('still detaches without a record, a missing session being expected (debug only)', async () => {
    rig.port.detachImpl = () =>
      Promise.reject(new Error('Debugger is not attached to the tab with id: 4.'));
    await rig.backend.disarm(TAB);
    expect(rig.port.calls).toEqual([`detach:${String(TAB)}`]);
    expect(logged('debug', /no session/)).toBe(true);
    expect(rig.log.lines.some((line) => line.level === 'warn')).toBe(false);
  });

  it('logs an unexpected detach failure of a held session and settles', async () => {
    await rig.backend.arm(TAB, 10);
    rig.port.detachImpl = () => Promise.reject(new Error('weird'));
    await expect(rig.backend.disarm(TAB)).resolves.toBeUndefined();
    expect(logged('warn', /detach failed/)).toBe(true);
  });

  it('expects any detach refusal when no session is on record (debug only)', async () => {
    rig.port.detachImpl = () => Promise.reject(new Error('Cannot access a chrome:// URL'));
    await rig.backend.disarm(TAB);
    expect(logged('debug', /no session/)).toBe(true);
    expect(rig.log.lines.some((line) => line.level === 'warn')).toBe(false);
  });

  it('runs after a slow arm — the latest call wins', async () => {
    const attach = deferred();
    rig.port.attachImpl = () => attach.promise;
    const armed = rig.backend.arm(TAB, 10);
    const disarmed = rig.backend.disarm(TAB);
    await flush();
    expect(rig.port.calls).toEqual([`attach:${String(TAB)}`]);
    attach.resolve();
    await expect(armed).resolves.toEqual({ armed: true });
    await disarmed;
    expect(rig.port.calls).toEqual([...FRESH, `detach:${String(TAB)}`]);
    // Disarmed: a browser signal for the tab reports nothing.
    await rig.detach('target_closed');
    expect(rig.host.ended).toEqual([]);
  });
});

describe('browser detach', () => {
  beforeEach(async () => {
    await rig.backend.arm(TAB, 10);
  });

  it('reports a cancelled infobar without probing the tab', async () => {
    await rig.detach('canceled_by_user');
    expect(rig.host.ended).toEqual([[TAB, 'infobar-cancelled', 10]]);
    expect(rig.port.calls).not.toContain('tabPresence');
  });

  it('reports a page the tab left http(s) for as unsupported-page', async () => {
    rig.port.presence = () => Promise.resolve('elsewhere');
    await rig.detach('target_closed');
    expect(rig.host.ended).toEqual([[TAB, 'unsupported-page', 10]]);
  });

  it('reports nothing for a closed tab', async () => {
    rig.port.presence = () => Promise.resolve('gone');
    await rig.detach('target_closed');
    expect(rig.host.ended).toEqual([]);
  });

  it('reads an unanswered tab probe as a live page (detached)', async () => {
    rig.port.presence = () => Promise.reject(new Error('probe failed'));
    await rig.detach('target_closed');
    expect(rig.host.ended).toEqual([[TAB, 'detached', 10]]);
    expect(logged('warn', /presence unknown/)).toBe(true);
  });

  it('reports once, and nothing for tabs it never armed, child sessions or bad sources', async () => {
    await rig.detach('target_closed');
    await rig.detach('target_closed');
    await rig.detach('target_closed', { tabId: 99 });
    await rig.detach('target_closed', { tabId: TAB, sessionId: 'child' });
    await rig.detach('target_closed', 'nonsense');
    expect(rig.host.ended).toEqual([[TAB, 'detached', 10]]);
  });

  it('logs a failing end report instead of rejecting', async () => {
    rig.host.interceptionEnded = () => Promise.reject(new Error('host broke'));
    await rig.detach('target_closed');
    expect(logged('error', /not reported/)).toBe(true);
  });
});

describe('paused requests', () => {
  beforeEach(async () => {
    await rig.backend.arm(TAB, 10);
    rig.port.calls.length = 0;
    rig.port.sent.length = 0;
  });

  it('rewrites a top-frame document and fulfills it once', async () => {
    await rig.pause();
    expect(rig.host.notServed).toEqual([]);
    expect(rig.host.documents).toEqual([
      {
        tabId: TAB,
        documentUrl: 'https://site.test/page',
        body: BODY,
        status: 200,
        method: 'GET',
        contentType: 'text/html; charset=utf-8',
        identity: {
          token: 'req-1',
          receivedAt: EPOCH,
          wallAt: WALL_AT,
          speculationRulesHeader: false,
          servedAsCopy: true,
          // Armed without an origin: no guard.
          speculationGuard: false,
          serviceWorkersBypassed: true
        }
      }
    ]);
    expect(rig.port.releases('req-1')).toEqual(['Fetch.fulfillRequest']);
    // The page target id is cached at arm: no lookup per pause.
    expect(rig.port.calls).not.toContain('pageTargetId');
    expect(rig.port.sent.at(-1)?.params).toEqual({
      requestId: 'req-1',
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
      body: bytesToBase64(REWRITTEN),
      responsePhrase: 'OK'
    });
  });

  it('continues when the host serves the original', async () => {
    rig.host.rewrite = () => Promise.resolve(null);
    await rig.pause();
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
  });

  it('continues a sub-frame document without reading it', async () => {
    await rig.pause({ frameId: 'IFRAME' });
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
    expect(rig.port.calls).not.toContain('Fetch.getResponseBody');
    expect(rig.host.documents).toEqual([]);
  });

  it('continues a child session’s pause on that session', async () => {
    await rig.pause({}, { tabId: TAB, sessionId: 'child' });
    expect(rig.port.sent).toEqual([
      {
        target: { tabId: TAB, sessionId: 'child' },
        method: 'Fetch.continueRequest',
        params: { requestId: 'req-1' }
      }
    ]);
  });

  it('continues a document of another frame when the page target cannot be re-read', async () => {
    rig.port.pageTarget = () => Promise.reject(new Error('targets failed'));
    await rig.pause({ frameId: 'OTHER' });
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
    rig.port.pageTarget = () => Promise.resolve(null);
    await rig.pause({ frameId: 'OTHER', requestId: 'req-2' });
    expect(rig.port.releases('req-2')).toEqual(['Fetch.continueRequest']);
  });

  it('re-reads the page target on a mismatch and follows a changed one', async () => {
    rig.port.pageTarget = () => Promise.resolve('SWAPPED');
    await rig.pause({ frameId: 'SWAPPED' });
    expect(rig.port.releases('req-1')).toEqual(['Fetch.fulfillRequest']);
    rig.port.calls.length = 0;
    await rig.pause({ frameId: 'SWAPPED', requestId: 'req-2' });
    expect(rig.port.calls).not.toContain('pageTargetId');
    // The old id is no longer the page.
    await rig.pause({ frameId: MAIN, requestId: 'req-3' });
    expect(rig.port.releases('req-3')).toEqual(['Fetch.continueRequest']);
  });

  it('forgets the page target when the session ends', async () => {
    await rig.detach('target_closed');
    rig.port.calls.length = 0;
    await rig.pause();
    expect(rig.port.calls).toContain('pageTargetId');
  });

  it('flags a Speculation-Rules header and drops it from the fulfilled response', async () => {
    await rig.pause({
      responseHeaders: [
        { name: 'Content-Type', value: 'text/html' },
        { name: 'Speculation-Rules', value: '"/rules.json"' }
      ]
    });
    expect(rig.host.documents[0]?.identity?.speculationRulesHeader).toBe(true);
    expect(rig.port.sent.at(-1)?.params?.responseHeaders).toEqual([
      { name: 'Content-Type', value: 'text/html' }
    ]);
  });

  it('demotes a release of an abandoned navigation to debug and corrects its record', async () => {
    rig.port.commands.set('Fetch.fulfillRequest', () =>
      Promise.reject(new Error('Invalid InterceptionId.'))
    );
    await rig.pause();
    // The request is gone: no second release is attempted…
    expect(rig.port.releases('req-1')).toEqual(['Fetch.fulfillRequest']);
    // …and the host's `rewritten` record for it is corrected (nothing was served).
    expect(
      rig.host.notServed.map(([tabId, url, identity]) => [tabId, url, identity?.token])
    ).toEqual([[TAB, 'https://site.test/page', 'req-1']]);
    expect(rig.log.lines.some((line) => line.level === 'warn')).toBe(false);
    expect(logged('debug', /gone/)).toBe(true);
  });

  it('continues a redirect hop without a frame check', async () => {
    await rig.pause({ responseStatusCode: 302 });
    expect(rig.port.calls).toEqual(['Fetch.continueRequest']);
  });

  it('continues and records an unreadable body with its identity', async () => {
    rig.port.commands.set('Fetch.getResponseBody', () => Promise.reject(new Error('no body')));
    await rig.pause();
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
    expect(rig.host.unavailable).toEqual([
      [
        TAB,
        'https://site.test/page',
        {
          token: 'req-1',
          receivedAt: EPOCH,
          wallAt: WALL_AT,
          speculationRulesHeader: false,
          servedAsCopy: true,
          speculationGuard: false,
          serviceWorkersBypassed: true
        }
      ]
    ]);
  });

  it('never reads a body announced larger than the limit', async () => {
    await rig.pause({
      responseHeaders: [
        { name: 'Content-Type', value: 'text/html' },
        { name: 'Content-Length', value: String(DOCUMENT_BODY_BYTE_LIMIT + 1) }
      ]
    });
    expect(rig.port.calls).not.toContain('Fetch.getResponseBody');
    expect(rig.host.unavailable).toHaveLength(1);
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
  });

  it('reads an encoded body whatever its announced length (decoded size unknown)', async () => {
    await rig.pause({
      responseHeaders: [
        { name: 'Content-Type', value: 'text/html' },
        { name: 'Content-Encoding', value: 'br' },
        { name: 'Content-Length', value: String(DOCUMENT_BODY_BYTE_LIMIT + 1) }
      ]
    });
    expect(rig.port.calls).toContain('Fetch.getResponseBody');
  });

  it('serves the original once the body read passes its bound', async () => {
    rig.port.commands.set('Fetch.getResponseBody', () => new Promise(() => undefined));
    await rig.pause();
    rig.timers.fire(CHROMIUM_TIMEOUTS_MS.bodyRead);
    await flush();
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
    expect(rig.host.unavailable).toHaveLength(1);
  });

  it('keeps an exclusions-only release deadline at the host bound + 1 s', () => {
    // The bound before simulation existed: 2 s engine budget + steps + 1 s margin.
    const headRelease =
      SESSION_STEP_TIMEOUTS_MS.ready +
      2 * SESSION_STEP_TIMEOUTS_MS.store +
      DOCUMENT_TRANSFORM_BUDGET_MS +
      SESSION_STEP_TIMEOUTS_MS.runnerOverhead +
      1_000;
    expect(chromiumReleaseMs(rewriteDocumentBoundMs(false))).toBe(headRelease);
    expect(chromiumReleaseMs(rewriteDocumentBoundMs(true))).toBe(
      headRelease + SIMULATION_PREPARATION_BOUND_MS
    );
  });

  it('serves the original once the host passes the release deadline, ignoring its late answer', async () => {
    const release = chromiumReleaseMs(INTERCEPTION_HOST_BOUNDS_MS.rewriteDocument);
    expect(release).toBeGreaterThan(INTERCEPTION_HOST_BOUNDS_MS.rewriteDocument);
    const late = deferred<Uint8Array | null>();
    rig.host.rewrite = () => late.promise;
    await rig.pause();
    rig.timers.fire(release);
    await flush();
    late.resolve(REWRITTEN);
    await flush();
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
  });

  it('gives a simulating session’s rewrite its longer granted deadline', async () => {
    rig.host.grant = { rewriteBoundMs: rewriteDocumentBoundMs(true) };
    const late = deferred<Uint8Array | null>();
    rig.host.rewrite = () => late.promise;
    await rig.pause();
    rig.timers.fire(chromiumReleaseMs(rewriteDocumentBoundMs(false)));
    await flush();
    expect(rig.port.releases('req-1')).toEqual([]);
    rig.timers.fire(chromiumReleaseMs(rewriteDocumentBoundMs(true)));
    await flush();
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
  });

  it('continues when the browser refuses the fulfilled response', async () => {
    rig.port.commands.set('Fetch.fulfillRequest', () =>
      Promise.reject(new Error('Invalid http status code or phrase'))
    );
    await rig.pause();
    expect(rig.port.releases('req-1')).toEqual(['Fetch.fulfillRequest', 'Fetch.continueRequest']);
    expect(logged('warn', /refused/)).toBe(true);
    // Served unmodified after all: the record of the rewrite is corrected.
    expect(rig.host.notServed).toHaveLength(1);
  });

  it('continues a malformed pause by its id, and logs one it cannot release', async () => {
    rig.port.handlers.event({ tabId: TAB }, 'Fetch.requestPaused', {
      requestId: 'bad',
      frameId: 1
    });
    rig.port.handlers.event({ tabId: TAB }, 'Fetch.requestPaused', { frameId: 1 });
    await flush();
    expect(rig.port.releases('bad')).toEqual(['Fetch.continueRequest']);
    expect(logged('error', /without an id/)).toBe(true);
  });

  it('continues at once while the tab is detaching', async () => {
    const detach = deferred();
    rig.port.detachImpl = () => detach.promise;
    const disarmed = rig.backend.disarm(TAB);
    await flush();
    await rig.pause();
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
    expect(rig.port.calls).not.toContain('pageTargetId');
    detach.resolve();
    await disarmed;
  });

  it('never reads the body of a document the host does not intercept (another origin, no session)', async () => {
    rig.host.intercept = false;
    await rig.pause();
    expect(rig.host.gated).toEqual([[TAB, 'https://site.test/page']]);
    expect(rig.port.calls).not.toContain('Fetch.getResponseBody');
    expect(rig.host.documents).toEqual([]);
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
  });

  it('considers a pause of a tab it holds no record of (the host gates it)', async () => {
    await rig.pause({}, { tabId: 77 });
    expect(rig.host.documents).toHaveLength(1);
  });

  it('treats a continue after a detach as already released (debug only)', async () => {
    rig.port.commands.set('Fetch.continueRequest', () =>
      Promise.reject(new Error('Debugger is not attached to the tab with id: 4.'))
    );
    await rig.pause({ frameId: 'IFRAME' });
    expect(logged('debug', /already gone/)).toBe(true);
    rig.port.commands.set('Fetch.continueRequest', () => Promise.reject(new Error('odd')));
    await rig.pause({ frameId: 'IFRAME', requestId: 'req-2' });
    expect(logged('warn', /could not be continued/)).toBe(true);
  });

  it('continues after an unexpected fault', async () => {
    rig.host.rewrite = () => {
      throw new Error('host threw');
    };
    await rig.pause();
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
    expect(logged('warn', /release deadline/)).toBe(true);
    rig.host.documentBodyUnavailable = () => {
      throw new Error('record threw');
    };
    rig.port.commands.set('Fetch.getResponseBody', () => Promise.reject(new Error('x')));
    await rig.pause({ requestId: 'req-2' });
    expect(rig.port.releases('req-2')).toEqual(['Fetch.continueRequest']);
    expect(logged('error', /handling failed/)).toBe(true);
  });

  it('ignores other events and logs a pause from an unknown source', async () => {
    rig.port.handlers.event({ tabId: TAB }, 'Network.requestWillBeSent', {});
    rig.port.handlers.event({ targetId: 'x' }, 'Fetch.requestPaused', pauseEvent());
    await flush();
    expect(rig.port.sent).toEqual([]);
    expect(logged('error', /unknown source/)).toBe(true);
  });
});

describe('defaults', () => {
  it('runs on the real clocks and logger when none are injected', async () => {
    const port = new FakePort();
    const host = new FakeHost();
    port.commands.set('Fetch.getResponseBody', () =>
      Promise.resolve({ body: bytesToBase64(BODY), base64Encoded: true })
    );
    const backend = createChromiumInterceptionBackend({ port, host });
    await expect(backend.arm(TAB, 1)).resolves.toEqual({ armed: true });
    // Each field against its own time base: `receivedAt` is the monotonic
    // stamp (time origin + `performance.now()`), `wallAt` is `Date.now()`.
    // The two bases drift apart within a process (wall-clock slewing), so
    // comparing across them fails whenever the wall clock runs ahead.
    const stampBefore = Math.floor(performance.timeOrigin + performance.now());
    const wallBefore = Date.now();
    port.handlers.event({ tabId: TAB }, 'Fetch.requestPaused', pauseEvent());
    await flush();
    const identity = host.documents[0]?.identity;
    expect(identity?.receivedAt).toBeGreaterThanOrEqual(stampBefore);
    expect(identity?.wallAt).toBeGreaterThanOrEqual(wallBefore);
    expect(identity?.wallAt).toBeLessThanOrEqual(Date.now());
  });
});

describe('Speculation-Rules header on continued session documents', () => {
  const HEADERS = [
    { name: 'Content-Type', value: 'text/html' },
    { name: 'Speculation-Rules', value: '"/rules.json"' },
    { name: 'Link', value: '<a>' }
  ];
  const WITHOUT = [
    { name: 'Content-Type', value: 'text/html' },
    { name: 'Link', value: '<a>' }
  ];

  beforeEach(async () => {
    await rig.backend.arm(TAB, 10, ORIGIN);
    rig.port.sent.length = 0;
    rig.port.calls.length = 0;
  });

  it('continues an unchanged document with the header dropped (no copy)', async () => {
    rig.host.rewrite = () => Promise.resolve(null);
    await rig.pause({ responseHeaders: HEADERS });
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueResponse']);
    expect(rig.port.sent.at(-1)?.params).toEqual({
      requestId: 'req-1',
      responseCode: 200,
      responseHeaders: WITHOUT,
      responsePhrase: 'OK'
    });
  });

  it('falls back to a plain continue when the browser refuses the header-dropping continue', async () => {
    rig.host.rewrite = () => Promise.resolve(null);
    rig.port.commands.set('Fetch.continueResponse', () => Promise.reject(new Error('nope')));
    await rig.pause({ responseHeaders: HEADERS });
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueResponse', 'Fetch.continueRequest']);
  });

  it('drops it on an unreadable body too', async () => {
    rig.port.commands.set('Fetch.getResponseBody', () => Promise.reject(new Error('no body')));
    await rig.pause({ responseHeaders: HEADERS });
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueResponse']);
  });

  it('drops it on an ineligible session document (e.g. XHTML), only for the session', async () => {
    const xhtml = [{ name: 'Content-Type', value: 'application/xhtml+xml' }, ...HEADERS.slice(1)];
    await rig.pause({ responseHeaders: xhtml });
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueResponse']);
    rig.host.intercept = false;
    await rig.pause({ requestId: 'req-2', responseHeaders: xhtml });
    expect(rig.port.releases('req-2')).toEqual(['Fetch.continueRequest']);
  });

  it('continues plainly a document without the header', async () => {
    rig.host.rewrite = () => Promise.resolve(null);
    await rig.pause();
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
  });

  it('flags the guard in documents of the guarded origin only', async () => {
    await rig.pause();
    await rig.pause({
      requestId: 'req-2',
      request: { url: 'https://other.test/x', method: 'GET' }
    });
    expect(rig.host.documents.map((document) => document.identity?.speculationGuard)).toEqual([
      true,
      false
    ]);
  });
});

describe('simulated-runtime script requests', () => {
  beforeEach(async () => {
    rig.port.commands.set('Page.getFrameTree', () =>
      Promise.resolve({ frameTree: { frame: { id: 'TOP', url: PAGE_URL } } })
    );
    await rig.backend.arm(TAB, 10);
    rig.port.calls.length = 0;
    rig.port.sent.length = 0;
  });

  /** Deliver a script pause and let it settle. */
  async function request(
    overrides: Record<string, unknown> = {},
    source: unknown = { tabId: TAB }
  ) {
    rig.port.handlers.event(source, 'Fetch.requestPaused', scriptPause(overrides));
    await flush();
  }

  it('answers the named runtime with its packaged bytes, uncached, never reaching the site', async () => {
    await request();
    expect(rig.host.runtimeAsks).toEqual([[TAB, RUNTIME_URL, PAGE_URL]]);
    expect(rig.port.releases('js-1')).toEqual(['Fetch.fulfillRequest']);
    expect(rig.port.sent.at(-1)?.params).toEqual({
      requestId: 'js-1',
      responseCode: 200,
      responseHeaders: [
        { name: 'content-type', value: 'text/javascript; charset=utf-8' },
        { name: 'cache-control', value: 'no-store' }
      ],
      body: bytesToBase64(RUNTIME_FILE.bytes)
    });
    // A script request is never read nor handed to the document step.
    expect(rig.port.calls).not.toContain('Fetch.getResponseBody');
    expect(rig.host.gated).toEqual([]);
  });

  it('continues a request the host names no file for (another URL, no simulation)', async () => {
    await request({ request: { url: 'https://site.test/x/lazyload.min.js', method: 'GET' } });
    expect(rig.port.releases('js-1')).toEqual(['Fetch.continueRequest']);
    rig.host.runtime = null;
    await request({ requestId: 'js-2' });
    expect(rig.port.releases('js-2')).toEqual(['Fetch.continueRequest']);
  });

  it('continues a sub-frame’s or a child session’s request without asking the host', async () => {
    await request({ frameId: 'IFRAME' });
    await request({ requestId: 'js-2' }, { tabId: TAB, sessionId: 'child' });
    expect(rig.port.releases('js-1')).toEqual(['Fetch.continueRequest']);
    expect(rig.port.sent.at(-1)?.method).toBe('Fetch.continueRequest');
    expect(rig.host.runtimeAsks).toEqual([]);
  });

  it.each([
    ['unreadable', () => Promise.reject(new Error('No target'))],
    ['missing from the frame tree', () => Promise.resolve({ frameTree: {} })]
  ])(
    'continues a request whose top document is %s, without asking the host (logged)',
    async (_name, answer) => {
      rig.port.commands.set('Page.getFrameTree', answer);
      await request();
      expect(rig.port.releases('js-1')).toEqual(['Fetch.continueRequest']);
      expect(rig.host.runtimeAsks).toEqual([]);
      expect(logged('warn', /runtime request left to the site/)).toBe(true);
    }
  );

  it('continues a request of a tab whose session is stopping, without asking the host', async () => {
    const detach = deferred();
    rig.port.detachImpl = () => detach.promise;
    const disarmed = rig.backend.disarm(TAB);
    await flush();
    await request();
    expect(rig.port.releases('js-1')).toEqual(['Fetch.continueRequest']);
    expect(rig.host.runtimeAsks).toEqual([]);
    detach.resolve();
    await disarmed;
  });

  it('names a refused answer and continues the request to the site', async () => {
    rig.port.commands.set('Fetch.fulfillRequest', () =>
      Promise.reject(new Error('Invalid header'))
    );
    await request();
    expect(rig.port.releases('js-1')).toEqual(['Fetch.fulfillRequest', 'Fetch.continueRequest']);
    expect(logged('warn', /Simulated runtime not delivered — answer refused/)).toBe(true);
  });

  it('names an answer whose request was already gone (nothing left to release)', async () => {
    rig.port.commands.set('Fetch.fulfillRequest', () =>
      Promise.reject(new Error('Invalid InterceptionId.'))
    );
    await request();
    expect(rig.port.releases('js-1')).toEqual(['Fetch.fulfillRequest']);
    expect(logged('info', /Simulated runtime not delivered — its request was already gone/)).toBe(
      true
    );
  });

  it('continues a request when the host fails unexpectedly', async () => {
    rig.host.simulatedRuntime = () => Promise.reject(new Error('host broke'));
    await request();
    expect(rig.port.releases('js-1')).toEqual(['Fetch.continueRequest']);
    expect(logged('error', /handling failed/)).toBe(true);
  });
});
