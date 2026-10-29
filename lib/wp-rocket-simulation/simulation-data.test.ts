/**
 * The simulation data reader: a well-formed file reads back as given, every
 * malformed shape is a problem naming the offending key (never a throw), and
 * the committed file reads.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_WPR_VERSIONS } from '../wp-rocket/versions';
import { DELAY_JS_VERSION_PATTERN } from '../wp-rocket/constants';
import {
  SIMULATION_DATA_PATH,
  isRuntimeJsPath,
  readSimulationData,
  rowListKeyText,
  simulationDataHashProblem,
  type SimulationData
} from './simulation-data';
import { sha256Hex } from '../../utils/sha256';
import { webSha256Hex } from '../../utils/web-sha256';

/** A text's content key (sync, for building fixtures). */
const textKey = sha256Hex;

/** A row list's content key (sync, for building fixtures). */
const listKey = (rows: readonly string[]): string => sha256Hex(rowListKeyText(rows));
import { parseSimulationTable } from './simulation-parity-table';

type Json = Record<string, unknown>;

const RUNTIME = 'a'.repeat(64);
const FALLBACK = 'b'.repeat(64);
const LIST = 'c'.repeat(64);
const LAZY_RUNTIME = 'f'.repeat(64);

/**
 * A LazyLoad entry over the given text and list keys (its runtime is pinned
 * only, never a text).
 */
function lazyloadEntry(text: string, list: string): Json {
  return {
    runtime: { sha256: LAZY_RUNTIME, bytes: 10, jsPath: 'lazyload/1.0/lazyload.min.js' },
    noJsStyle: { sha256: text },
    optionsScript: { sha256: text },
    runtimeTag: { beforeUrl: { sha256: text }, afterUrl: { sha256: text } },
    excludedAttributes: { sha256: list, count: 2 },
    excludedSrc: { sha256: list, count: 2 }
  };
}

/** A data file under test: every field loosely typed, so a test can break any of them. */
interface File {
  [key: string]: unknown;
  versions: Record<string, unknown>;
  texts: Record<string, unknown>;
  rowLists: Record<string, unknown>;
}

/** A valid file: one version, two texts, one row list. */
function valid(): File {
  return {
    format: 1,
    versions: {
      '3.23.5.1': {
        runtime: { sha256: RUNTIME, version: '2.0.5' },
        ieFallback: { sha256: FALLBACK },
        delayJsExclusions: { sha256: LIST, count: 2 },
        deferJsExternalExclusions: { sha256: LIST, count: 2 },
        deferJsInlineExclusions: { sha256: LIST, count: 2 },
        lazyload: lazyloadEntry(FALLBACK, LIST)
      }
    },
    texts: { [RUNTIME]: 'runtime', [FALLBACK]: 'fallback' },
    rowLists: { [LIST]: ['x', 'y'] }
  };
}

/** The `3.23.5.1` entry of a file built by {@link valid}. */
function entry(file: File): Record<string, Json> {
  return file.versions['3.23.5.1'] as Record<string, Json>;
}

/** Expect the mutated file to read as a problem containing `problem`. */
function rejects(mutate: (file: File) => void, problem: string): void {
  const file = valid();
  mutate(file);
  const read = readSimulationData(file);
  expect(read.ok).toBe(false);
  if (!read.ok) expect(read.problem).toContain(problem);
}

describe('readSimulationData', () => {
  it('reads a valid file as given, and two versions sharing one entry', () => {
    const file = valid();
    expect(readSimulationData(file)).toEqual({ ok: true, data: file });
    file.versions['3.24'] = structuredClone(file.versions['3.23.5.1']);
    const read = readSimulationData(file);
    expect(read.ok && Object.keys(read.data.versions)).toEqual(['3.23.5.1', '3.24']);
  });

  it('rejects a malformed file shape', () => {
    expect(readSimulationData(null)).toEqual({
      ok: false,
      problem: 'the data file must be an object'
    });
    expect(readSimulationData([])).toMatchObject({ ok: false });
    rejects((file) => (file.extra = 1), 'has keys other than');
    rejects((file) => (file.format = 2), 'format must be 1');
    rejects((file) => delete file.format, 'format must be 1');
    rejects((file) => ((file as Json).texts = []), 'texts must be an object');
    rejects((file) => ((file as Json).rowLists = 'x'), 'rowLists must be an object');
    rejects((file) => (file.versions = {}), 'versions must be a non-empty object');
    rejects((file) => ((file as Json).versions = []), 'versions must be a non-empty object');
  });

  it('rejects content keys that are not sha256 and malformed entries', () => {
    rejects((file) => (file.texts.ABC = 'x'), 'texts key "ABC" is not a sha256');
    rejects((file) => (file.texts[RUNTIME] = ''), `texts.${RUNTIME} must be a non-empty string`);
    rejects((file) => (file.texts[RUNTIME] = 1), 'must be a non-empty string');
    rejects((file) => (file.rowLists[LIST] = ['x', 1]), `rowLists.${LIST} must be an array`);
    rejects((file) => (file.rowLists[LIST] = 'x'), 'must be an array of strings');
  });

  it('rejects malformed version entries, naming the field', () => {
    rejects((file) => {
      file.versions['v3'] = file.versions['3.23.5.1'];
    }, 'versions key "v3" is not a WP Rocket version');
    rejects((file) => {
      file.versions['3'] = file.versions['3.23.5.1'];
    }, 'versions key "3" is not a WP Rocket version');
    rejects((file) => (file.versions['3.23.5.1'] = 'x'), 'versions.3.23.5.1 must be an object');
    rejects((file) => (entry(file).extra = {}), 'versions.3.23.5.1 has keys other than');
    rejects((file) => delete entry(file).runtime, 'versions.3.23.5.1.runtime must be an object');
    rejects(
      (file) => ((entry(file).runtime as Json).extra = 1),
      'versions.3.23.5.1.runtime has keys other than'
    );
    rejects(
      (file) => ((entry(file).runtime as Json).version = ''),
      'runtime.version must be a non-empty version string'
    );
    rejects(
      (file) => ((entry(file).runtime as Json).version = '2 0'),
      'runtime.version must be a non-empty version string'
    );
    rejects(
      (file) => ((entry(file).runtime as Json).sha256 = 'A'.repeat(64)),
      'versions.3.23.5.1.runtime.sha256 must be 64 lowercase hex digits'
    );
    rejects(
      (file) => delete (entry(file).ieFallback as Json).sha256,
      'ieFallback.sha256 must be 64 lowercase hex digits'
    );
    rejects(
      (file) => ((entry(file).delayJsExclusions as Json).sha256 = 1),
      'delayJsExclusions.sha256 must be 64 lowercase hex digits'
    );
  });

  it('rejects keys missing from texts or row lists, and a wrong count', () => {
    rejects(
      (file) => Reflect.deleteProperty(file.texts, RUNTIME),
      `versions.3.23.5.1.runtime: no text ${RUNTIME}`
    );
    rejects(
      (file) => Reflect.deleteProperty(file.texts, FALLBACK),
      `versions.3.23.5.1.ieFallback: no text ${FALLBACK}`
    );
    rejects(
      (file) => Reflect.deleteProperty(file.rowLists, LIST),
      `versions.3.23.5.1.delayJsExclusions: no row list ${LIST}`
    );
    rejects(
      (file) => ((entry(file).delayJsExclusions as Json).count = 3),
      'delayJsExclusions.count must be 2'
    );
    rejects(
      (file) => ((entry(file).delayJsExclusions as Json).count = '2'),
      'delayJsExclusions.count must be 2'
    );
    // Every list field is read the same way (the Defer JS lists too).
    rejects(
      (file) => delete entry(file).deferJsExternalExclusions,
      'deferJsExternalExclusions must be an object'
    );
    rejects(
      (file) => ((entry(file).deferJsInlineExclusions as Json).count = 1),
      'versions.3.23.5.1.deferJsInlineExclusions.count must be 2'
    );
    // A list key is never looked up as a text (and the reverse).
    rejects((file) => {
      (entry(file).delayJsExclusions as Json).sha256 = RUNTIME;
    }, `no row list ${RUNTIME}`);
  });

  it('rejects a malformed LazyLoad entry, naming the field', () => {
    const lazy = (file: File): Json => entry(file).lazyload as Json;
    rejects((file) => delete entry(file).lazyload, 'versions.3.23.5.1.lazyload must be an object');
    rejects((file) => (lazy(file).iframes = {}), 'versions.3.23.5.1.lazyload has keys other than');
    for (const jsPath of ['', '/abs.js', 'a/../b.js', 'lazyload.css', 'a b.js', 1]) {
      rejects(
        (file) => ((lazy(file).runtime as Json).jsPath = jsPath),
        'lazyload.runtime.jsPath must be a relative path to a .js file'
      );
    }
    for (const bytes of [0, -1, 1.5, '10']) {
      rejects(
        (file) => ((lazy(file).runtime as Json).bytes = bytes),
        'lazyload.runtime.bytes must be a positive integer'
      );
    }
    rejects(
      (file) => ((lazy(file).runtime as Json).sha256 = 'x'),
      'lazyload.runtime.sha256 must be 64 lowercase hex digits'
    );
    rejects(
      (file) => ((lazy(file).noJsStyle as Json).sha256 = RUNTIME.replace('a', 'e')),
      `versions.3.23.5.1.lazyload.noJsStyle: no text`
    );
    rejects(
      (file) => (((lazy(file).runtimeTag as Json).afterUrl as Json).sha256 = LIST),
      `versions.3.23.5.1.lazyload.runtimeTag.afterUrl: no text ${LIST}`
    );
    rejects(
      (file) => delete (lazy(file).runtimeTag as Json).beforeUrl,
      'lazyload.runtimeTag.beforeUrl must be an object'
    );
    rejects(
      (file) => ((lazy(file).excludedSrc as Json).count = 3),
      'versions.3.23.5.1.lazyload.excludedSrc.count must be 2'
    );
  });

  it("keeps LazyLoad's runtime out of the texts: a text under its key is dead weight", () => {
    rejects(
      (file) => (file.texts[LAZY_RUNTIME] = 'runtime bytes'),
      `entry ${LAZY_RUNTIME} is not used by any version`
    );
  });

  it('rejects an entry no version uses (dead weight in the package)', () => {
    const orphan = 'd'.repeat(64);
    rejects((file) => (file.texts[orphan] = 'x'), `entry ${orphan} is not used by any version`);
    rejects((file) => (file.rowLists[orphan] = []), `entry ${orphan} is not used by any version`);
  });

  it('never takes a field from the prototype chain', () => {
    const file = valid();
    delete file.format;
    const read = readSimulationData(Object.assign(Object.create({ format: 1 }) as Json, file));
    expect(read).toEqual({ ok: false, problem: 'format must be 1' });
  });

  it('rethrows a failure that is not a shape problem', () => {
    const file = valid();
    Object.defineProperty(file, 'format', {
      enumerable: true,
      get() {
        throw new TypeError('getter failed');
      }
    });
    expect(() => readSimulationData(file)).toThrow('getter failed');
  });

  it('reads the committed data file', () => {
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../public',
      SIMULATION_DATA_PATH
    );
    const read = readSimulationData(JSON.parse(readFileSync(path, 'utf8')));
    expect(read.ok).toBe(true);
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));

/** The committed data file, read (failing the test when it does not read). */
function committed(): SimulationData {
  const read = readSimulationData(
    JSON.parse(readFileSync(join(HERE, '../../public', SIMULATION_DATA_PATH), 'utf8'))
  );
  if (!read.ok) throw new Error(`committed data file unreadable: ${read.problem}`);
  return read.data;
}

describe('rowListKeyText', () => {
  it('is the rows’ JSON: order and characters count, nothing else', () => {
    expect(rowListKeyText(['a', 'b'])).toBe('["a","b"]');
    expect(rowListKeyText([])).toBe('[]');
    expect(rowListKeyText(['b', 'a'])).not.toBe(rowListKeyText(['a', 'b']));
    expect(rowListKeyText(['é"\\'])).toBe('["é\\"\\\\"]');
  });
});

describe('simulationDataHashProblem', () => {
  /** Real-keyed data: one version over two texts and one list. */
  function keyed(): SimulationData {
    const runtime = 'runtime';
    const fallback = 'fallback';
    const rows = ['x', 'y'];
    const read = readSimulationData({
      format: 1,
      versions: {
        '3.24': {
          runtime: { sha256: textKey(runtime), version: '2.0.5' },
          ieFallback: { sha256: textKey(fallback) },
          delayJsExclusions: { sha256: listKey(rows), count: 2 },
          deferJsExternalExclusions: { sha256: listKey(rows), count: 2 },
          deferJsInlineExclusions: { sha256: listKey(rows), count: 2 },
          lazyload: lazyloadEntry(textKey(fallback), listKey(rows))
        }
      },
      texts: { [textKey(runtime)]: runtime, [textKey(fallback)]: fallback },
      rowLists: { [listKey(rows)]: rows }
    });
    if (!read.ok) throw new Error(read.problem);
    return read.data;
  }

  it('accepts data whose every entry hashes to its key', async () => {
    await expect(simulationDataHashProblem(keyed(), webSha256Hex)).resolves.toBeNull();
  });

  it('names a text whose bytes changed', async () => {
    const data = keyed();
    const key = textKey('fallback');
    const damaged = { ...data, texts: { ...data.texts, [key]: 'fallbacK' } };
    await expect(simulationDataHashProblem(damaged, webSha256Hex)).resolves.toBe(
      `texts.${key} does not hash to its key`
    );
  });

  it('names a row list whose rows changed (an extra row, a reorder)', async () => {
    const data = keyed();
    const key = listKey(['x', 'y']);
    for (const rows of [
      ['x', 'y', 'z'],
      ['y', 'x']
    ]) {
      const damaged = { ...data, rowLists: { [key]: rows } };
      await expect(simulationDataHashProblem(damaged, webSha256Hex)).resolves.toBe(
        `rowLists.${key} does not hash to its key`
      );
    }
  });

  it('rejects the reader-only fixture (its keys are not hashes of its content)', async () => {
    const read = readSimulationData(valid());
    if (!read.ok) throw new Error(read.problem);
    await expect(simulationDataHashProblem(read.data, webSha256Hex)).resolves.toBe(
      `texts.${RUNTIME} does not hash to its key`
    );
  });
});

describe('the committed data file', () => {
  const data = committed();
  const table = parseSimulationTable(
    JSON.parse(readFileSync(join(HERE, 'simulation-parity.fixtures.json'), 'utf8'))
  );
  const pins = table.header.simulation;

  it('hashes to its keys', async () => {
    await expect(simulationDataHashProblem(data, webSha256Hex)).resolves.toBeNull();
  });

  it('holds an entry for every supported WP Rocket version, and no other', () => {
    expect(Object.keys(data.versions).sort()).toEqual(
      SUPPORTED_WPR_VERSIONS.map((row) => row.version).sort()
    );
  });

  it('names the parity header pins for the reference version', () => {
    const reference = data.versions[table.header.plugin];
    expect(reference).toEqual({
      runtime: { sha256: pins.runtime.sha256, version: pins.runtime.version },
      ieFallback: { sha256: pins.ieFallback.sha256 },
      delayJsExclusions: pins.delayJsExclusions,
      deferJsExternalExclusions: pins.deferJsExternalExclusions,
      deferJsInlineExclusions: pins.deferJsInlineExclusions,
      lazyload: {
        runtime: {
          sha256: pins.lazyload.runtime.sha256,
          bytes: pins.lazyload.runtime.bytes,
          jsPath: pins.lazyload.runtime.path.replace(/^assets\/js\//, '')
        },
        noJsStyle: { sha256: pins.lazyload.noJsStyle.sha256 },
        optionsScript: { sha256: pins.lazyload.optionsScript.sha256 },
        runtimeTag: {
          beforeUrl: { sha256: pins.lazyload.runtimeTag.beforeUrl.sha256 },
          afterUrl: { sha256: pins.lazyload.runtimeTag.afterUrl.sha256 }
        },
        excludedAttributes: pins.lazyload.excludedAttributes,
        excludedSrc: pins.lazyload.excludedSrc
      }
    });
    // The pinned byte sizes too: the texts are the plugin's own files.
    const encoder = new TextEncoder();
    expect(encoder.encode(data.texts[pins.runtime.sha256]).byteLength).toBe(pins.runtime.bytes);
    expect(encoder.encode(data.texts[pins.ieFallback.sha256]).byteLength).toBe(
      pins.ieFallback.bytes
    );
  });

  it("holds LazyLoad's texts at their pinned sizes, its runtime only as a pin", () => {
    const lazyload = pins.lazyload;
    const encoder = new TextEncoder();
    for (const pin of [
      lazyload.noJsStyle,
      lazyload.optionsScript,
      lazyload.runtimeTag.beforeUrl,
      lazyload.runtimeTag.afterUrl
    ]) {
      expect(encoder.encode(data.texts[pin.sha256]).byteLength).toBe(pin.bytes);
    }
    expect(data.texts[lazyload.runtime.sha256]).toBeUndefined();
    expect(lazyload.runtime).toMatchObject({
      path: 'assets/js/lazyload/17.8.3/lazyload.min.js',
      bytes: 8892
    });
    expect(data.texts[lazyload.noJsStyle.sha256]).toBe(
      '<noscript><style id="rocket-lazyload-nojs-css">.rll-youtube-player, [data-lazy-src]{display:none !important;}</style></noscript>'
    );
    expect(data.texts[lazyload.optionsScript.sha256]).toMatch(
      /^<script>window\.lazyLoadOptions=\[\{elements_selector:"img\[data-lazy-src\],\.rocket-lazyload".*<\/script>$/s
    );
    expect(data.texts[lazyload.runtimeTag.beforeUrl.sha256]).toBe(
      '<script data-no-minify="1" async src="'
    );
    expect(data.texts[lazyload.runtimeTag.afterUrl.sha256]).toBe('"></script>');
    expect(data.rowLists[lazyload.excludedSrc.sha256]).toEqual([
      '/wpcf7_captcha/',
      'timthumb.php?src',
      'woocommerce/assets/images/placeholder.png'
    ]);
    expect(data.rowLists[lazyload.excludedAttributes.sha256]).toHaveLength(22);
  });

  it('ships runtime 2.0.5, its version read from the runtime text itself', () => {
    for (const entry of Object.values(data.versions)) {
      expect(entry.runtime.version).toBe('2.0.5');
      const text = data.texts[entry.runtime.sha256] ?? '';
      expect(DELAY_JS_VERSION_PATTERN.exec(text)?.[1]).toBe(entry.runtime.version);
    }
  });

  it('holds no PHP replacement reference in a runtime (inserted via preg_replace, it would be rewritten)', () => {
    // `$n`, `${n}` and `\n` (n a digit) are back-references in a preg_replace replacement.
    const reference = /\$\d|\$\{\d|\\\d/;
    expect(reference.test('a$1b')).toBe(true);
    expect(reference.test('a${12}b')).toBe(true);
    expect(reference.test('a\\0b')).toBe(true);
    for (const entry of Object.values(data.versions)) {
      expect(reference.test(data.texts[entry.runtime.sha256] ?? '$0')).toBe(false);
    }
  });
});

describe('isRuntimeJsPath', () => {
  it('takes relative paths of plain segments ending in a .js file', () => {
    for (const path of ['l.js', 'lazyload/17.8.3/lazyload.min.js', 'a-b_c/d.e.js']) {
      expect(isRuntimeJsPath(path), path).toBe(true);
    }
  });

  it('refuses anything else: other files, absolute, empty or parent segments, queries, spaces', () => {
    for (const path of [
      '',
      'l.css',
      '/l.js',
      'a//l.js',
      '../l.js',
      'a/../l.js',
      'l.js?v=1',
      'a b.js',
      '.js/'
    ]) {
      expect(isRuntimeJsPath(path), path).toBe(false);
    }
  });
});
