/**
 * The paused-response boundary: event validation, the candidate decision
 * (stage, error, type, eligibility incl. redirects), body bytes (base64
 * and the textual form), header fix-up, and the fulfill parameters.
 */
import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../../../utils/base64';
import {
  classifyPause,
  continueWithoutRulesHeaderParams,
  frameTreeDocumentUrl,
  fulfillHeaders,
  fulfillParams,
  headerValue,
  parsePausedRequest,
  pausedRequestId,
  responseBodyBytes,
  runtimeFulfillParams,
  type PausedRequest
} from './paused-request';

/** A response-stage document event as Chromium sends it. */
function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'interception-job-1.0',
    request: { url: 'https://site.test/', method: 'GET', headers: {} },
    frameId: 'MAIN',
    resourceType: 'Document',
    responseStatusCode: 200,
    responseStatusText: 'OK',
    responseHeaders: [
      { name: 'Content-Type', value: 'text/html; charset=utf-8' },
      { name: 'Content-Encoding', value: 'gzip' }
    ],
    ...overrides
  };
}

/** The parsed form of {@link event}. */
function paused(overrides: Record<string, unknown> = {}): PausedRequest {
  const parsed = parsePausedRequest(event(overrides));
  if (parsed === null) throw new Error('fixture must parse');
  return parsed;
}

describe('parsePausedRequest', () => {
  it('validates a response-stage event', () => {
    expect(parsePausedRequest(event())).toEqual({
      requestId: 'interception-job-1.0',
      url: 'https://site.test/',
      method: 'GET',
      frameId: 'MAIN',
      resourceType: 'Document',
      status: 200,
      statusText: 'OK',
      headers: [
        { name: 'Content-Type', value: 'text/html; charset=utf-8' },
        { name: 'Content-Encoding', value: 'gzip' }
      ],
      errorReason: null
    });
  });

  it('reads a request-stage event (no response fields) with empty defaults', () => {
    const parsed = parsePausedRequest(
      event({
        responseStatusCode: undefined,
        responseStatusText: undefined,
        responseHeaders: undefined
      })
    );
    expect(parsed).toMatchObject({ status: null, statusText: '', headers: [] });
  });

  it('keeps a network error reason', () => {
    expect(
      parsePausedRequest(event({ responseStatusCode: undefined, responseErrorReason: 'Failed' }))
    ).toMatchObject({ errorReason: 'Failed', status: null });
  });

  it.each([
    ['not a record', null],
    ['no request', { ...event(), request: undefined }],
    ['empty id', event({ requestId: '' })],
    ['no url', event({ request: { method: 'GET' } })],
    ['no method', event({ request: { url: 'https://site.test/' } })],
    ['no frame', event({ frameId: 3 })],
    ['no type', event({ resourceType: undefined })],
    ['fractional status', event({ responseStatusCode: 200.5 })],
    ['string status', event({ responseStatusCode: '200' })],
    ['headers not an array', event({ responseHeaders: {} })],
    ['malformed header', event({ responseHeaders: [{ name: 'a' }] })],
    ['header not a record', event({ responseHeaders: ['a: b'] })],
    ['status text not a string', event({ responseStatusText: 1 })],
    ['error reason not a string', event({ responseErrorReason: 1 })]
  ])('refuses %s', (_label, input) => {
    expect(parsePausedRequest(input)).toBeNull();
  });
});

describe('pausedRequestId', () => {
  it('reads the id of an otherwise malformed event', () => {
    expect(pausedRequestId({ requestId: 'r', frameId: 1 })).toBe('r');
    expect(pausedRequestId({ requestId: '' })).toBeNull();
    expect(pausedRequestId('x')).toBeNull();
  });
});

describe('headerValue', () => {
  it('joins repeated names case-insensitively in order, null when absent', () => {
    const headers = [
      { name: 'Vary', value: 'a' },
      { name: 'x', value: '1' },
      { name: 'VARY', value: 'b' }
    ];
    expect(headerValue(headers, 'vary')).toBe('a, b');
    expect(headerValue(headers, 'missing')).toBeNull();
  });
});

describe('classifyPause', () => {
  it('passes a request-stage pause', () => {
    expect(
      classifyPause(paused({ responseStatusCode: undefined, responseHeaders: undefined }))
    ).toEqual({ kind: 'pass', reason: 'request-stage' });
  });

  it('marks a request-stage script pause as a script request', () => {
    expect(
      classifyPause(
        paused({
          resourceType: 'Script',
          responseStatusCode: undefined,
          responseHeaders: undefined
        })
      )
    ).toEqual({ kind: 'script-request' });
    // A script's network error is still only a pass.
    expect(
      classifyPause(
        paused({
          resourceType: 'Script',
          responseStatusCode: undefined,
          responseErrorReason: 'Failed'
        })
      )
    ).toEqual({ kind: 'pass', reason: 'network-error' });
  });

  it('passes a network error', () => {
    expect(
      classifyPause(paused({ responseStatusCode: undefined, responseErrorReason: 'Failed' }))
    ).toEqual({ kind: 'pass', reason: 'network-error' });
  });

  it('passes a non-document resource', () => {
    expect(classifyPause(paused({ resourceType: 'Script' }))).toEqual({
      kind: 'pass',
      reason: 'not-document'
    });
  });

  it.each([
    [
      'a redirect hop',
      { responseStatusCode: 302, responseHeaders: [{ name: 'Location', value: '/x' }] }
    ],
    ['a 304', { responseStatusCode: 304 }],
    ['a HEAD', { request: { url: 'https://site.test/', method: 'HEAD' } }],
    ['XHTML', { responseHeaders: [{ name: 'content-type', value: 'application/xhtml+xml' }] }],
    ['no content type', { responseHeaders: [] }]
  ])('passes %s as ineligible', (_label, overrides) => {
    expect(classifyPause(paused(overrides))).toEqual({ kind: 'pass', reason: 'ineligible' });
  });

  it('makes an eligible document a candidate with its facts (4xx included)', () => {
    expect(classifyPause(paused())).toEqual({
      kind: 'candidate',
      facts: { status: 200, method: 'GET', contentType: 'text/html; charset=utf-8' }
    });
    expect(classifyPause(paused({ responseStatusCode: 404 }))).toMatchObject({
      kind: 'candidate'
    });
  });
});

describe('responseBodyBytes', () => {
  it('decodes a base64 body (bytes kept as they are, any charset)', () => {
    const bytes = Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x80]);
    expect(responseBodyBytes({ body: bytesToBase64(bytes), base64Encoded: true })).toEqual(bytes);
  });

  it('accepts a pure-ASCII textual body', () => {
    expect(responseBodyBytes({ body: '<p>ok</p>', base64Encoded: false })).toEqual(
      new TextEncoder().encode('<p>ok</p>')
    );
  });

  it('refuses a non-ASCII textual body (its original bytes are unknowable)', () => {
    expect(responseBodyBytes({ body: 'café', base64Encoded: false })).toBeNull();
  });

  it.each([
    ['not a record', 'x'],
    ['no body', { base64Encoded: true }],
    ['flag missing', { body: 'eA==' }],
    ['invalid base64', { body: '%%%', base64Encoded: true }]
  ])('refuses %s', (_label, input) => {
    expect(responseBodyBytes(input)).toBeNull();
  });
});

describe('fulfillHeaders', () => {
  it('drops framing, cookie and speculation-rules lines, keeping every other line in order (repeats too)', () => {
    expect(
      fulfillHeaders([
        { name: 'Content-Type', value: 'text/html' },
        { name: 'content-length', value: '10' },
        { name: 'Content-Encoding', value: 'br' },
        { name: 'Transfer-Encoding', value: 'chunked' },
        { name: 'Set-Cookie', value: 'a=1' },
        { name: 'Speculation-Rules', value: '"/rules.json"' },
        { name: 'Link', value: '<a>' },
        { name: 'link', value: '<b>' }
      ])
    ).toEqual([
      { name: 'Content-Type', value: 'text/html' },
      { name: 'Link', value: '<a>' },
      { name: 'link', value: '<b>' }
    ]);
  });
});

describe('fulfillParams', () => {
  it('serves the body with the original code, phrase and fixed-up headers', () => {
    const body = new TextEncoder().encode('<p>x</p>');
    expect(
      fulfillParams(paused({ responseStatusCode: 599, responseStatusText: 'Custom' }), body)
    ).toEqual({
      requestId: 'interception-job-1.0',
      responseCode: 599,
      responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
      body: bytesToBase64(body),
      responsePhrase: 'Custom'
    });
  });

  it('omits an empty phrase (the browser then uses the standard one)', () => {
    const params = fulfillParams(paused({ responseStatusText: '' }), new Uint8Array());
    expect(params).not.toHaveProperty('responsePhrase');
    expect(params.body).toBe('');
  });
});

describe('continueWithoutRulesHeaderParams', () => {
  const withHeader = [
    { name: 'Content-Type', value: 'text/html' },
    { name: 'speculation-rules', value: '"/r.json"' }
  ];

  it('keeps code, phrase and every other header line', () => {
    expect(continueWithoutRulesHeaderParams(paused({ responseHeaders: withHeader }))).toEqual({
      requestId: 'interception-job-1.0',
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
      responsePhrase: 'OK'
    });
  });

  it('omits an empty phrase', () => {
    expect(
      continueWithoutRulesHeaderParams(
        paused({ responseHeaders: withHeader, responseStatusText: '' })
      )
    ).not.toHaveProperty('responsePhrase');
  });

  it('answers null without the header or before a response', () => {
    expect(continueWithoutRulesHeaderParams(paused())).toBeNull();
    expect(
      continueWithoutRulesHeaderParams(
        paused({ responseStatusCode: undefined, responseHeaders: withHeader })
      )
    ).toBeNull();
  });
});

describe('runtimeFulfillParams', () => {
  it('serves the bytes as a 200 classic script that is never stored', () => {
    const body = new TextEncoder().encode('/*! runtime */');
    expect(runtimeFulfillParams('r', body)).toEqual({
      requestId: 'r',
      responseCode: 200,
      responseHeaders: [
        { name: 'content-type', value: 'text/javascript; charset=utf-8' },
        { name: 'cache-control', value: 'no-store' }
      ],
      body: bytesToBase64(body)
    });
  });
});

describe('frameTreeDocumentUrl', () => {
  it('reads the root frame’s document URL', () => {
    expect(
      frameTreeDocumentUrl({
        frameTree: { frame: { id: 'TOP', url: 'https://site.test/post' }, childFrames: [] }
      })
    ).toBe('https://site.test/post');
  });

  it.each([
    ['no result', undefined],
    ['no tree', {}],
    ['no frame', { frameTree: {} }],
    ['a non-string url', { frameTree: { frame: { url: 7 } } }]
  ])('answers null for %s', (_name, result) => {
    expect(frameTreeDocumentUrl(result)).toBeNull();
  });
});
