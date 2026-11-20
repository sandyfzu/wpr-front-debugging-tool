/**
 * "Open in Sources": DevTools' `devtools.panels.openResource`, feature-detected
 * on the namespace the caller passes (production: the auto-imported `browser`;
 * tests: doubles). Firefox's DevTools API has no such call, so there the
 * capability is null and callers fall back to a new tab — no browser sniffing.
 *
 * The **callback** form is used: the Promise form only exists from Chrome 152,
 * below the supported floor. DevTools reports a failure (unknown URL, denied
 * resource) as the callback's argument — a status record with `isError` —
 * not through `runtime.lastError`; both are read so neither can slip by.
 *
 * URLs are never logged: page URLs can carry tokens in their query.
 */
import { toast } from '../../../components/ui/toast-store';
import { createLogger } from '../../../lib/logger';
import { capText } from '../../../utils/cap-text';
import { readLastError } from '../../../utils/last-error';

const log = createLogger('panel');

/**
 * Open one absolute URL in DevTools' Sources panel (its fragment dropped, see
 * {@link sourcesTarget}); rejects with an {@link OpenResourceError}.
 */
export type OpenResource = (url: string) => Promise<void>;

/** Why an open failed: the runtime error slot, DevTools' status record, or a throw. */
export type OpenResourceFailure = 'last-error' | 'devtools-status' | 'threw';

/**
 * A failed open, carrying only URL-free diagnostics (so it is safe to log).
 */
export class OpenResourceError extends Error {
  /**
   * @param failure Which channel reported the failure.
   * @param detail URL-free context: DevTools' status code + description, the
   *   redacted runtime message, or the thrown error's name.
   */
  constructor(
    readonly failure: OpenResourceFailure,
    readonly detail: string
  ) {
    super(`Open in Sources failed (${failure}): ${detail}`);
    this.name = 'OpenResourceError';
  }
}

/** The toast title for a failed open (S-3: what failed, then the remedy). */
export const OPEN_IN_SOURCES_FAILED = "Couldn't open in Sources";

/** The toast's remedy line: the companion new-tab control is always beside the tile. */
export const OPEN_IN_SOURCES_REMEDY = 'Open it in a new tab instead.';

/** Longest detail kept from a DevTools/runtime message (bounded log lines). */
const DETAIL_MAX = 200;

/** The callback-form signature this module calls (`url`, 0-based line, callback). */
type OpenResourceFn = (
  url: string,
  lineNumber: number,
  callback: (response?: unknown) => void
) => void;

/**
 * Read one property of an untrusted value without assuming its shape.
 *
 * @param value Anything.
 * @param key The property to read.
 * @returns The property's value, or undefined when `value` is not an object.
 */
function prop(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Replace every occurrence of the given URLs in a message, so a platform
 * error that echoes one stays loggable. Longer URLs go first: the opened
 * target is a prefix of the caller's URL, and replacing it first would leave
 * the caller's fragment behind.
 *
 * @param message The raw message.
 * @param urls The URLs involved in the open (empty strings are ignored).
 * @returns The bounded message with each URL replaced by `<url>`.
 */
export function redactUrl(message: string, ...urls: readonly string[]): string {
  const redacted = [...urls]
    .filter((url) => url !== '')
    .sort((a, b) => b.length - a.length)
    .reduce((text, url) => text.split(url).join('<url>'), message);
  return capText(redacted, DETAIL_MAX);
}

/**
 * The URL DevTools is asked to open: the input without its `#fragment`.
 * DevTools matches the inspected page's resources by exact URL, and
 * resource/request URLs never carry a fragment, so a URL with one (even a
 * bare `#`) would be "not found". The query is kept — it is part of the
 * resource's identity. In a serialized URL the first `#` always starts the
 * fragment (path and query percent-encode it).
 *
 * @param url An absolute URL (the tile passes the parsed `href`).
 * @returns The URL up to its first `#`, or unchanged when it has none.
 */
export function sourcesTarget(url: string): string {
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}

/**
 * Turn DevTools' callback argument into a failure detail. Success arrives as
 * `undefined` or `{ code: 'OK' }`; a failure as `{ isError: true, code,
 * description }` whose `details` carry the URL (never read here).
 *
 * @param response The callback's argument.
 * @returns The URL-free detail of a failure, or null on success.
 */
export function devtoolsStatusFailure(response: unknown): string | null {
  if (prop(response, 'isError') !== true) return null;
  const code = prop(response, 'code');
  const description = prop(response, 'description');
  const parts = [code, description].filter((part): part is string => typeof part === 'string');
  return parts.length > 0 ? capText(parts.join(' '), DETAIL_MAX) : 'unspecified DevTools error';
}

/**
 * Feature-detect "Open in Sources" on an extension namespace.
 *
 * @param api The namespace (production: the auto-imported `browser`; tests: a
 *   double). Never read from `globalThis`.
 * @returns The opener, or null when the namespace has no
 *   `devtools.panels.openResource` (Firefox, or not a DevTools window).
 */
export function openResourceCapability(api: unknown): OpenResource | null {
  const panels = prop(prop(api, 'devtools'), 'panels');
  const openResource = prop(panels, 'openResource');
  if (typeof openResource !== 'function') return null;
  const call = openResource as OpenResourceFn;
  const runtime = prop(api, 'runtime');
  return (url) =>
    new Promise<void>((resolve, reject) => {
      const target = sourcesTarget(url);
      try {
        // Line 0 = the first line (DevTools locations are 0-based).
        call.call(panels, target, 0, (response) => {
          // Read (and so acknowledge) the slot first, even when the status
          // record already reports the failure.
          const lastError =
            typeof runtime === 'object' && runtime !== null ? readLastError(runtime) : null;
          const status = devtoolsStatusFailure(response);
          if (lastError !== null)
            reject(new OpenResourceError('last-error', redactUrl(lastError, url, target)));
          else if (status !== null) reject(new OpenResourceError('devtools-status', status));
          else resolve();
        });
      } catch (cause) {
        // A synchronous throw (e.g. the extension context was invalidated):
        // only the error's name — its message may quote the URL.
        reject(new OpenResourceError('threw', cause instanceof Error ? cause.name : typeof cause));
      }
    });
}

/**
 * Open a URL in Sources for a click: a failure is logged (URL-free) and
 * toasted with its remedy, never thrown at the caller.
 *
 * @param open The detected opener ({@link openResourceCapability}).
 * @param url The absolute http(s) URL to open.
 * @returns True once DevTools accepted the open, false when it failed.
 */
export async function openInSources(open: OpenResource, url: string): Promise<boolean> {
  try {
    await open(url);
    return true;
  } catch (cause) {
    log.warn(
      'Open in Sources failed',
      cause instanceof OpenResourceError
        ? { failure: cause.failure, detail: cause.detail }
        : { failure: 'unexpected', name: cause instanceof Error ? cause.name : typeof cause }
    );
    toast.error(OPEN_IN_SOURCES_FAILED, { description: OPEN_IN_SOURCES_REMEDY });
    return false;
  }
}
