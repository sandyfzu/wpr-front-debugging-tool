/**
 * The compare overlay's presentation machine: a small, pure sequencer owning
 * what the two halves render at — the desktop-width dress (`'desktop'`), the
 * fluid boxes (`'auto'`) or the scaled phone frame (`'phone'`) — from the two
 * independent facts it holds: the persisted desktop-width option and the
 * truthful device-simulation session.
 *
 * The pairing every settled state converges to is `presentationOf`:
 * session on ⇔ `'phone'` (the requests truly carry the device identity), and
 * a sessionless overlay wears its persisted dress (`'desktop'` or `'auto'`).
 * The two invariants its states guarantee (settled, i.e. no command in
 * flight and not flagged failed):
 * - a live rule never coexists with a sessionless presentation — a session
 *   that is off leaves the tab's document requests in their own identity;
 * - a `'phone'` presentation never exists without a live rule and its
 *   reloaded documents — no half renders 412×892 while sending the real UA.
 *
 * Reload discipline: the `setDeviceSimulation` ask's resolution decides the
 * reload, keyed on the session flip (captured at the command's entry — the
 * background pushes the settled state before the reply; a post-await key
 * read would see the push and skip the reload): a command that changes the
 * tab's request identity (phone↔auto/desktop, a needed rule add or removal)
 * re-navigates both halves — a stale-live rule's descope included, since its
 * removal is exactly such a change; a pure dress change (a desktop toggle,
 * whose ask-less adoption never touches the tab) reflows nothing on its
 * own. Desktop toggles ask nothing at all: the dress is layout-only.
 * Ordering: a reload strictly precedes the presentation adoption, keeping
 * "no phone frame without phone requests" honest. Toggles that already
 * match are no-ops (except onto a failed settle, where the switch's retry
 * copy must actually retry), which keeps a re-open with the settings
 * unchanged a pure reveal. The analysis host never asks at all — PSI
 * Side-by-Side is untouched by this module.
 */

import type { DeviceSimState } from '../device-simulation/state';
import type { Logger } from '../logger';

/** What the overlay's halves render at: fluid boxes (`'auto'`), the scaled phone frame (`'phone'`), or the desktop-width dress (`'desktop'`). */
export type FramePresentation = 'auto' | 'phone' | 'desktop';

/**
 * Mirror the two independent facts to the presentation that matches them —
 * the pairing every state change converges to.
 *
 * @param session The truthful request-session fact.
 * @param desktop The persisted desktop-width dress.
 */
export function presentationOf(session: boolean, desktop: boolean): FramePresentation {
  return session ? 'phone' : desktop ? 'desktop' : 'auto';
}

/** The machine's knowable facts at rest — mirrors the UI's expressive states. */
export interface PresentationSnapshot {
  /**
   * Whether device simulation exists here, from the last resolved ask; `null`
   * before the first ask (e.g. while unmounted, or on the analysis host
   * where no ask runs) — the mobile switch stays hidden until an explicit answer.
   */
  available: boolean | null;
  /** What the frames render at, and after every resolved command what their documents were served by. */
  presentation: FramePresentation;
  /** The truthful request-session fact from the last resolved ask or push. */
  session: boolean;
  /** The desktop-width dress the sessionless presentations wear (adopted from the persisted option at open; survives close). */
  desktop: boolean;
  /** The last command's truthful state contradicted its target (an explicit UI branch — warn state, switch stays interactive). */
  failed: boolean;
  /** A command is in flight; the mobile switch is disabled for its duration. */
  busy: boolean;
}

/** The initial facts, before any event: coherent, switchless. */
export const INITIAL_PRESENTATION_SNAPSHOT: Readonly<PresentationSnapshot> = Object.freeze({
  available: null,
  presentation: 'auto',
  session: false,
  desktop: false,
  failed: false,
  busy: false
} satisfies PresentationSnapshot);

/**
 * The machine's browser seams. Contracts the machine holds its callers to:
 * `readState` and `applyState` always resolve a parsed `DeviceSimState`
 * (the wiring validates the payload and degrades a thrown ask into the
 * unavailable shape); `refreshHalves` re-navigates both halves and may
 * no-op when the halves have no documents yet (a first open navigates at
 * mount, after the rule); both persist seams never reject (a failed write
 * logs and degrades to "not persisted") and serialize onto their shared
 * chain in the wiring, so two switches never interleave their
 * read-modify-writes.
 */
export interface PresentationStateIO {
  /** The `getDeviceSimulation` ask (availability + current session). */
  readState(): Promise<DeviceSimState>;
  /** The `setDeviceSimulation` ask; resolves once the background has settled the tab's rule, returning the truthful state. */
  applyState(enabled: boolean): Promise<DeviceSimState>;
  /** Reload both halves' documents — the state-change side effect behind every session flip. */
  refreshHalves(): void;
  /** Record the mobile switch's intent in the persisted options (best-effort resolve-only). */
  persist(enabled: boolean): Promise<void>;
  /** Record the desktop-width switch's choice in the persisted options (best-effort resolve-only). */
  persistDesktop(enabled: boolean): Promise<void>;
  /** Degradation diagnostics. */
  log: Logger;
}

/** The sequencer the overlay's wiring drives. */
export interface PresentationState {
  /** The machine's current facts (a frozen snapshot; the last `onChange` payload). */
  snapshot(): Readonly<PresentationSnapshot>;
  /**
   * The overlay's open event: reads the persisted targets and the truth, and
   * — on the analysis host — does nothing at all (no asks, no state).
   *
   * @param psiMode The page is the PageSpeed Insights auto-flow host: simulation is refused there by design.
   * @param simTarget The persisted `features.sbsMobileSim` value read fresh at open.
   * @param desktopTarget The persisted `features.sbsDesktopWidth` value read fresh at open.
   */
  open(psiMode: boolean, simTarget: boolean, desktopTarget: boolean): Promise<void>;
  /**
   * The mobile switch toggled: no-op when the session already matches, else
   * apply the command, then record the intent in the persisted options.
   *
   * @param next The switch's new position.
   */
  toggle(next: boolean): Promise<void>;
  /**
   * The desktop-width switch toggled: never asks (the dress is layout-only)
   * and reloads nothing — the frames reflow live. A phone session yields
   * (the switch is not even rendered then, so this branch is defense); the
   * choice persists and re-applies on the phone→sessionless return.
   *
   * @param next The switch's new position.
   */
  toggleDesktop(next: boolean): Promise<void>;
  /** The overlay's close event: the removal ask (best-effort per its contract), never a reload; the presentation follows the truthful answer. */
  close(): Promise<void>;
  /** A `deviceSimulationChanged` push landed: converge the presentation to it without asks or reloads (background-driven removals included). */
  pushed(state: DeviceSimState): void;
}

/**
 * Create the machine over its seams.
 *
 * Events serialize through one promise chain, so an open, a toggle or a
 * desktop toggle can never interleave their command/adopt ordering; pushes
 * converge synchronously (they always carry a settled truthful state).
 *
 * @param io The browser seams (the messaging/refresh/persist wiring, validated at the boundary).
 * @param onChange Receives every state movement (the wiring mirrors it into a Solid signal).
 */
export function createPresentationState(
  io: PresentationStateIO,
  onChange: (snapshot: PresentationSnapshot) => void
): PresentationState {
  let available: boolean | null = null;
  let presentation: FramePresentation = 'auto';
  let session = false;
  let desktop = false;
  let failed = false;
  let busy = false;

  /** Publish a frozen copy of the current facts. */
  function notify(): void {
    onChange(Object.freeze({ available, presentation, session, desktop, failed, busy }));
  }

  /**
   * The sessionless degrade: nothing of the capability exists here, and
   * whatever session this machine might have created is gone. The dress is
   * the machine's own knowledge — an unavailable engine still honors it
   * (the desktop switch renders and works there; only the mobile switch
   * hides), so the presentation follows it.
   */
  function degradeUnavailable(): void {
    available = false;
    session = false;
    failed = false;
    busy = false;
    presentation = presentationOf(false, desktop);
  }

  /**
   * Mark a command in flight / settled around `body`, converging the
   * presentation to the truthful answer. A truthful mismatch against the
   * target is the explicit failed branch (no reload — nothing changed in
   * the tab); a thrown ask is the unknown-truth degrade (state kept, failed
   * flag up, the next event or push reconciles). The reload keys on the
   * session flip — captured at the command's ENTRY, not after the ask
   * resolves: the background pushes the tab's settled state before the ask's
   * own reply lands (the same value for this very command), so a post-await
   * key read would see the push-corrected field and skip the reload the
   * transition demands. Only a command that actually moved the tab's request
   * identity re-navigates the halves, and it does so strictly before the
   * presentation adoption.
   */
  async function command(wanted: FramePresentation): Promise<void> {
    const flipFrom = session;
    busy = true;
    notify();
    let answer: DeviceSimState | null;
    try {
      answer = await io.applyState(wanted === 'phone');
    } catch (cause) {
      io.log.error(
        `The device-simulation ${wanted === 'phone' ? 'enable' : 'disable'} ask never resolved — the state stays ${presentation} until the next event`,
        cause
      );
      failed = true;
      busy = false;
      notify();
      return;
    }
    if (!answer.available) {
      // Defense in depth: an ask-level refusal is the unavailable degrade
      // (the mobile switch stops being offered; nothing half-rendered remains).
      degradeUnavailable();
      notify();
      return;
    }
    available = true;
    session = answer.enabled;
    failed = (wanted === 'phone') !== answer.enabled;
    // A session flip re-identifies the tab's documents: re-navigate both
    // halves first, then adopt the presentation — the ordering that keeps
    // "no phone frame without phone requests" honest. A pure dress command
    // (the session already answering off) never reloads.
    if (flipFrom !== answer.enabled) io.refreshHalves();
    presentation = presentationOf(answer.enabled, desktop);
    busy = false;
    notify();
  }

  /**
   * Serialize an event body behind the chain; the returned promise signals
   * this event's completion and never rejects (a belt for a body bug: logged,
   * state kept).
   */
  let tail: Promise<void> = Promise.resolve();
  function enqueue(name: string, body: () => Promise<void>): Promise<void> {
    const step = tail.then(body).catch((cause: unknown) => {
      io.log.error(`The ${name} of the presentation machine failed`, cause);
    });
    tail = step.then(() => undefined);
    return step;
  }

  return {
    snapshot(): Readonly<PresentationSnapshot> {
      return Object.freeze({ available, presentation, session, desktop, failed, busy });
    },

    open(psiMode: boolean, simTarget: boolean, desktopTarget: boolean): Promise<void> {
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
        // The persisted dress is the machine's knowledge now: adopted at the
        // open itself — BEFORE the capability branch, so an engine without
        // the device simulation still wears it (its desktop switch stays
        // offered) — and surviving close.
        desktop = desktopTarget;
        if (!answer.available) {
          degradeUnavailable();
          notify();
          return;
        }
        available = true;
        if (simTarget) {
          // The persisted target wants the session: a pure reveal only when
          // the mounted phone presentation truly matches the fresh truth —
          // a rule that died without ever pushing (a refused close that
          // removed it for real) would otherwise settle `phone` over a
          // sessionless tab, an invariant breach with a dead switch; the
          // fresh truth runs the command instead, exactly the add branch.
          if (presentation === 'phone' && answer.enabled) {
            session = answer.enabled;
            notify();
            return;
          }
          await command('phone');
          return;
        }
        if (answer.enabled) {
          // A rule this open did not need comes off (the settled-open
          // invariant); the removal is a genuine session flip because the
          // leftover truth feeds the command's key.
          session = answer.enabled;
          await command(presentationOf(false, desktop));
          return;
        }
        // No session exists or is wanted: adopt the dress if it moved (the
        // ask-free adoption keeps a re-open reveal ask-free and reload-free
        // — the loaded frames reflow live).
        session = answer.enabled;
        const wantedDress = presentationOf(false, desktop);
        if (wantedDress !== presentation) presentation = wantedDress;
        notify();
      });
    },

    toggle(next: boolean): Promise<void> {
      return enqueue('toggle', async () => {
        if (next === session && !failed) {
          // Already there (inclusive of a re-commanded on): a no-op keeps the
          // re-open-with-unchanged-setting path a pure reveal — no ask, no
          // reload. The `!failed` guard keeps the failures' retry affordance
          // honest (the switch's warn copy promises "flip it again to
          // retry"): a failed settle contradicts its own settled state, so a
          // flip onto it commands rather than no-ops.
          return;
        }
        await command(next ? 'phone' : presentationOf(false, desktop));
        // The intent is recorded whatever the truthful outcome: a failed
        // convergence still retries by the next open with the setting on.
        // The write joins this event's serialized window — two rapid toggles
        // write their read-modify-writes in toggle order (concurrent writes
        // could resolve out of order and persist the stale intent, which the
        // next open would read as a false target). The seam's contract is
        // resolve-only (its own degradation lives in the wiring); a violating
        // rejection stays inside the queue's belt, logged.
        await io.persist(next);
        notify();
      });
    },

    toggleDesktop(next: boolean): Promise<void> {
      return enqueue('toggleDesktop', async () => {
        // Layout only, by design: no ask, no reload — the frames reflow live
        // through the scale presenter. A phone session yields (the dress is
        // not rendered then; the persisted choice re-applies when the
        // session turns off).
        desktop = next;
        presentation = presentationOf(session, desktop);
        notify();
        await io.persistDesktop(next);
        notify();
      });
    },

    close(): Promise<void> {
      return enqueue('close', async () => {
        if (available !== true) {
          session = false;
          presentation = presentationOf(false, desktop);
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
          degradeUnavailable();
          notify();
          return;
        }
        // The truthful answer rules the exit state; a refused removal keeps
        // the phone presentation (the requests truly still carry the UA) and
        // is the failed branch the warn state reports. Nothing reloads: the
        // halves leave the screen with the overlay.
        session = answer.enabled;
        presentation = presentationOf(answer.enabled, desktop);
        failed = answer.enabled;
        busy = false;
        notify();
      });
    },

    pushed(state: DeviceSimState): void {
      if (!state.available) {
        degradeUnavailable();
        notify();
        return;
      }
      // A push is always a settled truthful state: converge without asks or
      // reloads (reload rides the tab's own next navigation; the presentation
      // follows the truth immediately).
      available = true;
      session = state.enabled;
      presentation = presentationOf(state.enabled, desktop);
      failed = false;
      notify();
    }
  };
}
