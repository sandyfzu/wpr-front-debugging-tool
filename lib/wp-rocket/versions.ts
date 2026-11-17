/**
 * The WP Rocket versions the extension reproduces — the one declaring site
 * of that list, shared by the simulation (which version's passes, runtime
 * and lists a document gets) and the parity dev script (which plugin zips
 * it runs every case under).
 *
 * Owner-pinned: a row is added, replaced or dropped by hand in a reviewed
 * change, never derived from GitHub's release flags (a release may be
 * stable while still flagged pre-release). Today: the latest stable release
 * and the latest patch of the previous minor — a superseded patch of the
 * latest minor is dropped, so its pages simulate the latest stable (the UI
 * names both the site's and the simulated version). Each row's `version` is also
 * its key in the simulation data file (`versions`), so the two cannot
 * disagree silently: the parity script re-derives that file from these rows.
 *
 * A leaf module (no imports): the dev script loads it under Node's native
 * TypeScript.
 */

/** Why a version is supported. */
export type WprVersionRole = 'latest-stable' | 'previous-minor';

/**
 * The delimiter WP Rocket's Defer JS passes to `preg_quote` for each row of
 * its inline-exclusion list before joining them into the `/…/msi` pattern
 * it matches inline scripts with. `#` leaves a `/` in a row unescaped, so
 * such a row makes the whole pattern fail to compile (no inline script is
 * excluded by the list); `/` escapes it. `#` itself is escaped by
 * `preg_quote` either way.
 */
export type DeferInlineQuoteDelimiter = '#' | '/';

/**
 * How WP Rocket's Delay JS writes the `<meta charset>` it moves to the top of
 * `<head>` (or `<html>`, or before the first tag) into its `preg_replace`
 * replacement. `replacement`: interpolated as is, so a `$1`, `\1`, `\\` or
 * `\$` inside the tag is read as replacement syntax (a reference to a
 * missing group writes nothing) and the moved tag can differ from the one
 * removed; `literal`: escaped first (`addcslashes($tag, '\\$')`), so it is
 * copied byte for byte.
 */
export type MetaCharsetMoveText = 'replacement' | 'literal';

/**
 * Where a version's passes really differ from another supported version's.
 * Only differences verified against both plugin zips get a field; every
 * other pass is shared.
 */
export interface WprRuleVariants {
  /** See {@link DeferInlineQuoteDelimiter}. */
  readonly deferInlineQuoteDelimiter: DeferInlineQuoteDelimiter;
  /** See {@link MetaCharsetMoveText}. */
  readonly metaCharsetMoveText: MetaCharsetMoveText;
}

/** One supported WP Rocket version. */
export interface SupportedWprVersion {
  /** The plugin's `Version:` header (`3.24.1`); also its simulation data file key. */
  readonly version: string;
  /**
   * sha256 of the pinned plugin zip the parity script derives from: release
   * builds are not byte-reproducible, so this exact file is the reference.
   */
  readonly zipSha256: string;
  readonly role: WprVersionRole;
  readonly variants: WprRuleVariants;
}

/** The supported versions, newest first; exactly one row is `latest-stable`. */
export const SUPPORTED_WPR_VERSIONS: readonly SupportedWprVersion[] = [
  {
    version: '3.24.1',
    zipSha256: '83dd6a00dabffb2609a33028e28b93491232403d3908f0186d2be49e7afca4d9',
    role: 'latest-stable',
    variants: { deferInlineQuoteDelimiter: '/', metaCharsetMoveText: 'literal' }
  },
  {
    version: '3.23.5.1',
    zipSha256: 'e42f4b1ac3bfb32690dc616a36f35cb579262931ab9758e942bbd0aefe870e31',
    role: 'previous-minor',
    variants: { deferInlineQuoteDelimiter: '#', metaCharsetMoveText: 'replacement' }
  }
];

/**
 * The supported version with this exact version string.
 *
 * @param version A version string (`3.24.1`); `3.24.1.0` is not `3.24.1`.
 * @param rows The registry (default {@link SUPPORTED_WPR_VERSIONS}).
 * @returns The row, or `undefined` when the version is not supported.
 */
export function supportedWprVersion(
  version: string,
  rows: readonly SupportedWprVersion[] = SUPPORTED_WPR_VERSIONS
): SupportedWprVersion | undefined {
  return rows.find((row) => row.version === version);
}

/**
 * The `latest-stable` row: the version simulated when a page names none of
 * the supported ones, and the parity tables' reference version.
 *
 * @param rows The registry (default {@link SUPPORTED_WPR_VERSIONS}).
 * @throws {@link Error} when the registry does not hold exactly one such row.
 */
export function latestStableWprVersion(
  rows: readonly SupportedWprVersion[] = SUPPORTED_WPR_VERSIONS
): SupportedWprVersion {
  const latest = rows.filter((row) => row.role === 'latest-stable');
  const [row] = latest;
  if (row === undefined || latest.length > 1) {
    throw new Error(
      `the supported WP Rocket versions must hold exactly one latest-stable row, found ${String(latest.length)}`
    );
  }
  return row;
}
