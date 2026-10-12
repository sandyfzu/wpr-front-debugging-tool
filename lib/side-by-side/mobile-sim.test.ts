/**
 * The mobile-simulation machine's contract, pinned over traced seams:
 * open/toggle/close ordering (the set ask resolves before any reload),
 * the truthful branches (enabled/failed/unavailable), the no-op repeated
 * toggle (the pure reveal), push convergence without asks or reloads, and
 * the two rule/presentation invariants across every settled state.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { DeviceSimState } from '../device-simulation/state';
import {
  createMobileSimSession,
  INITIAL_SIM_SNAPSHOT,
  type MobileSimIO,
  type MobileSimSnapshot
} from './mobile-sim';

/** A manually-resolved promise for the late-ask ordering pins. */
interface SimAskDeferred {
  promise: Promise<DeviceSimState>;
  resolve(state: DeviceSimState): void;
}

function deferred(): SimAskDeferred {
  let resolve!: (state: DeviceSimState) => void;
  const promise = new Promise<DeviceSimState>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** The traced seams: every seam call is recorded; per-test stubs reassign the fns. */
interface SimIOTrace extends MobileSimIO {
  readState: Mock<() => Promise<DeviceSimState>>;
  applyState: Mock<(enabled: boolean) => Promise<DeviceSimState>>;
  refreshHalves: Mock<() => void>;
  persist: Mock<(enabled: boolean) => Promise<void>>;
}

/** A fresh trace recording every seam call; default stubs answer truthfully. */
function createTrace(): SimIOTrace {
  return {
    readState: vi.fn(() => Promise.resolve({ available: true, enabled: false })),
    applyState: vi.fn((enabled: boolean) => Promise.resolve({ available: true, enabled })),
    refreshHalves: vi.fn(),
    persist: vi.fn(() => Promise.resolve()),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  };
}

/** A machine over the trace, plus every snapshot it ever announced. */
interface SimFixture {
  machine: ReturnType<typeof createMobileSimSession>;
  trace: SimIOTrace;
  history: MobileSimSnapshot[];
}

function createFixture(trace = createTrace()): SimFixture {
  const history: MobileSimSnapshot[] = [];
  const machine = createMobileSimSession(trace, (snapshot) => {
    history.push(snapshot);
  });
  return { machine, trace, history };
}

/** Open with the default setting-off ask, then toggle on (the canonical primed phone state). */
async function primedPhone(fx: SimFixture): Promise<void> {
  await fx.machine.open(false, false);
  await fx.machine.toggle(true);
  expect(fx.machine.snapshot()).toMatchObject({
    presentation: 'phone',
    session: true,
    failed: false
  });
}

const ON: DeviceSimState = { available: true, enabled: true };
const OFF: DeviceSimState = { available: true, enabled: false };
const UNAVAILABLE: DeviceSimState = { available: false, enabled: false };

/**
 * The invariant sweep: a settled coherent snapshot mirrors session to
 * presentation (never a rule at `'auto'`, never a phone frame without the
 * rule), unavailability forces the auto presentation with no failure flag,
 * and anything else must be inside an in-flight or failed command the flag
 * covers.
 */
function expectCoherent(snapshot: Readonly<MobileSimSnapshot>): void {
  if (snapshot.available === false) {
    expect(snapshot.presentation, 'unavailable never dresses the overlay').toBe('auto');
    expect(snapshot.failed, 'unavailable is a degrade, not a failure').toBe(false);
    return;
  }
  if (!snapshot.failed) {
    expect(snapshot.presentation, 'presentation mirrors the session truth').toBe(
      snapshot.session ? 'phone' : 'auto'
    );
  }
  expect(snapshot.busy, 'a settled event never stays busy').toBe(false);
}

describe('open', () => {
  it('never asks on the analysis host — PSI side-by-side is untouched', async () => {
    const fx = createFixture();
    await fx.machine.open(true, true);
    expect(fx.trace.readState).not.toHaveBeenCalled();
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expect(fx.trace.persist).not.toHaveBeenCalled();
    expect(fx.machine.snapshot()).toEqual(INITIAL_SIM_SNAPSHOT);
    expectCoherent(fx.machine.snapshot());
  });

  it('with the persisted setting off answers availability and reloads nothing (the reveal path)', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false);
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expect(fx.machine.snapshot()).toEqual({
      available: true,
      presentation: 'auto',
      session: false,
      failed: false,
      busy: false
    });
    expectCoherent(fx.machine.snapshot());
  });

  it('with the setting on awaits the set ask before either half reloads, reloading both and then adopting the phone', async () => {
    const fx = createFixture();
    const late = deferred();
    fx.trace.applyState = vi.fn(() => late.promise);
    const opening = fx.machine.open(false, true);
    // The set ask is in flight: nothing has re-navigated yet.
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    late.resolve(ON);
    await opening;
    expect(fx.trace.applyState).toHaveBeenCalledWith(true);
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1);
    expect(fx.machine.snapshot()).toEqual({
      available: true,
      presentation: 'phone',
      session: true,
      failed: false,
      busy: false
    });
    // Refresh ran before the adoption: the busy flag cleared on the same
    // notification that already carries the phone presentation.
    expectCoherent(fx.machine.snapshot());
  });

  it('degrades to the explicit unavailable state when the ask answers unavailable (the switch never renders)', async () => {
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.resolve(UNAVAILABLE));
    await fx.machine.open(false, true);
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expect(fx.machine.snapshot().available).toBe(false);
    expectCoherent(fx.machine.snapshot());
  });

  it('survives a violating readState rejection with the same explicit degrade', async () => {
    // readState's contract is resolve-only; a rejection still cannot
    // half-render the switch behind a broken ask.
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.reject(new Error('dead context')));
    await fx.machine.open(false, true);
    expect(fx.machine.snapshot().available).toBe(false);
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expectCoherent(fx.machine.snapshot());
  });

  it('converges a session that is already on: the ask no-ops at the background, both halves still re-navigate under the live rule', async () => {
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.resolve(ON));
    fx.trace.applyState = vi.fn(() => Promise.resolve(ON));
    await fx.machine.open(false, true);
    expect(fx.trace.applyState).toHaveBeenCalledWith(true);
    // The frames must re-navigate to carry the session's documents whatever
    // the rule-add's no-op-ness (first open navigates at mount; a re-open
    // reloads in place — the wiring decides; the demand is the machine's).
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1);
    expect(fx.machine.snapshot().presentation).toBe('phone');
    expectCoherent(fx.machine.snapshot());
  });

  it('converges a stale-live rule when the setting turned off between opens', async () => {
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.resolve(ON));
    fx.trace.applyState = vi.fn(() => Promise.resolve(OFF));
    await fx.machine.open(false, false);
    expect(fx.trace.applyState).toHaveBeenCalledWith(false);
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1);
    expect(fx.machine.snapshot()).toMatchObject({ presentation: 'auto', session: false });
    expectCoherent(fx.machine.snapshot());
  });

  it('lands the failed branch when the add did not take effect: no reload, flag up, switch still truthful', async () => {
    const fx = createFixture();
    fx.trace.applyState = vi.fn(() => Promise.resolve(OFF));
    await fx.machine.open(false, true);
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    const settled = fx.machine.snapshot();
    expect(settled).toMatchObject({
      available: true,
      presentation: 'auto',
      session: false,
      failed: true
    });
    expectCoherent(settled);
  });

  it('reports post-command unavailability when the command itself answers unavailable', async () => {
    // A set-time refusal is the capability degrading mid-life; the degrade
    // state collapses everything, same semantics as the open's own.
    const fx = createFixture();
    fx.trace.applyState = vi.fn(() => Promise.resolve(UNAVAILABLE));
    await fx.machine.open(false, true);
    expect(fx.machine.snapshot().available).toBe(false);
    expectCoherent(fx.machine.snapshot());
  });
});

describe('toggle', () => {
  it('on: awaits the ask, reloads both halves, adopts the phone presentation, then records the intent', async () => {
    const fx = createFixture();
    const late = deferred();
    let persisted = false;
    await fx.machine.open(false, false);
    fx.trace.applyState = vi.fn(() => late.promise);
    fx.trace.persist = vi.fn(() => {
      persisted = true;
      return Promise.resolve();
    });
    const toggling = fx.machine.toggle(true);
    await Promise.resolve(); // the event's start is settled; the ask is still in flight
    expect(fx.machine.snapshot().busy).toBe(true);
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expect(persisted, 'the intent write must not race ahead of the resolution').toBe(false);
    late.resolve(ON);
    await toggling;
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1);
    expect(fx.trace.persist).toHaveBeenCalledWith(true);
    expectCoherent(fx.machine.snapshot());
  });

  it('off (symmetric): awaits the removal, reloads both halves back to real, records the off intent', async () => {
    const fx = createFixture();
    await primedPhone(fx);
    fx.trace.applyState = vi.fn(() => Promise.resolve(OFF));
    const refreshesBefore = fx.trace.refreshHalves.mock.calls.length;
    const toggling = fx.machine.toggle(false);
    await Promise.resolve();
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(refreshesBefore);
    await toggling;
    expect(fx.trace.applyState).toHaveBeenCalledWith(false);
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(refreshesBefore + 1);
    expect(fx.trace.persist).toHaveBeenCalledWith(false);
    expect(fx.machine.snapshot().presentation).toBe('auto');
    expectCoherent(fx.machine.snapshot());
  });

  it('is a no-op when the presentation already matches (no ask, no reload, no write)', async () => {
    const fx = createFixture();
    await primedPhone(fx);
    expect(fx.trace.applyState).toHaveBeenCalledTimes(1);
    expect(fx.trace.persist).toHaveBeenCalledTimes(1);
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1);
    await fx.machine.toggle(true);
    expect(fx.trace.applyState).toHaveBeenCalledTimes(1);
    expect(fx.trace.persist).toHaveBeenCalledTimes(1);
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1);
    expect(fx.machine.snapshot()).toMatchObject({ presentation: 'phone', failed: false });
  });

  it('a re-open with the live session matches the persisted setting: a pure reveal — no set ask, no reload', async () => {
    // The leftover-live scenario: a close whose removal was refused kept the
    // session truthful and the phone presentation; opening again with the
    // same setting changes nothing — the mounted frames are revealed as they
    // are, the set rule is precious and never re-created.
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.resolve(OFF));
    await fx.machine.open(false, false);
    await fx.machine.toggle(true);
    expect(fx.trace.applyState).toHaveBeenCalledTimes(1);
    const revealsBefore = fx.trace.refreshHalves.mock.calls.length;
    fx.trace.readState = vi.fn(() => Promise.resolve(ON));
    await fx.machine.open(false, true);
    expect(fx.trace.applyState).toHaveBeenCalledTimes(1); // only the priming toggle
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(revealsBefore);
    expect(fx.machine.snapshot()).toMatchObject({ presentation: 'phone', session: true });
    expectCoherent(fx.machine.snapshot());
  });

  it('a toggle onto a refused removal keeps the truthful state: no reload, failed flag, session still on', async () => {
    const fx = createFixture();
    await primedPhone(fx);
    fx.trace.applyState = vi.fn(() => Promise.resolve(ON));
    await fx.machine.toggle(false);
    const settled = fx.machine.snapshot();
    expect(settled).toMatchObject({ presentation: 'phone', session: true, failed: true });
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1); // only the on-command reloaded
    expectCoherent(settled);
  });

  it('queues a rapid on/off pair into ordered commands (the serialization is observable)', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false);
    const first = fx.machine.toggle(true);
    const second = fx.machine.toggle(false);
    await Promise.all([first, second]);
    expect(fx.trace.applyState.mock.calls.map((call) => call[0])).toEqual([true, false]);
    // Each applied direction re-navigated the halves once.
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(2);
    expect(fx.machine.snapshot()).toMatchObject({ presentation: 'auto', session: false });
    expectCoherent(fx.machine.snapshot());
  });

  it('records the intent inside its event: the next command waits for the previous write', async () => {
    // A rapid pair where the first write is held back: the second toggle's
    // command must not start until write one resolves — toggles never
    // interleave their ask with a still-in-flight read-modify-write (two
    // concurrent writes could resolve out of order and persist the stale
    // intent, which the next open would read as a false target).
    const fx = createFixture();
    let releaseWrite!: () => void;
    const heldWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const persistCalls: boolean[] = [];
    fx.trace.persist = vi.fn((next: boolean) => {
      persistCalls.push(next);
      return next ? heldWrite : Promise.resolve();
    });
    await fx.machine.open(false, false);
    const first = fx.machine.toggle(true);
    const second = fx.machine.toggle(false);
    await new Promise((resolve) => setTimeout(resolve, 0)); // flush the first event's microtasks
    expect(persistCalls).toEqual([true]); // the first write started and is held
    expect(fx.trace.applyState.mock.calls.map((call) => call[0])).toEqual([true]); // the second command waits
    releaseWrite();
    await Promise.all([first, second]);
    expect(persistCalls).toEqual([true, false]);
    expect(fx.trace.applyState.mock.calls.map((call) => call[0])).toEqual([true, false]);
    expectCoherent(fx.machine.snapshot());
  });

  it('never rejects even when the ask throws — the unknown-truth degrade keeps the presentation and flags failed', async () => {
    const fx = createFixture();
    fx.trace.applyState = vi.fn(() => Promise.reject(new Error('no receiver')));
    await fx.machine.open(false, false);
    await expect(fx.machine.toggle(true)).resolves.toBeUndefined();
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    const settled = fx.machine.snapshot();
    expect(settled).toMatchObject({ presentation: 'auto', failed: true, busy: false });
    expectCoherent(settled);
  });
});

describe('close', () => {
  it('removes the rule without reloading: the presentation follows the truthful answer to auto', async () => {
    const fx = createFixture();
    await primedPhone(fx);
    const late = deferred();
    fx.trace.applyState = vi.fn(() => late.promise);
    const closing = fx.machine.close();
    await Promise.resolve(); // the event's start is settled; the ask is still in flight
    expect(fx.machine.snapshot().busy).toBe(true);
    late.resolve(OFF);
    await closing;
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1); // only the priming command reloads
    expect(fx.machine.snapshot()).toMatchObject({
      presentation: 'auto',
      session: false,
      failed: false
    });
    expectCoherent(fx.machine.snapshot());
  });

  it('a refused close keeps the truthful phone presentation and marks failed — honest, never half-dressed', async () => {
    const fx = createFixture();
    await primedPhone(fx);
    fx.trace.applyState = vi.fn(() => Promise.resolve(ON));
    await fx.machine.close();
    const settled = fx.machine.snapshot();
    expect(settled).toMatchObject({ presentation: 'phone', session: true, failed: true });
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1); // only the on-command reloaded
    expectCoherent(settled);
  });

  it('is an idempotent removal ask when the session is already off', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false);
    fx.trace.applyState = vi.fn(() => Promise.resolve(OFF));
    await fx.machine.close();
    expect(fx.trace.applyState).toHaveBeenCalledWith(false);
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expect(fx.machine.snapshot()).toMatchObject({ presentation: 'auto', failed: false });
    expectCoherent(fx.machine.snapshot());
  });

  it('skips the removal entirely after an unavailable answer (no rule could exist)', async () => {
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.resolve(UNAVAILABLE));
    await fx.machine.open(false, true);
    await fx.machine.close();
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expect(fx.machine.snapshot().presentation).toBe('auto');
    expectCoherent(fx.machine.snapshot());
  });

  it('skips the removal when the machine was never asked (no rule could exist)', async () => {
    const fx = createFixture();
    await fx.machine.close();
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expectCoherent(fx.machine.snapshot());
  });

  it('lands the failed branch when the closing removal ask explodes (state kept, no reload)', async () => {
    const fx = createFixture();
    await primedPhone(fx);
    fx.trace.applyState = vi.fn(() => Promise.reject(new Error('dead context')));
    await expect(fx.machine.close()).resolves.toBeUndefined();
    const settled = fx.machine.snapshot();
    // The honest state stands: the truthful set answer never arrived, so the
    // presentation and session stay as they were, flagged failed until the
    // next event or push reconciles.
    expect(settled).toMatchObject({ presentation: 'phone', session: true, failed: true });
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1); // only the on-command reloaded
    expectCoherent(settled);
  });

  it('collapses to the degrade state when the closing removal answers unavailable', async () => {
    const fx = createFixture();
    await primedPhone(fx);
    fx.trace.applyState = vi.fn(() => Promise.resolve(UNAVAILABLE));
    await fx.machine.close();
    const settled = fx.machine.snapshot();
    expect(settled).toMatchObject({ available: false, presentation: 'auto', session: false });
    expectCoherent(settled);
  });
});

describe('pushed', () => {
  it('converges the presentation to a pushed-on state without asks or reloads', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false);
    fx.machine.pushed(ON);
    expect(fx.trace.readState).toHaveBeenCalledTimes(1);
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expect(fx.machine.snapshot()).toMatchObject({
      available: true,
      presentation: 'phone',
      session: true,
      failed: false
    });
    expectCoherent(fx.machine.snapshot());
  });

  it('converges a background-driven removal to the auto presentation, without reload', async () => {
    const fx = createFixture();
    await primedPhone(fx);
    fx.machine.pushed(OFF);
    expect(fx.trace.applyState).toHaveBeenCalledTimes(1); // only the priming command
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1); // only the priming command
    expect(fx.machine.snapshot()).toMatchObject({ presentation: 'auto', session: false });
    expectCoherent(fx.machine.snapshot());
  });

  it('a push arriving mid-command converges first and the command resolution still decides', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false);
    const late = deferred();
    fx.trace.applyState = vi.fn(() => late.promise);
    const toggling = fx.machine.toggle(true);
    await Promise.resolve(); // the event's start is settled; the ask is still in flight
    expect(fx.machine.snapshot().busy).toBe(true);
    // A supposedly simultaneous background change lands while the ask flies:
    fx.machine.pushed({ available: true, enabled: false });
    expect(fx.machine.snapshot()).toMatchObject({ presentation: 'auto', busy: true });
    late.resolve(ON);
    await toggling;
    expect(fx.machine.snapshot()).toMatchObject({
      presentation: 'phone',
      session: true,
      failed: false,
      busy: false
    });
    expectCoherent(fx.machine.snapshot());
  });

  it('records an unavailable push as the explicit degrade', async () => {
    const fx = createFixture();
    await primedPhone(fx);
    fx.machine.pushed(UNAVAILABLE);
    const settled = fx.machine.snapshot();
    expect(settled).toMatchObject({ available: false, presentation: 'auto', session: false });
    expectCoherent(settled);
  });
});

describe('invariants sweep', () => {
  /**
   * The machine's two rule/presentation invariants as a scripted lifecycle:
   * every settled event ends coherent — no live rule at 'auto', no phone
   * without live requests, unavailability always auto, failures flagged and
   * busy-free.
   */
  it('every event of a scripted lifecycle keeps the presentation honest', async () => {
    const fx = createFixture();
    await fx.machine.open(true, true); // psi: everything skipped
    expect(fx.machine.snapshot()).toEqual(INITIAL_SIM_SNAPSHOT);
    await fx.machine.open(false, true); // first open, persisted on → phone
    expect(fx.machine.snapshot().presentation).toBe('phone');
    await fx.machine.toggle(false); // switch off mid-session → auto
    expect(fx.machine.snapshot().presentation).toBe('auto');
    await fx.machine.toggle(true); // back on
    expect(fx.machine.snapshot().presentation).toBe('phone');
    await fx.machine.close(); // rule gone, auto
    expect(fx.machine.snapshot().presentation).toBe('auto');
    await fx.machine.open(false, true); // re-open with the setting on → phone again
    expect(fx.machine.snapshot().presentation).toBe('phone');
    await fx.machine.close();
    expect(fx.machine.snapshot().presentation).toBe('auto');
    fx.machine.pushed(OFF); // a background-driven removal after close
    expect(fx.machine.snapshot().presentation).toBe('auto');
    // Every settled snapshot (commands' in-flight entries included where the
    // busy flag already covers them) satisfies the invariants; the sweep
    // reads settled states via the busy-free gate inside `expectCoherent`.
    for (const snapshot of fx.history) {
      if (!snapshot.busy) expectCoherent(snapshot);
      else {
        expect(snapshot.available === null || snapshot.available).toBe(true);
        expect(['auto', 'phone']).toContain(snapshot.presentation);
      }
    }
  });

  it('a failed settle is still coherent: the truthful state stands and the flag marks the contradiction', async () => {
    // A toggle-on answered by a judicial refusal: the state stays off (the
    // truthful mirror), the failed branch flags the contradiction.
    const fx = createFixture();
    await fx.machine.open(false, false);
    fx.trace.applyState = vi.fn(() => Promise.resolve(OFF));
    await fx.machine.toggle(true);
    expectCoherent(fx.machine.snapshot());
    expect(fx.machine.snapshot().failed).toBe(true);
  });
});
