/**
 * When the Known Conflicts scans run, under the on-page UI gate: the
 * surface's start (boot or gate-on resume, per `scanStartPlan`), its stop
 * (gate off: observer off, pending rescan dropped, card removed) and the
 * one gated entry every scan trigger goes through (DB writes, DOM churn,
 * the late pass). The scan itself (URL, extraction, findings, mount) is
 * the caller's `pass`; this module owns only the flow's timing state.
 */
import type { GatedSurfaceStart } from '../../../lib/page-ui/gated-surface';
import { latePassDue, passSettled, scanStartPlan, type ScanSurfaceMode } from './scan-state';

/** The page seams the flow drives. */
export interface ScanFlowDeps {
  /** The page's scan surface at boot. */
  readonly mode: ScanSurfaceMode;
  /** The plugins screen's late-pass delay. */
  readonly latePassDelayMs: number;
  /** Whether the surface runs (the on-page UI gate's machine). */
  running(): boolean;
  /** Whether the content script's context is dead. */
  isInvalid(): boolean;
  /** One scan pass (reads {@link ScanFlow.settled} for its verdict). */
  pass(): void;
  /** Run once after a delay (dropped on invalidation). */
  later(run: () => void, ms: number): void;
  /** HelpScout: start observing DOM churn. */
  observe(): void;
  /** HelpScout: stop observing DOM churn. */
  disconnect(): void;
  /** HelpScout: request a debounced pass. */
  rescanSoon(): void;
  /** HelpScout: drop a pending debounced pass. */
  cancelRescan(): void;
  /** Remove the card and reset it to its fresh shape. */
  removeCard(): void;
}

/** A surface's scan flow. */
export interface ScanFlow {
  /** The gated surface's start hook. */
  readonly start: (cause: GatedSurfaceStart) => void;
  /** The gated surface's stop hook. */
  readonly stop: () => void;
  /** Run a pass now, only while the surface runs (every trigger's entry). */
  readonly scan: () => void;
  /** Whether the pass flow has closed (`passSettled`): a zero-finding pass may then be final. */
  settled(): boolean;
}

/**
 * Create the flow.
 *
 * @param deps The page seams.
 * @returns The flow, idle until `start`.
 */
export function createScanFlow(deps: ScanFlowDeps): ScanFlow {
  /** Whether the plugins screen's late pass has run. */
  let latePassRan = false;
  /** Whether a late pass is pending (its timer armed, not yet fired). */
  let latePassScheduled = false;

  const scan = (): void => {
    // Scans exist for the card only: none while the gate is off (a gate-on
    // rescans) or once the context died.
    if (deps.isInvalid() || !deps.running()) return;
    deps.pass();
  };

  /**
   * The plugins screen's bounded flow: a pass now plus one late pass. The
   * empty state is final only once the late pass has RUN; a late pass
   * firing while the gate is off settles the flow and scans nothing (the
   * gate-on rescans).
   */
  const twoPass = (): void => {
    scan();
    if (!latePassDue(latePassRan, latePassScheduled)) return;
    latePassScheduled = true;
    deps.later(() => {
      latePassScheduled = false;
      // Invalidation: the flow stays unsettled, nothing scans.
      if (deps.isInvalid()) return;
      latePassRan = true;
      scan();
    }, deps.latePassDelayMs);
  };

  return {
    start: (cause) => {
      if (deps.isInvalid()) return;
      if (deps.mode === 'helpscout') deps.observe();
      const plan = scanStartPlan(deps.mode, cause, latePassRan);
      if (plan === 'two-pass') twoPass();
      else if (plan === 'debounced') deps.rescanSoon();
      else scan();
    },
    stop: () => {
      deps.disconnect();
      deps.cancelRescan();
      deps.removeCard();
    },
    scan,
    settled: () => passSettled(deps.mode, latePassRan)
  };
}
