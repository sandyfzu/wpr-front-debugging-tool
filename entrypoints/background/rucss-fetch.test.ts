/**
 * The RUCSS service requests: only a top-frame page asking for its own
 * address gets a request, always to the fixed endpoint with only the
 * address, flags and safelist; the timeout and a cancel stay distinct; the
 * answer is capped and judged; logs never carry an address.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger';
import { parseRucssFetchReply, RUCSS_TEST_LIMITS } from '../../lib/messaging/rucss-test';
import {
  RUCSS_FETCH_TIMEOUT_MS,
  RUCSS_KEEP_ALIVE_INTERVAL_MS
} from '../../lib/rucss-tester/deadlines';
import { buildRucssEndpointUrl, RUCSS_ENDPOINT } from '../../lib/rucss-tester/endpoint';
import { RUCSS_RESPONSE_MAX_BYTES } from '../../lib/rucss-tester/response';
import {
  answerRucssFetch,
  createRucssInflight,
  keepBackgroundAlive,
  rucssConsentHeld,
  rucssRequestUrlFor,
  sendRucssRequest,
  type RucssFetchDeps
} from './rucss-fetch';

const PAGE = 'https://site.test/shop/?a=1#top';
const SENDER = { tab: { id: 7 }, frameId: 0, url: 'https://site.test/shop/?a=1' };
const REQUEST = { pageUrl: PAGE, safelist: ['.keep'], mobile: true, home: false };
const NOW = 1_700_000_000_123;
const OK_BODY = '{"code":200,"contents":{"shakedCSS":"a{}"}}';

beforeEach(() => {
  fakeBrowser.reset();
});

/** A logger recording every line. */
function logDouble(): Logger & { lines: unknown[][] } {
  const lines: unknown[][] = [];
  const record =
    (level: string) =>
    (...args: unknown[]): void => {
      lines.push([level, ...args]);
    };
  return {
    lines,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error')
  };
}

/** A fetch double that answers `body` with `status`, honouring its signal. */
function fetchAnswering(body: string, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn((_url: string, init?: RequestInit) => {
    if (init?.signal?.aborted === true) return Promise.reject(init.signal.reason as Error);
    return Promise.resolve(new Response(body, { status }));
  });
}

/** A fetch double that never answers until its signal aborts (then rejects with its reason). */
function fetchHanging(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      })
  );
}

/** Deps over a fetch double; the timeout signal never fires unless given. */
function deps(
  fetch: ReturnType<typeof vi.fn>,
  timeoutSignal: (ms: number) => AbortSignal = () => new AbortController().signal
): RucssFetchDeps & { log: ReturnType<typeof logDouble> } {
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => NOW,
    timeoutSignal,
    keepAlive: () => () => undefined,
    log: logDouble()
  };
}

describe('rucssRequestUrlFor', () => {
  it('builds the fixed endpoint address for a page on the sender’s origin', () => {
    expect(rucssRequestUrlFor(REQUEST, 'https://site.test', NOW)).toBe(
      `${RUCSS_ENDPOINT}?url=https%3A%2F%2Fsite.test%2Fshop%2F%3Fa%3D1%261700000000&mobile`
    );
  });

  it('refuses a page off the sender’s origin or not http(s) — no open proxy', () => {
    for (const pageUrl of [
      'https://evil.test/',
      'http://site.test/',
      'https://site.test.evil.test/',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'not a url'
    ]) {
      expect(rucssRequestUrlFor({ ...REQUEST, pageUrl }, 'https://site.test', NOW)).toBeNull();
    }
  });
});

describe('request address bound', () => {
  const ORIGIN = 'https://site.test';
  /** A normalized page address of exactly `chars` characters. */
  const pageOf = (chars: number): string => `${ORIGIN}/${'a'.repeat(chars - ORIGIN.length - 1)}`;
  /**
   * The page address that encodes longest at `chars` characters: past the
   * origin, only `/` and a `?` (three characters each, encoded) — a query,
   * so the seconds join it with the longest joiner (`%26`).
   */
  const widestPageOf = (chars: number): string =>
    `${ORIGIN}/?${'/'.repeat(chars - ORIGIN.length - 2)}`;
  const largest = {
    ...REQUEST,
    pageUrl: widestPageOf(RUCSS_TEST_LIMITS.urlChars),
    mobile: true,
    home: true
  };

  it('sends the largest accepted page address, and the content script accepts the reply carrying it', async () => {
    const reply = await answerRucssFetch(
      { ...SENDER, url: largest.pageUrl },
      largest,
      createRucssInflight(),
      deps(fetchAnswering(OK_BODY))
    );
    expect(reply.kind).toBe('answered');
    // The reply survives the receiving guard — no `background-unreachable` after a sent request.
    expect(parseRucssFetchReply(JSON.parse(JSON.stringify(reply)))).toEqual(reply);
  });

  it('bounds the builder’s longest address exactly (largest page, largest seconds, both flags)', () => {
    const built = buildRucssEndpointUrl({
      pageUrl: largest.pageUrl,
      unixSeconds: Number.MAX_SAFE_INTEGER,
      mobile: true,
      home: true
    });
    // Only the origin's 14 letters/dots (`https`, `site.test`) encode to one
    // character instead of three: the bound is tight up to them.
    expect(built.length).toBe(RUCSS_TEST_LIMITS.requestUrlChars - 2 * 14);
  });

  it('refuses one character past the page bound, sending nothing', async () => {
    const fetch = fetchAnswering(OK_BODY);
    const pageUrl = pageOf(RUCSS_TEST_LIMITS.urlChars + 1);
    await expect(
      answerRucssFetch(
        { ...SENDER, url: pageUrl },
        { ...REQUEST, pageUrl },
        createRucssInflight(),
        deps(fetch)
      )
    ).resolves.toEqual({ kind: 'refused' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a page address that grows past the request bound when normalized', () => {
    // Within the page bound as sent; each space becomes `%20` in the built address.
    const pageUrl = `${ORIGIN}/${' '.repeat(RUCSS_TEST_LIMITS.urlChars - ORIGIN.length - 2)}x`;
    expect(pageUrl.length).toBe(RUCSS_TEST_LIMITS.urlChars);
    expect(rucssRequestUrlFor({ ...REQUEST, pageUrl }, ORIGIN, NOW)).toBeNull();
  });

  it('a reply whose request address passes the request bound is refused by the guard', () => {
    const requestUrl = 'u'.repeat(RUCSS_TEST_LIMITS.requestUrlChars + 1);
    const outcome = { ok: true, shakenCss: '' };
    expect(parseRucssFetchReply({ kind: 'answered', requestUrl, outcome })).toBeNull();
    expect(
      parseRucssFetchReply({ kind: 'answered', requestUrl: requestUrl.slice(1), outcome })
    ).not.toBeNull();
  });
});

describe('answerRucssFetch', () => {
  it('sends one POST to the fixed endpoint with only the safelist, no credentials, and answers', async () => {
    const fetch = fetchAnswering(OK_BODY);
    const d = deps(fetch);
    await expect(answerRucssFetch(SENDER, REQUEST, createRucssInflight(), d)).resolves.toEqual({
      kind: 'answered',
      requestUrl: `${RUCSS_ENDPOINT}?url=https%3A%2F%2Fsite.test%2Fshop%2F%3Fa%3D1%261700000000&mobile`,
      outcome: { ok: true, shakenCss: 'a{}' }
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith(`${RUCSS_ENDPOINT}?`)).toBe(true);
    expect(init).toMatchObject({
      method: 'POST',
      body: '{"safelist":[".keep"]}',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow'
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Nothing about the page reaches the console.
    expect(JSON.stringify(d.log.lines)).not.toContain('site.test');
  });

  it('refuses — sending nothing — a subframe, a tab-less page, a forged sender, a foreign page or a malformed request', async () => {
    const cases: [unknown, unknown][] = [
      [{ ...SENDER, frameId: 3 }, REQUEST],
      [{ id: 'ext', url: 'chrome-extension://ext/panel.html' }, REQUEST],
      [{ tab: { id: '7' }, frameId: 0, url: SENDER.url }, REQUEST],
      [{ ...SENDER, url: 'chrome-extension://ext/x.html' }, REQUEST],
      [undefined, REQUEST],
      [SENDER, { ...REQUEST, pageUrl: 'https://mega.wp-rocket.me/anything' }],
      [SENDER, { ...REQUEST, extra: 1 }],
      [SENDER, { ...REQUEST, safelist: 'x' }],
      [SENDER, null]
    ];
    for (const [sender, data] of cases) {
      const fetch = fetchAnswering(OK_BODY);
      const d = deps(fetch);
      await expect(
        answerRucssFetch(sender as never, data, createRucssInflight(), d),
        JSON.stringify([sender, data])
      ).resolves.toEqual({ kind: 'refused' });
      expect(fetch).not.toHaveBeenCalled();
      expect(JSON.stringify(d.log.lines)).not.toContain('site.test');
    }
  });

  it('answers a bad service answer as its typed failure (logged by kind only)', async () => {
    const d = deps(fetchAnswering('{"code":401,"message":"nope"}', 200));
    const reply = await answerRucssFetch(SENDER, REQUEST, createRucssInflight(), d);
    expect(reply).toMatchObject({
      kind: 'answered',
      outcome: { ok: false, failure: { kind: 'service-code', serviceCode: 401 } }
    });
    expect(d.log.lines).toEqual([['info', 'RUCSS request failed: service-code']]);
  });

  it('cancels a tab’s older request when the same tab asks again (`cancelled`, not `timeout`)', async () => {
    const hanging = fetchHanging();
    const inflight = createRucssInflight();
    const first = answerRucssFetch(SENDER, REQUEST, inflight, deps(hanging));
    const second = answerRucssFetch(SENDER, REQUEST, inflight, deps(fetchAnswering(OK_BODY)));
    await expect(first).resolves.toMatchObject({
      outcome: { ok: false, failure: { kind: 'cancelled' } }
    });
    await expect(second).resolves.toMatchObject({ outcome: { ok: true } });
  });

  it('keeps other tabs’ requests independent', async () => {
    const inflight = createRucssInflight();
    const first = answerRucssFetch(SENDER, REQUEST, inflight, deps(fetchHanging()));
    await answerRucssFetch(
      { ...SENDER, tab: { id: 8 } },
      REQUEST,
      inflight,
      deps(fetchAnswering(OK_BODY))
    );
    inflight.cancel(7);
    await expect(first).resolves.toMatchObject({
      outcome: { ok: false, failure: { kind: 'cancelled' } }
    });
  });
});

describe('the data-consent check (where the browser has one)', () => {
  it('sends when the grant is held, checking it on every request', async () => {
    const fetch = fetchAnswering(OK_BODY);
    const consent = vi.fn(() => Promise.resolve(true));
    const d = { ...deps(fetch), consent };
    await answerRucssFetch(SENDER, REQUEST, createRucssInflight(), d);
    await answerRucssFetch(SENDER, REQUEST, createRucssInflight(), d);
    expect(consent).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('sends nothing and answers consent-missing without the grant', async () => {
    const fetch = fetchAnswering(OK_BODY);
    const d = { ...deps(fetch), consent: () => Promise.resolve(false) };
    await expect(answerRucssFetch(SENDER, REQUEST, createRucssInflight(), d)).resolves.toEqual({
      kind: 'consent-missing'
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(d.log.lines).toEqual([
      ['info', 'RUCSS request not sent: the data-sharing consent is not granted']
    ]);
  });

  it('reads a failed grant read as not granted (logged), sending nothing', async () => {
    const fetch = fetchAnswering(OK_BODY);
    const d = { ...deps(fetch), consent: () => Promise.reject(new Error('dead context')) };
    await expect(answerRucssFetch(SENDER, REQUEST, createRucssInflight(), d)).resolves.toEqual({
      kind: 'consent-missing'
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(d.log.lines[0]).toEqual([
      'error',
      'Reading the data-sharing consent failed; the RUCSS request is not sent',
      'dead context'
    ]);
  });

  it('checks no consent for a refused sender (refusal first)', async () => {
    const consent = vi.fn(() => Promise.resolve(true));
    const d = { ...deps(fetchAnswering(OK_BODY)), consent };
    await expect(
      answerRucssFetch({ ...SENDER, frameId: 1 }, REQUEST, createRucssInflight(), d)
    ).resolves.toEqual({ kind: 'refused' });
    expect(consent).not.toHaveBeenCalled();
  });

  it('with no check to run, the grant counts as held', async () => {
    await expect(rucssConsentHeld({ log: logDouble() })).resolves.toBe(true);
  });
});

describe('sendRucssRequest', () => {
  it('reads the timeout signal as `timeout` (with the real AbortSignal.timeout)', async () => {
    const outcome = await sendRucssRequest(
      'u',
      [],
      new AbortController().signal,
      deps(fetchHanging(), () => AbortSignal.timeout(1))
    );
    expect(outcome).toEqual({ ok: false, failure: { kind: 'timeout' } });
  });

  it('reads a timeout as `timeout` even when the rejection is a plain AbortError (Firefox body read)', async () => {
    const timeout = new AbortController();
    const firefoxLike = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        })
    );
    const pending = sendRucssRequest(
      'u',
      [],
      new AbortController().signal,
      deps(firefoxLike, () => timeout.signal)
    );
    timeout.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    await expect(pending).resolves.toEqual({ ok: false, failure: { kind: 'timeout' } });
  });

  it('arms the budget from the shared deadline', async () => {
    const timeoutSignal = vi.fn(() => new AbortController().signal);
    await sendRucssRequest(
      'u',
      [],
      new AbortController().signal,
      deps(fetchAnswering(OK_BODY), timeoutSignal)
    );
    expect(timeoutSignal).toHaveBeenCalledWith(RUCSS_FETCH_TIMEOUT_MS);
  });

  it('reads a plain cancel as `cancelled`', async () => {
    const cancel = new AbortController();
    const pending = sendRucssRequest('u', [], cancel.signal, deps(fetchHanging()));
    cancel.abort();
    await expect(pending).resolves.toEqual({ ok: false, failure: { kind: 'cancelled' } });
  });

  it('reads a transport failure as `network-error`', async () => {
    const failing = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(
      sendRucssRequest('u', [], new AbortController().signal, deps(failing))
    ).resolves.toEqual({ ok: false, failure: { kind: 'network-error' } });
  });

  it('refuses an answer past the byte cap, and judges a non-JSON error page', async () => {
    const big = 'x'.repeat(RUCSS_RESPONSE_MAX_BYTES + 1);
    await expect(
      sendRucssRequest('u', [], new AbortController().signal, deps(fetchAnswering(big)))
    ).resolves.toEqual({ ok: false, failure: { kind: 'oversize' } });
    await expect(
      sendRucssRequest('u', [], new AbortController().signal, deps(fetchAnswering('<html>', 502)))
    ).resolves.toEqual({ ok: false, failure: { kind: 'http-status', httpStatus: 502 } });
  });

  it('keeps the background alive exactly while the request waits — answered or failed', async () => {
    for (const fetch of [
      fetchAnswering(OK_BODY),
      vi.fn(() => Promise.reject(new TypeError('x')))
    ]) {
      const stop = vi.fn();
      const d = { ...deps(fetch), keepAlive: vi.fn(() => stop) };
      await sendRucssRequest('u', [], new AbortController().signal, d);
      expect(d.keepAlive).toHaveBeenCalledOnce();
      expect(stop).toHaveBeenCalledOnce();
    }
  });

  it('sends `{}` for an empty safelist', async () => {
    const fetch = fetchAnswering(OK_BODY);
    await sendRucssRequest('u', [], new AbortController().signal, deps(fetch));
    expect((fetch.mock.calls[0] as [string, RequestInit])[1].body).toBe('{}');
  });
});

describe('createRucssInflight', () => {
  it('releases only its own request and ignores a cancel of an idle tab', () => {
    const inflight = createRucssInflight();
    const first = inflight.begin(1);
    const second = inflight.begin(1);
    expect(first.signal.aborted).toBe(true);
    first.release();
    inflight.cancel(1);
    expect(second.signal.aborted).toBe(true);
    expect(() => {
      inflight.cancel(99);
    }).not.toThrow();
  });
});

describe('keepBackgroundAlive', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the API every interval (under 30 s) until stopped', async () => {
    vi.useFakeTimers();
    expect(RUCSS_KEEP_ALIVE_INTERVAL_MS).toBeLessThan(30_000);
    const ping = vi.fn(() => Promise.resolve({}));
    const stop = keepBackgroundAlive(ping, logDouble());
    expect(ping).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RUCSS_FETCH_TIMEOUT_MS);
    expect(ping).toHaveBeenCalledTimes(
      Math.floor(RUCSS_FETCH_TIMEOUT_MS / RUCSS_KEEP_ALIVE_INTERVAL_MS)
    );
    stop();
    ping.mockClear();
    await vi.advanceTimersByTimeAsync(RUCSS_KEEP_ALIVE_INTERVAL_MS * 3);
    expect(ping).not.toHaveBeenCalled();
  });

  it('logs a failed call and keeps going', async () => {
    vi.useFakeTimers();
    const log = logDouble();
    const ping = vi.fn(() => Promise.reject(new Error('Extension context invalidated.')));
    const stop = keepBackgroundAlive(ping, log);
    await vi.advanceTimersByTimeAsync(RUCSS_KEEP_ALIVE_INTERVAL_MS * 2);
    stop();
    expect(ping).toHaveBeenCalledTimes(2);
    expect(log.lines).toEqual([
      ['warn', 'RUCSS request keep-alive call failed', { cause: 'Extension context invalidated.' }],
      ['warn', 'RUCSS request keep-alive call failed', { cause: 'Extension context invalidated.' }]
    ]);
  });
});
