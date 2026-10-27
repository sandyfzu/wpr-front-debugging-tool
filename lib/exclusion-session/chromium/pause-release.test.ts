/** One release per paused request: fulfill / continue / header-dropping continue, fallbacks, gone requests. */
import { describe, expect, it } from 'vitest';
import type { Logger } from '../../logger';
import { createPauseRelease } from './pause-release';
import { parsePausedRequest, type PausedRequest } from './paused-request';

/** A logger recording levels. */
function fakeLog(): Logger & { levels: string[] } {
  const levels: string[] = [];
  const at = (level: string) => () => {
    levels.push(level);
  };
  return { levels, debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

const PAUSE = parsePausedRequest({
  requestId: 'r1',
  request: { url: 'https://s.test/', method: 'GET' },
  frameId: 'F',
  resourceType: 'Document',
  responseStatusCode: 200,
  responseStatusText: 'OK',
  responseHeaders: [
    { name: 'Content-Type', value: 'text/html' },
    { name: 'Speculation-Rules', value: '"/r.json"' }
  ]
}) as PausedRequest;

/** A release over a scripted sender. */
function rig(answers: Record<string, () => Promise<unknown>> = {}) {
  const sent: string[] = [];
  const log = fakeLog();
  const release = createPauseRelease({
    requestId: 'r1',
    tabId: 1,
    log,
    send: (method) => {
      sent.push(method);
      return answers[method]?.() ?? Promise.resolve({});
    }
  });
  return { release, sent, log };
}

describe('createPauseRelease', () => {
  it('releases once: later attempts are no-ops', async () => {
    const { release, sent } = rig();
    await expect(release.fulfill({ requestId: 'r1' })).resolves.toBe('fulfilled');
    await release.pass('again');
    await release.passWithoutRulesHeader('again', PAUSE);
    // A fulfill after the release served nothing.
    await expect(release.fulfill({})).resolves.toBe('gone');
    expect(sent).toEqual(['Fetch.fulfillRequest']);
  });

  it('keeps the request held after a refused fulfill, so a continue still goes', async () => {
    const { release, sent, log } = rig({
      'Fetch.fulfillRequest': () => Promise.reject(new Error('Invalid http status code or phrase'))
    });
    await expect(release.fulfill({})).resolves.toBe('refused');
    await release.pass('refused');
    expect(sent).toEqual(['Fetch.fulfillRequest', 'Fetch.continueRequest']);
    expect(log.levels).toContain('warn');
  });

  it('reports a gone request as gone, released (debug only)', async () => {
    const { release, sent, log } = rig({
      'Fetch.fulfillRequest': () => Promise.reject(new Error('Invalid InterceptionId.'))
    });
    await expect(release.fulfill({})).resolves.toBe('gone');
    await release.pass('x');
    expect(sent).toEqual(['Fetch.fulfillRequest']);
    expect(log.levels).toEqual(['debug']);
  });

  it('drops the rules header via continueResponse, falling back to a plain continue', async () => {
    const ok = rig();
    await ok.release.passWithoutRulesHeader('x', PAUSE);
    expect(ok.sent).toEqual(['Fetch.continueResponse']);
    const refused = rig({ 'Fetch.continueResponse': () => Promise.reject(new Error('nope')) });
    await refused.release.passWithoutRulesHeader('x', PAUSE);
    expect(refused.sent).toEqual(['Fetch.continueResponse', 'Fetch.continueRequest']);
  });

  it('continues plainly a response without the header', async () => {
    const { release, sent } = rig();
    await release.passWithoutRulesHeader('x', { ...PAUSE, headers: [] });
    expect(sent).toEqual(['Fetch.continueRequest']);
  });

  it('logs a failed plain continue by kind (gone: debug, other: warn)', async () => {
    const gone = rig({
      'Fetch.continueRequest': () =>
        Promise.reject(new Error('Debugger is not attached to the tab with id: 1.'))
    });
    await gone.release.pass('x');
    expect(gone.log.levels).toEqual(['debug']);
    const odd = rig({ 'Fetch.continueRequest': () => Promise.reject(new Error('odd')) });
    await odd.release.pass('x');
    expect(odd.log.levels).toEqual(['warn']);
  });
});
