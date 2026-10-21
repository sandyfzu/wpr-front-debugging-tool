/**
 * The Chromium backend over a fake debugger port, a fake host, a fake
 * logger and a manual timer: arming (attach + enable, refusals, adoption,
 * mid-arm detaches, liveness re-check, re-tagging), serialization (the
 * latest of arm/resume/disarm wins), disarm, browser detaches (cause
 * mapping, generations, closed tabs), and paused requests — every path
 * releasing the request exactly once.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Logger } from '../../logger';
import type { ScheduleTimer } from '../../messaging/bounded-ask';
import { bytesToBase64 } from '../../../utils/base64';
import type { InterceptedDocument, InterceptionBackend, InterceptionHost } from '../backend';
import { DOCUMENT_BODY_BYTE_LIMIT } from '../document-transform';
import { INTERCEPTION_HOST_BOUNDS_MS } from '../timeouts';
import { CHROMIUM_TIMEOUTS_MS, createChromiumInterceptionBackend } from './backend';
import type { DebuggerEventHandlers, DebuggerPort, DebuggerTarget, TabPresence } from './port';

const TAB = 4;
const MAIN = 'MAIN-FRAME';
const BODY = new TextEncoder().encode('<p>served</p>');
const REWRITTEN = new TextEncoder().encode('<p>rewritten</p>');

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
          (call.method === 'Fetch.continueRequest' || call.method === 'Fetch.fulfillRequest') &&
          call.params?.requestId === requestId
      )
      .map((call) => call.method);
  }
}

/** A fake host recording its calls. */
class FakeHost implements InterceptionHost {
  rewrite: (document: InterceptedDocument) => Promise<Uint8Array | null> = () =>
    Promise.resolve(REWRITTEN);
  readonly documents: InterceptedDocument[] = [];
  readonly unavailable: [number, string][] = [];
  readonly ended: [number, string, number][] = [];

  shouldIntercept(): Promise<boolean> {
    return Promise.resolve(true);
  }

  rewriteDocument(document: InterceptedDocument): Promise<Uint8Array | null> {
    this.documents.push(document);
    return this.rewrite(document);
  }

  documentBodyUnavailable(tabId: number, documentUrl: string): Promise<void> {
    this.unavailable.push([tabId, documentUrl]);
    return Promise.resolve();
  }

  interceptionEnded(tabId: number, cause: string, generation: number): Promise<void> {
    this.ended.push([tabId, cause, generation]);
    return Promise.resolve();
  }
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
  const backend = createChromiumInterceptionBackend({ port, host, log, schedule: timers.schedule });
  rig = {
    port,
    host,
    log,
    timers,
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
  it('attaches, then enables response-stage document interception', async () => {
    await expect(rig.backend.arm(TAB, 10)).resolves.toEqual({ armed: true });
    expect(rig.port.calls).toEqual([`attach:${String(TAB)}`, 'Fetch.enable']);
    expect(rig.port.sent[0]).toEqual({
      target: { tabId: TAB },
      method: 'Fetch.enable',
      params: {
        patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Response' }]
      }
    });
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

  it('adopts this extension’s existing session ("already attached")', async () => {
    rig.port.attachImpl = () =>
      Promise.reject(new Error('Another debugger is already attached to the tab with id: 4.'));
    await expect(rig.backend.arm(TAB, 10)).resolves.toEqual({ armed: true });
    expect(rig.port.calls).toEqual([`attach:${String(TAB)}`, 'Fetch.enable']);
    expect(logged('info', /Adopting/)).toBe(true);
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

  it('confirms an armed tab with the patterns only, re-tagging it', async () => {
    await rig.backend.arm(TAB, 10);
    rig.port.calls.length = 0;
    await expect(rig.backend.arm(TAB, 20)).resolves.toEqual({ armed: true });
    expect(rig.port.calls).toEqual(['Fetch.enable']);
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
    expect(rig.port.calls).toEqual(['Fetch.enable', `attach:${String(TAB)}`, 'Fetch.enable']);
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
    expect(rig.port.calls).toEqual([
      `attach:${String(TAB)}`,
      'Fetch.enable',
      `detach:${String(TAB)}`
    ]);
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
    expect(rig.host.documents).toEqual([
      {
        tabId: TAB,
        documentUrl: 'https://site.test/page',
        body: BODY,
        status: 200,
        method: 'GET',
        contentType: 'text/html; charset=utf-8'
      }
    ]);
    expect(rig.port.releases('req-1')).toEqual(['Fetch.fulfillRequest']);
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

  it('continues when the page target is unknown', async () => {
    rig.port.pageTarget = () => Promise.reject(new Error('targets failed'));
    await rig.pause();
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
    rig.port.pageTarget = () => Promise.resolve(null);
    await rig.pause({ requestId: 'req-2' });
    expect(rig.port.releases('req-2')).toEqual(['Fetch.continueRequest']);
  });

  it('continues a redirect hop without a frame check', async () => {
    await rig.pause({ responseStatusCode: 302 });
    expect(rig.port.calls).toEqual(['Fetch.continueRequest']);
  });

  it('continues and records an unreadable body', async () => {
    rig.port.commands.set('Fetch.getResponseBody', () => Promise.reject(new Error('no body')));
    await rig.pause();
    expect(rig.port.releases('req-1')).toEqual(['Fetch.continueRequest']);
    expect(rig.host.unavailable).toEqual([[TAB, 'https://site.test/page']]);
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

  it('serves the original once the host passes the release deadline, ignoring its late answer', async () => {
    expect(CHROMIUM_TIMEOUTS_MS.release).toBeGreaterThan(
      INTERCEPTION_HOST_BOUNDS_MS.rewriteDocument
    );
    const late = deferred<Uint8Array | null>();
    rig.host.rewrite = () => late.promise;
    await rig.pause();
    rig.timers.fire(CHROMIUM_TIMEOUTS_MS.release);
    await flush();
    late.resolve(REWRITTEN);
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

  it('considers a pause of a tab it holds no record of (the host gates it)', async () => {
    await rig.pause({}, { tabId: 77 });
    expect(rig.host.documents).toHaveLength(1);
  });

  it('treats a continue after a detach as already released (debug only)', async () => {
    rig.port.commands.set('Fetch.continueRequest', () =>
      Promise.reject(new Error('Debugger is not attached to the tab with id: 4.'))
    );
    await rig.pause({ frameId: 'IFRAME' });
    expect(logged('debug', /after detach/)).toBe(true);
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
