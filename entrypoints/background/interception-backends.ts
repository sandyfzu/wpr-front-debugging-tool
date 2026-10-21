/**
 * The interception-backend registry, in preference order: the background
 * selects the first row whose feature detection passes. One row per
 * browser mechanism (a Chromium debugger-protocol row and a Firefox
 * streaming-filter row are planned); with no row — or none supported —
 * every apply answers `unsupported-browser` and the build stays honest.
 */
import type { InterceptionBackendRow } from '../../lib/exclusion-session/backend';
import { STREAM_FILTER_BACKEND } from './stream-filter-backend';

/**
 * The registry. The streaming-filter row exists only in the Firefox build
 * (a build-time constant, so the Chromium service worker carries none of
 * its code); its feature detection still decides at run time.
 */
export const INTERCEPTION_BACKENDS: readonly InterceptionBackendRow[] = [
  ...(import.meta.env.BROWSER === 'firefox' ? [STREAM_FILTER_BACKEND] : [])
];
