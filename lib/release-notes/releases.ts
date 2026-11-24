/**
 * The release index: one row per extension version (the manifest /
 * `package.json` version — never a separate page version), newest first,
 * saying only whether updating to it opens the What's new page. Its copy
 * lives in `./notes`, keyed by these versions (the type makes a missing or
 * stray copy row a compile error), so the background — which only decides —
 * never bundles the page's words.
 *
 * Every version bump adds its row (the registry test requires one for the
 * `package.json` version); `announce` only for majors and notable minors,
 * never routine patches.
 */

/** One release's index row. */
export interface ReleaseEntry {
  /** The extension version. */
  readonly version: string;
  /** Whether updating to this version opens the page. */
  readonly announce: boolean;
  /** Release day (`YYYY-MM-DD`), set when the version ships. */
  readonly date?: string;
}

/** Every release, newest first. */
export const RELEASES = [
  { version: '3.0.0', announce: true }
] as const satisfies readonly ReleaseEntry[];

/**
 * The newest version that never wrote the What's new marker (the store's
 * last build before the page existed). An update arriving with no marker
 * means the user never ran a marker-writing build, whatever
 * `previousVersion` says: Chromium records `previousVersion` as the version
 * installed at each update, disabled ones included, so a second update while
 * the browser kept the first one disabled reports a version that never ran.
 */
export const LAST_UNMARKED_VERSION = '2.2.5';

/** A version the index lists (the copy table's key). */
export type ReleaseVersion = (typeof RELEASES)[number]['version'];
