/**
 * The compare overlay's mobile-simulation machine: a small, pure sequencer
 * that turns the persisted setting and the switch into exactly the session
 * the background answers, with both halves re-navigating when — and only
 * when — the tab's request identity changes.
 *
 * The two invariants its states guarantee (settled, i.e. no command in
 * flight and not flagged failed):
 * - a live rule never coexists with presentation `'auto'` — a session that
 *   is off leaves the tab's document requests in their own identity;
 * - a `'phone'` presentation never exists without a live rule and its
 *   reloaded documents — no half renders 412×892 while sending the real UA,
 *   and no phone UA serves desktop-sized frames.
 *
 * Ordering: every command awaits the `setDeviceSimulation` ask's truth
 * before either half is refreshed (a late-resolving ask is still awaited),
 * and the both-halves reload precedes the presentation adoption. Toggles
 * that already match the presentation are no-ops (no ask, no reload), which
 * keeps a re-open with the setting unchanged a pure reveal. The analysis
 * host never asks at all — PSI Side-by-Side is untouched by this module.
 */

import type { DeviceSimState } from '../device-simulation/state';
import type { Logger } from '../logger';

/** What the overlay's halves render at: fluid boxes (`'auto'`) or the scaled phone frame (`'phone'`). */
export type SimPresentation = 'auto' | 'phone';

/** The machine's knowable facts at rest — mirrors the UI's expressive states. */
export interface MobileSimSnapshot {
  /**
   * Whether simulation exists here, from the last resolved ask; `null`
   * before the first ask (e.g. while unmounted, or on the analysis host
   * where no ask runs) — the switch stays hidden until an explicit answer.
   */
  available: boolean | null;
  /** What the frames render at, and after every resolved command what their documents were served by. */
  presentation: SimPresentation;
  /** The truthful request-session fact from the last resolved ask or push. */
  session: boolean;
  /** The last command's truthful state contradicted its target (an explicit UI branch — warn state, switch stays interactive). */
  failed: boolean;
  /** A command is in flight; the switch is disabled for its duration. */
  busy: boolean;
}

/** The initial facts, before any event: coherent, switchless. */
export const INITIAL_SIM_SNAPSHOT: Readonly<MobileSimSnapshot> = Object.freeze({
  available: null,
  presentation: 'auto',
  session: false,
  failed: false,
  busy: false
} satisfies MobileSimSnapshot);

/**
 * The machine's browser seams. Contracts the machine holds its callers to:
 * `readState` and `applyState` always resolve a parsed `DeviceSimState`
 * (the wiring validates the payload and degrades a thrown ask into the
 * unavailable shape); `refreshHalves` re-navigates both halves and may
 * no-op when the halves have no documents yet (a first open navigates at
 * mount, after the rule); `persist` never rejects (a failed write logs and
 * degrades to "not persisted").
 */
export interface MobileSimIO {
  /** The `getDeviceSimulation` ask (availability + current session). */
  readState(): Promise<DeviceSimState>;
  /** The `setDeviceSimulation` ask; resolves once the background has settled the tab's rule, returning the truthful state. */
  applyState(enabled: boolean): Promise<DeviceSimState>;
  /** Reload both halves' documents — the state-change side effect behind every presentation change. */
  refreshHalves(): void;
  /** Record the switch's intent in the persisted options (best-effort, same mechanics as the scroll-sync switch's write). */
  persist(enabled: boolean): Promise<void>;
  /** Degradation diagnostics. */
  log: Logger;
}

/** The sequencer the overlay's wiring drives. */
export interface MobileSimSession {
  /** The machine's current facts (a frozen snapshot; the last `onChange` payload). */
  snapshot(): Readonly<MobileSimSnapshot>;
  /**
   * The overlay's open event: reads the persisted target and the truth, and
   * — on the analysis host — does nothing at all (no asks, no state).
   *
   * @param psiMode The page is the PageSpeed Insights auto-flow host: simulation is refused there by design.
   * @param target The persisted `features.sbsMobileSim` value read fresh at open.
   */
  open(psiMode: boolean, target: boolean): Promise<void>;
  /**
   * A switch toggled: no-op when the presentation already matches, else
   * apply the command, then record the intent in the persisted options.
   *
   * @param next The switch's new position.
   */
  toggle(next: boolean): Promise<void>;
  /** The overlay's close event: the removal ask (best-effort per its contract), never a reload; the presentation follows the truthful answer. */
  close(): Promise<void>;
  /** A `deviceSimulationChanged` push landed: converge the presentation to it without asks or reloads (background-driven removals included). */
  pushed(state: DeviceSimState): void;
}

/**
 * Mirror a session fact to the presentation that matches it — the identity
 * pairing the invariants hold: session on ⇔ phone, session off ⇔ auto.
 *
 * @param session The truthful request-session fact.
 */
function mirrorOf(session: boolean): SimPresentation {
  return session ? 'phone' : 'auto';
}

/**
 * Create the machine over its seams.
 *
 * Events serialize through one promise chain, so an open, a toggle and a
 * close can never interleave their command/adopt ordering; pushes converge
 * synchronously (they always carry a settled truthful state).
 *
 * @param io The browser seams (the messaging/refresh/persist wiring, validated at the boundary).
 * @param onChange Receives every state movement (the wiring mirrors it into a Solid signal).
 */
export function createMobileSimSession(
  io: MobileSimIO,
  onChange: (snapshot: MobileSimSnapshot) => void
): MobileSimSession {
  let available: boolean | null = null;
  let presentation: SimPresentation = 'auto';
  let session = false;
  let failed = false;
  let busy = false;
  let tail: Promise<void> = Promise.resolve();

  /** Publish a frozen copy of the current facts. */
  function notify(): void {
    onChange(Object.freeze({ available, presentation, session, failed, busy }));
  }

  /**
   * Mark a command in flight / settled around `body`, converging the
   * presentation to the truthful answer. A truthful mismatch against the
   * target is the explicit failed branch (no reload — nothing changed in
   * the tab); a thrown ask is the unknown-truth degrade (state kept, failed
   * flag up, the next event or push reconciles). Refresh strictly follows
   * the ask's resolution and immediately precedes the presentation adoption.
   */
  async function command(wanted: SimPresentation): Promise<void> {
    busy = true;
    notify();
    let answer: DeviceSimState | null;
    try {
      answer = await io.applyState(wanted === 'phone');
    } catch (cause) {
      io.log.error(
        `The mobile-simulation ${wanted === 'phone' ? 'enable' : 'disable'} ask never resolved — the state stays ${presentation} until the next event`,
        cause
      );
      failed = true;
      busy = false;
      notify();
      return;
    }
    if (!answer.available) {
      // Defense in depth: an ask-level refusal is the unavailable degrade
      // (the switch stops being offered; nothing half-rendered remains).
      available = false;
      presentation = 'auto';
      session = false;
      failed = false;
      busy = false;
      notify();
      return;
    }
    available = true;
    const truth: SimPresentation = mirrorOf(answer.enabled);
    session = answer.enabled;
    failed = truth !== wanted;
    // Truthful match: the tab's requests now carry the wanted identity, so
    // the halves re-navigate first and the presentation is adopted after —
    // ordering that keeps "no phone frame without phone requests" honest.
    if (truth === wanted) io.refreshHalves();
    presentation = truth;
    busy = false;
    notify();
  }

  /**
   * Serialize an event body behind the chain; the returned promise signals
   * this event's completion and never rejects (a belt for a body bug: logged,
   * state kept).
   */
  function enqueue(name: string, body: () => Promise<void>): Promise<void> {
    const step = tail.then(body).catch((cause: unknown) => {
      io.log.error(`The ${name} of the mobile-simulation machine failed`, cause);
    });
    tail = step.then(() => undefined);
    return step;
  }

  return {
    snapshot(): Readonly<MobileSimSnapshot> {
      return Object.freeze({ available, presentation, session, failed, busy });
    },

    open(psiMode: boolean, target: boolean): Promise<void> {
      return enqueue('open', async () => {
        if (psiMode) return; // No asks on the analysis host — PSI is never touched.
        let answer: DeviceSimState | null;
        try {
          answer = await io.readState();
        } catch (cause) {
          // readState's contract is resolve-only; a violation still degrades
          // instead of half-rendering the switch behind a broken ask.
          io.log.error('The simulation availability ask failed — the switch stays hidden', cause);
          answer = { available: false, enabled: false };
        }
        if (!answer.available) {
          available = false;
          session = false;
          presentation = 'auto';
          failed = false;
          notify();
          return;
        }
        available = true;
        // Converge the tab to the target: a rule already live with the setting
        // off comes off (the settled-open invariant), a rule needed comes on.
        // The truth the ask just read is what session now reflects; a wanted
        // presentation that differs from it (or from the current dress) is a
        // command in either direction.
        const wanted: SimPresentation = target ? 'phone' : 'auto';
        const truthPhone = answer.enabled;
        session = truthPhone;
        if (wanted !== presentation || (!target && truthPhone)) {
          await command(wanted);
          return;
        }
        notify();
      });
    },

    toggle(next: boolean): Promise<void> {
      return enqueue('toggle', async () => {
        if (next === (presentation === 'phone')) {
          // Already there (inclusive of a re-commanded on): a no-op keeps the
          // re-open-with-unchanged-setting path a pure reveal — no ask, no reload.
          return;
        }
        await command(next ? 'phone' : 'auto');
        // The intent is recorded whatever the truthful outcome: a failed
        // convergence still retries by the next open with the setting on.
        // The write joins this event's serialized window — two rapid toggles
        // write their read-modify-writes in toggle order; concurrent writes
        // could resolve out of order and persist the stale intent, which the
        // next open would read as a false target. The seam's contract is
        // resolve-only (its own degradation lives in the wiring); a violating
        // rejection stays inside the queue's belt, logged.
        await io.persist(next);
        notify();
      });
    },

    close(): Promise<void> {
      return enqueue('close', async () => {
        if (available !== true) {
          presentation = 'auto';
          notify();
          return; // Nothing this machine could have created exists to remove.
        }
        busy = true;
        notify();
        let answer: DeviceSimState | null;
        try {
          answer = await io.applyState(false);
        } catch (cause) {
          io.log.error(
            'The closing removal ask never resolved — the session stays until reconciliation',
            cause
          );
          failed = true;
          busy = false;
          notify();
          return;
        }
        if (!answer.available) {
          available = false;
          presentation = 'auto';
          session = false;
          failed = false;
          busy = false;
          notify();
          return;
        }
        // The truthful answer rules the exit state; a refused removal keeps
        // the phone presentation (the requests truly still carry the UA) and
        // is the failed branch the warn state reports.
        session = answer.enabled;
        presentation = mirrorOf(answer.enabled);
        failed = answer.enabled;
        busy = false;
        notify();
      });
    },

    pushed(state: DeviceSimState): void {
      if (!state.available) {
        available = false;
        presentation = 'auto';
        session = false;
        failed = false;
        notify();
        return;
      }
      // A push is always a settled truthful state: converge without asks or
      // reloads (reload rides the tab's own next navigation; the presentation
      // and the label suffix follow the truth immediately).
      available = true;
      session = state.enabled;
      presentation = mirrorOf(state.enabled);
      failed = false;
      notify();
    }
  };
}
