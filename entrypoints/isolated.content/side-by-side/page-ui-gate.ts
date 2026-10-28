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
 * - Opens: one at a time, refused while the gate is off or unknown; an
 *   open the gate crossed mid-flight is dropped, and restarted once the
 *   gate is back (`createOpenGuard`).
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

/** What the open guard reads. */
export interface OpenGuardDeps {
  /** Whether the overlay's gated surface runs. */
  running(): boolean;
  /** Whether the content script's context is dead. */
  isInvalid(): boolean;
}

/** One open in flight. */
export interface OpenTicket {
  /**
   * Whether the gate cut this open since it began (it closed, or closed
   * and came back: the view was removed meanwhile). A cut open is
   * abandoned — the caller drops it after cleaning up.
   */
  cut(): boolean;
}

/** Why an open did not start. */
export type OpenRefusal = 'busy' | 'page-ui-off';

/** The overlay's open serialization under the gate. */
export interface OpenGuard {
  /**
   * Start an open: refused while the overlay is open or an open is in
   * flight (`busy`: concurrent triggers collapse into one open) and while
   * the surface does not run (`page-ui-off`: the gate outranks every
   * trigger; unknown counts as off).
   */
  begin(isOpen: boolean): OpenTicket | OpenRefusal;
  /** Whether an open is in flight. */
  inFlight(): boolean;
  /** The overlay's host was removed: every open in flight is stale. */
  viewRemoved(): void;
  /**
   * End an open (always, in `finally`).
   *
   * @returns Whether to open again: the open was cut and the gate is
   *   already back on (the gate-on's re-open met this open in flight and
   *   was absorbed by the `busy` refusal).
   */
  end(ticket: OpenTicket): boolean;
}

/**
 * Build the overlay's open guard.
 *
 * @param deps The gate and context reads.
 * @returns The guard, idle.
 */
export function createOpenGuard(deps: OpenGuardDeps): OpenGuard {
  let inFlight = false;
  /** Bumped by every host removal. */
  let viewEpoch = 0;
  /** The tickets cut so far (the one in flight, at most). */
  const abandoned = new WeakSet<OpenTicket>();

  return {
    begin(isOpen) {
      if (isOpen || inFlight) return 'busy';
      if (!deps.running()) return 'page-ui-off';
      inFlight = true;
      const epoch = viewEpoch;
      const ticket: OpenTicket = {
        cut() {
          if (deps.running() && epoch === viewEpoch) return false;
          abandoned.add(ticket);
          return true;
        }
      };
      return ticket;
    },
    inFlight: () => inFlight,
    viewRemoved() {
      viewEpoch += 1;
    },
    end(ticket) {
      inFlight = false;
      return abandoned.has(ticket) && deps.running() && !deps.isInvalid();
    }
  };
}
