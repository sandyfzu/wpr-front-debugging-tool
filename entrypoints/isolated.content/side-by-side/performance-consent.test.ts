import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../../lib/logger';
import type { PageNotice } from '../palette/notice';
import {
  PERFORMANCE_CONSENT_WORDS as WORDS,
  askConsentHere,
  checkAnalysisConsent,
  missNotice,
  openPerformanceWithConsent,
  reloadAfterConsent,
  restoredPageNeedsCheck
} from './performance-consent';

const ENTRY = 'https://pagespeed.web.dev/?wpr-sbs=https%3A%2F%2Fexample.com%2F';
const NO_RECEIVER = new Error('Could not establish connection. Receiving end does not exist.');

/** A logger double. */
function logDouble() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

/** Deps whose asks answer `answer` in turn (the last one repeats). */
function deps(...answers: (() => Promise<unknown>)[]) {
  let call = 0;
  const notices: PageNotice[] = [];
  return {
    ask: vi.fn<(next: string, mode: string) => Promise<unknown>>(() => {
      const answer = answers[Math.min(call, answers.length - 1)];
      call += 1;
      return answer === undefined ? Promise.resolve(undefined) : answer();
    }),
    notify: vi.fn((notice: PageNotice) => {
      notices.push(notice);
    }),
    notices,
    log: logDouble()
  };
}

const reply = (status: string) => () => Promise.resolve({ status });

describe('missNotice', () => {
  it('names the cause and offers Try again', () => {
    const retry = vi.fn();
    const failed = missNotice('T', { kind: 'reply', reply: { status: 'failed' } }, retry);
    expect(failed).toMatchObject({ title: 'T', body: WORDS.failedBody });
    for (const kind of ['no-receiver', 'timeout', 'invalid-reply'] as const) {
      expect(missNotice('T', { kind }, retry).body).toBe(WORDS.unreachableBody);
    }
    failed.action?.run();
    expect(failed.action?.label).toBe('Try again');
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('openPerformanceWithConsent', () => {
  it('asks the background to open the analysis tab; granted or asking shows nothing more', async () => {
    for (const status of ['granted', 'asking']) {
      const d = deps(reply(status));
      await openPerformanceWithConsent(ENTRY, vi.fn(), d);
      expect(d.ask).toHaveBeenCalledWith(ENTRY, 'open-tab');
      expect(d.notify).not.toHaveBeenCalled();
    }
  });

  it('a failed ask shows the notice with Try again (logged)', async () => {
    const retry = vi.fn();
    const d = deps(reply('failed'));
    await openPerformanceWithConsent(ENTRY, retry, d);
    expect(d.notices[0]).toMatchObject({ title: WORDS.openFailedTitle, body: WORDS.failedBody });
    d.notices[0]?.action?.run();
    expect(retry).toHaveBeenCalledOnce();
    expect(d.log.warn).toHaveBeenCalledOnce();
  });

  it('no answer, a junk answer or a rejected send shows the unreachable notice', async () => {
    for (const answer of [
      () => Promise.reject(NO_RECEIVER),
      () => Promise.resolve({ status: 'nope' }),
      () => Promise.reject(new Error('boom'))
    ]) {
      const d = deps(answer);
      await openPerformanceWithConsent(ENTRY, vi.fn(), d);
      expect(d.notices[0]).toMatchObject({
        title: WORDS.openFailedTitle,
        body: WORDS.unreachableBody
      });
    }
  });
});

describe('checkAnalysisConsent', () => {
  it('granted: the frames load, nothing shown', async () => {
    const d = deps(reply('granted'));
    await expect(checkAnalysisConsent(ENTRY, vi.fn(), d)).resolves.toBe(true);
    expect(d.ask).toHaveBeenCalledWith(ENTRY, 'check');
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('missing: nothing loads; the notice asks, and its Allow shows the consent page here', async () => {
    const d = deps(reply('missing'), reply('asking'));
    await expect(checkAnalysisConsent(ENTRY, vi.fn(), d)).resolves.toBe(false);
    const notice = d.notices[0];
    expect(notice).toMatchObject({ title: WORDS.askTitle, body: WORDS.askBody });
    expect(notice?.body).toContain('pagespeed.web.dev');
    expect(notice?.action?.label).toBe('Allow…');
    notice?.action?.run();
    await vi.waitFor(() => {
      expect(d.ask).toHaveBeenLastCalledWith(ENTRY, 'ask-here');
    });
    expect(d.notify).toHaveBeenCalledOnce();
  });

  it('a failed or missed check loads nothing and offers Try again', async () => {
    for (const answer of [reply('failed'), reply('asking'), () => Promise.reject(NO_RECEIVER)]) {
      const retry = vi.fn();
      const d = deps(answer);
      await expect(checkAnalysisConsent(ENTRY, retry, d)).resolves.toBe(false);
      expect(d.notices[0]?.title).toBe(WORDS.framesFailedTitle);
      d.notices[0]?.action?.run();
      expect(retry).toHaveBeenCalledOnce();
    }
  });
});

describe('askConsentHere', () => {
  it('asking: the tab is on its way to the consent page, nothing shown', async () => {
    const retry = vi.fn();
    const d = deps(reply('asking'));
    await askConsentHere(ENTRY, retry, d);
    expect(d.notify).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it('granted meanwhile: the comparison opens now', async () => {
    const retry = vi.fn();
    await askConsentHere(ENTRY, retry, deps(reply('granted')));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('a failed or missed ask shows the notice with Try again', async () => {
    for (const answer of [reply('failed'), reply('missing'), () => Promise.reject(NO_RECEIVER)]) {
      const d = deps(answer);
      await askConsentHere(ENTRY, vi.fn(), d);
      expect(d.notices[0]?.title).toBe(WORDS.framesFailedTitle);
      expect(d.notices[0]?.action?.label).toBe('Try again');
    }
  });
});

describe('reloadAfterConsent', () => {
  it('checks again first, then reloads while the grant holds', async () => {
    const d = deps(reply('granted'));
    const reload = vi.fn();
    await expect(reloadAfterConsent(ENTRY, reload, d)).resolves.toBe(true);
    expect(d.ask).toHaveBeenCalledWith(ENTRY, 'check');
    expect(reload).toHaveBeenCalledOnce();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('a grant revoked since the open reloads nothing; the notice asks', async () => {
    const d = deps(reply('missing'));
    const reload = vi.fn();
    await expect(reloadAfterConsent(ENTRY, reload, d)).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(d.notices[0]).toMatchObject({ title: WORDS.askTitle });
  });

  it("a miss's Try again repeats the reload's check", async () => {
    const d = deps(() => Promise.reject(NO_RECEIVER), reply('granted'));
    const reload = vi.fn();
    await expect(reloadAfterConsent(ENTRY, reload, d)).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
    d.notices[0]?.action?.run();
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
    expect(d.ask).toHaveBeenNthCalledWith(2, ENTRY, 'check');
  });

  it('a throwing reload is logged, never a rejection', async () => {
    const d = deps(reply('granted'));
    const reload = vi.fn(() => {
      throw new Error('gone');
    });
    await expect(reloadAfterConsent(ENTRY, reload, d)).resolves.toBe(false);
    expect(d.log.error).toHaveBeenCalledWith('Reloading the analysis frames failed', 'gone');
  });
});

describe('restoredPageNeedsCheck', () => {
  const restored = { persisted: true, autoFlow: true, open: false, opening: false };

  it('asks again on an analysis page back from the cache with nothing open', () => {
    expect(restoredPageNeedsCheck(restored)).toBe(true);
  });

  it('a fresh load, another page, an open or opening comparison needs nothing', () => {
    expect(restoredPageNeedsCheck({ ...restored, persisted: false })).toBe(false);
    expect(restoredPageNeedsCheck({ ...restored, autoFlow: false })).toBe(false);
    expect(restoredPageNeedsCheck({ ...restored, open: true })).toBe(false);
    expect(restoredPageNeedsCheck({ ...restored, opening: true })).toBe(false);
  });
});
