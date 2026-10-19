/**
 * The "Copy as exclusion" action's copy vocabulary: what the row control, its
 * toasts and its remedies say. The shared copy button renders the mechanism
 * (the guarded write, the pending guard, the flash, the toasts); this module
 * owns the words and the one configuration that aims them.
 *
 * A script that defines a name other code reads too early is the usual Delay
 * JS casualty, and excluding that script from Delay JS is the usual fix — so
 * the confirmation names the WP Rocket setting to paste into, not just
 * "copied", and a rejected write names the pattern to add by hand.
 */
import type { CopyButtonProps } from '../../../../components/ui/copy-button';
import { LABEL_DELAY_JAVASCRIPT_EXECUTION } from '../../../../lib/detection/labels';

/** The row control's visible action label (its rest wording above the tier). */
const VISIBLE_LABEL = 'Copy as exclusion';

/** The visible label's wording while the check flash shows. */
const FLASH_LABEL = 'Copied';

/** The row control's hover hint (its purpose, in full). */
const HOVER_TITLE = `Copy an exclusion for this script, to exclude it from ${LABEL_DELAY_JAVASCRIPT_EXECUTION}`;

/** The success toast's title. */
const COPIED_TITLE = 'Exclusion copied';

/**
 * Where the pattern goes (the success toast's description): WP Rocket's
 * own setting — the feature label from the verified label table, then the
 * field under it.
 */
export const COPIED_DESCRIPTION = `Paste it into WP Rocket's ${LABEL_DELAY_JAVASCRIPT_EXECUTION} → Excluded JavaScript Files.`;

/**
 * The failure remedy, naming the pattern so it can be typed in by hand.
 *
 * @param pattern The exclusion that could not be copied.
 * @returns The toast description.
 */
export function copyFailedRemedy(pattern: string): string {
  return `Add it by hand: ${pattern}`;
}

/** What one row's copy control is for: the pattern it copies and its full name. */
export interface ExclusionCopyInput {
  /** The exclusion pattern to copy (same-origin path, or host-joined). */
  readonly pattern: string;
  /** The control's full accessible name (`copyExclusionName`'s shape). */
  readonly name: string;
}

/**
 * The "Copy as exclusion" action configured onto the shared copy button shape:
 * exact pattern on the clipboard, in-place feedback at the row, the
 * setting-naming toast, and a hand-typing remedy when the write fails. The
 * clipboard seam and the placement class stay with the caller.
 *
 * @param input The row's pattern and name.
 * @returns The shared button's props.
 */
export function exclusionCopyProps(input: ExclusionCopyInput): CopyButtonProps {
  return {
    text: input.pattern,
    label: VISIBLE_LABEL,
    ariaLabel: input.name,
    title: HOVER_TITLE,
    showLabel: 'regular-up',
    copiedLabel: FLASH_LABEL,
    successTitle: COPIED_TITLE,
    successDescription: COPIED_DESCRIPTION,
    failureDescription: copyFailedRemedy(input.pattern)
  };
}
