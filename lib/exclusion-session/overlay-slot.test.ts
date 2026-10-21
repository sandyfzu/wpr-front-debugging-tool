import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OVERLAY_CLAIM_TTL_MS,
  OVERLAY_SLOT_GLOBAL,
  claimOverlaySlot,
  claimedPresentation,
  holdOverlaySlot,
  parseOverlaySlotVerdict,
  type LiveOverlay,
  type OverlaySlotRequest
} from './overlay-slot';

const scope = globalThis as unknown as Record<string, unknown>;
const ORIGIN = location.origin;

const reopen = (presentation: 'open' | 'folded' = 'folded'): OverlaySlotRequest => ({
  mode: 'reopen',
  presentation,
  origin: ORIGIN,
  claimTtlMs: OVERLAY_CLAIM_TTL_MS
});
const open: OverlaySlotRequest = {
  mode: 'open',
  presentation: null,
  origin: null,
  claimTtlMs: OVERLAY_CLAIM_TTL_MS
};

/** A live instance whose liveness and reveal are controllable. */
function live(alive = true, reveal = true): LiveOverlay & { reveals: number } {
  const handle = {
    state: 'live' as const,
    reveals: 0,
    alive: () => alive,
    reveal: () => {
      handle.reveals += 1;
      return reveal;
    }
  };
  return handle;
}

afterEach(() => {
  Reflect.deleteProperty(scope, OVERLAY_SLOT_GLOBAL);
  vi.useRealTimers();
});

describe('claimOverlaySlot (run in the page)', () => {
  it('claims an empty slot with the presentation, and a second claim waits (one injection)', () => {
    expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, reopen('folded'))).toBe('inject');
    expect(claimedPresentation(scope)).toBe('folded');
    // Two load events racing: the second re-open sees the claim.
    expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, reopen('open'))).toBe('pending');
    expect(claimedPresentation(scope)).toBe('folded');
  });

  it('lets an explicit open upgrade a pending re-open to start open and focused', () => {
    claimOverlaySlot(OVERLAY_SLOT_GLOBAL, reopen('folded'));
    expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, open)).toBe('pending');
    expect(claimedPresentation(scope)).toBeNull();
  });

  it('frees a claim past its time-to-live (the injection never mounted)', () => {
    vi.useFakeTimers();
    claimOverlaySlot(OVERLAY_SLOT_GLOBAL, reopen('folded'));
    vi.advanceTimersByTime(OVERLAY_CLAIM_TTL_MS);
    expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, reopen('open'))).toBe('inject');
    expect(claimedPresentation(scope)).toBe('open');
  });

  it('leaves a live overlay to a re-open, and reveals it to an explicit open', () => {
    const handle = live();
    holdOverlaySlot(scope, handle);
    expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, reopen())).toBe('live');
    expect(handle.reveals).toBe(0);
    expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, open)).toBe('revealed');
    expect(handle.reveals).toBe(1);
    expect(scope[OVERLAY_SLOT_GLOBAL]).toBe(handle);
  });

  it('replaces a dead instance (dead, refusing or throwing reveal)', () => {
    holdOverlaySlot(scope, live(false));
    expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, reopen())).toBe('inject');
    holdOverlaySlot(scope, live(true, false));
    expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, open)).toBe('inject');
    holdOverlaySlot(scope, {
      state: 'live',
      alive: () => {
        throw new Error('dead context');
      },
      reveal: () => true
    });
    expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, open)).toBe('inject');
    holdOverlaySlot(scope, {
      state: 'live',
      alive: () => true,
      reveal: () => {
        throw new Error('dead context');
      }
    });
    expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, open)).toBe('inject');
  });

  it('takes a request as Chromium delivers it: null-valued keys dropped', () => {
    // `{ presentation: null, origin: null }` arrives without both keys.
    const delivered = { mode: 'open', claimTtlMs: OVERLAY_CLAIM_TTL_MS } as OverlaySlotRequest;
    expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, delivered)).toBe('inject');
    expect(claimedPresentation(scope)).toBeNull();
    expect((scope[OVERLAY_SLOT_GLOBAL] as { presentation: unknown }).presentation).toBeNull();
  });

  it('refuses a page of another origin than the session’s (the tab moved on)', () => {
    expect(
      claimOverlaySlot(OVERLAY_SLOT_GLOBAL, { ...reopen(), origin: 'https://other.test' })
    ).toBe('other-origin');
    expect(OVERLAY_SLOT_GLOBAL in scope).toBe(false);
  });

  it('refuses a document that is not an HTML page', () => {
    const contentType = vi.spyOn(document, 'contentType', 'get').mockReturnValue('image/png');
    try {
      expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, open)).toBe('not-html');
      expect(OVERLAY_SLOT_GLOBAL in scope).toBe(false);
    } finally {
      contentType.mockRestore();
    }
  });

  it('is not fooled by the page: a host element of the overlay’s tag name is no slot', () => {
    const fake = document.createElement('wpr-fdt-exclusion-builder');
    document.documentElement.append(fake);
    try {
      expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, reopen())).toBe('inject');
    } finally {
      fake.remove();
    }
  });

  it('is self-contained (the browser serializes it without its module)', () => {
    expect(claimOverlaySlot.toString()).not.toMatch(/OVERLAY_|isOverlay|import|require\(/);
  });
});

describe('holdOverlaySlot', () => {
  it('releases only its own hold (a newer claim stays)', () => {
    const release = holdOverlaySlot(scope, live());
    // A reveal leaves the hold in place.
    expect(claimOverlaySlot(OVERLAY_SLOT_GLOBAL, open)).toBe('revealed');
    release();
    expect(OVERLAY_SLOT_GLOBAL in scope).toBe(false);
    const releaseOld = holdOverlaySlot(scope, live(false));
    // The dead instance's slot is claimed by a new open; its late release keeps the claim.
    claimOverlaySlot(OVERLAY_SLOT_GLOBAL, reopen('open'));
    releaseOld();
    expect(claimedPresentation(scope)).toBe('open');
  });
});

describe('claimedPresentation / parseOverlaySlotVerdict', () => {
  it('reads a claim’s presentation only (none for a live slot or junk)', () => {
    expect(claimedPresentation({})).toBeNull();
    expect(claimedPresentation({ [OVERLAY_SLOT_GLOBAL]: live() })).toBeNull();
    expect(
      claimedPresentation({ [OVERLAY_SLOT_GLOBAL]: { state: 'claimed', presentation: 'x' } })
    ).toBeNull();
  });

  it('accepts the verdicts only (a thrown probe answers undefined, an engine an error object)', () => {
    expect(parseOverlaySlotVerdict('inject')).toBe('inject');
    for (const junk of [undefined, null, true, { error: 'x' }, 'INJECT']) {
      expect(parseOverlaySlotVerdict(junk)).toBeNull();
    }
  });
});
