/**
 * The panel's view of the inspected tab's exclusion session: one ask at
 * mount, then the background's pushes (`exclusionSessionUpdated`) keep it
 * current. Pure state + words (the status bar's builder entry renders
 * them); the transport is injected.
 *
 * The panel says only what the record says about the tab — whether a given
 * page was rewritten is the overlay's to tell (it compares the served
 * document with the page on screen).
 */
import type { AskOutcome } from '../../../lib/messaging/bounded-ask';
import type {
  ExclusionOverlayOpenOutcome,
  ExclusionSessionSummary,
  ExclusionSessionTabSummary
} from '../../../lib/messaging/exclusion-panel';
import type { StatusKind } from '../../../components/ui/status-badge';
import { PAGE_UI_MENU_RESCUE, PAGE_UI_OPTIONS_RESCUE } from '../../../lib/page-commands/commands';
import { hudFeatureOf } from '../../../lib/detection/hud';
import type { SimulatedFeatureId } from '../../../lib/wp-rocket-simulation/spec';
import { joinWords } from '../../../utils/text';

/**
 * - `checking` — the first answer has not arrived.
 * - `known` — the tab's session summary (from the ask or a later push).
 * - `unknown` — the ask got no answer (no background, timeout, bad reply).
 */
export type BuilderSessionState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'known'; readonly summary: ExclusionSessionSummary }
  | { readonly kind: 'unknown' };

/** The state before any answer. */
export const BUILDER_SESSION_CHECKING: BuilderSessionState = { kind: 'checking' };

/**
 * Fold the mount ask's answer in (the one ask the entry makes). Only a
 * still-checking state takes it: a push that landed first is newer than
 * the answer (which was read before it), so it stands.
 *
 * @param state The current state.
 * @param outcome The ask's outcome.
 */
export function withAnswer(
  state: BuilderSessionState,
  outcome: AskOutcome<ExclusionSessionSummary>
): BuilderSessionState {
  if (state.kind !== 'checking') return state;
  return outcome.kind === 'reply' ? { kind: 'known', summary: outcome.reply } : { kind: 'unknown' };
}

/**
 * Fold a push in: only the background's pushes (no sender tab) about the
 * inspected tab count.
 *
 * @param state The current state.
 * @param push The validated push.
 * @param inspectedTabId The panel's inspected tab.
 * @param fromTab Whether the push came from a context with a tab (a content script).
 */
export function withPush(
  state: BuilderSessionState,
  push: ExclusionSessionTabSummary,
  inspectedTabId: number | null,
  fromTab: boolean
): BuilderSessionState {
  if (fromTab || push.tabId !== inspectedTabId) return state;
  return { kind: 'known', summary: push.summary };
}

/** The entry's words: a status badge (never color alone) and its explanation. */
export interface BuilderEntryView {
  readonly badge: { readonly kind: StatusKind; readonly label: string } | null;
  readonly description: string;
}

/** The host of an origin (the scheme only costs width). */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * The "On" description's opening, up to the colon: the exclusions, plus the
 * features the last document was simulated with by their full names — only
 * a document the step actually simulated (one left as served names no
 * simulation). Several features read as simulated by the extension, never
 * the site's configuration.
 *
 * @param simulated The features the last document was simulated with.
 */
function appliedLead(simulated: readonly SimulatedFeatureId[]): string {
  const names = simulated.map((id) => hudFeatureOf(id)?.label ?? id);
  if (names.length === 0) return 'Exclusions are applied in this tab';
  if (names.length === 1)
    return `Exclusions and a simulated ${names.join('')} are applied in this tab`;
  return `Exclusions are applied in this tab, with ${joinWords(names)} simulated by the extension (not the site’s configuration)`;
}

/**
 * The entry's words for a state.
 *
 * @param state The session state.
 */
export function builderEntryView(state: BuilderSessionState): BuilderEntryView {
  if (state.kind === 'checking') {
    return { badge: null, description: 'Checking the exclusion session of this tab.' };
  }
  if (state.kind === 'unknown') {
    return {
      badge: null,
      description:
        'The exclusion session of this tab could not be read. Open the builder to see it.'
    };
  }
  const summary = state.summary;
  switch (summary.state) {
    case 'inactive':
      return {
        badge: { kind: 'neutral', label: 'Off' },
        description: 'No exclusions applied in this tab.'
      };
    case 'active':
      return {
        badge: { kind: 'ok', label: 'On' },
        description: `${appliedLead(summary.simulated ?? [])}: pages of ${hostOf(summary.origin)} load rewritten until Stop or the tab closes. Open the builder to see this page’s result.`
      };
    case 'unavailable':
      return {
        badge: { kind: 'error', label: 'Unavailable' },
        description:
          'The browser could not intercept this tab’s pages. Open the builder for the cause and the remedy.'
      };
  }
}

/** A toast to show after an open: its tone, title and remedy. */
export interface OpenFeedback {
  readonly tone: 'success' | 'error';
  readonly title: string;
  readonly description?: string;
}

/** The remedy shared by every open that got no usable answer. */
const OPEN_RETRY = 'Try again, or open it from the extension toolbar button’s menu.';

/**
 * The feedback of an open attempt.
 *
 * @param outcome The ask's outcome (its reply is the background's open outcome).
 */
export function openFeedback(outcome: AskOutcome<ExclusionOverlayOpenOutcome>): OpenFeedback {
  if (outcome.kind !== 'reply') {
    return { tone: 'error', title: 'The exclusion builder didn’t open', description: OPEN_RETRY };
  }
  switch (outcome.reply) {
    case 'injected':
      return { tone: 'success', title: 'Exclusion builder opened on the page' };
    case 'revealed':
      return { tone: 'success', title: 'Exclusion builder shown on the page' };
    case 'unsupported-page':
      return {
        tone: 'error',
        title: 'This page can’t host the exclusion builder',
        description: 'Open a regular http or https page in this tab.'
      };
    case 'not-html':
      return {
        tone: 'error',
        title: 'This page isn’t a web page the builder can open on',
        description:
          'The exclusion builder works on HTML pages, not on images, feeds or other files.'
      };
    case 'tab-gone':
      return {
        tone: 'error',
        title: 'The exclusion builder didn’t open',
        description: 'The inspected tab is gone.'
      };
    case 'page-ui-off':
      return {
        tone: 'error',
        title: 'On-page UI is off',
        description: `The builder lives on the page. Turn on-page UI back on from ${PAGE_UI_MENU_RESCUE} or ${PAGE_UI_OPTIONS_RESCUE}, then open it again.`
      };
    case 'failed':
      return { tone: 'error', title: 'The exclusion builder didn’t open', description: OPEN_RETRY };
  }
}
