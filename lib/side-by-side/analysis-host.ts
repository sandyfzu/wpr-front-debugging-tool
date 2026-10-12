/**
 * The analysis host the compare flow runs on: PageSpeed Insights. One
 * constant for both surfaces that resolve against it — the overlay (its
 * auto-flow and its entry derivation) and the background (the simulated
 * device sessions' refusal boundary) — declared once here.
 */

/** Host PageSpeed Insights runs on. */
export const PSI_HOST = 'pagespeed.web.dev';

/**
 * Whether a URL is the PageSpeed Insights host (the overlay's compare flow
 * happens there, where the controls are owned by its self-driving analyses —
 * simulated-device sessions refuse it on principle).
 *
 * @param url The page URL.
 */
export function isPsiHost(url: URL): boolean {
  return url.host === PSI_HOST;
}
