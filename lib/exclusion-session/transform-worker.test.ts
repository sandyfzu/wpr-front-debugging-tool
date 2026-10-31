/**
 * The preempting runner: the worker-side handler (request guard, step
 * announcements, cloneable causes) and the host (results, deadline kill
 * naming the announced feature, port errors, spawn failures, serialized
 * runs, respawn after a kill, stale messages, dispose).
 */
import { describe, expect, it, vi } from 'vitest';
import { applyPipeline, EXCLUSION_PIPELINE_STEP_IDS } from '../exclusion-builder/pipeline';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../exclusion-builder/set';
import type { ScheduleTimer } from '../messaging/bounded-ask';
import type { DocumentTransformRequest } from './document-transform';
import type { DocumentSimulationInput } from '../messaging/exclusion-simulation';
import { simulationInput } from '../messaging/exclusion-simulation.fixtures';
import {
  createWorkerTransformRunner,
  handleTransformWorkerMessage,
  parseTransformWorkerRequest,
  WORKER_GRACE_MS,
  type TransformWorkerMessage,
  type TransformWorkerPort,
  type TransformWorkerRequest
} from './transform-worker';

const SET: ExclusionSet = {
  rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['a\\.js'] },
  disable: EMPTY_EXCLUSION_SET.disable
};
const DELAYED = '<script type="rocketlazyloadscript" data-rocket-src="a.js"></script>';
const REQUEST: DocumentTransformRequest = {
  html: DELAYED,
  set: SET,
  budgetMs: 100
};

/** A manual timer: `fire()` runs every pending callback. */
function manualTimers(): { schedule: ScheduleTimer; fire: () => void; delays: number[] } {
  const pending = new Set<() => void>();
  const delays: number[] = [];
  return {
    schedule: (run, ms) => {
      delays.push(ms);
      pending.add(run);
      return () => pending.delete(run);
    },
    fire: () => {
      for (const run of [...pending]) {
        pending.delete(run);
        run();
      }
    },
    delays
  };
}

/** A fake port; `behave` decides what the "worker" does with each request. */
class FakePort implements TransformWorkerPort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  readonly received: TransformWorkerRequest[] = [];

  constructor(private readonly behave: (port: FakePort, message: TransformWorkerRequest) => void) {}

  postMessage(message: TransformWorkerRequest): void {
    this.received.push(message);
    this.behave(this, message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Deliver a worker message asynchronously. */
  emit(data: unknown): void {
    queueMicrotask(() => this.onmessage?.({ data }));
  }
}

/** A worker that really runs the handler. */
const working = (port: FakePort, message: TransformWorkerRequest): void => {
  handleTransformWorkerMessage(
    message,
    (out) => {
      port.emit(out);
    },
    () => 0
  );
};

describe('parseTransformWorkerRequest', () => {
  const valid = { type: 'transform', id: 1, request: REQUEST };

  it('accepts a well-formed request (fresh set)', () => {
    const parsed = parseTransformWorkerRequest(valid);
    expect(parsed).toEqual(valid);
    expect(parsed?.request.set).not.toBe(SET);
  });

  it.each([
    ['not a record', 'x'],
    ['wrong type', { ...valid, type: 'other' }],
    ['bad id', { ...valid, id: -1 }],
    ['no request', { ...valid, request: null }],
    ['html not a string', { ...valid, request: { ...REQUEST, html: 1 } }],
    ['zero budget', { ...valid, request: { ...REQUEST, budgetMs: 0 } }],
    ['infinite budget', { ...valid, request: { ...REQUEST, budgetMs: Infinity } }],
    ['bad set', { ...valid, request: { ...REQUEST, set: {} } }],
    ['bytes not a record', { ...valid, request: { ...REQUEST, bytes: 'utf-8' } }],
    ['bytes without bom', { ...valid, request: { ...REQUEST, bytes: { encoding: 'utf-8' } } }],
    [
      'bytes with a huge encoding',
      { ...valid, request: { ...REQUEST, bytes: { encoding: 'x'.repeat(65), bom: false } } }
    ]
  ])('rejects %s', (_case, data) => {
    expect(parseTransformWorkerRequest(data)).toBeNull();
  });

  it('accepts the decoding facts', () => {
    const bytes = { encoding: 'windows-1252', bom: false };
    const data = { ...valid, request: { ...REQUEST, bytes } };
    expect(parseTransformWorkerRequest(data)?.request.bytes).toEqual(bytes);
  });

  it('ignores fields it does not read (e.g. a document URL)', () => {
    const data = { ...valid, request: { ...REQUEST, documentUrl: 'https://s.tld/' } };
    expect(parseTransformWorkerRequest(data)?.request).toEqual(REQUEST);
  });
});

describe('handleTransformWorkerMessage', () => {
  it('announces each step, then posts the result', () => {
    const posted: TransformWorkerMessage[] = [];
    handleTransformWorkerMessage(
      { type: 'transform', id: 7, request: REQUEST },
      (m) => posted.push(m),
      () => 0
    );
    expect(posted.slice(0, -1)).toEqual(
      EXCLUSION_PIPELINE_STEP_IDS.map((feature) => ({ type: 'step', id: 7, feature }))
    );
    const expected = applyPipeline(DELAYED, SET);
    expect(posted.at(-1)).toEqual({
      type: 'result',
      id: 7,
      result: {
        ok: true,
        html: expected.html,
        outcome: { outcome: 'rewritten', reports: expected.reports }
      }
    });
  });

  it('drops malformed requests', () => {
    const post = vi.fn();
    handleTransformWorkerMessage({ type: 'nope' }, post);
    expect(post).not.toHaveBeenCalled();
  });

  it('sends an engine failure cause as its message', () => {
    const posted: TransformWorkerMessage[] = [];
    const bad = { ...REQUEST, set: { ...SET, rows: { ...SET.rows, delayJs: ['('] } } };
    handleTransformWorkerMessage({ type: 'transform', id: 1, request: bad }, (m) => posted.push(m));
    const last = posted.at(-1);
    expect(last?.type).toBe('result');
    if (last?.type !== 'result' || last.result.ok) throw new Error('expected a failed result');
    expect(last.result.outcome).toEqual({ outcome: 'failed', reason: 'engine-failed' });
    expect(typeof last.result.cause).toBe('string');
  });

  it('stringifies a non-Error cause', () => {
    const posted: TransformWorkerMessage[] = [];
    let calls = 0;
    const throwing = () => {
      calls++;
      if (calls > 1) throw 'clock broke'; // eslint-disable-line @typescript-eslint/only-throw-error -- a non-Error throw is the case under test
      return 0;
    };
    handleTransformWorkerMessage(
      { type: 'transform', id: 1, request: REQUEST },
      (m) => posted.push(m),
      throwing
    );
    const last = posted.at(-1);
    if (last?.type !== 'result' || last.result.ok) throw new Error('expected a failed result');
    expect(last.result.cause).toBe('clock broke');
  });

  it('describes a non-Error, non-string cause generically', () => {
    const posted: TransformWorkerMessage[] = [];
    let calls = 0;
    const throwing = () => {
      calls++;
      if (calls > 1) throw { code: 1 }; // eslint-disable-line @typescript-eslint/only-throw-error -- a non-Error throw is the case under test
      return 0;
    };
    handleTransformWorkerMessage(
      { type: 'transform', id: 1, request: REQUEST },
      (m) => posted.push(m),
      throwing
    );
    const last = posted.at(-1);
    if (last?.type !== 'result' || last.result.ok) throw new Error('expected a failed result');
    expect(last.result.cause).toBe('Non-error engine failure');
  });

  it('posts an over-budget result without a cause', () => {
    const posted: TransformWorkerMessage[] = [];
    let t = 0;
    handleTransformWorkerMessage(
      { type: 'transform', id: 1, request: REQUEST },
      (m) => posted.push(m),
      () => (t += 1_000)
    );
    expect(posted.at(-1)).toEqual({
      type: 'result',
      id: 1,
      result: {
        ok: false,
        // The replay step runs first (Defer JS, no row of its own).
        outcome: { outcome: 'over-budget', feature: 'defer_all_js', row: null, budgetMs: 100 }
      }
    });
  });
});

describe('createWorkerTransformRunner', () => {
  it('resolves the worker result and keeps the port for the next run', async () => {
    const spawn = vi.fn(() => new FakePort(working));
    const timers = manualTimers();
    const host = createWorkerTransformRunner({ spawn, schedule: timers.schedule });
    const first = await host.run(REQUEST);
    expect(first.ok).toBe(true);
    await host.run(REQUEST);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(timers.delays).toEqual([100 + WORKER_GRACE_MS, 100 + WORKER_GRACE_MS]);
  });

  it('kills a silent run at the deadline, naming the last announced feature', async () => {
    const ports: FakePort[] = [];
    const timers = manualTimers();
    const host = createWorkerTransformRunner({
      spawn: () => {
        const port = new FakePort((self, message) => {
          self.emit({ type: 'step', id: message.id, feature: 'delay_js' });
          self.emit({ type: 'step', id: message.id, feature: 'defer_all_js' });
          self.emit({ type: 'step', id: message.id, feature: 'bogus' });
        });
        ports.push(port);
        return port;
      },
      schedule: timers.schedule,
      graceMs: 5
    });
    const run = host.run({ ...REQUEST, set: { ...SET, rows: { ...SET.rows, deferJs: ['x'] } } });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    timers.fire();
    await expect(run).resolves.toEqual({
      ok: false,
      outcome: { outcome: 'over-budget', feature: 'defer_all_js', row: 'x', budgetMs: 100 }
    });
    expect(ports[0]?.terminated).toBe(true);
    expect(timers.delays).toEqual([105]);
  });

  it('bills the first step, naming no row, when nothing was announced, then respawns', async () => {
    const timers = manualTimers();
    const spawn = vi
      .fn<() => TransformWorkerPort>()
      .mockReturnValueOnce(new FakePort(() => undefined))
      .mockReturnValueOnce(new FakePort(working));
    const host = createWorkerTransformRunner({ spawn, schedule: timers.schedule });
    const killed = host.run(REQUEST);
    await new Promise((resolve) => setTimeout(resolve, 0));
    timers.fire();
    // The set's one Delay JS row never ran (no step started): it must not be blamed.
    await expect(killed).resolves.toEqual({
      ok: false,
      outcome: { outcome: 'over-budget', feature: 'defer_all_js', row: null, budgetMs: 100 }
    });
    expect(EXCLUSION_PIPELINE_STEP_IDS[0]).toBe('defer_all_js');
    await expect(host.run(REQUEST)).resolves.toMatchObject({ ok: true });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale run id and answers the current one', async () => {
    const timers = manualTimers();
    const host = createWorkerTransformRunner({
      spawn: () =>
        new FakePort((self, message) => {
          self.emit({ type: 'result', id: message.id + 100, result: { ok: true } });
          self.emit('junk');
          working(self, message);
        }),
      schedule: timers.schedule
    });
    await expect(host.run(REQUEST)).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ['a non-record result', 'nope'],
    ['ok without html', { ok: true, outcome: { outcome: 'rewritten', reports: [] } }],
    ['ok with a non-rewritten outcome', { ok: true, html: 'x', outcome: { outcome: 'failed' } }],
    ['ok without reports', { ok: true, html: 'x', outcome: { outcome: 'rewritten' } }],
    ['a non-boolean ok', { ok: 1, outcome: { outcome: 'failed' } }],
    ['a failed run with a rewritten outcome', { ok: false, outcome: { outcome: 'rewritten' } }]
  ])('answers engine-failed for %s', async (_case, result) => {
    const host = createWorkerTransformRunner({
      spawn: () =>
        new FakePort((self, message) => {
          self.emit({ type: 'result', id: message.id, result });
        }),
      schedule: manualTimers().schedule
    });
    await expect(host.run(REQUEST)).resolves.toMatchObject({
      ok: false,
      outcome: { outcome: 'failed', reason: 'engine-failed' }
    });
  });

  it('passes a failed worker result through', async () => {
    const result = {
      ok: false,
      outcome: { outcome: 'failed', reason: 'engine-failed' },
      cause: 'x'
    };
    const host = createWorkerTransformRunner({
      spawn: () =>
        new FakePort((self, message) => {
          self.emit({ type: 'result', id: message.id, result });
        }),
      schedule: manualTimers().schedule
    });
    await expect(host.run(REQUEST)).resolves.toEqual(result);
  });

  it('answers engine-failed on a port error and kills the port', async () => {
    const port = new FakePort((self) => {
      queueMicrotask(() => self.onerror?.('crashed'));
    });
    const host = createWorkerTransformRunner({
      spawn: () => port,
      schedule: manualTimers().schedule
    });
    await expect(host.run(REQUEST)).resolves.toEqual({
      ok: false,
      outcome: { outcome: 'failed', reason: 'engine-failed' },
      cause: 'crashed'
    });
    expect(port.terminated).toBe(true);
    expect(port.onmessage).toBeNull();
  });

  it('answers engine-failed when the platform cannot spawn', async () => {
    const boom = new Error('no workers here');
    const host = createWorkerTransformRunner({
      spawn: () => {
        throw boom;
      }
    });
    await expect(host.run(REQUEST)).resolves.toEqual({
      ok: false,
      outcome: { outcome: 'failed', reason: 'engine-failed' },
      cause: boom
    });
  });

  it('answers engine-failed when posting throws (e.g. an uncloneable request)', async () => {
    const boom = new Error('DataCloneError');
    const port = new FakePort(() => {
      throw boom;
    });
    const host = createWorkerTransformRunner({
      spawn: () => port,
      schedule: manualTimers().schedule
    });
    await expect(host.run(REQUEST)).resolves.toMatchObject({ cause: boom });
    expect(port.terminated).toBe(true);
  });

  it('serializes runs: the second request posts only after the first settles', async () => {
    let release: (() => void) | null = null;
    const port = new FakePort((self, message) => {
      if (message.id === 0) {
        release = () => {
          working(self, message);
        };
      } else {
        working(self, message);
      }
    });
    const host = createWorkerTransformRunner({
      spawn: () => port,
      schedule: manualTimers().schedule
    });
    const first = host.run(REQUEST);
    const second = host.run(REQUEST);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(port.received.map((message) => message.id)).toEqual([0]);
    (release as (() => void) | null)?.();
    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(second).resolves.toMatchObject({ ok: true });
    expect(port.received.map((message) => message.id)).toEqual([0, 1]);
  });

  it('bounds a queued run from its arrival: dropped as engine-failed at its own deadline', async () => {
    const timers: { ms: number; run: () => void }[] = [];
    const schedule: ScheduleTimer = (run, ms) => {
      const timer = { ms, run };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    };
    const port = new FakePort(() => undefined); // the first run never answers
    const host = createWorkerTransformRunner({ spawn: () => port, schedule });
    const first = host.run(REQUEST);
    const queued = host.run({ ...REQUEST, budgetMs: 40 });
    // Both deadlines are armed at hand-over, not when the queued run reaches the port.
    expect(timers.map((timer) => timer.ms)).toEqual([100 + WORKER_GRACE_MS, 40 + WORKER_GRACE_MS]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    timers[1]?.run(); // the queued run's (shorter) deadline passes first
    await expect(queued).resolves.toEqual({
      ok: false,
      outcome: { outcome: 'failed', reason: 'engine-failed' },
      cause: new Error('Transform run queued past its deadline')
    });
    expect(port.received.map((message) => message.id)).toEqual([0]);
    timers[0]?.run();
    await expect(first).resolves.toMatchObject({ outcome: { outcome: 'over-budget' } });
    expect(timers).toEqual([]);
  });

  it('a queued run reaching the port keeps only what is left of its deadline', async () => {
    const pending = new Map<number, () => void>();
    let nextTimer = 0;
    const schedule: ScheduleTimer = (run) => {
      const id = nextTimer++;
      pending.set(id, run);
      return () => pending.delete(id);
    };
    let release: (() => void) | null = null;
    const port = new FakePort((self, message) => {
      if (message.id === 0) {
        release = () => {
          working(self, message);
        };
      }
      // the second run never answers
    });
    const host = createWorkerTransformRunner({ spawn: () => port, schedule });
    const first = host.run(REQUEST);
    const second = host.run(REQUEST);
    await new Promise((resolve) => setTimeout(resolve, 0));
    (release as (() => void) | null)?.();
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(port.received.map((message) => message.id)).toEqual([0, 1]);
    // No new timer was armed when the second run started: its arrival deadline kills it.
    expect([...pending.keys()]).toEqual([1]);
    pending.get(1)?.();
    await expect(second).resolves.toMatchObject({ outcome: { outcome: 'over-budget' } });
    expect(port.terminated).toBe(true);
  });

  it('dispose kills the port and settles the in-flight run as engine-failed', async () => {
    const port = new FakePort(() => undefined);
    const host = createWorkerTransformRunner({
      spawn: () => port,
      schedule: manualTimers().schedule
    });
    const run = host.run(REQUEST);
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.dispose();
    await expect(run).resolves.toMatchObject({ ok: false, outcome: { reason: 'engine-failed' } });
    expect(port.terminated).toBe(true);
    host.dispose(); // idempotent
  });

  it('dispose settles every queued run and never spawns again', async () => {
    const spawn = vi.fn(() => new FakePort(() => undefined));
    const host = createWorkerTransformRunner({ spawn, schedule: manualTimers().schedule });
    const running = host.run(REQUEST);
    const queued = [host.run(REQUEST), host.run(REQUEST)];
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.dispose();
    for (const run of [running, ...queued]) {
      await expect(run).resolves.toMatchObject({ ok: false, outcome: { reason: 'engine-failed' } });
    }
    await expect(host.run(REQUEST)).resolves.toEqual({
      ok: false,
      outcome: { outcome: 'failed', reason: 'engine-failed' },
      cause: new Error('Transform worker disposed')
    });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('survives a timer seam that fires synchronously (the queue never wedges)', async () => {
    const schedule: ScheduleTimer = (run, ms) => {
      if (ms === 1 + WORKER_GRACE_MS) run(); // already past its deadline at hand-over
      return () => undefined;
    };
    const spawn = vi.fn(() => new FakePort(working));
    const host = createWorkerTransformRunner({ spawn, schedule });
    await expect(host.run({ ...REQUEST, budgetMs: 1 })).resolves.toMatchObject({
      outcome: { outcome: 'failed', reason: 'engine-failed' }
    });
    await expect(host.run(REQUEST)).resolves.toMatchObject({ ok: true });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('uses the platform timer by default', async () => {
    vi.useFakeTimers();
    try {
      const host = createWorkerTransformRunner({ spawn: () => new FakePort(() => undefined) });
      const run = host.run({ ...REQUEST, budgetMs: 10 });
      await vi.advanceTimersByTimeAsync(10 + WORKER_GRACE_MS);
      await expect(run).resolves.toMatchObject({ outcome: { outcome: 'over-budget' } });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('simulation fields', () => {
  const valid = { type: 'transform', id: 1, request: REQUEST };
  /** A simulation input carrying no CSP meta (the fixture's meta offset may lie past {@link DELAYED}). */
  const simulate = {
    ...simulationInput(),
    csp: { browser: 'chromium', headers: [], metas: [] }
  } as const satisfies DocumentSimulationInput;
  /** {@link REQUEST} simulating Delay JS. */
  const SIMULATING: DocumentTransformRequest = { ...REQUEST, simulate };

  it('carries a valid simulation input through the request guard', () => {
    const data = { ...valid, request: { ...REQUEST, simulate } };
    expect(parseTransformWorkerRequest(data)?.request).toEqual({ ...REQUEST, simulate });
  });

  it('rejects a malformed input of its own (runtime), never the page-derived parts', () => {
    const bad = { ...valid, request: { ...REQUEST, simulate: { ...simulate, runtime: '' } } };
    expect(parseTransformWorkerRequest(bad)).toBeNull();
  });

  it('degrades unfit page-derived parts instead of dropping the request', () => {
    const past = {
      ...simulate,
      csp: { ...simulate.csp, metas: [{ content: '', offset: DELAYED.length + 1 }] }
    };
    const huge = {
      ...simulate,
      siteVersion: '9'.repeat(65),
      csp: { ...simulate.csp, headers: [{ name: 'csp', value: 'v'.repeat(32 * 1024 + 1) }] }
    };
    // `toEqual` reads an `undefined` property as absent.
    const withoutCsp = { ...simulate, csp: undefined };
    expect(
      parseTransformWorkerRequest({ ...valid, request: { ...REQUEST, simulate: past } })?.request
        .simulate
    ).toEqual({ ...withoutCsp, cspUnavailable: 'unreadable' });
    expect(
      parseTransformWorkerRequest({ ...valid, request: { ...REQUEST, simulate: huge } })?.request
        .simulate
    ).toEqual({ ...withoutCsp, cspUnavailable: 'oversized' });
  });

  it('names the simulate stage of a run killed in its simulation step (no row)', async () => {
    const timers = manualTimers();
    const host = createWorkerTransformRunner({
      spawn: () =>
        new FakePort((self, message) => {
          self.emit({ type: 'step', id: message.id, feature: 'delay_js', stage: 'simulate' });
        }),
      schedule: timers.schedule,
      graceMs: 5
    });
    const run = host.run(SIMULATING);
    await new Promise((resolve) => setTimeout(resolve, 0));
    timers.fire();
    await expect(run).resolves.toEqual({
      ok: false,
      outcome: {
        outcome: 'over-budget',
        feature: 'delay_js',
        row: null,
        budgetMs: 100,
        stage: 'simulate'
      }
    });
  });

  it('ignores a simulate stage for a feature the request does not simulate', async () => {
    for (const [request, feature, row] of [
      [REQUEST, 'delay_js', 'a\\.js'],
      [SIMULATING, 'defer_all_js', null]
    ] as const) {
      const timers = manualTimers();
      const host = createWorkerTransformRunner({
        spawn: () =>
          new FakePort((self, message) => {
            self.emit({ type: 'step', id: message.id, feature, stage: 'simulate' });
          }),
        schedule: timers.schedule,
        graceMs: 5
      });
      const run = host.run(request);
      await new Promise((resolve) => setTimeout(resolve, 0));
      timers.fire();
      await expect(run).resolves.toEqual({
        ok: false,
        outcome: { outcome: 'over-budget', feature, row, budgetMs: 100 }
      });
    }
  });

  it('a later stage-less step clears the stage (an unknown stage reads as none)', async () => {
    const timers = manualTimers();
    const host = createWorkerTransformRunner({
      spawn: () =>
        new FakePort((self, message) => {
          self.emit({ type: 'step', id: message.id, feature: 'delay_js', stage: 'simulate' });
          self.emit({ type: 'step', id: message.id, feature: 'delay_js', stage: 'other' });
        }),
      schedule: timers.schedule,
      graceMs: 5
    });
    const run = host.run(SIMULATING);
    await new Promise((resolve) => setTimeout(resolve, 0));
    timers.fire();
    await expect(run).resolves.toEqual({
      ok: false,
      outcome: { outcome: 'over-budget', feature: 'delay_js', row: 'a\\.js', budgetMs: 100 }
    });
  });

  it('passes a runtime-unavailable worker result through', async () => {
    const result = {
      ok: false,
      outcome: { outcome: 'runtime-unavailable', cause: 'hash-mismatch' }
    };
    const host = createWorkerTransformRunner({
      spawn: () =>
        new FakePort((self, message) => {
          self.emit({ type: 'result', id: message.id, result });
        }),
      schedule: manualTimers().schedule
    });
    await expect(host.run(REQUEST)).resolves.toEqual(result);
  });

  it('still refuses an unknown unmodified outcome', async () => {
    const result = { ok: false, outcome: { outcome: 'skipped' } };
    const host = createWorkerTransformRunner({
      spawn: () =>
        new FakePort((self, message) => {
          self.emit({ type: 'result', id: message.id, result });
        }),
      schedule: manualTimers().schedule
    });
    const answer = await host.run(REQUEST);
    expect(answer.ok).toBe(false);
    expect(answer.outcome).toEqual({ outcome: 'failed', reason: 'engine-failed' });
  });
});
