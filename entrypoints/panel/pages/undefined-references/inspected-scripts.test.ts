/**
 * The devtools adapter: untrusted platform answers shape-checked,
 * `lastError` read in every callback, base64 decoded, a hanging resource
 * skipped after its timeout, the page-origin read, the added-script watch,
 * and the feature probe.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ScriptListError,
  createScriptLoader,
  decodeResourceContent,
  createInspectedScripts,
  parsePageOrigin,
  realInspectedScripts,
  type InspectedWindowDeps,
  type ScriptLoaderDeps
} from './inspected-scripts';

/** A platform-shaped resource whose content arrives through the callback. */
function resource(
  url: unknown,
  content: unknown,
  options: { type?: unknown; encoding?: unknown } = {}
): Record<string, unknown> {
  return {
    url,
    type: 'type' in options ? options.type : 'script',
    getContent(callback: (content: unknown, encoding: unknown) => void) {
      callback(content, options.encoding ?? '');
    }
  };
}

/** Deps answering `resources`, with a scripted `lastError` sequence. */
function deps(resources: unknown, lastErrors: (string | null)[] = []): ScriptLoaderDeps {
  return {
    getResources: (onResources) => {
      onResources(resources);
    },
    readLastError: () => lastErrors.shift() ?? null
  };
}

describe('decodeResourceContent', () => {
  it('passes plain text through for an empty or absent encoding', () => {
    expect(decodeResourceContent('var a;', '')).toBe('var a;');
    expect(decodeResourceContent('var a;', undefined)).toBe('var a;');
    expect(decodeResourceContent('var a;', null)).toBe('var a;');
  });

  it('decodes base64 as UTF-8 (multi-byte included)', () => {
    const text = 'var café = "ü";';
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    expect(decodeResourceContent(encoded, 'base64')).toBe(text);
  });

  it('answers null for non-text content, unknown encodings and broken base64', () => {
    expect(decodeResourceContent(null, '')).toBeNull();
    expect(decodeResourceContent(42, '')).toBeNull();
    expect(decodeResourceContent('abc', 'gzip')).toBeNull();
    expect(decodeResourceContent('%%%not base64', 'base64')).toBeNull();
  });
});

describe('createScriptLoader', () => {
  it('reads every http(s) script resource, then the inline stack', async () => {
    const load = createScriptLoader(
      deps([
        resource('https://x.test/a.js', 'var a;'),
        resource('https://x.test/style.css', 'body{}', { type: 'stylesheet' }),
        resource('chrome-extension://id/x.js', 'var z;')
      ])
    );
    await expect(load([{ content: 'var i;' }, {}])).resolves.toEqual({
      assets: [
        { origin: { kind: 'url', url: 'https://x.test/a.js' }, content: 'var a;' },
        { origin: { kind: 'inline' }, content: 'var i;' }
      ],
      unreadable: 0
    });
  });

  it('drops malformed platform entries instead of crashing on them', async () => {
    const load = createScriptLoader(
      deps([
        null,
        'string',
        { url: 42, getContent: () => undefined },
        { url: 'https://x.test/no-reader.js' },
        resource('https://x.test/ok.js', 'var ok;', { type: 7 }),
        resource('https://x.test/good.js', 'var good;')
      ])
    );
    // A non-string type reads as absent, so that entry is not a script.
    await expect(load([])).resolves.toEqual({
      assets: [{ origin: { kind: 'url', url: 'https://x.test/good.js' }, content: 'var good;' }],
      unreadable: 0
    });
  });

  it('decodes base64 bodies and skips unreadable ones', async () => {
    const load = createScriptLoader(
      deps([
        resource('https://x.test/enc.js', btoa('var enc;'), { encoding: 'base64' }),
        resource('https://x.test/null.js', null)
      ])
    );
    await expect(load([])).resolves.toEqual({
      assets: [{ origin: { kind: 'url', url: 'https://x.test/enc.js' }, content: 'var enc;' }],
      unreadable: 1
    });
  });

  it('reads lastError in each content callback and skips that resource', async () => {
    // First read: the listing (clean); second + third: the two content reads.
    const load = createScriptLoader(
      deps(
        [resource('https://x.test/a.js', 'var a;'), resource('https://x.test/b.js', 'var b;')],
        [null, 'No resource with given URL found', null]
      )
    );
    await expect(load([])).resolves.toEqual({
      assets: [{ origin: { kind: 'url', url: 'https://x.test/b.js' }, content: 'var b;' }],
      unreadable: 1
    });
  });

  it('rejects with the platform reason when the listing sets lastError', async () => {
    const load = createScriptLoader(deps([], ['Inspected target navigated or closed']));
    const read = load([]);
    await expect(read).rejects.toBeInstanceOf(ScriptListError);
    await expect(read).rejects.toThrow('Inspected target navigated or closed');
  });

  it('rejects a listing that is not a list', async () => {
    await expect(createScriptLoader(deps({ length: 1 }))([])).rejects.toThrow(
      'The resource listing was not a list.'
    );
  });

  it('rejects when the platform call throws synchronously', async () => {
    const load = createScriptLoader({
      getResources: () => {
        throw new Error('Extension context invalidated.');
      },
      readLastError: () => null
    });
    await expect(load([])).rejects.toThrow('Extension context invalidated.');
  });

  it('resolves the inline stack alone when the page has no script resources', async () => {
    await expect(createScriptLoader(deps([]))([{ content: 'var i;' }])).resolves.toEqual({
      assets: [{ origin: { kind: 'inline' }, content: 'var i;' }],
      unreadable: 0
    });
    await expect(createScriptLoader(deps([]))([])).resolves.toEqual({
      assets: [],
      unreadable: 0
    });
  });
});

describe('unreadable count', () => {
  /** A resource whose content read throws synchronously. */
  const throwing = (url: string) => ({
    url,
    type: 'script',
    getContent() {
      throw new Error('Extension context invalidated.');
    }
  });

  it('counts lastErrors, undecodable content and throwing reads — not empty bodies', async () => {
    const cancels: (() => void)[] = [];
    const load = createScriptLoader({
      ...deps(
        [
          resource('https://x.test/empty.js', ''),
          resource('https://x.test/error.js', 'var e;'),
          resource('https://x.test/bad.js', '%%%', { encoding: 'base64' }),
          throwing('https://x.test/throws.js'),
          resource('https://x.test/ok.js', 'var ok;')
        ],
        [null, null, 'No resource with given URL found', null, null]
      ),
      schedule: () => {
        const cancel = vi.fn();
        cancels.push(cancel);
        return cancel;
      }
    });
    await expect(load([])).resolves.toEqual({
      assets: [
        // An empty body is a readable (empty) script.
        { origin: { kind: 'url', url: 'https://x.test/empty.js' }, content: '' },
        { origin: { kind: 'url', url: 'https://x.test/ok.js' }, content: 'var ok;' }
      ],
      unreadable: 3
    });
    // Every resource's timer was cancelled — the throwing one included.
    expect(cancels).toHaveLength(5);
    for (const cancel of cancels) expect(cancel).toHaveBeenCalledOnce();
  });

  it('counts per read — a second read starts from zero', async () => {
    const load = createScriptLoader(deps([throwing('https://x.test/throws.js')]));
    await expect(load([])).resolves.toMatchObject({ unreadable: 1 });
    await expect(load([])).resolves.toMatchObject({ unreadable: 1 });
  });
});

describe('per-resource content timeout', () => {
  it('skips a resource whose content never arrives, and ignores its late answer', async () => {
    const timers: (() => void)[] = [];
    let late: ((content: unknown, encoding: unknown) => void) | undefined;
    const hanging = {
      url: 'https://x.test/hangs.js',
      type: 'script',
      getContent(callback: (content: unknown, encoding: unknown) => void) {
        late = callback;
      }
    };
    const load = createScriptLoader({
      ...deps([hanging, resource('https://x.test/ok.js', 'var ok;')]),
      schedule: (run) => {
        timers.push(run);
        return () => undefined;
      },
      contentTimeoutMs: 5
    });
    const read = load([]);
    await Promise.resolve();
    // The ok resource answered; the hanging one holds the read until its timer.
    for (const run of timers) run();
    await expect(read).resolves.toEqual({
      assets: [{ origin: { kind: 'url', url: 'https://x.test/ok.js' }, content: 'var ok;' }],
      unreadable: 1
    });
    expect(() => late?.('var late;', '')).not.toThrow();
  });

  it('cancels the timer once the content arrives', async () => {
    const cancel = vi.fn();
    const load = createScriptLoader({
      ...deps([resource('https://x.test/a.js', 'var a;')]),
      schedule: () => cancel
    });
    await load([]);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('parsePageOrigin', () => {
  it('accepts exactly an http(s) origin', () => {
    expect(parsePageOrigin('https://example.com')).toBe('https://example.com');
    expect(parsePageOrigin('http://localhost:8891')).toBe('http://localhost:8891');
  });

  it('rejects anything else', () => {
    for (const value of [
      'https://example.com/',
      'https://example.com/path',
      'null',
      'file://',
      'chrome-extension://abc',
      42,
      undefined
    ]) {
      expect(parsePageOrigin(value)).toBeNull();
    }
  });
});

/** Inspected-window deps over a scripted eval answer and an event registry. */
function windowDeps(
  evalAnswer: (onResult: (result: unknown, exception: unknown) => void) => void,
  lastErrors: (string | null)[] = []
) {
  const listeners = new Set<(resource: unknown) => void>();
  const value: InspectedWindowDeps = {
    ...deps([]),
    readLastError: () => lastErrors.shift() ?? null,
    evaluate: (expression, onResult) => {
      expect(expression).toBe('location.origin');
      evalAnswer(onResult);
    },
    onResourceAdded: {
      add: (listener) => listeners.add(listener),
      remove: (listener) => listeners.delete(listener)
    }
  };
  return { value, listeners };
}

describe('createInspectedScripts — page origin', () => {
  it('reads and validates the evaluated origin', async () => {
    const { value } = windowDeps((done) => {
      done('https://example.com', undefined);
    });
    await expect(createInspectedScripts(value).readPageOrigin()).resolves.toBe(
      'https://example.com'
    );
  });

  it('answers null on an exception, a lastError, a junk value or a throw', async () => {
    const cases = [
      windowDeps((done) => {
        done(undefined, { isException: true, value: 'boom' });
      }),
      windowDeps((done) => {
        done(undefined, { isError: true, code: 'E_FAILED' });
      }),
      windowDeps(
        (done) => {
          done('https://example.com', undefined);
        },
        ['Inspected target navigated or closed']
      ),
      windowDeps((done) => {
        done('javascript:alert(1)', undefined);
      }),
      windowDeps(() => {
        throw new Error('Extension context invalidated.');
      })
    ];
    for (const { value } of cases) {
      await expect(createInspectedScripts(value).readPageOrigin()).resolves.toBeNull();
    }
  });
});

describe('createInspectedScripts — added scripts', () => {
  it('reports http(s) scripts only, and unsubscribes', () => {
    const { value, listeners } = windowDeps(() => undefined);
    const added: string[] = [];
    const stop = createInspectedScripts(value).watchAddedScripts((url) => added.push(url));
    expect(listeners.size).toBe(1);
    const [listener] = [...listeners];
    listener?.({ url: 'https://x.test/late.js', type: 'script' });
    listener?.({ url: 'https://x.test/style.css', type: 'stylesheet' });
    listener?.({ url: 'chrome-extension://id/x.js', type: 'script' });
    listener?.(null);
    listener?.({ url: 42, type: 'script' });
    expect(added).toEqual(['https://x.test/late.js']);
    stop();
    expect(listeners.size).toBe(0);
  });

  it('isolates a throwing consumer and survives missing or failing event APIs', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { value, listeners } = windowDeps(() => undefined);
    createInspectedScripts(value).watchAddedScripts(() => {
      throw new Error('consumer broke');
    });
    expect(() => [...listeners][0]?.({ url: 'https://x.test/a.js', type: 'script' })).not.toThrow();

    const withoutEvent: InspectedWindowDeps = { ...value, onResourceAdded: undefined };
    expect(createInspectedScripts(withoutEvent).watchAddedScripts(() => undefined)).toBeTypeOf(
      'function'
    );
    const failing = createInspectedScripts({
      ...value,
      onResourceAdded: {
        add: () => {
          throw new Error('nope');
        },
        remove: () => {
          throw new Error('nope');
        }
      }
    });
    expect(() => {
      failing.watchAddedScripts(() => undefined)();
    }).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('realInspectedScripts', () => {
  const api = browser as unknown as Record<string, unknown>;
  const savedDevtools = api['devtools'];

  afterEach(() => {
    api['devtools'] = savedDevtools;
  });

  it('is null where the browser cannot list the inspected page resources', () => {
    api['devtools'] = undefined;
    expect(realInspectedScripts()).toBeNull();
    api['devtools'] = { inspectedWindow: { tabId: 1 } };
    expect(realInspectedScripts()).toBeNull();
  });

  it('wraps the real APIs, calling each on its own object', async () => {
    const onResourceAdded = {
      addListener: vi.fn(function (this: unknown) {
        expect(this).toBe(onResourceAdded);
      }),
      removeListener: vi.fn(function (this: unknown) {
        expect(this).toBe(onResourceAdded);
      })
    };
    const inspectedWindow = {
      tabId: 1,
      getResources: vi.fn(function (this: unknown, callback: (resources: unknown) => void) {
        expect(this).toBe(inspectedWindow);
        callback([resource('https://x.test/a.js', 'var a;')]);
      }),
      eval: vi.fn(function (
        this: unknown,
        _expression: string,
        callback: (result: unknown, exception: unknown) => void
      ) {
        expect(this).toBe(inspectedWindow);
        callback('https://x.test', undefined);
      }),
      onResourceAdded
    };
    api['devtools'] = { inspectedWindow };
    const reader = realInspectedScripts();
    expect(reader).not.toBeNull();
    await expect(reader?.load([])).resolves.toEqual({
      assets: [{ origin: { kind: 'url', url: 'https://x.test/a.js' }, content: 'var a;' }],
      unreadable: 0
    });
    await expect(reader?.readPageOrigin()).resolves.toBe('https://x.test');
    reader?.watchAddedScripts(() => undefined)();
    expect(onResourceAdded.addListener).toHaveBeenCalledOnce();
    expect(onResourceAdded.removeListener).toHaveBeenCalledOnce();
  });

  it('answers a null origin without eval, and no-ops the watch without the event', async () => {
    api['devtools'] = {
      inspectedWindow: {
        getResources(callback: (resources: unknown) => void) {
          callback([]);
        }
      }
    };
    const reader = realInspectedScripts();
    await expect(reader?.readPageOrigin()).resolves.toBeNull();
    expect(() => reader?.watchAddedScripts(() => undefined)()).not.toThrow();
  });

  it('reads runtime.lastError inside the listing callback', async () => {
    const runtime = api['runtime'] as Record<string, unknown>;
    const savedLastError = Object.getOwnPropertyDescriptor(runtime, 'lastError');
    try {
      api['devtools'] = {
        inspectedWindow: {
          getResources(callback: (resources: unknown) => void) {
            Object.defineProperty(runtime, 'lastError', {
              configurable: true,
              value: { message: 'Inspected target navigated or closed' }
            });
            callback(undefined);
          }
        }
      };
      await expect(realInspectedScripts()?.load([])).rejects.toThrow(
        'Inspected target navigated or closed'
      );
      // A lastError without a message still fails, with a generic reason.
      Object.defineProperty(runtime, 'lastError', { configurable: true, value: {} });
      api['devtools'] = {
        inspectedWindow: {
          getResources(callback: (resources: unknown) => void) {
            callback([]);
          }
        }
      };
      await expect(realInspectedScripts()?.load([])).rejects.toThrow('Unknown error');
    } finally {
      if (savedLastError) Object.defineProperty(runtime, 'lastError', savedLastError);
      else Reflect.deleteProperty(runtime, 'lastError');
    }
  });
});

describe('createInspectedScripts — bypassed page', () => {
  /** The bypass eval's ok answer. */
  const bypassOk = (html: string, url = 'https://example.com/?nowprocket=1'): string =>
    JSON.stringify({ ok: true, url, html });

  /** Deps for the bypass expression, asserting its static, injection-inert shape. */
  function bypassDeps(
    evalAnswer: (onResult: (result: unknown, exception: unknown) => void) => void,
    lastErrors: (string | null)[] = []
  ): { value: InspectedWindowDeps } {
    const expressions: string[] = [];
    return {
      value: {
        ...deps([]),
        readLastError: () => lastErrors.shift() ?? null,
        evaluate: (expression, onResult) => {
          expressions.push(expression);
          // One static expression: the URL comes from the page's own location
          // (the bypassed flag added to the existing params); the extension
          // interpolates nothing into it — no eval-injection surface.
          expect(expression).toContain('new URL(location.href)');
          expect(expression).toContain("searchParams.set('nowprocket', '1')");
          evalAnswer(onResult);
        }
      }
    };
  }

  it('parses the ok answer through (the response URL and the html)', async () => {
    const { value } = bypassDeps((done) => {
      done(bypassOk('<p>x</p>', 'https://example.com/?nowprocket=1'), undefined);
    });
    await expect(createInspectedScripts(value).readBypassedPage()).resolves.toEqual({
      url: 'https://example.com/?nowprocket=1',
      html: '<p>x</p>'
    });
  });

  it('answers null for every degraded shape, never throwing', async () => {
    const cases = [
      // The page's own degraded answers: a non-2xx status, a blocked or
      // oversized body.
      bypassDeps((done) => {
        done(JSON.stringify({ ok: false, reason: 'status 404' }), undefined);
      }),
      bypassDeps((done) => {
        done(JSON.stringify({ ok: false, reason: 'oversized' }), undefined);
      }),
      // Junk values the page's world could hand back.
      bypassDeps((done) => {
        done(undefined, undefined);
      }),
      bypassDeps((done) => {
        done('not json', undefined);
      }),
      bypassDeps((done) => {
        done(bypassOk('<p/>', 'javascript:alert(1)'), undefined);
      }),
      bypassDeps((done) => {
        done(JSON.stringify({ ok: true, html: '<p/>' }), undefined);
      }),
      // A devtools-side error, a JS exception in the eval, a lastError
      // ahead of the answer, and a throwing eval call (context invalidated).
      bypassDeps((done) => {
        done(undefined, { isError: true, code: 'E_FAILED' });
      }),
      bypassDeps((done) => {
        done(undefined, { isException: true, value: 'boom' });
      }),
      bypassDeps(
        (done) => {
          done(bypassOk('<p/>'), undefined);
        },
        ['Inspected target navigated or closed']
      ),
      bypassDeps(() => {
        throw new Error('Extension context invalidated.');
      })
    ];
    for (const { value } of cases) {
      await expect(createInspectedScripts(value).readBypassedPage()).resolves.toBeNull();
    }
  });
});
