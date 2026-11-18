/**
 * "Open in Sources" seam: feature detection on the passed namespace, the
 * callback form's three failure channels (runtime slot, DevTools status
 * record, synchronous throw), URL-free logging and the failure toast.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, toastItems } from '../../../components/ui/toast-store';
import {
  devtoolsStatusFailure,
  OPEN_IN_SOURCES_FAILED,
  OPEN_IN_SOURCES_REMEDY,
  openInSources,
  OpenResourceError,
  openResourceCapability,
  redactUrl,
  sourcesTarget
} from './open-resource';

/** A URL carrying a secret, to prove nothing logs it. */
const URL_WITH_TOKEN = 'https://site.example/wp-content/app.js?token=s3cret';

/** A DevTools double whose `openResource` answers its callback with `response`. */
function devtoolsWith(
  respond: (callback: (response?: unknown) => void) => void,
  runtime?: object
): { api: object; openResource: ReturnType<typeof vi.fn> } {
  const panels = {
    openResource: vi.fn(function (
      this: unknown,
      _url: string,
      _line: number,
      callback: (response?: unknown) => void
    ) {
      expect(this).toBe(panels);
      respond(callback);
    })
  };
  return { api: { devtools: { panels }, runtime }, openResource: panels.openResource };
}

afterEach(() => {
  toast.clear();
  vi.restoreAllMocks();
});

describe('openResourceCapability detection', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'browser'],
    ['no devtools', {}],
    ['devtools null', { devtools: null }],
    ['no panels', { devtools: {} }],
    ['no openResource (Firefox)', { devtools: { panels: { create: () => undefined } } }],
    ['openResource not a function', { devtools: { panels: { openResource: 'yes' } } }]
  ])('is null for %s', (_label, api) => {
    expect(openResourceCapability(api)).toBeNull();
  });

  it('is an opener when devtools.panels.openResource is a function', () => {
    expect(
      openResourceCapability(
        devtoolsWith((done) => {
          done();
        }).api
      )
    ).toBeTypeOf('function');
  });
});

describe('openResourceCapability opener', () => {
  it('calls the callback form once with the URL and line 0, bound to panels', async () => {
    const { api, openResource } = devtoolsWith((done) => {
      done({ code: 'OK' });
    });
    await expect(openResourceCapability(api)?.(URL_WITH_TOKEN)).resolves.toBeUndefined();
    expect(openResource).toHaveBeenCalledTimes(1);
    expect(openResource).toHaveBeenCalledWith(URL_WITH_TOKEN, 0, expect.any(Function));
  });

  it('asks DevTools for the URL without its fragment (resources never carry one)', async () => {
    const { api, openResource } = devtoolsWith((done) => {
      done({ code: 'OK' });
    });
    await openResourceCapability(api)?.(`${URL_WITH_TOKEN}#top`);
    expect(openResource.mock.calls).toEqual([[URL_WITH_TOKEN, 0, expect.any(Function)]]);
  });

  it('redacts both the given URL and the fragment-less target from a runtime message', async () => {
    const runtime = { lastError: undefined as { message: string } | undefined };
    const full = `${URL_WITH_TOKEN}#k=s3cret`;
    const { api } = devtoolsWith((done) => {
      runtime.lastError = { message: `No ${URL_WITH_TOKEN}; asked ${full}` };
      done();
    }, runtime);
    await expect(openResourceCapability(api)?.(full)).rejects.toMatchObject({
      failure: 'last-error',
      detail: 'No <url>; asked <url>'
    });
  });

  it('resolves on an undefined response (DevTools sometimes sends none)', async () => {
    const { api } = devtoolsWith((done) => {
      done();
    });
    await expect(openResourceCapability(api)?.(URL_WITH_TOKEN)).resolves.toBeUndefined();
  });

  it('resolves when the runtime slot is null (Firefox spelling of "no error")', async () => {
    const { api } = devtoolsWith(
      (done) => {
        done();
      },
      { lastError: null }
    );
    await expect(openResourceCapability(api)?.(URL_WITH_TOKEN)).resolves.toBeUndefined();
  });

  it('rejects on runtime.lastError, redacting the URL from its message', async () => {
    const runtime = { lastError: undefined as { message: string } | undefined };
    const { api } = devtoolsWith((done) => {
      runtime.lastError = { message: `Cannot open ${URL_WITH_TOKEN}` };
      done();
    }, runtime);
    const error: unknown = await openResourceCapability(api)?.(URL_WITH_TOKEN).catch(
      (cause: unknown) => cause
    );
    expect(error).toBeInstanceOf(OpenResourceError);
    expect(error).toMatchObject({ failure: 'last-error', detail: 'Cannot open <url>' });
  });

  it('rejects on a DevTools error status without reading its URL-bearing details', async () => {
    const { api } = devtoolsWith((done) => {
      done({
        code: 'E_NOTFOUND',
        description: 'Object not found: %s',
        details: [URL_WITH_TOKEN],
        isError: true
      });
    });
    const error: unknown = await openResourceCapability(api)?.(URL_WITH_TOKEN).catch(
      (cause: unknown) => cause
    );
    expect(error).toMatchObject({
      failure: 'devtools-status',
      detail: 'E_NOTFOUND Object not found: %s'
    });
    expect((error as Error).message).not.toContain('s3cret');
  });

  it('prefers the runtime slot when both channels report (the slot is still read)', async () => {
    const runtime = { lastError: { message: 'Port closed' } };
    const { api } = devtoolsWith((done) => {
      done({ isError: true, code: 'E_FAILED' });
    }, runtime);
    await expect(openResourceCapability(api)?.(URL_WITH_TOKEN)).rejects.toMatchObject({
      failure: 'last-error',
      detail: 'Port closed'
    });
  });

  it('rejects with the error name only when the call throws', async () => {
    const { api } = devtoolsWith(() => {
      throw new TypeError(`bad ${URL_WITH_TOKEN}`);
    });
    await expect(openResourceCapability(api)?.(URL_WITH_TOKEN)).rejects.toMatchObject({
      failure: 'threw',
      detail: 'TypeError'
    });
  });

  it('names a non-Error throw by its type', async () => {
    const { api } = devtoolsWith(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- a hostile API's throw
      throw 'nope';
    });
    await expect(openResourceCapability(api)?.(URL_WITH_TOKEN)).rejects.toMatchObject({
      failure: 'threw',
      detail: 'string'
    });
  });
});

describe('devtoolsStatusFailure', () => {
  it.each([
    ['undefined', undefined, null],
    ['OK status', { code: 'OK', description: 'OK', details: [] }, null],
    ['isError not exactly true', { isError: 'true', code: 'E_FAILED' }, null],
    ['code only', { isError: true, code: 'E_FAILED' }, 'E_FAILED'],
    ['no strings', { isError: true, code: 7 }, 'unspecified DevTools error']
  ])('%s → %s', (_label, response, expected) => {
    expect(devtoolsStatusFailure(response)).toBe(expected);
  });

  it('bounds a long description', () => {
    const detail = devtoolsStatusFailure({ isError: true, description: 'x'.repeat(500) });
    expect(detail?.length).toBeLessThanOrEqual(201);
  });
});

describe('redactUrl', () => {
  it('replaces every occurrence of the URL and leaves other text', () => {
    expect(redactUrl(`a ${URL_WITH_TOKEN} b ${URL_WITH_TOKEN}`, URL_WITH_TOKEN)).toBe(
      'a <url> b <url>'
    );
    expect(redactUrl('nothing here', URL_WITH_TOKEN)).toBe('nothing here');
  });

  it('keeps the message as is for an empty URL (split on "" would interleave)', () => {
    expect(redactUrl('abc', '')).toBe('abc');
  });

  it('replaces the longer of overlapping URLs first, so no fragment is left behind', () => {
    const full = `${URL_WITH_TOKEN}#frag=s3cret`;
    expect(redactUrl(`${full} and ${URL_WITH_TOKEN}`, URL_WITH_TOKEN, full)).toBe(
      '<url> and <url>'
    );
  });
});

describe('sourcesTarget', () => {
  it.each([
    ['no fragment', 'https://a.example/x.js?ver=1', 'https://a.example/x.js?ver=1'],
    ['a fragment, query kept', 'https://a.example/x.js?ver=1#top', 'https://a.example/x.js?ver=1'],
    ['a bare "#"', 'https://a.example/x.js#', 'https://a.example/x.js'],
    ['"#" inside the fragment', 'https://a.example/#a#b', 'https://a.example/'],
    ['empty', '', '']
  ])('%s: %s → %s', (_label, url, expected) => {
    expect(sourcesTarget(url)).toBe(expected);
  });
});

describe('openInSources', () => {
  it('returns true and toasts nothing on success', async () => {
    const open = vi.fn(() => Promise.resolve());
    await expect(openInSources(open, URL_WITH_TOKEN)).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith(URL_WITH_TOKEN);
    expect(toastItems()).toHaveLength(0);
  });

  it('logs a URL-free warning and toasts the remedy on a failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const open = vi.fn(() =>
      Promise.reject(new OpenResourceError('devtools-status', 'E_NOTFOUND Object not found: %s'))
    );
    await expect(openInSources(open, URL_WITH_TOKEN)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('s3cret');
    expect(warn.mock.calls[0]?.[0]).toContain('[WPR FDT]');
    expect(warn.mock.calls[0]?.[1]).toEqual({
      failure: 'devtools-status',
      detail: 'E_NOTFOUND Object not found: %s'
    });
    expect(toastItems()).toMatchObject([
      { tone: 'error', title: OPEN_IN_SOURCES_FAILED, description: OPEN_IN_SOURCES_REMEDY }
    ]);
  });

  it('names an unexpected rejection by type, never by message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await openInSources(() => Promise.reject(new Error(URL_WITH_TOKEN)), URL_WITH_TOKEN);
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection is the case under test
    await openInSources(() => Promise.reject('x'), URL_WITH_TOKEN);
    expect(warn.mock.calls[0]?.[1]).toEqual({ failure: 'unexpected', name: 'Error' });
    expect(warn.mock.calls[1]?.[1]).toEqual({ failure: 'unexpected', name: 'string' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('s3cret');
  });
});
