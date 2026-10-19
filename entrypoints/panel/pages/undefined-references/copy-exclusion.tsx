/**
 * The "Copy as exclusion" action's copy vocabulary: what the row control, its
 * toasts and its remedies say. The shared copy button renders the mechanism
 * (the guarded write, the pending guard, the flash, the toasts); this module
 * owns the words and aims them, through one component every row renders.
 *
 * A script that defines a name other code reads too early is the usual Delay
 * JS casualty, and excluding that script from Delay JS is the usual fix — so
 * the confirmation names the WP Rocket setting to paste into, not just
 * "copied", and a rejected write names the pattern to add by hand.
 */
import type { JSX } from 'solid-js';
import type { ClipboardLike } from '../../../../components/ui/copy-button';
import { CopyButton } from '../../../../components/ui/copy-button';
import { LABEL_DELAY_JAVASCRIPT_EXECUTION } from '../../../../lib/detection/labels';

/** The row control's visible action label (its rest wording above the tier). */
const VISIBLE_LABEL = 'Copy as exclusion';

/** The visible label's wording while the check flash shows. */
const FLASH_LABEL = 'Copied';

/** The row control's hover hint (its purpose, in full). */
const HOVER_TITLE = `Copy an exclusion for this script, to exclude it from ${LABEL_DELAY_JAVASCRIPT_EXECUTION}`;

/**
 * The row control's hover hint while the original-host resolution runs;
 * activation is suppressed until the copy payload settles.
 */
const PENDING_TITLE = 'Resolving the script\u2019s original path\u2026';

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

/**
 * Why a row has no copy control: the script ships inside WP Rocket's
 * combined JS bundle (the bundle filename is an md5 digest — no original
 * path to copy), so per-file Delay exclusion is not available, and the
 * words give the working remedy instead.
 */
export const COMBINED_EXCLUSION_NOTE =
  "This script ships inside WP Rocket's combined JS bundle — per-file Delay exclusion is not available. The remedy is disabling Combine JS or excluding the original file in File Optimization.";

/** Props of {@link ExclusionCopyButton}. */
export interface ExclusionCopyButtonProps {
  /**
   * The exclusion pattern to copy, read per access — a host-hidden row's
   * payload resolves once (hostless → host-led) while the control is
   * mounted.
   */
  readonly pattern: () => string;
  /** The control's full accessible name (`copyExclusionName`'s shape). */
  readonly name: string;
  /** Whether the original-host resolution is still running (read per access). */
  readonly pending: () => boolean;
  /** The clipboard seam (default `navigator.clipboard`); injected by tests. */
  readonly clipboard?: ClipboardLike;
  /** Extra classes, merged last so callers win. */
  readonly class?: string;
}

/**
 * The "Copy as exclusion" action on the shared copy button: the exact
 * pattern on the clipboard, in-place feedback at the row, the
 * setting-naming toast, a hand-typing remedy when the write fails, and the
 * resolution wait (the shared button's `pending`) with its own hint.
 *
 * @param props See {@link ExclusionCopyButtonProps}.
 */
export function ExclusionCopyButton(props: ExclusionCopyButtonProps): JSX.Element {
  return (
    <CopyButton
      text={props.pattern()}
      label={VISIBLE_LABEL}
      ariaLabel={props.name}
      title={props.pending() ? PENDING_TITLE : HOVER_TITLE}
      pending={props.pending()}
      showLabel="regular-up"
      copiedLabel={FLASH_LABEL}
      successTitle={COPIED_TITLE}
      successDescription={COPIED_DESCRIPTION}
      failureDescription={copyFailedRemedy(props.pattern())}
      clipboard={props.clipboard}
      class={props.class}
    />
  );
}
