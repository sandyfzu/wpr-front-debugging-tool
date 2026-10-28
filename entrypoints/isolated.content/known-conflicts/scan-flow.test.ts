/**
 * The scan flow over fake seams: every trigger is gated on the surface
 * running (and a live context), the plugins screen's two-pass flow runs at
 * boot and on a resume that never settled (a gate-off boot), quick off → on
 * bursts never stack late passes, a late pass firing while off settles
 * without scanning, HelpScout observes and debounces, stop tears it down.
 */
import { describe, expect, it, vi } from 'vitest';
import { createScanFlow, type ScanFlow } from './scan-flow';
import type { ScanSurfaceMode } from './scan-state';

const DELAY = 1_000;

/** A flow over controllable seams; `fire()` runs the pending timers. */
function harness(mode: ScanSurfaceMode) {
  let running = true;
  let invalid = false;
  const timers: Array<() => void> = [];
  const pass = vi.fn();
  const later = vi.fn((run: () => void, ms: number) => {
    expect(ms).toBe(DELAY);
    timers.push(run);
  });
  const deps = {
    mode,
    latePassDelayMs: DELAY,
    running: () => running,
    isInvalid: () => invalid,
    pass,
    later,
    observe: vi.fn(),
    disconnect: vi.fn(),
    rescanSoon: vi.fn(),
    cancelRescan: vi.fn(),
    removeCard: vi.fn()
  };
  const flow: ScanFlow = createScanFlow(deps);
  return {
    flow,
    deps,
    pass,
    later,
    setRunning: (next: boolean) => {
      running = next;
    },
    invalidate: () => {
      invalid = true;
    },
    fire: () => {
      for (const run of timers.splice(0)) run();
    }
  };
}

describe('createScanFlow — the gated entry', () => {
  it('scans only while the surface runs', () => {
    const h = harness('wp-admin');
    h.setRunning(false);
    h.flow.scan();
    expect(h.pass).not.toHaveBeenCalled();
    h.setRunning(true);
    h.flow.scan();
    expect(h.pass).toHaveBeenCalledTimes(1);
  });

  it('never scans on a dead context', () => {
    const h = harness('helpscout');
    h.invalidate();
    h.flow.scan();
    h.flow.start('boot');
    expect(h.pass).not.toHaveBeenCalled();
    expect(h.deps.observe).not.toHaveBeenCalled();
  });
});

describe('createScanFlow — plugins screen', () => {
  it('boots with a pass now and settles after the late pass', () => {
    const h = harness('wp-admin');
    h.flow.start('boot');
    expect(h.pass).toHaveBeenCalledTimes(1);
    expect(h.flow.settled()).toBe(false);
    h.fire();
    expect(h.pass).toHaveBeenCalledTimes(2);
    expect(h.flow.settled()).toBe(true);
    expect(h.deps.observe).not.toHaveBeenCalled();
  });

  it('runs the two-pass flow on a resume after a gate-off boot (the card settles)', () => {
    const h = harness('wp-admin');
    // Gate-off boot: the machine never started the flow; a gate-on resumes.
    h.flow.start('resume');
    expect(h.pass).toHaveBeenCalledTimes(1);
    expect(h.later).toHaveBeenCalledTimes(1);
    h.fire();
    expect(h.flow.settled()).toBe(true);
    expect(h.pass).toHaveBeenCalledTimes(2);
  });

  it('never stacks late passes across quick off → on bursts', () => {
    const h = harness('wp-admin');
    h.flow.start('boot');
    h.setRunning(false);
    h.flow.stop();
    h.setRunning(true);
    h.flow.start('resume');
    h.setRunning(false);
    h.flow.stop();
    h.setRunning(true);
    h.flow.start('resume');
    expect(h.later).toHaveBeenCalledTimes(1);
    h.fire();
    expect(h.flow.settled()).toBe(true);
  });

  it('settles without scanning when the late pass fires while off; a resume then scans once', () => {
    const h = harness('wp-admin');
    h.flow.start('boot');
    h.setRunning(false);
    h.flow.stop();
    h.fire();
    expect(h.pass).toHaveBeenCalledTimes(1);
    expect(h.flow.settled()).toBe(true);
    h.setRunning(true);
    h.flow.start('resume');
    expect(h.pass).toHaveBeenCalledTimes(2);
    expect(h.later).toHaveBeenCalledTimes(1);
  });

  it('an invalidated late pass leaves the flow unsettled and scans nothing', () => {
    const h = harness('wp-admin');
    h.flow.start('boot');
    h.invalidate();
    h.fire();
    expect(h.flow.settled()).toBe(false);
    expect(h.pass).toHaveBeenCalledTimes(1);
  });
});

describe('createScanFlow — HelpScout', () => {
  it('observes and debounces at boot, scans at once on a resume', () => {
    const h = harness('helpscout');
    expect(h.flow.settled()).toBe(true);
    h.flow.start('boot');
    expect(h.deps.observe).toHaveBeenCalledTimes(1);
    expect(h.deps.rescanSoon).toHaveBeenCalledTimes(1);
    expect(h.pass).not.toHaveBeenCalled();
    h.flow.start('resume');
    expect(h.deps.observe).toHaveBeenCalledTimes(2);
    expect(h.pass).toHaveBeenCalledTimes(1);
    expect(h.later).not.toHaveBeenCalled();
  });
});

describe('createScanFlow — stop', () => {
  it('disconnects, drops the pending rescan and removes the card', () => {
    const h = harness('helpscout');
    h.flow.start('boot');
    h.flow.stop();
    expect(h.deps.disconnect).toHaveBeenCalledTimes(1);
    expect(h.deps.cancelRescan).toHaveBeenCalledTimes(1);
    expect(h.deps.removeCard).toHaveBeenCalledTimes(1);
  });
});
