/**
 * The presentation machine's contract, pinned over traced seams:
 * open/toggle/desktop ordering (cargo of the session-flip reload rule),
 * the truthful branches (enabled/failed/unavailable), the no-op repeated
 * toggles (the pure reveal), the persisted dress's adoption and
 * re-application, push convergence without asks or reloads, and the
 * rule/presentation invariants across every settled state.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { DeviceSimState } from '../device-simulation/state';
import {
  createPresentationState,
  INITIAL_PRESENTATION_SNAPSHOT,
  presentationOf,
  type PresentationSnapshot,
  type PresentationStateIO
} from './presentation-state';

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
interface SimIOTrace extends PresentationStateIO {
  readState: Mock<() => Promise<DeviceSimState>>;
  applyState: Mock<(enabled: boolean) => Promise<DeviceSimState>>;
  refreshHalves: Mock<() => void>;
  persist: Mock<(enabled: boolean) => Promise<void>>;
  persistDesktop: Mock<(enabled: boolean) => Promise<void>>;
}

/** A fresh trace recording every seam call; default stubs answer truthfully. */
function createTrace(): SimIOTrace {
  return {
    readState: vi.fn(() => Promise.resolve({ available: true, enabled: false })),
    applyState: vi.fn((enabled: boolean) => Promise.resolve({ available: true, enabled })),
    refreshHalves: vi.fn(),
    persist: vi.fn(() => Promise.resolve()),
    persistDesktop: vi.fn(() => Promise.resolve()),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  };
}

/** A machine over the trace, plus every snapshot it ever announced. */
interface SimFixture {
  machine: ReturnType<typeof createPresentationState>;
  trace: SimIOTrace;
  history: PresentationSnapshot[];
}

function createFixture(trace = createTrace()): SimFixture {
  const history: PresentationSnapshot[] = [];
  const machine = createPresentationState(trace, (snapshot) => {
    history.push(snapshot);
  });
  return { machine, trace, history };
}

/** Open with the default targets, then toggle the mobile switch on (the canonical primed phone state). */
async function primedPhone(fx: SimFixture): Promise<void> {
  await fx.machine.open(false, false, false);
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
 * The invariant sweep: a settled coherent snapshot mirrors session and dress
 * through `presentationOf` (never a rule at a sessionless presentation, never
 * a phone frame without the rule), and anything else must be inside an
 * in-flight or failed command the flag covers. Unavailability is the degrade
 * that still honors the dress (the desktop switch works on engines without
 * the device simulation), not a failure.
 */
function expectCoherent(snapshot: Readonly<PresentationSnapshot>): void {
  expect(
    snapshot.presentation,
    'the presentation mirrors the session truth and the persisted dress'
  ).toBe(presentationOf(snapshot.session, snapshot.desktop));
  if (snapshot.available === false) {
    expect(snapshot.session, 'unavailable leaves no session behind').toBe(false);
    expect(snapshot.failed, 'unavailable is a degrade, not a failure').toBe(false);
  }
  expect(snapshot.busy, 'a settled event never stays busy').toBe(false);
}

describe('presentationOf', () => {
  it('mirrors the two independent facts: the session wins, the sessionless wear their dress', () => {
    expect(presentationOf(false, false)).toBe('auto');
    expect(presentationOf(false, true)).toBe('desktop');
    expect(presentationOf(true, false)).toBe('phone');
    // The dress stays persisted under the session; its re-application is the
    // sessionless convergence that follows the toggle-off.
    expect(presentationOf(true, true)).toBe('phone');
  });
});

describe('open', () => {
  it('never asks on the analysis host — PSI side-by-side is untouched', async () => {
    const fx = createFixture();
    await fx.machine.open(true, true, true);
    expect(fx.trace.readState).not.toHaveBeenCalled();
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expect(fx.trace.persist).not.toHaveBeenCalled();
    expect(fx.machine.snapshot()).toEqual(INITIAL_PRESENTATION_SNAPSHOT);
    expectCoherent(fx.machine.snapshot());
  });

  it('with both persisted targets off answers availability and reloads nothing (the reveal path)', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false, false);
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expect(fx.machine.snapshot()).toEqual({
      available: true,
      presentation: 'auto',
      session: false,
      desktop: false,
      failed: false,
      busy: false
    });
    expectCoherent(fx.machine.snapshot());
  });

  it('with the mobile target on awaits the set ask before either half reloads, reloading both and then adopting the phone', async () => {
    const fx = createFixture();
    const late = deferred();
    fx.trace.applyState = vi.fn(() => late.promise);
    const opening = fx.machine.open(false, true, false);
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
      desktop: false,
      failed: false,
      busy: false
    });
    expectCoherent(fx.machine.snapshot());
  });

  it('with only the desktop option on adopts the dress ask-free: no set ask, no reload, sessionless', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false, true);
    expect(fx.trace.readState).toHaveBeenCalledTimes(1);
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expect(fx.machine.snapshot()).toEqual({
      available: true,
      presentation: 'desktop',
      session: false,
      desktop: true,
      failed: false,
      busy: false
    });
    expectCoherent(fx.machine.snapshot());
  });

  it('a re-open with the desktop dress unchanged stays a pure reveal (the ask-free adoption is idempotent)', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false, true);
    await fx.machine.open(false, false, true);
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expect(fx.machine.snapshot()).toMatchObject({ presentation: 'desktop', session: false });
    expectCoherent(fx.machine.snapshot());
  });

  it('degrades to the explicit unavailable state when the ask answers unavailable (the mobile switch never renders)', async () => {
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.resolve(UNAVAILABLE));
    // The dress is still honored on an engine without the device simulation
    // (the desktop switch renders and works there), so the presentation
    // follows the option even in the degrade.
    await fx.machine.open(false, true, true);
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expect(fx.machine.snapshot().available).toBe(false);
    expect(fx.machine.snapshot().presentation).toBe('desktop');
    expect(fx.machine.snapshot().desktop).toBe(true);
    expectCoherent(fx.machine.snapshot());
  });

  it('survives a violating readState rejection with the same explicit degrade', async () => {
    // readState's contract is resolve-only; a rejection still cannot
    // half-render the switch behind a broken ask.
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.reject(new Error('dead context')));
    await fx.machine.open(false, true, false);
    expect(fx.machine.snapshot().available).toBe(false);
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expectCoherent(fx.machine.snapshot());
  });

  it('converges a session that is already on: the ask no-ops at the background, both halves still re-navigate under the live rule', async () => {
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.resolve(ON));
    fx.trace.applyState = vi.fn(() => Promise.resolve(ON));
    await fx.machine.open(false, true, false);
    expect(fx.trace.applyState).toHaveBeenCalledWith(true);
    // The frames must re-navigate to carry the session's documents whatever
    // the rule-add's no-op-ness (first open navigates at mount; a re-open
    // reloads in place — the wiring decides; the demand is the machine's).
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1);
    expect(fx.machine.snapshot().presentation).toBe('phone');
    expectCoherent(fx.machine.snapshot());
  });

  it('converges a stale-live rule when the persisted target turned off between opens', async () => {
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.resolve(ON));
    fx.trace.applyState = vi.fn(() => Promise.resolve(OFF));
    await fx.machine.open(false, false, false);
    expect(fx.trace.applyState).toHaveBeenCalledWith(false);
    // The removal is a session flip (true → false): the halves re-navigate
    // back to their real identity.
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1);
    expect(fx.machine.snapshot()).toMatchObject({ presentation: 'auto', session: false });
    expectCoherent(fx.machine.snapshot());
  });

  it('a re-open whose phone presentation outran the truth converges through the command, not the reveal', async () => {
    // The rule died without ever pushing (a refused close that really removed
    // it, a background sweep of another surface): the truth says sessionless,
    // the machine still dresses phone from its last settled state. The pure
    // reveal would settle `session:false` under `presentation:'phone'` — an
    // invariant breach with a dead switch; the machine runs the add command
    // against the fresh truth instead (whose re-taken rule keeps the already
    // device-era documents valid, so a refresh is neither needed nor run).
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.resolve(OFF));
    await fx.machine.open(false, false, false);
    await fx.machine.toggle(true); // engaged, presentation phone
    fx.trace.readState = vi.fn(() => Promise.resolve(OFF));
    const clocksBefore = fx.trace.refreshHalves.mock.calls.length;
    await fx.machine.open(false, true, false);
    expect(fx.trace.applyState).toHaveBeenCalledTimes(2);
    expect(fx.machine.snapshot()).toMatchObject({
      presentation: 'phone',
      session: true,
      failed: false
    });
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(clocksBefore);
    expectCoherent(fx.machine.snapshot());
  });

  it('a stale-rule descope with the desktop option on lands on the persisted dress after the removal', async () => {
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.resolve(ON));
    fx.trace.applyState = vi.fn(() => Promise.resolve(OFF));
    await fx.machine.open(false, false, true);
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1);
    expect(fx.machine.snapshot()).toMatchObject({
      presentation: 'desktop',
      session: false,
      desktop: true
    });
    expectCoherent(fx.machine.snapshot());
  });

  it('a re-open with the live session matches the persisted target: a pure reveal — no set ask, no reload', async () => {
    // The leftover-live scenario: a close whose removal was refused kept the
    // session truthful and the phone presentation; opening again with the
    // same target changes nothing — the mounted frames are revealed as they
    // are, the set rule is precious and never re-created.
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.resolve(OFF));
    await fx.machine.open(false, false, false);
    await fx.machine.toggle(true);
    expect(fx.trace.applyState).toHaveBeenCalledTimes(1);
    const revealsBefore = fx.trace.refreshHalves.mock.calls.length;
    fx.trace.readState = vi.fn(() => Promise.resolve(ON));
    await fx.machine.open(false, true, false);
    expect(fx.trace.applyState).toHaveBeenCalledTimes(1); // only the priming toggle
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(revealsBefore);
    expect(fx.machine.snapshot()).toMatchObject({ presentation: 'phone', session: true });
    expectCoherent(fx.machine.snapshot());
  });

  it('lands the failed branch when the add did not take effect: no reload, flag up, switch still truthful', async () => {
    const fx = createFixture();
    fx.trace.applyState = vi.fn(() => Promise.resolve(OFF));
    await fx.machine.open(false, true, false);
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
    await fx.machine.open(false, true, false);
    expect(fx.machine.snapshot().available).toBe(false);
    expectCoherent(fx.machine.snapshot());
  });
});

describe('toggle', () => {
  it('on: awaits the ask, reloads both halves, adopts the phone presentation, then records the intent', async () => {
    const fx = createFixture();
    const late = deferred();
    let persisted = false;
    await fx.machine.open(false, false, false);
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

  it('a toggle-off with the desktop option on re-applies the dress after the session reload', async () => {
    // The dress stays persisted under the session (the switch is not even
    // rendered then); the sessionless convergence wears it again — the
    // halves reload back to real requests AND render the desktop dress.
    const fx = createFixture();
    await fx.machine.open(false, false, true);
    await fx.machine.toggle(true);
    fx.trace.applyState = vi.fn(() => Promise.resolve(OFF));
    const refreshesBefore = fx.trace.refreshHalves.mock.calls.length;
    await fx.machine.toggle(false);
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(refreshesBefore + 1);
    expect(fx.machine.snapshot().presentation).toBe('desktop');
    expect(fx.machine.snapshot().session).toBe(false);
    expectCoherent(fx.machine.snapshot());
  });

  it('is a no-op when the session already matches (no ask, no reload, no write)', async () => {
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
    await fx.machine.open(false, false, false);
    const first = fx.machine.toggle(true);
    const second = fx.machine.toggle(false);
    await Promise.all([first, second]);
    expect(fx.trace.applyState.mock.calls.map((call) => call[0])).toEqual([true, false]);
    // Each applied direction re-navigated the halves once (the session
    // flipped both times).
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
    await fx.machine.open(false, false, false);
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
    await fx.machine.open(false, false, false);
    await expect(fx.machine.toggle(true)).resolves.toBeUndefined();
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    const settled = fx.machine.snapshot();
    expect(settled).toMatchObject({ presentation: 'auto', failed: true, busy: false });
    expectCoherent(settled);
  });

  it("a failed settle's surviving session still commands on a switch flip — the retry copy is honest, the no-op doesn't strand it", async () => {
    // The failing residue: a descope attempt whose ask throws (an extension
    // reload in flight) leaves `session:true` under the sessionless dress,
    // flagged failed. The switch then renders unchecked, and clicking it ON
    // must command against the fresh truth — a raw-session no-op would leave
    // the user stranded on the warn state until a push or close/re-open.
    const fx = createFixture();
    fx.trace.readState = vi.fn(() => Promise.resolve(ON));
    fx.trace.applyState = vi.fn(() => Promise.reject(new Error('no receiver')));
    await fx.machine.open(false, false, false);
    expect(fx.machine.snapshot()).toMatchObject({ session: true, failed: true });
    fx.trace.applyState = vi.fn(() => Promise.resolve(ON));
    await fx.machine.toggle(true);
    expect(fx.trace.applyState).toHaveBeenCalledWith(true);
    expect(fx.machine.snapshot()).toMatchObject({
      presentation: 'phone',
      session: true,
      failed: false
    });
    // The rule never actually left (the descope never landed), so the
    // loaded documents are already device era — a reload is neither needed
    // nor run.
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expectCoherent(fx.machine.snapshot());
  });
});

describe('toggleDesktop', () => {
  it('never asks and never reloads — the dress reflows live; the write joins the event', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false, false);
    await fx.machine.toggleDesktop(true);
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expect(fx.trace.refreshHalves).not.toHaveBeenCalled();
    expect(fx.trace.persistDesktop).toHaveBeenCalledWith(true);
    expect(fx.machine.snapshot()).toEqual({
      available: true,
      presentation: 'desktop',
      session: false,
      desktop: true,
      failed: false,
      busy: false
    });
    expectCoherent(fx.machine.snapshot());
  });

  it('a phone session yields: the presentation stays phone, the choice persists under it', async () => {
    const fx = createFixture();
    await primedPhone(fx);
    const commands = fx.trace.applyState.mock.calls.length;
    const refreshes = fx.trace.refreshHalves.mock.calls.length;
    await fx.machine.toggleDesktop(true);
    expect(fx.trace.applyState).toHaveBeenCalledTimes(commands);
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(refreshes);
    expect(fx.machine.snapshot()).toMatchObject({
      presentation: 'phone',
      session: true,
      desktop: true
    });
    expectCoherent(fx.machine.snapshot());
  });

  it('a previous desktop choice re-applies through the sessionless return of a toggle-off', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false, false);
    await fx.machine.toggleDesktop(true);
    await fx.machine.toggle(true);
    fx.trace.applyState = vi.fn(() => Promise.resolve(OFF));
    await fx.machine.toggle(false);
    expect(fx.machine.snapshot()).toMatchObject({
      presentation: 'desktop',
      session: false,
      desktop: true
    });
    expectCoherent(fx.machine.snapshot());
  });

  it('queues behind a mobile toggle and writes after it: two switches never interleave their writes', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false, false);
    const simToggle = fx.machine.toggle(true);
    const dressToggle = fx.machine.toggleDesktop(true);
    await Promise.all([simToggle, dressToggle]);
    expect(fx.trace.persist).toHaveBeenCalledWith(true);
    expect(fx.trace.persistDesktop).toHaveBeenCalledWith(true);
    // The persisted sim target tails the mobile event while the dress holds
    // under the engaged session.
    expect(fx.machine.snapshot()).toMatchObject({
      presentation: 'phone',
      session: true,
      desktop: true
    });
    expectCoherent(fx.machine.snapshot());
  });

  it('never rejects even with a throwing persist seam (the belt keeps it logged)', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false, false);
    fx.trace.persistDesktop = vi.fn(() => Promise.reject(new Error('storage dead')));
    await expect(fx.machine.toggleDesktop(true)).resolves.toBeUndefined();
    expect(fx.machine.snapshot().desktop).toBe(true);
    expect(fx.machine.snapshot().presentation).toBe('desktop');
    expectCoherent(fx.machine.snapshot());
  });
});

describe('close', () => {
  it('removes the rule without reloading: the presentation follows the truthful answer to the sessionless dress', async () => {
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

  it('the desktop option survives close and re-applies on the next open', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false, true);
    await fx.machine.toggleDesktop(false);
    expect(fx.machine.snapshot().desktop).toBe(false);
    expect(fx.machine.snapshot().presentation).toBe('auto');
    await fx.machine.close();
    expect(fx.machine.snapshot().desktop).toBe(false);
    // A close does not resurrect the dress; the next open reads the persisted
    // truth again.
    await fx.machine.open(false, false, true);
    expect(fx.machine.snapshot()).toMatchObject({
      presentation: 'desktop',
      session: false,
      desktop: true
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
    await fx.machine.open(false, false, false);
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
    await fx.machine.open(false, true, false);
    await fx.machine.close();
    expect(fx.trace.applyState).not.toHaveBeenCalled();
    expect(fx.machine.snapshot().presentation).toBe('auto');
    expectCoherent(fx.machine.snapshot());
  });

  it('skips the removal when the machine was never asked (no rule could exist)', async () => {
    const fx = createFixture();
    // Before any ask, the machine's desktop knowledge is its initial value:
    // the machineless close keeps the coherent initial mirror.
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
    await fx.machine.open(false, false, false);
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

  it('a pushed-off state lands on the machine dress: the sessionless convergence re-applies it', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false, true);
    await fx.machine.toggle(true);
    fx.machine.pushed(OFF);
    expect(fx.trace.applyState).toHaveBeenCalledTimes(1); // only the priming toggle
    expect(fx.trace.refreshHalves).toHaveBeenCalledTimes(1); // only the priming toggle
    expect(fx.machine.snapshot()).toMatchObject({
      presentation: 'desktop',
      session: false,
      desktop: true
    });
    expectCoherent(fx.machine.snapshot());
  });

  it('a push arriving mid-command converges first and the command resolution still decides', async () => {
    const fx = createFixture();
    await fx.machine.open(false, false, false);
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

  it("the command's OWN mid-flight push (the background pushes its settled state before the reply) cannot skip the reload", async () => {
    // The exact dispatch the background performs (device-simulation's handler
    // notifies the settled state, then returns it): if the push lands while
    // the ask is in flight and the flip key were read after the await, the
    // push-corrected session would silence the reload the transition
    // demands — phone-dressed frames showing real-UA documents. The key is
    // the command's entry session, so the reload runs.
    const fx = createFixture();
    await fx.machine.open(false, false, false);
    const late = deferred();
    fx.trace.applyState = vi.fn(() => late.promise);
    const toggling = fx.machine.toggle(true);
    await Promise.resolve();
    expect(fx.machine.snapshot().busy, 'the ask is in flight').toBe(true);
    fx.machine.pushed(ON); // the same state the ask will return
    late.resolve(ON);
    await toggling;
    expect(
      fx.trace.refreshHalves,
      'the identity change re-navigates the halves exactly once'
    ).toHaveBeenCalledTimes(1);
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
   * The machine's rule/presentation invariants as a scripted lifecycle:
   * every settled event ends coherent — no live rule at a sessionless
   * presentation, no phone without live requests, unavailability still
   * coherent with the dress, failures flagged and busy-free.
   */
  it('every event of a scripted lifecycle keeps the presentation honest', async () => {
    const fx = createFixture();
    await fx.machine.open(true, true, true); // psi: everything skipped
    expect(fx.machine.snapshot()).toEqual(INITIAL_PRESENTATION_SNAPSHOT);
    await fx.machine.open(false, true, true); // first open, mobile on + dress on → the phone session wins
    expect(fx.machine.snapshot().presentation).toBe('phone');
    await fx.machine.toggle(false); // switch off mid-session → the persisted dress re-applies
    expect(fx.machine.snapshot().presentation).toBe('desktop');
    await fx.machine.toggleDesktop(false); // dress off → fluid
    expect(fx.machine.snapshot().presentation).toBe('auto');
    await fx.machine.toggle(true); // back on
    expect(fx.machine.snapshot().presentation).toBe('phone');
    await fx.machine.close(); // rule gone, sessionless dress (persisted off)
    expect(fx.machine.snapshot().presentation).toBe('auto');
    await fx.machine.open(false, true, false); // re-open with the target on → phone again
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
        expect(['auto', 'phone', 'desktop']).toContain(snapshot.presentation);
      }
    }
  });

  it('a failed settle is still coherent: the truthful state stands and the flag marks the contradiction', async () => {
    // A toggle-on answered by a judicial refusal: the state stays off (the
    // truthful mirror), the failed branch flags the contradiction.
    const fx = createFixture();
    await fx.machine.open(false, false, false);
    fx.trace.applyState = vi.fn(() => Promise.resolve(OFF));
    await fx.machine.toggle(true);
    expectCoherent(fx.machine.snapshot());
    expect(fx.machine.snapshot().failed).toBe(true);
  });
});
