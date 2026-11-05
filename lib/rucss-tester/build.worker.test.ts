/** The worker entry: answers each build message with the build's result, never throws out. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RUCSS_TESTER_CONFIG } from './config';

/** What the entry posted. */
const posted: unknown[] = [];
let onmessage: ((event: { data: unknown }) => void) | null = null;

beforeAll(async () => {
  // The entry binds to the worker global (`self`): stand in for it here.
  vi.stubGlobal('self', {
    set onmessage(handler: (event: { data: unknown }) => void) {
      onmessage = handler;
    },
    postMessage: (message: unknown) => posted.push(message)
  });
  await import('./build.worker');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** Send one message to the entry and return what it posted. */
function send(data: unknown): unknown {
  posted.length = 0;
  onmessage?.({ data });
  return posted[0];
}

describe('the build worker entry', () => {
  it('answers a valid input with the build result', () => {
    expect(
      send({
        config: { ...DEFAULT_RUCSS_TESTER_CONFIG, excludeFiles: 'keep' },
        shakenCss: 'a{}',
        links: ['https://a.test/keep.css', 'https://a.test/x.css']
      })
    ).toEqual({ ok: true, css: 'a{}', applied: [], keepLinks: [0] });
  });

  it('answers `failed` for a malformed input', () => {
    expect(send({ nope: true })).toEqual({ ok: false, problem: 'failed' });
  });

  it('answers an exclusion pattern the engine gives up on with its line', () => {
    const throwing = vi.spyOn(RegExp.prototype, 'test').mockImplementation(() => {
      throw new RangeError('Maximum call stack size exceeded');
    });
    try {
      expect(
        send({
          config: { ...DEFAULT_RUCSS_TESTER_CONFIG, excludeFiles: 'x(a|b)*' },
          shakenCss: '',
          links: ['https://a.test/x.css']
        })
      ).toEqual({
        ok: false,
        problem: 'exclusion-failed',
        line: 'x(a|b)*',
        message: 'Maximum call stack size exceeded'
      });
    } finally {
      throwing.mockRestore();
    }
  });

  it('answers `failed` when the build throws outside the pattern engine', () => {
    const throwing = vi.spyOn(String.prototype, 'trim').mockImplementation(() => {
      throw new RangeError('Invalid string length');
    });
    try {
      expect(send({ config: DEFAULT_RUCSS_TESTER_CONFIG, shakenCss: '', links: [] })).toEqual({
        ok: false,
        problem: 'failed'
      });
    } finally {
      throwing.mockRestore();
    }
  });
});
