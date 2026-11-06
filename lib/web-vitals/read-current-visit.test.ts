/**
 * The panel's current-visit read: the page's input is reduced (the capped
 * mark carried along), every miss is its own outcome; the tab step is
 * bounded and guards the answer.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Logger } from '../logger';
import type { AskOutcome } from '../messaging/bounded-ask';
import type { CurrentVisitVitalsReply } from '../messaging/current-visit-vitals';
import type { VitalsInput } from './current-visit';
import {
  currentVisitTabStep,
  readCurrentVisitVitals,
  type CurrentVisitDeps
} from './read-current-visit';

/** A visit with an LCP, no shift, one interaction; CLS unsupported (Firefox-like). */
const INPUT: VitalsInput = {
  supported: { lcp: true, cls: false, inp: true },
  activationStart: 0,
  firstHiddenTime: null,
  fcpTime: 200,
  lcpEntries: [{ startTime: 1200 }],
  layoutShifts: [],
  events: [{ interactionId: 3, duration: 240 }],
  interactionCount: 1
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

/** Deps whose read answers `outcome`. */
function deps(outcome: AskOutcome<CurrentVisitVitalsReply>): Omit<
  CurrentVisitDeps,
  'read' | 'log'
> & {
  read: Mock<CurrentVisitDeps['read']>;
  log: LogSpies;
} {
  return {
    read: vi.fn<CurrentVisitDeps['read']>(() => Promise.resolve(outcome)),
    log: logDouble()
  };
}

describe('readCurrentVisitVitals', () => {
  it('reduces the page’s input', async () => {
    await expect(
      readCurrentVisitVitals(deps({ kind: 'reply', reply: { input: INPUT, capped: true } }))
    ).resolves.toEqual({
      kind: 'read',
      capped: true,
      vitals: {
        lcp: { state: 'measured', value: 1200, rating: 'good' },
        cls: { state: 'unsupported' },
        inp: { state: 'measured', value: 240, rating: 'needs-improvement', interactions: 1 }
      }
    });
  });

  it('reads a miss as an unreachable page, logged', async () => {
    const d = deps({ kind: 'no-receiver' });
    await expect(readCurrentVisitVitals(d)).resolves.toEqual({
      kind: 'page-unreachable',
      miss: 'no-receiver'
    });
    expect(d.log.debug).toHaveBeenCalledTimes(1);
  });
});

describe('currentVisitTabStep', () => {
  it('asks the tab and guards its answer', async () => {
    const getCurrentVisitVitals = vi.fn(() => Promise.resolve({ input: INPUT, capped: false }));
    await expect(currentVisitTabStep({ getCurrentVisitVitals }, 6)()).resolves.toEqual({
      kind: 'reply',
      reply: { input: INPUT, capped: false }
    });
    expect(getCurrentVisitVitals).toHaveBeenCalledWith(6);
    const broken = currentVisitTabStep({ getCurrentVisitVitals: () => Promise.resolve(null) }, 6);
    await expect(broken()).resolves.toEqual({ kind: 'invalid-reply' });
  });
});
