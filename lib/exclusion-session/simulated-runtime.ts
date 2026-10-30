/**
 * Which packaged file answers a session tab's request for a simulated
 * runtime. A page simulated with LazyLoad carries WP Rocket's runtime tag,
 * whose URL a site without the feature answers with a 404; the backends
 * ask here for every request named like that runtime and answer it with
 * the packaged copy (never fetched from the site) only when:
 * - the tab's session is live and its latest recorded document simulated
 *   LazyLoad (the record is read behind the tab's document record, so a
 *   page's runtime request never races its own document's record),
 * - the requesting document (the tab's top-level one, as the browser
 *   reports it) is on the session's origin and is that recorded document
 *   — same origin + path: a page the session left unrecorded (another
 *   origin, or a load it never intercepted) never gets an answer, even
 *   when it names the same runtime URL; the query is not compared, so a
 *   page that rewrote its own query (`history.replaceState`) still gets
 *   it — and
 * - the request URL is that document's runtime URL, exactly (normalized as
 *   the browser serializes it) — any other URL goes to the site as made.
 *
 * The file is the version's packaged runtime as verified against its pin
 * (the same bytes a simulation was allowed to run with).
 */
import type { Logger } from '../logger';
import {
  SERVED_DOCUMENT_LIMITS,
  type ExclusionSessionStatus
} from '../messaging/exclusion-session';
import { parseUrl } from '../../utils/urls';
import type { PackagedRuntimeFile, SimulationSources } from './simulation-sources';

/** Why a runtime request is left to the site. */
export type SimulatedRuntimeMiss =
  /** No live session in the tab (never applied, stopped, unavailable). */
  | 'no-session'
  /** The tab's latest recorded document carries no simulated LazyLoad runtime. */
  | 'not-simulated'
  /** The requesting document is not on the session's origin. */
  | 'other-origin'
  /** The requesting document is not the recorded one (or the record names none). */
  | 'other-document'
  /** The request is not the latest document's runtime URL. */
  | 'other-url';

/** A runtime request matched against the tab's session: the version to answer for, or why not. */
export type SimulatedRuntimeMatch =
  | { readonly matched: true; readonly version: string }
  | { readonly matched: false; readonly miss: SimulatedRuntimeMiss };

/** The runtime request as the backend sees it. */
export interface SimulatedRuntimeRequest {
  /** The request's URL. */
  readonly url: string;
  /** The URL of the tab's top-level document making the request. */
  readonly documentUrl: string;
}

/**
 * The URL as the browser serializes it, or null when it does not parse.
 *
 * @param url An absolute URL.
 */
function serialized(url: string): string | null {
  return parseUrl(url)?.href ?? null;
}

/**
 * Where the requesting document stands against the session's recorded one.
 *
 * @param documentUrl The requesting document's URL.
 * @param origin The session's origin.
 * @param recordedPath The recorded document's origin + path (cut as stored), or undefined.
 * @returns The miss, or null when it is the recorded document.
 */
function documentMiss(
  documentUrl: string,
  origin: string,
  recordedPath: string | undefined
): SimulatedRuntimeMiss | null {
  const parsed = parseUrl(documentUrl);
  if (parsed?.origin !== origin) return 'other-origin';
  if (recordedPath === undefined) return 'other-document';
  const path = `${parsed.origin}${parsed.pathname}`.slice(0, SERVED_DOCUMENT_LIMITS.urlPathChars);
  return path === recordedPath ? null : 'other-document';
}

/**
 * Match a runtime request against the tab's session (pure).
 *
 * @param status The tab's session status, read behind its document record.
 * @param request The request's URL and its top-level document's URL.
 * @returns The WP Rocket version whose runtime answers it, or the miss.
 */
export function matchSimulatedRuntime(
  status: ExclusionSessionStatus,
  request: SimulatedRuntimeRequest
): SimulatedRuntimeMatch {
  if (status.state !== 'active') return { matched: false, miss: 'no-session' };
  const document = status.document;
  const report = document?.outcome === 'rewritten' ? document.lazyloadSimulation : undefined;
  if (report?.state !== 'simulated' || report.runtimeUrl === undefined) {
    return { matched: false, miss: 'not-simulated' };
  }
  const miss = documentMiss(request.documentUrl, status.origin, document?.served?.urlPath);
  if (miss !== null) return { matched: false, miss };
  const expected = serialized(report.runtimeUrl);
  return expected !== null && expected === serialized(request.url)
    ? { matched: true, version: report.wpRocketVersion }
    : { matched: false, miss: 'other-url' };
}

/**
 * The packaged file answering a runtime request, or null (the request goes
 * to the site). A matched request whose packaged runtime is unusable is
 * logged by name: the page then runs without it, as on a site whose
 * runtime file is missing. Never rejects.
 *
 * @param status The tab's session status, read behind its document record.
 * @param request The request's URL and its top-level document's URL.
 * @param sources The packaged data and runtime sources (deadlined by the caller).
 * @param log Where an unusable runtime is reported.
 */
export async function resolveSimulatedRuntime(
  status: ExclusionSessionStatus,
  request: SimulatedRuntimeRequest,
  sources: Pick<SimulationSources, 'runtime' | 'lazyloadRuntime'>,
  log: Pick<Logger, 'warn'>
): Promise<PackagedRuntimeFile | null> {
  const match = matchSimulatedRuntime(status, request);
  if (!match.matched) return null;
  const read = await sources.runtime(match.version);
  if (!read.ok) {
    log.warn('Simulated LazyLoad runtime not delivered — packaged data unusable', {
      version: match.version,
      cause: read.cause
    });
    return null;
  }
  const check = await sources.lazyloadRuntime(read.package.lazyload);
  if (!check.ok) {
    log.warn('Simulated LazyLoad runtime not delivered — packaged runtime unusable', {
      version: match.version,
      cause: check.cause
    });
    return null;
  }
  return check.file;
}
