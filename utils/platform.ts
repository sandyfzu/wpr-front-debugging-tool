/**
 * The navigator's platform string, read one way everywhere a surface branches
 * an accommodation on it (never a capability — those are feature-detected).
 */

/** The navigator facts the platform reads take (tests pass doubles). */
export interface PlatformFacts {
  /** `navigator.platform` (deprecated, still the one value every engine fills). */
  readonly platform?: string;
  /** `navigator.userAgentData.platform` where the engine exposes it (`macOS`). */
  readonly userAgentData?: { readonly platform?: string };
}

/**
 * The platform name: the client-hints value, else (missing or empty) the
 * deprecated `navigator.platform`, else `''`.
 *
 * @param facts The navigator (or a test double).
 * @returns The platform name (`macOS`, `MacIntel`, `Win32`, …) or `''`.
 */
export function platformName(facts: PlatformFacts): string {
  const hinted = facts.userAgentData?.platform;
  if (hinted !== undefined && hinted !== '') return hinted;
  return facts.platform ?? '';
}

/**
 * Whether the platform is macOS (`macOS` client hint or a `Mac…` platform —
 * iPadOS also reports `MacIntel`), where Cmd stands in for Ctrl.
 *
 * @param facts The navigator (or a test double).
 */
export function isMacPlatform(facts: PlatformFacts): boolean {
  return /^mac/i.test(platformName(facts));
}
