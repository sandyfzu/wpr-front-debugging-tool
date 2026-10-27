/**
 * The copy confirmation's rhythm, in a module with no UI dependencies so
 * surfaces outside the Tailwind/Kobalte primitives (shadow-root overlays)
 * time their flash with it too.
 */

/**
 * How long the check confirmation state lingers after a successful copy (ms).
 * The shared flash's one declaring site — every flash consumer times with it,
 * so confirmation feedback keeps one rhythm everywhere.
 */
export const COPIED_FLASH_MS = 1600;
