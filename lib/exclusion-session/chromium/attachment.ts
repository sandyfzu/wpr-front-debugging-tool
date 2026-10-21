/**
 * The per-tab attachment state machine of the Chromium backend — pure: a
 * state and an event in, the next state and what to report out. The
 * backend runs every arm/resume/disarm of a tab serialized (so the latest
 * of them wins by construction) and drives this machine from them and
 * from the browser's detach signal, which can land at any moment.
 *
 * ```
 * detached ── attach ─▶ attaching ── enabled ─▶ armed ── confirm ─▶ armed (re-tagged)
 *                          │                      │
 *                          ├── lost ──────────────┼──▶ detached          (our step found it dead)
 *                          ├── detach ────────────┴──▶ detaching ── detached ─▶ detached
 * any ── browser-detached ─▶ detached   (armed: its interception ended; attaching: the arm aborts)
 * ```
 *
 * The generation (the session's start time) is the tag the backend was
 * armed or resumed with; an end is reported with the generation of the
 * attachment that ended.
 */
/** A tab's attachment. */
export type Attachment =
  | { readonly phase: 'detached' }
  /** An arm/resume is attaching and enabling interception. */
  | { readonly phase: 'attaching'; readonly generation: number }
  /** Interception is live, tagged with `generation`. */
  | { readonly phase: 'armed'; readonly generation: number }
  /** A disarm is detaching. */
  | { readonly phase: 'detaching' };

/** What can happen to a tab's attachment. */
export type AttachmentEvent =
  /** An arm/resume starts attaching a detached tab. */
  | { readonly type: 'attach'; readonly generation: number }
  /** An arm/resume found the armed attachment alive: re-tag it. */
  | { readonly type: 'confirm'; readonly generation: number }
  /** Interception was enabled on the attaching tab. */
  | { readonly type: 'enabled' }
  /** An arm/resume step found the attachment unusable (failed or already gone). */
  | { readonly type: 'lost' }
  /** A disarm starts detaching. */
  | { readonly type: 'detach' }
  /** The disarm's detach finished. */
  | { readonly type: 'detached' }
  /** The browser ended the session. */
  | { readonly type: 'browser-detached' };

/**
 * What a transition asks the backend to do besides moving. The cause is
 * the backend's to work out (it may need the tab's presence, read after
 * the move — the move itself is synchronous, so no later step of a tab
 * ever sees a stale attachment).
 */
export type AttachmentEffect =
  /** The live interception tagged `generation` ended: report it. */
  | { readonly kind: 'interception-ended'; readonly generation: number }
  /** The arm in flight lost its attachment: it fails. */
  | { readonly kind: 'arm-aborted' };

/** A transition's result. */
export interface AttachmentTransition {
  readonly next: Attachment;
  readonly effect: AttachmentEffect | null;
}

/** The detached state. */
export const DETACHED: Attachment = { phase: 'detached' };

/** A move with no effect. */
function move(next: Attachment): AttachmentTransition {
  return { next, effect: null };
}

/**
 * The browser ended the session: always detached; an armed attachment's
 * interception ended, an attaching one's arm aborts.
 */
function browserDetached(state: Attachment): AttachmentTransition {
  if (state.phase === 'armed') {
    return { next: DETACHED, effect: { kind: 'interception-ended', generation: state.generation } };
  }
  if (state.phase === 'attaching') return { next: DETACHED, effect: { kind: 'arm-aborted' } };
  return move(DETACHED);
}

/**
 * The next attachment for an event, or null when the event is not
 * accepted in that state (the backend treats it as "the step was
 * overtaken" — e.g. the browser detached while it ran).
 *
 * @param state The tab's attachment.
 * @param event What happened.
 */
export function transitionAttachment(
  state: Attachment,
  event: AttachmentEvent
): AttachmentTransition | null {
  switch (event.type) {
    case 'attach':
      return state.phase === 'detached'
        ? move({ phase: 'attaching', generation: event.generation })
        : null;
    case 'confirm':
      return state.phase === 'armed'
        ? move({ phase: 'armed', generation: event.generation })
        : null;
    case 'enabled':
      return state.phase === 'attaching'
        ? move({ phase: 'armed', generation: state.generation })
        : null;
    case 'lost':
      return state.phase === 'attaching' || state.phase === 'armed' ? move(DETACHED) : null;
    case 'detach':
      return state.phase === 'attaching' || state.phase === 'armed'
        ? move({ phase: 'detaching' })
        : null;
    case 'detached':
      return state.phase === 'detaching' ? move(DETACHED) : null;
    case 'browser-detached':
      return browserDetached(state);
  }
}

/**
 * Whether a paused request of the tab may be considered for a rewrite:
 * every phase but `detaching` (a pause can reach a background whose
 * attachment record was lost — e.g. after a restart — and the host still
 * gates it on the session record; while detaching, the session is ending).
 *
 * @param state The tab's attachment.
 */
export function mayRewrite(state: Attachment): boolean {
  return state.phase !== 'detaching';
}
