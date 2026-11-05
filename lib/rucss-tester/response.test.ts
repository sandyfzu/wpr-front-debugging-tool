/** The answer guard: the one usable shape, and a typed failure for everything else. */
import { describe, expect, it } from 'vitest';
import { RUCSS_RESPONSE_MAX_BYTES, parseRucssResponse, rucssTransportFailure } from './response';

/** A readable body. */
function text(body: string): { ok: true; text: string } {
  return { ok: true, text: body };
}

describe('RUCSS_RESPONSE_MAX_BYTES', () => {
  it('is 2 MiB', () => {
    expect(RUCSS_RESPONSE_MAX_BYTES).toBe(2_097_152);
  });
});

describe('parseRucssResponse', () => {
  it('accepts code 200 with string contents.shakedCSS (empty included)', () => {
    expect(parseRucssResponse(200, text('{"code":200,"contents":{"shakedCSS":"a{}"}}'))).toEqual({
      ok: true,
      shakenCss: 'a{}'
    });
    expect(parseRucssResponse(200, text('{"code":200,"contents":{"shakedCSS":""},"x":1}'))).toEqual(
      {
        ok: true,
        shakenCss: ''
      }
    );
  });

  it('lets the service code decide over a non-2xx status', () => {
    expect(parseRucssResponse(500, text('{"code":200,"contents":{"shakedCSS":"a"}}'))).toEqual({
      ok: true,
      shakenCss: 'a'
    });
    expect(parseRucssResponse(400, text('{"code":422}'))).toEqual({
      ok: false,
      failure: { kind: 'service-code', httpStatus: 400, serviceCode: 422 }
    });
  });

  it('reports a non-200 service code with the HTTP status', () => {
    expect(parseRucssResponse(200, text('{"code":401,"message":"x"}'))).toEqual({
      ok: false,
      failure: { kind: 'service-code', httpStatus: 200, serviceCode: 401 }
    });
  });

  it('passes body-read problems through', () => {
    expect(parseRucssResponse(200, { ok: false, problem: 'oversize' })).toEqual({
      ok: false,
      failure: { kind: 'oversize' }
    });
    expect(parseRucssResponse(200, { ok: false, problem: 'not-utf8' })).toEqual({
      ok: false,
      failure: { kind: 'not-utf8' }
    });
  });

  it('reads an unusable 2xx body as malformed and a non-2xx one as http-status', () => {
    for (const body of [
      '',
      'not json',
      '[]',
      'null',
      '"x"',
      '{}',
      '{"code":"200"}',
      '{"code":null}'
    ]) {
      expect(parseRucssResponse(200, text(body))).toEqual({
        ok: false,
        failure: { kind: 'malformed', httpStatus: 200 }
      });
      expect(parseRucssResponse(503, text(body))).toEqual({
        ok: false,
        failure: { kind: 'http-status', httpStatus: 503 }
      });
    }
  });

  it('reads code 200 without string CSS as malformed (any status)', () => {
    for (const body of [
      '{"code":200}',
      '{"code":200,"contents":null}',
      '{"code":200,"contents":"a{}"}',
      '{"code":200,"contents":{"shakedCSS":1}}',
      '{"code":200,"contents":{"shakedCss":"a"}}',
      '{"code":200,"contents":[{"shakedCSS":"a"}]}'
    ]) {
      expect(parseRucssResponse(404, text(body))).toEqual({
        ok: false,
        failure: { kind: 'malformed', httpStatus: 404 }
      });
    }
  });

  it('never reads prototype-planted fields', () => {
    expect(
      parseRucssResponse(200, text('{"__proto__":{"code":200,"contents":{"shakedCSS":"evil"}}}'))
    ).toEqual({ ok: false, failure: { kind: 'malformed', httpStatus: 200 } });
    expect(
      parseRucssResponse(200, text('{"code":200,"contents":{"__proto__":{"shakedCSS":"evil"}}}'))
    ).toEqual({ ok: false, failure: { kind: 'malformed', httpStatus: 200 } });
  });

  it('treats a 2xx range edge correctly', () => {
    expect(parseRucssResponse(299, text('x')).ok).toBe(false);
    expect(parseRucssResponse(299, text('x'))).toMatchObject({ failure: { kind: 'malformed' } });
    expect(parseRucssResponse(300, text('x'))).toMatchObject({ failure: { kind: 'http-status' } });
    expect(parseRucssResponse(199, text('x'))).toMatchObject({ failure: { kind: 'http-status' } });
  });
});

describe('rucssTransportFailure', () => {
  it.each([
    [new DOMException('t', 'TimeoutError'), 'timeout'],
    [new DOMException('a', 'AbortError'), 'cancelled'],
    [new DOMException('n', 'NetworkError'), 'network-error'],
    [new TypeError('Failed to fetch'), 'network-error'],
    // A plain Error named like an abort is not one: only DOMExceptions are signal reasons.
    [Object.assign(new Error('a'), { name: 'AbortError' }), 'network-error'],
    [undefined, 'network-error']
  ])('reads %s as %s', (cause, kind) => {
    expect(rucssTransportFailure(cause)).toEqual({ ok: false, failure: { kind } });
  });

  it('reads the reasons real signals abort with (timeout signal vs a plain cancel)', async () => {
    /** The rejection of a never-settling request under a signal. */
    async function rejectionUnder(signal: AbortSignal): Promise<unknown> {
      const pending = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
      });
      return pending.catch((cause: unknown) => cause);
    }
    const cancel = new AbortController();
    const cancelled = rejectionUnder(AbortSignal.any([cancel.signal, AbortSignal.timeout(60_000)]));
    cancel.abort();
    expect(rucssTransportFailure(await cancelled)).toMatchObject({
      failure: { kind: 'cancelled' }
    });
    const timedOut = rejectionUnder(AbortSignal.timeout(1));
    expect(rucssTransportFailure(await timedOut)).toMatchObject({ failure: { kind: 'timeout' } });
  });
});
