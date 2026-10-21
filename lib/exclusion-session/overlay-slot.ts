/**
 * The overlay's slot in a tab's top document: one global in the
 * extension's isolated world (content scripts of one extension share a
 * frame's isolated world, so the page can neither read nor spoof it),
 * holding either a **claim** (an injection is on its way, with the
 * presentation it starts in) or the **live** instance (its liveness check
 * and its reveal). The background claims the slot with
 * {@link claimOverlaySlot} before it injects anything, in one synchronous
 * step in the page — so two opens racing each other inject once.
 *
 * Opens:
 * - a re-open (a session tab's page loaded) never touches a live or
 *   pending overlay;
 * - an explicit open (context menu, panel) reveals a live overlay instead
 *   of replacing it (replacement would drop its unsaved draft and view
 *   state), upgrades a pending one to start open and focused, and injects
 *   only when there is none. (Turning the explicit open into a toggle is
 *   one branch in the live arm.)
 */
import type { OverlayPresentation } from './overlay-reopen';

/** The slot's global name in the isolated world. */
export const OVERLAY_SLOT_GLOBAL = '__wprFdtOverlaySlot';

/**
 * How long a claim holds the slot without its instance going live (the
 * injection failed, or the page left): past it, a new open may claim again.
 */
export const OVERLAY_CLAIM_TTL_MS = 10_000;

/** A claim: an overlay injection is on its way. */
export interface OverlayClaim {
  readonly state: 'claimed';
  /** How it starts (`null`: an explicit open — the panel, focused). */
  presentation: OverlayPresentation | null;
  /** Epoch ms of the claim. */
  readonly at: number;
}

/** The live instance's handle. */
export interface LiveOverlay {
  readonly state: 'live';
  /** Whether the instance still runs (its context valid, its host in the page). */
  alive(): boolean;
  /** Unfold and focus it; false when it cannot (it is dead). */
  reveal(): boolean;
}

/** What the slot holds. */
export type OverlaySlot = OverlayClaim | LiveOverlay;

/** What an open asks the page for. */
export interface OverlaySlotRequest {
  /** `open` = explicit, `reopen` = a session page loaded. */
  readonly mode: 'open' | 'reopen';
  /** How an injected overlay starts (`null` for an explicit open). */
  readonly presentation: OverlayPresentation | null;
  /** The origin the page must have (a re-open's session origin), or null for any. */
  readonly origin: string | null;
  readonly claimTtlMs: number;
}

/**
 * The page's answer:
 * - `inject` — the slot is claimed for this open: inject the overlay now;
 * - `live` — an overlay runs (a re-open leaves it be);
 * - `revealed` — an explicit open unfolded and focused the live overlay;
 * - `pending` — an injection is on its way (an explicit open made it
 *   start open and focused);
 * - `other-origin` — the document is not of the expected origin (the tab
 *   moved on since the load event);
 * - `not-html` — the document is not an HTML page (an image, a feed, …).
 */
export type OverlaySlotVerdict =
  'inject' | 'live' | 'revealed' | 'pending' | 'other-origin' | 'not-html';

/** Every verdict (the background checks what the page answered). */
export const OVERLAY_SLOT_VERDICTS: readonly OverlaySlotVerdict[] = [
  'inject',
  'live',
  'revealed',
  'pending',
  'other-origin',
  'not-html'
];

/**
 * Claim the slot (run in the page's isolated world by `executeScript`, so
 * it is serialized: self-contained, JSON arguments, no imports).
 *
 * @param key The slot's global name.
 * @param request The open.
 * @returns The verdict.
 */
export function claimOverlaySlot(key: string, request: OverlaySlotRequest): OverlaySlotVerdict {
  if (document.contentType !== 'text/html') return 'not-html';
  if (request.origin !== null && location.origin !== request.origin) return 'other-origin';
  const scope = globalThis as unknown as Record<string, unknown>;
  const slot = scope[key] as
    | { state?: unknown; at?: unknown; presentation?: unknown; alive?: unknown; reveal?: unknown }
    | undefined;
  if (slot?.state === 'live' && typeof slot.alive === 'function') {
    let alive = false;
    try {
      alive = (slot.alive as () => unknown)() === true;
    } catch {
      alive = false;
    }
    if (alive) {
      if (request.mode === 'reopen') return 'live';
      try {
        if (typeof slot.reveal === 'function' && (slot.reveal as () => unknown)() === true) {
          return 'revealed';
        }
      } catch {
        // A reveal that throws is a dead instance: claim below and replace it.
      }
    }
  } else if (
    slot?.state === 'claimed' &&
    typeof slot.at === 'number' &&
    Date.now() - slot.at < request.claimTtlMs
  ) {
    // The coming instance starts open and focused for an explicit open.
    if (request.mode === 'open') slot.presentation = null;
    return 'pending';
  }
  scope[key] = { state: 'claimed', presentation: request.presentation, at: Date.now() };
  return 'inject';
}

/** Whether a value is a presentation. */
function isOverlayPresentation(value: unknown): value is OverlayPresentation {
  return value === 'open' || value === 'folded';
}

/**
 * The presentation the claim asks the starting overlay for.
 *
 * @param scope The isolated world's global object.
 * @param key The slot's global name.
 * @returns The claimed presentation, or null (an explicit open, or no claim).
 */
export function claimedPresentation(
  scope: Record<string, unknown>,
  key: string = OVERLAY_SLOT_GLOBAL
): OverlayPresentation | null {
  const slot = scope[key] as { state?: unknown; presentation?: unknown } | undefined;
  if (slot?.state !== 'claimed') return null;
  return isOverlayPresentation(slot.presentation) ? slot.presentation : null;
}

/**
 * Take the slot for a mounted instance; returns its release, which clears
 * the slot only while it still holds this instance (a newer claim stays).
 *
 * @param scope The isolated world's global object.
 * @param live The instance's handle.
 * @param key The slot's global name.
 */
export function holdOverlaySlot(
  scope: Record<string, unknown>,
  live: LiveOverlay,
  key: string = OVERLAY_SLOT_GLOBAL
): () => void {
  scope[key] = live;
  return () => {
    if (scope[key] === live) Reflect.deleteProperty(scope, key);
  };
}

/**
 * Narrow what the page answered (a thrown probe or a foreign engine's
 * error object is not a verdict).
 *
 * @param value The injection result.
 */
export function parseOverlaySlotVerdict(value: unknown): OverlaySlotVerdict | null {
  return OVERLAY_SLOT_VERDICTS.find((verdict) => verdict === value) ?? null;
}
