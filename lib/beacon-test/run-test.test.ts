/**
 * The panel's beacon test: an invalid draft is refused with every issue
 * (the "at least one feature" reason included) and nothing is sent; a valid
 * one is sent as a fresh configuration and the page's validated answer is
 * passed through; every ask miss is its own outcome; the tab step is
 * bounded and guards the answer.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Logger } from '../logger';
import type { AskOutcome } from '../messaging/bounded-ask';
import type { BeaconTestAnswer } from '../messaging/beacon-test';
import { BEACON_TEST_DEFAULTS, DEFAULT_SELECTOR_TEXT, type BeaconTestDraft } from './config';
import { beaconTabStep, runBeaconTest, type BeaconTestDeps } from './run-test';

/** A runnable draft (lazy render only: no selector parsing involved). */
const DRAFT: BeaconTestDraft = {
  features: { aboveTheFold: false, lazyRender: true },
  mobile: false,
  widthThreshold: BEACON_TEST_DEFAULTS.widthThreshold,
  heightThreshold: BEACON_TEST_DEFAULTS.heightThreshold,
  lazyRenderThreshold: BEACON_TEST_DEFAULTS.lazyRenderThreshold,
  selectorText: DEFAULT_SELECTOR_TEXT
};

/** A logger whose levels are spies the test reads (properties, so reads stay bound). */
interface LogSpies {
  readonly debug: Mock<Logger['debug']>;
  readonly info: Mock<Logger['info']>;
  readonly warn: Mock<Logger['warn']>;
  readonly error: Mock<Logger['error']>;
}

/** A silent logger recording its calls. */
function logDouble(): LogSpies {
  return {
    debug: vi.fn<Logger['debug']>(),
    info: vi.fn<Logger['info']>(),
    warn: vi.fn<Logger['warn']>(),
    error: vi.fn<Logger['error']>()
  };
}

/** Deps whose run answers `outcome`. */
function deps(
  outcome: AskOutcome<BeaconTestAnswer>
): Omit<BeaconTestDeps, 'run' | 'log'> & { run: Mock<BeaconTestDeps['run']>; log: LogSpies } {
  return {
    // A parser double: plain selectors parse, a stray closing bracket does not.
    isValidSelector: (selector) => !/[)\]]$/.test(selector),
    run: vi.fn<BeaconTestDeps['run']>(() => Promise.resolve(outcome)),
    log: logDouble()
  };
}

describe('runBeaconTest', () => {
  it('refuses a draft with no feature on, sending nothing', async () => {
    const d = deps({ kind: 'reply', reply: { kind: 'busy' } });
    const outcome = await runBeaconTest(
      { ...DRAFT, features: { aboveTheFold: false, lazyRender: false } },
      d
    );
    expect(outcome).toEqual({ kind: 'invalid-config', issues: [{ kind: 'no-feature' }] });
    expect(d.run).not.toHaveBeenCalled();
  });

  it('reports every issue at once', async () => {
    const d = deps({ kind: 'reply', reply: { kind: 'busy' } });
    const outcome = await runBeaconTest(
      {
        ...DRAFT,
        features: { aboveTheFold: true, lazyRender: false },
        widthThreshold: 0,
        selectorText: ''
      },
      d
    );
    expect(outcome).toEqual({
      kind: 'invalid-config',
      issues: [{ kind: 'threshold', field: 'widthThreshold' }, { kind: 'no-selector' }]
    });
  });

  it('sends the checked configuration and passes the page’s answer through', async () => {
    const answer: BeaconTestAnswer = { kind: 'bailed', reason: 'screen-size' };
    const d = deps({ kind: 'reply', reply: answer });
    await expect(runBeaconTest(DRAFT, d)).resolves.toBe(answer);
    expect(d.run).toHaveBeenCalledWith({
      config: {
        features: { aboveTheFold: false, lazyRender: true },
        mobile: false,
        widthThreshold: 1600,
        heightThreshold: 700,
        lazyRenderThreshold: 1800,
        selectors: []
      }
    });
  });

  it.each(['no-receiver', 'timeout', 'invalid-reply'] as const)(
    'reads a %s miss as an unreachable page, logged quietly',
    async (kind) => {
      const d = deps({ kind });
      await expect(runBeaconTest(DRAFT, d)).resolves.toEqual({
        kind: 'page-unreachable',
        miss: kind
      });
      expect(d.log.debug).toHaveBeenCalledTimes(1);
      expect(d.log.warn).not.toHaveBeenCalled();
    }
  );

  it('logs a real send failure loudly', async () => {
    const d = deps({ kind: 'failed', cause: new Error('boom') });
    await expect(runBeaconTest(DRAFT, d)).resolves.toEqual({
      kind: 'page-unreachable',
      miss: 'failed'
    });
    expect(d.log.warn).toHaveBeenCalledWith('Beacon test failed', 'boom');
  });
});

describe('beaconTabStep', () => {
  it('asks the tab and guards its answer', async () => {
    const runBeaconTest = vi.fn(() => Promise.resolve({ kind: 'runner-unavailable' }));
    const step = beaconTabStep({ runBeaconTest }, 9);
    const request = {
      config: { ...BEACON_TEST_DEFAULTS, features: { aboveTheFold: false, lazyRender: true } }
    };
    await expect(step(request)).resolves.toEqual({
      kind: 'reply',
      reply: { kind: 'runner-unavailable' }
    });
    expect(runBeaconTest).toHaveBeenCalledWith(9, request);
  });

  it('reads a malformed answer as invalid', async () => {
    const step = beaconTabStep({ runBeaconTest: () => Promise.resolve({ kind: 'nope' }) }, 9);
    await expect(step({ config: BEACON_TEST_DEFAULTS })).resolves.toEqual({
      kind: 'invalid-reply'
    });
  });
});
