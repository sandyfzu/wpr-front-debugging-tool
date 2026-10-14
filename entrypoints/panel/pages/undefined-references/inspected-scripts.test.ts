/**
 * The devtools resource adapter: untrusted platform answers shape-checked,
 * `lastError` read in every callback, base64 decoded, the feature probe.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ScriptListError,
  createScriptLoader,
  decodeResourceContent,
  realScriptLoader,
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
    await expect(load([{ content: 'var i;' }, {}])).resolves.toEqual([
      { origin: { kind: 'url', url: 'https://x.test/a.js' }, content: 'var a;' },
      { origin: { kind: 'inline' }, content: 'var i;' }
    ]);
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
    await expect(load([])).resolves.toEqual([
      { origin: { kind: 'url', url: 'https://x.test/good.js' }, content: 'var good;' }
    ]);
  });

  it('decodes base64 bodies and skips unreadable ones', async () => {
    const load = createScriptLoader(
      deps([
        resource('https://x.test/enc.js', btoa('var enc;'), { encoding: 'base64' }),
        resource('https://x.test/null.js', null)
      ])
    );
    await expect(load([])).resolves.toEqual([
      { origin: { kind: 'url', url: 'https://x.test/enc.js' }, content: 'var enc;' }
    ]);
  });

  it('reads lastError in each content callback and skips that resource', async () => {
    // First read: the listing (clean); second + third: the two content reads.
    const load = createScriptLoader(
      deps(
        [resource('https://x.test/a.js', 'var a;'), resource('https://x.test/b.js', 'var b;')],
        [null, 'No resource with given URL found', null]
      )
    );
    await expect(load([])).resolves.toEqual([
      { origin: { kind: 'url', url: 'https://x.test/b.js' }, content: 'var b;' }
    ]);
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
    await expect(createScriptLoader(deps([]))([{ content: 'var i;' }])).resolves.toEqual([
      { origin: { kind: 'inline' }, content: 'var i;' }
    ]);
    await expect(createScriptLoader(deps([]))([])).resolves.toEqual([]);
  });
});

describe('realScriptLoader', () => {
  const api = browser as unknown as Record<string, unknown>;
  const savedDevtools = api['devtools'];

  afterEach(() => {
    api['devtools'] = savedDevtools;
  });

  it('is null where the browser cannot list the inspected page resources', () => {
    api['devtools'] = undefined;
    expect(realScriptLoader()).toBeNull();
    api['devtools'] = { inspectedWindow: { tabId: 1 } };
    expect(realScriptLoader()).toBeNull();
  });

  it('wraps the real API, calling it on its own object', async () => {
    const inspectedWindow = {
      tabId: 1,
      getResources: vi.fn(function (this: unknown, callback: (resources: unknown) => void) {
        expect(this).toBe(inspectedWindow);
        callback([resource('https://x.test/a.js', 'var a;')]);
      })
    };
    api['devtools'] = { inspectedWindow };
    const load = realScriptLoader();
    expect(load).not.toBeNull();
    await expect(load?.([])).resolves.toEqual([
      { origin: { kind: 'url', url: 'https://x.test/a.js' }, content: 'var a;' }
    ]);
    expect(inspectedWindow.getResources).toHaveBeenCalledOnce();
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
      await expect(realScriptLoader()?.([])).rejects.toThrow(
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
      await expect(realScriptLoader()?.([])).rejects.toThrow('Unknown error');
    } finally {
      if (savedLastError) Object.defineProperty(runtime, 'lastError', savedLastError);
      else Reflect.deleteProperty(runtime, 'lastError');
    }
  });
});
