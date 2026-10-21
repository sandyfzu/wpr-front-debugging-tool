/**
 * The interception-backend registry, in preference order: the background
 * selects the first row whose feature detection passes. One row per
 * browser mechanism (Chromium's debugger-protocol row, Firefox's
 * streaming-filter row); with no row — or none supported —
 * every apply answers `unsupported-browser` and the build stays honest.
 */
import type { InterceptionBackendRow } from '../../lib/exclusion-session/backend';
import { CHROMIUM_INTERCEPTION_ROW } from './chromium-interception';
import { STREAM_FILTER_BACKEND } from './stream-filter-backend';

/**
 * The registry. Each row exists only in its browser's build (a build-time
 * constant, so neither background bundle carries the other's code): the
 * debugger-protocol row outside Firefox, the streaming-filter row in
 * Firefox; each row's feature detection still decides at run time.
 */
export const INTERCEPTION_BACKENDS: readonly InterceptionBackendRow[] =
  import.meta.env.BROWSER === 'firefox' ? [STREAM_FILTER_BACKEND] : [CHROMIUM_INTERCEPTION_ROW];
