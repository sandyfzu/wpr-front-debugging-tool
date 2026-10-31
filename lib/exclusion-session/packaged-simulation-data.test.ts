/**
 * The packaged runtime source: each cause of an unusable data file (fetch
 * failure, HTTP error, not JSON, wrong shape, hash mismatch, missing
 * version) via transport doubles, one read per background lifetime (shared
 * by concurrent documents, kept when damaged, retried when unreachable),
 * and the committed file serving every supported version.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { SUPPORTED_WPR_VERSIONS } from '../wp-rocket/versions';
import { SIMULATION_DATA_PATH, rowListKeyText } from '../wp-rocket-simulation/simulation-data';
import { sha256Hex } from '../../utils/sha256';
import { webSha256Hex } from '../../utils/web-sha256';
import {
  createPackagedRuntimeSource,
  loadPackagedSimulationData,
  packagedVersion,
  type PackagedDataFetch
} from './packaged-simulation-data';

const DATA_URL = 'chrome-extension://id/wp-rocket-simulation/simulation-data.json';

const COMMITTED = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../public', SIMULATION_DATA_PATH),
  'utf8'
);

/** A text's content key (sync, for building fixtures). */
const textKey = sha256Hex;

/** A row list's content key (sync, for building fixtures). */
const listKey = (rows: readonly string[]): string => sha256Hex(rowListKeyText(rows));

const RUNTIME = 'RocketLazyLoadScripts.run();';
const FALLBACK = 'if(navigator.userAgent.match(/MSIE|Trident/i)){}';
const ROWS = ['lazyLoadOptions', 'wpr-beacon'];

/** A valid, really keyed data file for one version. */
function dataFile(version = '3.24'): Record<string, unknown> {
  return {
    format: 1,
    versions: {
      [version]: {
        runtime: { sha256: textKey(RUNTIME), version: '2.0.5' },
        ieFallback: { sha256: textKey(FALLBACK) },
        delayJsExclusions: { sha256: listKey(ROWS), count: ROWS.length },
        deferJsExternalExclusions: { sha256: listKey(ROWS), count: ROWS.length },
        deferJsInlineExclusions: { sha256: listKey(ROWS), count: ROWS.length },
        lazyload: {
          runtime: { sha256: 'f'.repeat(64), bytes: 10, jsPath: 'lazyload/1.0/lazyload.min.js' },
          noJsStyle: { sha256: textKey(FALLBACK) },
          optionsScript: { sha256: textKey(FALLBACK) },
          runtimeTag: {
            beforeUrl: { sha256: textKey(FALLBACK) },
            afterUrl: { sha256: textKey(FALLBACK) }
          },
          excludedAttributes: { sha256: listKey(ROWS), count: ROWS.length },
          excludedSrc: { sha256: listKey(ROWS), count: ROWS.length }
        }
      }
    },
    texts: { [textKey(RUNTIME)]: RUNTIME, [textKey(FALLBACK)]: FALLBACK },
    rowLists: { [listKey(ROWS)]: ROWS }
  };
}

/** A transport answering `text` with `status`, recording the URLs asked. */
function serving(text: string, status = 200, asked: string[] = []): PackagedDataFetch {
  return (url) => {
    asked.push(url);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(text)
    });
  };
}

/** A logger double. */
function logger() {
  return { error: vi.fn() };
}

describe('loadPackagedSimulationData', () => {
  it('reads, parses and verifies a sound file from the given URL', async () => {
    const asked: string[] = [];
    const load = await loadPackagedSimulationData(
      serving(JSON.stringify(dataFile()), 200, asked),
      DATA_URL,
      webSha256Hex
    );
    expect(asked).toEqual([DATA_URL]);
    expect(load.ok).toBe(true);
  });

  it('reads an unreachable file as asset-unreachable (rejection, HTTP error, body failure)', async () => {
    const failing: PackagedDataFetch[] = [
      () => Promise.reject(new TypeError('Failed to fetch')),
      serving('', 404),
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.reject(new TypeError('body stream failed'))
        })
    ];
    const details: string[] = [];
    for (const fetch of failing) {
      const load = await loadPackagedSimulationData(fetch, DATA_URL, webSha256Hex);
      expect(load).toMatchObject({ ok: false, cause: 'asset-unreachable' });
      if (!load.ok) details.push(load.detail);
    }
    expect(details).toEqual([
      'TypeError: Failed to fetch',
      'HTTP 404',
      'TypeError: body stream failed'
    ]);
  });

  it('reads a non-JSON or wrongly shaped file as asset-malformed, naming the problem', async () => {
    await expect(
      loadPackagedSimulationData(serving('{"format":1,'), DATA_URL, webSha256Hex)
    ).resolves.toEqual({
      ok: false,
      cause: 'asset-malformed',
      detail: 'not JSON'
    });
    await expect(
      loadPackagedSimulationData(
        serving(JSON.stringify({ ...dataFile(), format: 2 })),
        DATA_URL,
        webSha256Hex
      )
    ).resolves.toEqual({ ok: false, cause: 'asset-malformed', detail: 'format must be 1' });
  });

  it('reads a file whose content differs from its pins as hash-mismatch', async () => {
    const file = dataFile();
    const key = textKey(RUNTIME);
    file.texts = { ...(file.texts as object), [key]: `${RUNTIME} ` };
    await expect(
      loadPackagedSimulationData(serving(JSON.stringify(file)), DATA_URL, webSha256Hex)
    ).resolves.toEqual({
      ok: false,
      cause: 'hash-mismatch',
      detail: `texts.${key} does not hash to its key`
    });
  });

  it('reads a failing digest as asset-unreachable (unchecked data is never trusted)', async () => {
    const load = await loadPackagedSimulationData(
      serving(JSON.stringify(dataFile())),
      DATA_URL,
      () => Promise.reject(new Error('digest unavailable'))
    );
    expect(load).toEqual({
      ok: false,
      cause: 'asset-unreachable',
      detail: 'digest failed: Error: digest unavailable'
    });
  });

  it('verifies the committed file', async () => {
    await expect(
      loadPackagedSimulationData(serving(COMMITTED), DATA_URL, webSha256Hex)
    ).resolves.toMatchObject({
      ok: true
    });
  });
});

describe('packagedVersion', () => {
  it('serves every supported version from the committed file, texts and list by their pins', async () => {
    const load = await loadPackagedSimulationData(serving(COMMITTED), DATA_URL, webSha256Hex);
    if (!load.ok) throw new Error(load.detail);
    for (const { version } of SUPPORTED_WPR_VERSIONS) {
      const read = packagedVersion(load.data, version);
      if (!read.ok) throw new Error(`${version}: ${read.cause}`);
      const entry = load.data.versions[version];
      expect(textKey(read.package.runtime)).toBe(entry?.runtime.sha256);
      expect(textKey(read.package.fallback)).toBe(entry?.ieFallback.sha256);
      expect(listKey(read.package.bundledListRows)).toBe(entry?.delayJsExclusions.sha256);
    }
  });

  it('answers version-missing for a version the file does not hold (own keys only)', async () => {
    const load = await loadPackagedSimulationData(
      serving(JSON.stringify(dataFile())),
      DATA_URL,
      webSha256Hex
    );
    if (!load.ok) throw new Error(load.detail);
    expect(packagedVersion(load.data, '3.23.5.1')).toEqual({
      ok: false,
      cause: 'version-missing'
    });
    expect(packagedVersion(load.data, 'toString')).toEqual({
      ok: false,
      cause: 'version-missing'
    });
  });

  it('answers asset-malformed for data whose keys do not resolve (not read by the reader)', () => {
    const file = dataFile();
    const data = { ...file, texts: {} } as unknown as Parameters<typeof packagedVersion>[0];
    expect(packagedVersion(data, '3.24')).toEqual({ ok: false, cause: 'asset-malformed' });
  });
});

describe('createPackagedRuntimeSource', () => {
  it('reads the file once for concurrent and later documents', async () => {
    const asked: string[] = [];
    const runtime = createPackagedRuntimeSource({
      fetch: serving(JSON.stringify(dataFile()), 200, asked),
      url: DATA_URL,
      sha256: webSha256Hex,
      log: logger()
    });
    const reads = await Promise.all([runtime('3.24'), runtime('3.24')]);
    await runtime('3.24');
    expect(asked).toEqual([DATA_URL]);
    for (const read of reads) {
      expect(read).toEqual({
        ok: true,
        package: {
          runtime: RUNTIME,
          fallback: FALLBACK,
          bundledListRows: ROWS,
          bundledDeferLists: { external: ROWS, inline: ROWS },
          lazyload: {
            noJsStyle: FALLBACK,
            optionsScript: FALLBACK,
            runtimeTagBeforeUrl: FALLBACK,
            runtimeTagAfterUrl: FALLBACK,
            runtimeJsPath: 'lazyload/1.0/lazyload.min.js',
            excludedAttributes: ROWS,
            excludedSrc: ROWS,
            runtime: { sha256: 'f'.repeat(64), bytes: 10 }
          }
        }
      });
    }
  });

  it('keeps a damaged file’s answer for the lifetime, logged once', async () => {
    const asked: string[] = [];
    const log = logger();
    const runtime = createPackagedRuntimeSource({
      fetch: serving('not json', 200, asked),
      url: DATA_URL,
      sha256: webSha256Hex,
      log
    });
    await expect(runtime('3.24')).resolves.toEqual({ ok: false, cause: 'asset-malformed' });
    await expect(runtime('3.24')).resolves.toEqual({ ok: false, cause: 'asset-malformed' });
    expect(asked).toHaveLength(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('unusable'), {
      cause: 'asset-malformed',
      detail: 'not JSON'
    });
  });

  it('retries an unreachable file on the next document', async () => {
    const log = logger();
    let calls = 0;
    const fetch: PackagedDataFetch = (url) => {
      calls++;
      return calls === 1
        ? Promise.reject(new TypeError('Failed to fetch'))
        : serving(JSON.stringify(dataFile()))(url);
    };
    const runtime = createPackagedRuntimeSource({
      fetch,
      url: DATA_URL,
      sha256: webSha256Hex,
      log
    });
    await expect(runtime('3.24')).resolves.toEqual({ ok: false, cause: 'asset-unreachable' });
    await expect(runtime('3.24')).resolves.toMatchObject({ ok: true });
    await runtime('3.24');
    expect(calls).toBe(2);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('logs an unreachable file once per failure streak, never on each retrying document', async () => {
    const log = logger();
    let calls = 0;
    // Unreachable three ways (rejection, HTTP 404, rejection), then damaged.
    const fetch: PackagedDataFetch = (url) => {
      calls++;
      if (calls === 2) return serving('', 404)(url);
      if (calls <= 3) return Promise.reject(new TypeError('Failed to fetch'));
      return serving('not json')(url);
    };
    const runtime = createPackagedRuntimeSource({
      fetch,
      url: DATA_URL,
      sha256: webSha256Hex,
      log
    });
    for (let i = 0; i < 3; i++) {
      await expect(runtime('3.24')).resolves.toEqual({ ok: false, cause: 'asset-unreachable' });
    }
    expect(calls).toBe(3);
    expect(log.error).toHaveBeenCalledTimes(1);
    // Another cause ends the streak and is logged.
    await expect(runtime('3.24')).resolves.toEqual({ ok: false, cause: 'asset-malformed' });
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenLastCalledWith(expect.stringContaining('unusable'), {
      cause: 'asset-malformed',
      detail: 'not JSON'
    });
  });

  it('answers version-missing per document, logged once per version', async () => {
    const log = logger();
    const runtime = createPackagedRuntimeSource({
      fetch: serving(JSON.stringify(dataFile('3.24'))),
      url: DATA_URL,
      sha256: webSha256Hex,
      log
    });
    await expect(runtime('3.23.5.1')).resolves.toEqual({ ok: false, cause: 'version-missing' });
    await expect(runtime('3.23.5.1')).resolves.toEqual({ ok: false, cause: 'version-missing' });
    await expect(runtime('3.24')).resolves.toMatchObject({ ok: true });
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('no usable entry'), {
      version: '3.23.5.1',
      cause: 'version-missing'
    });
  });
});
