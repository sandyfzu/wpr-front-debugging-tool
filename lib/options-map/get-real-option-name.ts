/**
 * Human-readable rendering of WP Rocket option ids.
 *
 * The two JSON maps are verbatim plugin vocabulary (39 internal-option names
 * + 5 diagnoser labels); `getRealOptionName` is the single accessor. The data
 * lives as JSON next to this file — imported statically (small, always
 * needed) so typings flow through the bundler instead of `JSON?raw` parsing.
 */

import optionNames from './option-names.json';
import otherNames from './other-names.json';

/** Internal option id → user-facing label. */
const OPTION_NAMES: ReadonlyMap<string, string> = new Map<string, string>([
  ...Object.entries<string>(optionNames),
  ...Object.entries<string>(otherNames)
]);

/**
 * Label for an option id, or the id itself when unmapped (the diagnoser can
 * surface option ids this file does not know yet — showing the raw id is the
 * honest fallback and beats a collected crash).
 */
export function getRealOptionName(option: string): string {
  return OPTION_NAMES.get(option) ?? option;
}

/**
 * The known option ids, for registries that need to enumerate rows (never a
 * proxy for validation — unknown ids fall back above by design).
 */
export function knownOptionIds(): string[] {
  return [...OPTION_NAMES.keys()];
}
