/**
 * The simulated device: one mobile profile by owner directive — the compare
 * answers "what does this site do on a phone", not "which phone". Every other
 * piece of the module (rule derivation, frame presentation, identity) derives
 * from this single row; adding a device later means growing this row into a
 * registry plus its tests, never new branches.
 */

/** One simulated device: the request identity and the viewport it renders at. */
export interface DeviceProfile {
  /** Stable row identifier (`'phone'` for the one row). */
  id: string;
  /** The UA string put on document requests and shadowed into the page world. */
  userAgent: string;
  /** The frame's exact size in CSS px, portrait — presentation scales it, never reshapes it. */
  viewport: { width: number; height: number };
}

/**
 * The one device. UA tokens `Android` + `Mobile` are what UA decisions listen
 * for (Chrome's reduction keeps those exact tokens; the `K` replaces the
 * device model). The Chrome major is pinned at implementation time — 155,
 * stable since 2026-10-06 — and must be verified against the plugin's
 * server-side mobile decision on the local site before the feature ships; a
 * needed correction is recorded here, never assumed. Viewport is Pixel-class,
 * portrait, in CSS px (the presentation's fit scaling owns the mapping to the
 * window).
 */
export const DEVICE_SIMULATION_PROFILE: DeviceProfile = {
  id: 'phone',
  userAgent:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
  viewport: { width: 412, height: 892 }
};
