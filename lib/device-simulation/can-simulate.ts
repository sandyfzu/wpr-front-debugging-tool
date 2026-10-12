/**
 * The enable decision, pure so every caller asks one question and gets one
 * answer: simulation exists on a debugged site tab when the browser can
 * deliver it — and never on the analysis host, where the overlay is a viewer
 * over a remote flow, not a session to spoof.
 */

/** The two facts a caller resolves before asking. */
export interface DeviceSimAvailability {
  /** The browser exposes session DNR (feature-detected once: `'declarativeNetRequest' in browser`). */
  dnrAvailable: boolean;
  /** The sender resolves to the PSI auto-flow host (an analysis page), not a debugged site. */
  analysisHost: boolean;
}

/**
 * Whether a device-simulation request may run for the caller.
 *
 * @param availability The caller's resolved facts.
 * @returns True only when the browser can simulate and the caller is not the
 *   analysis host. An unavailable browser degrades the whole capability
 *   (Firefox keeps it disabled, never half-working).
 */
export function canSimulate(availability: DeviceSimAvailability): boolean {
  return availability.dnrAvailable && !availability.analysisHost;
}
