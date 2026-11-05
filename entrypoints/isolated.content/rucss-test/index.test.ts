/**
 * The module's wiring over the fake browser: the two page channels answer
 * through the executor, the background ask is validated, a malformed
 * request is refused, and the page's test state is readable in-context.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onMessage, sendMessage } from '../../../lib/messaging/index';
import { RUCSS_RESULT_STYLE_ID } from '../../../lib/rucss-tester/run-plan';
import { rucssTestModeFor, setupRucssTest } from '.';

const START = { safelist: [], inlinePreserves: [], mobile: false, home: false };

/** A minimal live context whose invalidation the test triggers. */
function contextDouble(): ContentScriptContext & { invalidate: () => void } {
  const teardowns: (() => void)[] = [];
  return {
    isInvalid: false,
    onInvalidated: (teardown: () => void) => {
      teardowns.push(teardown);
      return () => undefined;
    },
    invalidate: () => {
      for (const teardown of teardowns) teardown();
    }
  } as unknown as ContentScriptContext & { invalidate: () => void };
}

let ctx: ReturnType<typeof contextDouble>;
let stopBackground = (): void => undefined;

beforeEach(() => {
  fakeBrowser.reset();
  document.head.innerHTML = '<style id="theme">.a{}</style>';
  ctx = contextDouble();
});

afterEach(() => {
  ctx.invalidate();
  stopBackground();
});

describe('setupRucssTest', () => {
  it('runs a start and an apply end to end over the messaging channels', async () => {
    const asked = vi.fn();
    stopBackground = onMessage('fetchRucssShakenCss', ({ data }) => {
      asked(data);
      return { kind: 'answered', requestUrl: 'u', outcome: { ok: true, shakenCss: 'a{}' } };
    });
    setupRucssTest(ctx);
    expect(rucssTestModeFor(ctx)?.()).toEqual({ applied: false, runs: 0 });

    const started = await sendMessage('startRucssTest', START);
    expect(asked).toHaveBeenCalledWith({
      pageUrl: location.href,
      safelist: [],
      mobile: false,
      home: false
    });
    expect(started).toMatchObject({ ok: true, shakenCss: 'a{}', links: [] });
    if (!started.ok) throw new Error('not started');

    const applied = await sendMessage('applyRucssTest', {
      runId: started.runId,
      css: 'b{}',
      keepLinks: []
    });
    expect(applied).toMatchObject({ ok: true, summary: { removed: 1 } });
    expect(document.getElementById('theme')).toBeNull();
    expect(document.getElementById(RUCSS_RESULT_STYLE_ID)?.textContent).toBe('b{}');
    expect(rucssTestModeFor(ctx)?.()).toEqual({ applied: true, runs: 1 });
  });

  it('reads a malformed background answer as unreachable, page untouched', async () => {
    stopBackground = onMessage('fetchRucssShakenCss', () => ({ kind: 'nope' }) as never);
    setupRucssTest(ctx);
    await expect(sendMessage('startRucssTest', START)).resolves.toEqual({
      ok: false,
      failure: { kind: 'background-unreachable' }
    });
    expect(document.getElementById('theme')).not.toBeNull();
  });

  it('refuses malformed page requests', async () => {
    setupRucssTest(ctx);
    await expect(sendMessage('startRucssTest', { nope: 1 } as never)).rejects.toThrow('malformed');
    await expect(sendMessage('applyRucssTest', { runId: 'x' } as never)).resolves.toEqual({
      ok: false,
      failure: 'invalid-request'
    });
  });

  it('has no reader for a context it never set up', () => {
    expect(rucssTestModeFor(contextDouble())).toBeNull();
  });
});
