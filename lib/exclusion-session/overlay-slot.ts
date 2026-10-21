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
  /** The claiming open's token (its injection failing releases only its own claim). */
  readonly token: string;
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
  /** This open's token, unique per open (see {@link releaseOverlayClaim}). */
  readonly token: string;
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
  const type = document.contentType;
  if (type !== 'text/html' && type !== 'application/xhtml+xml') return 'not-html';
  // Loose on purpose: Chromium's argument serialization drops null-valued
  // keys (verified on CFT 156), so "any origin" arrives as an absent key.
  if (typeof request.origin === 'string' && location.origin !== request.origin) {
    return 'other-origin';
  }
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
  scope[key] = {
    state: 'claimed',
    presentation: request.presentation ?? null,
    at: Date.now(),
    token: request.token
  };
  return 'inject';
}

/**
 * Release a claim whose injection failed (run in the page, serialized like
 * {@link claimOverlaySlot}): only while the slot still holds that very
 * claim — a newer claim or a live instance stays.
 *
 * @param key The slot's global name.
 * @param token The failed open's token.
 * @returns Whether the claim was released.
 */
export function releaseOverlayClaim(key: string, token: string): boolean {
  const scope = globalThis as unknown as Record<string, unknown>;
  const slot = scope[key] as { state?: unknown; token?: unknown } | undefined;
  if (slot?.state !== 'claimed' || slot.token !== token) return false;
  Reflect.deleteProperty(scope, key);
  return true;
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
 * Take the slot for a starting instance (at once, before it mounts, so an
 * explicit open in between reveals it rather than replacing it); returns
 * its release, which clears the slot only while it still holds this
 * instance (a newer claim stays).
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

/** A starting overlay's hold on the slot (taken before it mounts). */
export interface StartingOverlay {
  /**
   * The view mounted: its host (liveness) and its reveal (runs at once if
   * an open asked for a reveal while it was mounting).
   */
  attach(host: { readonly isConnected: boolean }, reveal: () => void): void;
  /** Leave the slot (closed, superseded, invalidated, or the mount failed). */
  release(): void;
}

/**
 * Hold the slot for an overlay from the moment its script starts, so an
 * explicit open while it mounts reveals it instead of replacing it. Until
 * it mounts it counts as alive for `mountWindowMs` (a mount that never
 * finishes stops blocking opens then).
 *
 * @param scope The isolated world's global object.
 * @param isInvalid Whether the instance's context is dead.
 * @param now Epoch ms now.
 * @param mountWindowMs How long a mount may take before the hold lapses.
 * @param key The slot's global name.
 */
export function holdStartingOverlay(
  scope: Record<string, unknown>,
  isInvalid: () => boolean,
  now: () => number,
  mountWindowMs: number = OVERLAY_CLAIM_TTL_MS,
  key: string = OVERLAY_SLOT_GLOBAL
): StartingOverlay {
  const startedAt = now();
  let host: { readonly isConnected: boolean } | null = null;
  let reveal: (() => void) | null = null;
  let revealAsked = false;
  const release = holdOverlaySlot(
    scope,
    {
      state: 'live',
      alive: () =>
        !isInvalid() && (host === null ? now() - startedAt < mountWindowMs : host.isConnected),
      reveal: () => {
        if (isInvalid()) return false;
        if (reveal === null) revealAsked = true;
        else reveal();
        return true;
      }
    },
    key
  );
  return {
    attach(mountedHost, mountedReveal) {
      host = mountedHost;
      reveal = mountedReveal;
      if (revealAsked) {
        revealAsked = false;
        mountedReveal();
      }
    },
    release
  };
}
