/**
 * Firefox dialect pins, over recorded SpiderMonkey shapes, plus the parity
 * proof: one page's errors yield the same words through either dialect, and
 * the Chromium dialect's output is unchanged by the Firefox one.
 *
 * Recorded shapes and their sources:
 * - frames-only stack `fn@url:line:col` (+ `cause*` async prefixes):
 *   SpiderMonkey `FormatSpiderMonkeyStackFrame` (js/src/vm/SavedStacks.cpp);
 *   `ErrorObject::getStack_impl` prepends the header only in V8-emulation
 *   mode. Live Firefox 158 probe: `stack` =
 *   `@http://127.0.0.1:8493/fdt/:1:227\nsetTimeout handler*…`, message
 *   `fdtProbeMissingRef is not defined`.
 * - messages (js/public/friend/ErrorNumbers.msg): `{0} is not defined`,
 *   `{0} is not a function`, `can't access property {0}, {1} is {2}`,
 *   `can't access property {0} of {1}`; the key `{0}` is `ValueToSource` of
 *   the id (`ReportIsNullOrUndefinedForPropertyAccess`, js/src/vm/JSContext.cpp:
 *   string keys double-quoted, index keys bare), under the pref
 *   `javascript.options.property_error_message_fix` (default true since at
 *   least the Firefox 150 release, the build's floor).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHROMIUM_ERROR_DIALECT,
  DEFAULT_FLUSH_DELAY_MS,
  extractUndefinedReference,
  extractWithShapes,
  startUndefinedReferenceCapture,
  type ErrorTextDialect
} from './capture-undefined-references';
import {
  CANT_ACCESS_PROPERTY_SHAPE,
  FIREFOX_ERROR_DIALECT,
  readFirefoxErrorText,
  unescapeQuotedKey
} from './firefox-error-dialect';

/** A recorded SpiderMonkey stack: frames only, async cause prefix included. */
const SM_FRAMES =
  '@http://127.0.0.1:8493/fdt/:1:227\nsetTimeout handler*@http://127.0.0.1:8493/fdt/:1:200\n';

/** An error object as SpiderMonkey builds one: name/message + a frames-only stack. */
const smError = (Ctor: ErrorConstructor, message: string): Error => {
  const error = new Ctor(message);
  Object.defineProperty(error, 'stack', { value: SM_FRAMES, configurable: true });
  return error;
};

/** An error object as V8 builds one: the stack opens with `Name: message`. */
const v8Error = (Ctor: ErrorConstructor, message: string): Error => {
  const error = new Ctor(message);
  const stack = `${error.name}: ${message}\n    at http://127.0.0.1:8493/fdt/:1:227`;
  Object.defineProperty(error, 'stack', { value: stack, configurable: true });
  return error;
};

/** The word a dialect extracts from one thrown object. */
const wordOf = (dialect: ErrorTextDialect, thrown: object): string | null => {
  const text = dialect.readText(thrown);
  return text === null ? null : extractWithShapes(text, dialect.shapes);
};

describe('CANT_ACCESS_PROPERTY_SHAPE', () => {
  it('a string key after an expression is the reference', () => {
    expect(
      CANT_ACCESS_PROPERTY_SHAPE(`TypeError: can't access property "theForm", obj.a is undefined`)
    ).toBe('theForm');
  });

  it('the expression-less form (`of undefined`) reads the key too', () => {
    expect(CANT_ACCESS_PROPERTY_SHAPE(`TypeError: can't access property "x" of undefined`)).toBe(
      'x'
    );
  });

  it('index keys are bare numbers and read as their digits (V8 reads `0` too)', () => {
    expect(
      CANT_ACCESS_PROPERTY_SHAPE(`TypeError: can't access property 0, list is undefined`)
    ).toBe('0');
  });

  it('null reads are not undefined references', () => {
    expect(
      CANT_ACCESS_PROPERTY_SHAPE(`TypeError: can't access property "x", obj is null`)
    ).toBeNull();
    expect(CANT_ACCESS_PROPERTY_SHAPE(`TypeError: can't access property "x" of null`)).toBeNull();
  });

  it('empty and symbol keys name nothing', () => {
    expect(
      CANT_ACCESS_PROPERTY_SHAPE(`TypeError: can't access property "", o is undefined`)
    ).toBeNull();
    expect(
      CANT_ACCESS_PROPERTY_SHAPE(`TypeError: can't access property Symbol("s"), o is undefined`)
    ).toBeNull();
  });

  it('escaped keys come back raw: quote, backslash, `\\xNN`, `\\uNNNN`, surrogate pairs', () => {
    const shape = (key: string): string | null =>
      CANT_ACCESS_PROPERTY_SHAPE(`TypeError: can't access property "${key}", o is undefined`);
    expect(shape(String.raw`a\"b`)).toBe('a"b');
    expect(shape(String.raw`a\\b`)).toBe('a\\b');
    expect(shape(String.raw`caf\xE9`)).toBe('café');
    expect(shape(String.raw`caf\xe9`)).toBe('café');
    expect(shape(String.raw`漢字`)).toBe('漢字');
    expect(shape(String.raw`smile😀`)).toBe('smile😀');
    expect(shape("it's")).toBe("it's");
  });

  it('malformed escapes name nothing', () => {
    const shape = (key: string): string | null =>
      CANT_ACCESS_PROPERTY_SHAPE(`TypeError: can't access property "${key}", o is undefined`);
    expect(shape(String.raw`a\q`)).toBeNull();
    expect(shape(String.raw`a\x4`)).toBeNull();
    expect(shape(String.raw`a\xZZ`)).toBeNull();
    expect(shape(String.raw`a\u12`)).toBeNull();
    expect(shape(String.raw`a\u{1F600}`)).toBeNull();
    // A raw quote ends the key early; the rest is no longer the shape.
    expect(shape('a"b')).toBeNull();
    // A trailing backslash swallows the closing quote.
    expect(shape('a\\')).toBeNull();
  });

  it('a property write reads like a read on SpiderMonkey and yields the key (V8: nothing)', () => {
    // `o.a.k = 1` — SpiderMonkey throws the read's text; V8 says `setting`.
    expect(
      CANT_ACCESS_PROPERTY_SHAPE(`TypeError: can't access property "k", o.a is undefined`)
    ).toBe('k');
    expect(
      extractUndefinedReference("TypeError: Cannot set properties of undefined (setting 'k')")
    ).toBeNull();
  });

  it('stays line-local and needs the TypeError prefix', () => {
    expect(
      CANT_ACCESS_PROPERTY_SHAPE(`TypeError: can't access property "x", o\nis undefined`)
    ).toBeNull();
    expect(CANT_ACCESS_PROPERTY_SHAPE(`can't access property "x", o is undefined`)).toBeNull();
  });
});

describe('unescapeQuotedKey', () => {
  it('a plain body is the key itself (empty included)', () => {
    expect(unescapeQuotedKey('theForm')).toBe('theForm');
    expect(unescapeQuotedKey('')).toBe('');
  });

  it('decodes every escape SpiderMonkey emits', () => {
    expect(unescapeQuotedKey(String.raw`\b\f\t\v\x00\'\"\\`)).toBe('\b\f\t\v\0\'"\\');
  });

  it('a key holding a line terminator names nothing (V8 shapes are line-local)', () => {
    for (const body of [
      String.raw`a\nb`,
      String.raw`a\rb`,
      String.raw`a\u2028b`,
      String.raw`a\u2029b`
    ]) {
      expect(unescapeQuotedKey(body)).toBeNull();
    }
    expect(
      extractUndefinedReference("TypeError: Cannot read properties of undefined (reading 'a\nb')")
    ).toBeNull();
  });

  it('a tab survives, as V8 reads it', () => {
    expect(unescapeQuotedKey(String.raw`a\tb`)).toBe('a\tb');
    expect(
      extractUndefinedReference("TypeError: Cannot read properties of undefined (reading 'a\tb')")
    ).toBe('a\tb');
  });

  it('a lone surrogate decodes as is (word admission refuses it)', () => {
    expect(unescapeQuotedKey(String.raw`\uD83D`)).toBe('\uD83D');
  });

  it('an escaped backslash never starts a second escape', () => {
    expect(unescapeQuotedKey(String.raw`\\x41`)).toBe('\\x41');
  });

  it('a huge hostile body stays fast', () => {
    const start = performance.now();
    expect(unescapeQuotedKey(`${'\\x41'.repeat(50_000)}\\`)).toBeNull();
    expect(
      CANT_ACCESS_PROPERTY_SHAPE(
        `TypeError: can't access property "${'\\"'.repeat(50_000)}, o is undefined`
      )
    ).toBeNull();
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('readFirefoxErrorText', () => {
  it('rebuilds the header above the frames', () => {
    expect(readFirefoxErrorText(smError(ReferenceError, 'foo is not defined'))).toBe(
      `ReferenceError: foo is not defined\n${SM_FRAMES}`
    );
  });

  it('no string stack, no text (a stack-less look-alike stays out, as on Chromium)', () => {
    expect(
      readFirefoxErrorText({ name: 'ReferenceError', message: 'foo is not defined' })
    ).toBeNull();
    expect(readFirefoxErrorText({ stack: 42, name: 'ReferenceError', message: 'x' })).toBeNull();
  });

  it('a non-string name or message leaves the stack alone', () => {
    expect(readFirefoxErrorText({ stack: SM_FRAMES, name: 1, message: 'x' })).toBe(SM_FRAMES);
    expect(readFirefoxErrorText({ stack: SM_FRAMES, name: 'TypeError' })).toBe(SM_FRAMES);
  });

  it('a throwing getter propagates (the capture guards the read)', () => {
    const hostile = { stack: SM_FRAMES };
    Object.defineProperty(hostile, 'message', {
      get: () => {
        throw new Error('getter boom');
      }
    });
    expect(() => readFirefoxErrorText(hostile)).toThrow('getter boom');
  });
});

describe('engine parity: the same page error, the same word', () => {
  /** Each row: the error ctor, V8's message, SpiderMonkey's message, the word. */
  const rows: [ErrorConstructor, string, string, string][] = [
    [ReferenceError, 'jQuery is not defined', 'jQuery is not defined', 'jQuery'],
    [
      TypeError,
      "Cannot read properties of undefined (reading 'theForm')",
      `can't access property "theForm", document.forms.x is undefined`,
      'theForm'
    ],
    [
      TypeError,
      "Cannot read properties of undefined (reading '0')",
      "can't access property 0, list is undefined",
      '0'
    ],
    [TypeError, 'window.foo.bar is not a function', 'window.foo.bar is not a function', 'bar'],
    [
      TypeError,
      "Cannot read properties of undefined (reading 'café')",
      String.raw`can't access property "caf\xE9", o.a is undefined`,
      'café'
    ],
    [
      TypeError,
      "Cannot read properties of undefined (reading '漢字')",
      String.raw`can't access property "\u6F22\u5B57", o.a is undefined`,
      '漢字'
    ],
    [
      TypeError,
      "Cannot read properties of undefined (reading '😀')",
      String.raw`can't access property "\uD83D\uDE00" of undefined`,
      '😀'
    ]
  ];

  it.each(rows)('%o: V8 %s / SpiderMonkey %s', (Ctor, v8Message, smMessage, word) => {
    expect(wordOf(CHROMIUM_ERROR_DIALECT, v8Error(Ctor, v8Message))).toBe(word);
    expect(wordOf(FIREFOX_ERROR_DIALECT, smError(Ctor, smMessage))).toBe(word);
    // A V8-shaped stack through the Firefox dialect (V8-emulation mode, or a
    // page-built stack) still yields the word.
    expect(wordOf(FIREFOX_ERROR_DIALECT, v8Error(Ctor, v8Message))).toBe(word);
  });

  it('the Chromium dialect is untouched: SpiderMonkey shapes stay unread there', () => {
    expect(
      wordOf(CHROMIUM_ERROR_DIALECT, smError(ReferenceError, 'foo is not defined'))
    ).toBeNull();
    expect(
      extractUndefinedReference(`TypeError: can't access property "x", o is undefined`)
    ).toBeNull();
  });

  it('null reads and unrelated errors name nothing on either engine', () => {
    expect(
      wordOf(FIREFOX_ERROR_DIALECT, smError(TypeError, `can't access property "x", o is null`))
    ).toBeNull();
    expect(wordOf(FIREFOX_ERROR_DIALECT, smError(SyntaxError, 'unexpected token'))).toBeNull();
  });
});

describe('the capture with the Firefox dialect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('page errors and rejections with frames-only stacks ship their words', () => {
    const sends: string[][] = [];
    const stop = startUndefinedReferenceCapture({
      dialect: FIREFOX_ERROR_DIALECT,
      sendBatch: (words) => {
        sends.push(words);
      }
    });
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'ReferenceError: fdtProbeMissingRef is not defined',
        error: smError(ReferenceError, 'fdtProbeMissingRef is not defined')
      })
    );
    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', {
      value: smError(TypeError, `can't access property "theForm", f is undefined`)
    });
    window.dispatchEvent(rejection);
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([['fdtProbeMissingRef', 'theForm']]);
    stop();
  });

  it('hostile escaped keys ship nothing: control, lone surrogate, malformed', () => {
    const sends: string[][] = [];
    const stop = startUndefinedReferenceCapture({
      dialect: FIREFOX_ERROR_DIALECT,
      sendBatch: (words) => {
        sends.push(words);
      }
    });
    for (const key of [
      String.raw`a\nb`,
      String.raw`\uD83D`,
      String.raw`\x1B[2J`,
      String.raw`a\q`
    ]) {
      window.dispatchEvent(
        new ErrorEvent('error', {
          error: smError(TypeError, `can't access property "${key}", o is undefined`)
        })
      );
    }
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([]);
    stop();
  });

  it('a hostile message getter cannot break the listener', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const sends: string[][] = [];
    const stop = startUndefinedReferenceCapture({
      dialect: FIREFOX_ERROR_DIALECT,
      sendBatch: (words) => {
        sends.push(words);
      }
    });
    const hostile = { stack: SM_FRAMES };
    Object.defineProperty(hostile, 'message', {
      get: () => {
        throw new Error('getter boom');
      }
    });
    expect(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: hostile }));
    }).not.toThrow();
    vi.advanceTimersByTime(DEFAULT_FLUSH_DELAY_MS);
    expect(sends).toEqual([]);
    stop();
    debug.mockRestore();
  });
});
