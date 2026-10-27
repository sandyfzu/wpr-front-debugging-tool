/**
 * What the browser's debugger-API errors mean for a session. Chromium
 * reports every failure as a message string only (no codes), so each rule
 * matches the message's fixed leading text (ids and URLs follow it).
 * Messages verified against Chromium's debugger API and permission
 * sources (`debugger_api.cc`, `manifest_constants.h`, `constants.h`,
 * main branch, 2026-10-20) and observed on Chromium 156.
 */
import type { ArmUnavailableCause } from '../backend';

/** How an attach attempt failed. */
export type AttachFailure =
  /**
   * This extension already holds the tab (Chromium's "Another debugger is
   * already attached" names *this* extension's own session — other clients
   * never block an attach): adopt it.
   */
  | { readonly kind: 'already-attached' }
  /** The tab cannot be armed; `known` is false for an unrecognized message. */
  | { readonly kind: 'unavailable'; readonly cause: ArmUnavailableCause; readonly known: boolean };

/** One attach-error rule: the message's leading text and its meaning. */
interface AttachErrorRule {
  readonly prefix: string;
  readonly failure: AttachFailure;
}

/** An unavailability rule. */
function unavailable(prefix: string, cause: ArmUnavailableCause): AttachErrorRule {
  return { prefix, failure: { kind: 'unavailable', cause, known: true } };
}

/**
 * The attach-error table. "Cannot attach to this target." is what an
 * inspection ban answers (the `DeveloperToolsAvailability` policy refuses
 * the client) — it is also answered for an interstitial or PDF view, which
 * never host the overlay that asks to apply, so it reads as policy.
 */
const ATTACH_ERROR_RULES: readonly AttachErrorRule[] = [
  { prefix: 'Another debugger is already attached', failure: { kind: 'already-attached' } },
  unavailable('Cannot attach to this target.', 'debugging-policy'),
  unavailable(
    'This page cannot be scripted due to an ExtensionsSettings policy.',
    'debugging-policy'
  ),
  unavailable('Host access is restricted by policy.', 'debugging-policy'),
  unavailable('Screenshot capture is restricted', 'debugging-policy'),
  unavailable('Cannot access a chrome:// URL', 'unsupported-page'),
  unavailable('Cannot access a chrome-extension:// URL', 'unsupported-page'),
  unavailable('Cannot access contents of', 'unsupported-page'),
  unavailable('The extensions gallery cannot be scripted.', 'unsupported-page'),
  unavailable('The New Tab Page cannot be scripted.', 'unsupported-page'),
  unavailable('Cannot navigate to a file URL', 'unsupported-page'),
  // The tab went away between the ask and the attach.
  unavailable('No tab with given id', 'detached')
];

/** An unrecognized attach failure: retryable, never a claim about the page or a policy. */
const UNKNOWN_ATTACH_FAILURE: AttachFailure = {
  kind: 'unavailable',
  cause: 'attach-denied',
  known: false
};

/**
 * The message of a thrown browser error (the debugger API rejects with
 * `Error`s; anything else is stringified).
 *
 * @param error What was thrown.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Classify a failed attach.
 *
 * @param error What `attach` rejected with.
 */
export function classifyAttachError(error: unknown): AttachFailure {
  const message = errorMessage(error);
  return (
    ATTACH_ERROR_RULES.find((rule) => message.startsWith(rule.prefix))?.failure ??
    UNKNOWN_ATTACH_FAILURE
  );
}

/**
 * Whether a call failed because there is no session left to act on: this
 * extension holds none on the tab (detached — by the browser or by us), or
 * the tab itself is gone.
 *
 * @param error What `sendCommand` or `detach` rejected with.
 */
export function isNotAttachedError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.startsWith('Debugger is not attached') || message.startsWith('No tab with given id')
  );
}

/**
 * Whether a release failed because the paused request no longer exists —
 * its navigation was abandoned or replaced (Chromium answers "Invalid
 * InterceptionId." for a request it has dropped).
 *
 * @param error What `continueRequest` / `fulfillRequest` rejected with.
 */
export function isAbandonedRequestError(error: unknown): boolean {
  return errorMessage(error).startsWith('Invalid InterceptionId');
}
