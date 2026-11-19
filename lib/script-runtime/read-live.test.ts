/**
 * The panel's live script read: each script is classified (states, groups,
 * sources, the budget's text cut carried along), the total and truncation
 * reported, every miss its own outcome; the tab step is bounded and guards
 * the answer.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Logger } from '../logger';
import type { AskOutcome } from '../messaging/bounded-ask';
import type { LiveScriptFacts, ScriptRuntimeReply } from '../messaging/script-runtime';
import { liveScriptsTabStep, readLiveScripts, type LiveScriptsDeps } from './read-live';

/** A delayed plugin script that has not run yet. */
const PENDING: LiveScriptFacts = {
  type: 'rocketlazyloadscript',
  delayedSrc: 'https://a.test/wp-content/plugins/x/a.js',
  src: null,
  status: null,
  id: 'a',
  classes: [],
  text: '',
  textCut: false
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
function deps(
  outcome: AskOutcome<ScriptRuntimeReply>
): Omit<LiveScriptsDeps, 'read' | 'log'> & { read: Mock<LiveScriptsDeps['read']>; log: LogSpies } {
  return {
    read: vi.fn<LiveScriptsDeps['read']>(() => Promise.resolve(outcome)),
    log: logDouble()
  };
}

describe('readLiveScripts', () => {
  it('classifies every script and carries the text cut', async () => {
    const executed: LiveScriptFacts = {
      ...PENDING,
      type: 'text/javascript',
      src: PENDING.delayedSrc,
      status: 'executed'
    };
    const inline: LiveScriptFacts = {
      ...PENDING,
      type: null,
      delayedSrc: null,
      text: 'var a = 1;…',
      textCut: true
    };
    const outcome = await readLiveScripts(
      deps({ kind: 'reply', reply: { scripts: [PENDING, executed, inline], total: 3 } })
    );
    expect(outcome).toMatchObject({
      kind: 'read',
      total: 3,
      truncated: false,
      scripts: [
        { state: 'pending', group: 'plugin', fullTextCut: false },
        { state: 'executed', group: 'plugin', fullTextCut: false },
        { state: 'not-delayed', group: 'inline', sourceKind: 'inline', fullTextCut: true }
      ]
    });
    if (outcome.kind !== 'read') throw new Error('not read');
    expect(Object.isFrozen(outcome.scripts)).toBe(true);
    expect(Object.isFrozen(outcome.scripts[0])).toBe(true);
    expect(outcome.scripts[0]).not.toHaveProperty('textCut');
    // No base in the answer: none in the outcome.
    expect(outcome.baseUrl).toBeNull();
  });

  it('passes the page base on for the panel to resolve relative URLs', async () => {
    const outcome = await readLiveScripts(
      deps({ kind: 'reply', reply: { scripts: [], total: 0, baseUrl: 'https://a.test/shop/' } })
    );
    expect(outcome).toMatchObject({ kind: 'read', baseUrl: 'https://a.test/shop/' });
  });

  it('reports a page with more scripts than listed as truncated', async () => {
    const outcome = await readLiveScripts(
      deps({ kind: 'reply', reply: { scripts: [PENDING], total: 1200 } })
    );
    expect(outcome).toMatchObject({ total: 1200, truncated: true });
  });

  it('reads a miss as an unreachable page, logged', async () => {
    const d = deps({ kind: 'timeout' });
    await expect(readLiveScripts(d)).resolves.toEqual({
      kind: 'page-unreachable',
      miss: 'timeout'
    });
    expect(d.log.debug).toHaveBeenCalledWith('Live script read got no answer: timeout');
  });
});

describe('liveScriptsTabStep', () => {
  it('asks the tab and guards its answer', async () => {
    const getScriptRuntimeStatuses = vi.fn(() => Promise.resolve({ scripts: [], total: 0 }));
    await expect(liveScriptsTabStep({ getScriptRuntimeStatuses }, 2)()).resolves.toEqual({
      kind: 'reply',
      reply: { scripts: [], total: 0 }
    });
    expect(getScriptRuntimeStatuses).toHaveBeenCalledWith(2);
    const broken = liveScriptsTabStep({ getScriptRuntimeStatuses: () => Promise.resolve([]) }, 2);
    await expect(broken()).resolves.toEqual({ kind: 'invalid-reply' });
  });
});
