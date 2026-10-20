/**
 * The interception-backend registry, in preference order: the background
 * selects the first row whose feature detection passes. One row per
 * browser mechanism (a Chromium debugger-protocol row and a Firefox
 * streaming-filter row are planned); with no row — or none supported —
 * every apply answers `unsupported-browser` and the build stays honest.
 */
import type { InterceptionBackendRow } from '../../lib/exclusion-session/backend';

/** The registry (empty until a backend lands). */
export const INTERCEPTION_BACKENDS: readonly InterceptionBackendRow[] = [];
