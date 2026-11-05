/**
 * The RUCSS service requests: only a top-frame page asking for its own
 * address gets a request, always to the fixed endpoint with only the
 * address, flags and safelist; the timeout and a cancel stay distinct; the
 * answer is capped and judged; logs never carry an address.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger';
import { parseRucssFetchReply, RUCSS_TEST_LIMITS } from '../../lib/messaging/rucss-test';
import { RUCSS_FETCH_TIMEOUT_MS } from '../../lib/rucss-tester/deadlines';
import { buildRucssEndpointUrl, RUCSS_ENDPOINT } from '../../lib/rucss-tester/endpoint';
import { RUCSS_RESPONSE_MAX_BYTES } from '../../lib/rucss-tester/response';
import {
  answerRucssFetch,
  createRucssInflight,
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
    log: logDouble()
  };
}

describe('rucssRequestUrlFor', () => {
  it('builds the fixed endpoint address for a page on the sender’s origin', () => {
    expect(rucssRequestUrlFor(REQUEST, 'https://site.test', NOW)).toBe(
      `${RUCSS_ENDPOINT}?url=https://site.test/shop/?a=1?1700000000&mobile`
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
  const largest = {
    ...REQUEST,
    pageUrl: pageOf(RUCSS_TEST_LIMITS.urlChars),
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
    expect(built.length).toBe(RUCSS_TEST_LIMITS.requestUrlChars);
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
      requestUrl: `${RUCSS_ENDPOINT}?url=https://site.test/shop/?a=1?1700000000&mobile`,
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
