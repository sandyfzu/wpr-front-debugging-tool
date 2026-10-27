/**
 * The compare overlay under the on-page UI gate: the gated surface's
 * start/stop for this module (`lib/page-ui/gated-surface`).
 *
 * - Boot: the reload-restore record is consumed at the page's boot moment
 *   whatever the gate says, so a gate-off boot never leaves it for a later
 *   load; the overlay opens at boot only if the gate is on and the record
 *   matched (or the page is the PageSpeed Insights auto-flow).
 * - Gate off: an open overlay closes (its close restores the scroll,
 *   retracts the simulation and clears the record) and the host is
 *   removed; whether it was up (or opening) is remembered.
 * - Gate on: the overlay re-opens if it was up when the gate closed —
 *   never because of a boot-only reason (the record is spent).
 */
import type { Logger } from '../../../lib/logger';
import type { GatedSurfaceHooks } from '../../../lib/page-ui/gated-surface';
import { consumeBootOpenState, type OpenStateWindow } from './session-open';

/** What the overlay's gate hooks drive. */
export interface OverlayGateDeps {
  /** The tab's window (the reload-restore record's storage). */
  readonly win: OpenStateWindow;
  /** The document's URL. */
  href(): string;
  /** Whether this page is the PageSpeed Insights auto-flow page. */
  autoFlowPage(): boolean;
  /** Whether the overlay covers the page. */
  isOpen(): boolean;
  /** Whether an open is in flight. */
  opening(): boolean;
  /** The overlay's single open path (it re-checks the gate itself). */
  open(): Promise<void>;
  /** The overlay's close. */
  close(): void;
  /** Remove the overlay's host. */
  unmount(): void;
  /** Whether the content script's context is dead. */
  isInvalid(): boolean;
  readonly log: Pick<Logger, 'error'>;
}

/** The gate hooks plus the boot moment's record consumption. */
export interface OverlayGate extends GatedSurfaceHooks {
  /** Consume the reload-restore record (call at the boot moment, before `pageReady`). */
  consumeRestore(): void;
}

/**
 * Build the overlay's gate hooks.
 *
 * @param deps The overlay's open/close seams.
 * @returns The hooks.
 */
export function createOverlayGate(deps: OverlayGateDeps): OverlayGate {
  let restoreRecorded = false;
  let reopenOnResume = false;

  const open = (): void => {
    // The belt catch keeps the never-fire-and-forget guarantee local even
    // though the open path resolves (a future rejecting await must not
    // surface as an unhandled rejection).
    deps.open().catch((cause: unknown) => {
      deps.log.error('The overlay open failed unexpectedly', cause);
    });
  };

  return {
    consumeRestore() {
      restoreRecorded = consumeBootOpenState(deps.win, deps.href());
    },
    start(cause) {
      const wanted = cause === 'boot' ? restoreRecorded || deps.autoFlowPage() : reopenOnResume;
      restoreRecorded = false;
      reopenOnResume = false;
      if (wanted && !deps.isInvalid()) open();
    },
    stop() {
      reopenOnResume = deps.isOpen() || deps.opening();
      if (deps.isOpen()) deps.close();
      deps.unmount();
    }
  };
}
