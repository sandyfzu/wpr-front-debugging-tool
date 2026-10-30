/**
 * The packaged simulation data as the hosts' runtime source: the data file
 * shipped inside the extension is read once per background lifetime,
 * checked strictly (format, then every entry's sha256 against its key) and
 * kept in memory; each document then gets its WP Rocket version's runtime,
 * IE fallback and bundled exclusion list from it. The runtime is only ever
 * this packaged text — never fetched from a site or a server.
 *
 * A damaged package (malformed, a hash differing from its pin) stays
 * damaged for the lifetime, so that answer is kept; an unreachable read
 * (a transient fetch or digest failure) is retried by the next document.
 */
import type { Logger } from '../logger';
import { ownValue } from '../../utils/is-record';
import {
  readSimulationData,
  simulationDataHashProblem,
  type SimulationData,
  type TextSha256,
  type SimulationVersionData
} from '../wp-rocket-simulation/simulation-data';
import type { SimulationRuntimeUnavailableCause } from '../wp-rocket-simulation/spec';
import type {
  LazyloadRuntimeCheck,
  SimulationLazyloadPackage,
  SimulationPackageRead,
  SimulationSources
} from './simulation-sources';

/** Why the whole data file is unusable (a version's absence is decided per document). */
export type PackagedDataFailure = Exclude<SimulationRuntimeUnavailableCause, 'version-missing'>;

/** One read of the data file: the verified data, or why it is unusable (with a log detail). */
export type PackagedDataLoad =
  | { readonly ok: true; readonly data: SimulationData }
  | { readonly ok: false; readonly cause: PackagedDataFailure; readonly detail: string };

/** The transport: a `fetch`-shaped call on the packaged file's extension URL. */
export type PackagedDataFetch = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

/** What the runtime source needs. */
export interface PackagedSimulationDataDeps {
  /** Reads the packaged file (the background binds the platform `fetch`). */
  readonly fetch: PackagedDataFetch;
  /** The data file's extension URL (`runtime.getURL`). */
  readonly url: string;
  /** The digest the pins are checked with (the background binds Web Crypto). */
  readonly sha256: TextSha256;
  /** Where an unusable file or a missing version is reported (never the data). */
  readonly log: Pick<Logger, 'error'>;
}

/**
 * Read, parse and verify the data file once. Never rejects: every failure
 * is a cause.
 *
 * @param fetch The transport.
 * @param url The file's extension URL.
 * @param sha256 The digest the pins are checked with.
 */
export async function loadPackagedSimulationData(
  fetch: PackagedDataFetch,
  url: string,
  sha256: TextSha256
): Promise<PackagedDataLoad> {
  let text: string;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, cause: 'asset-unreachable', detail: `HTTP ${String(response.status)}` };
    }
    text = await response.text();
  } catch (cause) {
    return { ok: false, cause: 'asset-unreachable', detail: String(cause) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, cause: 'asset-malformed', detail: 'not JSON' };
  }
  const read = readSimulationData(parsed);
  if (!read.ok) return { ok: false, cause: 'asset-malformed', detail: read.problem };
  let mismatch: string | null;
  try {
    mismatch = await simulationDataHashProblem(read.data, sha256);
  } catch (cause) {
    // The pins cannot be checked now: never trust unchecked data, and let
    // the next document retry (the file itself may be sound).
    return { ok: false, cause: 'asset-unreachable', detail: `digest failed: ${String(cause)}` };
  }
  if (mismatch !== null) return { ok: false, cause: 'hash-mismatch', detail: mismatch };
  return { ok: true, data: read.data };
}

/**
 * One WP Rocket version's package from verified data.
 *
 * @param data Data that passed {@link loadPackagedSimulationData}.
 * @param version The selected WP Rocket version.
 * @returns The package, or `version-missing` when the file has no entry for it.
 */
export function packagedVersion(data: SimulationData, version: string): SimulationPackageRead {
  const entry = ownValue(data.versions, version) as SimulationVersionData | undefined;
  if (entry === undefined) return { ok: false, cause: 'version-missing' };
  const runtime = ownValue(data.texts, entry.runtime.sha256) as string | undefined;
  const fallback = ownValue(data.texts, entry.ieFallback.sha256) as string | undefined;
  const rows = ownValue(data.rowLists, entry.delayJsExclusions.sha256) as
    readonly string[] | undefined;
  const external = ownValue(data.rowLists, entry.deferJsExternalExclusions.sha256) as
    readonly string[] | undefined;
  const inline = ownValue(data.rowLists, entry.deferJsInlineExclusions.sha256) as
    readonly string[] | undefined;
  const lazyload = lazyloadPackage(data, entry);
  // The reader resolved every key already; a miss here means the data was not read by it.
  if (
    runtime === undefined ||
    fallback === undefined ||
    rows === undefined ||
    external === undefined ||
    inline === undefined ||
    lazyload === null
  ) {
    return { ok: false, cause: 'asset-malformed' };
  }
  return {
    ok: true,
    package: {
      runtime,
      fallback,
      bundledListRows: rows,
      bundledDeferLists: { external, inline },
      lazyload
    }
  };
}

/**
 * A version entry's LazyLoad package from verified data.
 *
 * @param data Verified data.
 * @param entry The version's entry.
 * @returns The package, or null when a key does not resolve (data not read by the reader).
 */
function lazyloadPackage(
  data: SimulationData,
  entry: SimulationVersionData
): SimulationLazyloadPackage | null {
  const entryOf = entry.lazyload;
  const text = (sha256: string): string | undefined =>
    ownValue(data.texts, sha256) as string | undefined;
  const list = (sha256: string): readonly string[] | undefined =>
    ownValue(data.rowLists, sha256) as readonly string[] | undefined;
  const parts = {
    noJsStyle: text(entryOf.noJsStyle.sha256),
    optionsScript: text(entryOf.optionsScript.sha256),
    runtimeTagBeforeUrl: text(entryOf.runtimeTag.beforeUrl.sha256),
    runtimeTagAfterUrl: text(entryOf.runtimeTag.afterUrl.sha256),
    excludedAttributes: list(entryOf.excludedAttributes.sha256),
    excludedSrc: list(entryOf.excludedSrc.sha256)
  };
  if (Object.values(parts).some((value) => value === undefined)) return null;
  return {
    ...(parts as { [Key in keyof typeof parts]: NonNullable<(typeof parts)[Key]> }),
    runtimeJsPath: entryOf.runtime.jsPath,
    runtime: { sha256: entryOf.runtime.sha256, bytes: entryOf.runtime.bytes }
  };
}

/** The transport for the packaged LazyLoad runtime: its bytes at an extension URL. */
export type PackagedBytesFetch = (
  url: string
) => Promise<Pick<Response, 'ok' | 'status' | 'arrayBuffer'>>;

/** A sha256 of bytes, lowercase hex (the caller's platform digest). */
export type BytesSha256 = (bytes: ArrayBuffer) => Promise<string>;

/** What the LazyLoad runtime check needs. */
export interface PackagedLazyloadRuntimeDeps {
  /** Reads a packaged file's bytes (the background binds the platform `fetch`). */
  readonly fetch: PackagedBytesFetch;
  /**
   * The data file's extension URL: runtime paths resolve against it (the
   * runtime ships beside it, under its folder).
   */
  readonly dataUrl: string;
  /** The digest the pin is checked with. */
  readonly sha256: BytesSha256;
  /** Where an unusable runtime is reported. */
  readonly log: Pick<Logger, 'error'>;
}

/**
 * Check one packaged LazyLoad runtime file against its pin. Never rejects.
 *
 * @param deps Transport, data URL and digest.
 * @param lazyload The version's LazyLoad package (path and pin).
 * @returns Sound, or the cause and a log detail.
 */
export async function checkPackagedLazyloadRuntime(
  deps: Pick<PackagedLazyloadRuntimeDeps, 'fetch' | 'dataUrl' | 'sha256'>,
  lazyload: Pick<SimulationLazyloadPackage, 'runtimeJsPath' | 'runtime'>
): Promise<LazyloadRuntimeCheck & { readonly detail?: string }> {
  let bytes: ArrayBuffer;
  try {
    const response = await deps.fetch(new URL(lazyload.runtimeJsPath, deps.dataUrl).href);
    if (!response.ok) {
      return { ok: false, cause: 'asset-unreachable', detail: `HTTP ${String(response.status)}` };
    }
    bytes = await response.arrayBuffer();
  } catch (cause) {
    return { ok: false, cause: 'asset-unreachable', detail: String(cause) };
  }
  let digest: string;
  try {
    digest = await deps.sha256(bytes);
  } catch (cause) {
    return { ok: false, cause: 'asset-unreachable', detail: `digest failed: ${String(cause)}` };
  }
  if (bytes.byteLength !== lazyload.runtime.bytes || digest !== lazyload.runtime.sha256) {
    return {
      ok: false,
      cause: 'hash-mismatch',
      detail: `${lazyload.runtimeJsPath}: ${String(bytes.byteLength)} B, sha256 ${digest}`
    };
  }
  return { ok: true };
}

/**
 * The LazyLoad runtime source over the packaged files: each runtime path
 * is checked once per lifetime (concurrent asks share the check); a sound
 * or damaged answer is kept, an unreachable one retried by the next
 * document. Never rejects; each failure logged once per path and cause.
 *
 * @param deps Transport, data URL, digest and logger.
 */
export function createPackagedLazyloadRuntimeSource(
  deps: PackagedLazyloadRuntimeDeps
): SimulationSources['lazyloadRuntime'] {
  const checks = new Map<string, Promise<LazyloadRuntimeCheck>>();
  const logged = new Set<string>();
  return (lazyload) => {
    const key = `${lazyload.runtimeJsPath} ${lazyload.runtime.sha256}`;
    const known = checks.get(key);
    if (known !== undefined) return known;
    const check = checkPackagedLazyloadRuntime(deps, lazyload).then((result) => {
      if (result.ok) return { ok: true } as const;
      if (!logged.has(`${key} ${result.cause}`)) {
        logged.add(`${key} ${result.cause}`);
        deps.log.error(
          'Packaged LazyLoad runtime unusable — LazyLoad not simulated (the other features still are)',
          {
            path: lazyload.runtimeJsPath,
            cause: result.cause,
            detail: result.detail
          }
        );
      }
      if (result.cause === 'asset-unreachable') checks.delete(key);
      return { ok: false, cause: result.cause } as const;
    });
    checks.set(key, check);
    return check;
  };
}

/**
 * The runtime source over the packaged data file: the first call reads it
 * (concurrent calls share that read), later calls answer from memory.
 * Never rejects. A damaged file is logged once (its answer is kept); an
 * unreachable one once per failure streak (the first failure after a
 * success, or at start — every document retries it); each missing version
 * once per lifetime.
 *
 * @param deps Transport, URL, the digest the pins are checked with, and logger.
 */
export function createPackagedRuntimeSource(
  deps: PackagedSimulationDataDeps
): SimulationSources['runtime'] {
  let loading: Promise<PackagedDataLoad> | undefined;
  const missing = new Set<string>();
  // Whether the last read was unreachable (its retries then log nothing).
  let unreachableStreak = false;

  /** Start (or share) the read; a transient failure is forgotten so the next call retries. */
  const load = (): Promise<PackagedDataLoad> => {
    loading ??= loadPackagedSimulationData(deps.fetch, deps.url, deps.sha256).then((result) => {
      const unreachable = !result.ok && result.cause === 'asset-unreachable';
      if (!result.ok && !(unreachable && unreachableStreak)) {
        deps.log.error('Packaged simulation data unusable — simulations unavailable', {
          cause: result.cause,
          detail: result.detail
        });
      }
      unreachableStreak = unreachable;
      if (unreachable) loading = undefined;
      return result;
    });
    return loading;
  };

  return async (version) => {
    const result = await load();
    if (!result.ok) return { ok: false, cause: result.cause };
    const read = packagedVersion(result.data, version);
    if (!read.ok && !missing.has(version)) {
      missing.add(version);
      deps.log.error('Packaged simulation data has no usable entry for a WP Rocket version', {
        version,
        cause: read.cause
      });
    }
    return read;
  };
}
