/**
 * The consent page's flow over the pure machine
 * (`lib/data-consent/consent-state`): read the grant, ask on the user's
 * click, tell the waiting tool the answer, then leave — back to the tool
 * (the tab closes) or on to PageSpeed Insights (the tab navigates). A grant
 * given elsewhere meanwhile (another consent tab, the Add-ons Manager)
 * settles this page the same way: no tab is left asking for a grant held.
 *
 * Firefox accepts `permissions.request` only while it handles the user's
 * input, so {@link ConsentFlow.allow} calls it first, synchronously, before
 * any await or state write.
 */
import { createSignal, type Accessor } from 'solid-js';
import { DATA_CONSENT_PERMISSIONS, DATA_CONSENT_TYPE } from '../../lib/data-consent/consent';
import type { DataConsentPageQuery } from '../../lib/data-consent/consent-page-url';
import {
  dataConsentStep,
  INITIAL_DATA_CONSENT_STATE,
  type DataConsentEvent,
  type DataConsentState
} from '../../lib/data-consent/consent-state';
import type { DataConsentApi } from '../../lib/data-consent/consent';
import type { Logger } from '../../lib/logger';

/** What the flow runs against (production binds Firefox's APIs; tests inject doubles). */
export interface ConsentFlowDeps {
  readonly query: DataConsentPageQuery;
  /** Whether the grant is held now (rejects when the read fails). */
  readonly hasConsent: () => Promise<boolean>;
  readonly request: DataConsentApi['request'];
  /**
   * Follow grant removals (the Add-ons Manager's switch) while the page is
   * open; returns the unsubscribe.
   */
  readonly watchRemoved: (onRemoved: (dataCollection: readonly string[]) => void) => () => void;
  /** Follow grants given while the page is open (anywhere); returns the unsubscribe. */
  readonly watchAdded: (onAdded: (dataCollection: readonly string[]) => void) => () => void;
  /** Tell the waiting tool the answer (never rejects: a tool no longer open is fine). */
  readonly sendAnswer: (granted: boolean) => Promise<void>;
  /** Close this tab (rejects when it cannot). */
  readonly closeTab: () => Promise<void>;
  /** Replace this page with `url`. */
  readonly navigate: (url: string) => void;
  readonly log: Logger;
}

/** The page's controller. */
export interface ConsentFlow {
  readonly state: Accessor<DataConsentState>;
  /** The tab could not close itself: the page offers a Close button that tries again. */
  readonly closeFailed: Accessor<boolean>;
  /** Start the check (once, at mount). */
  readonly start: () => Promise<void>;
  /** Allow (call straight from the click handler). */
  readonly allow: () => Promise<void>;
  /** Not now: decline without the browser prompt. */
  readonly decline: () => Promise<void>;
  /** Close this tab. */
  readonly close: () => Promise<void>;
  readonly dispose: () => void;
}

/**
 * Summarize a cause for the user and the log.
 *
 * @param cause The caught value.
 */
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Create the flow.
 *
 * @param deps See {@link ConsentFlowDeps}.
 */
export function createConsentFlow(deps: ConsentFlowDeps): ConsentFlow {
  const [state, setState] = createSignal<DataConsentState>(INITIAL_DATA_CONSENT_STATE);
  const [closeFailed, setCloseFailed] = createSignal(false);

  /**
   * Apply one event.
   *
   * @returns Whether the state changed.
   */
  const dispatch = (event: DataConsentEvent): boolean => {
    const current = state();
    const next = dataConsentStep(current, event);
    if (next !== current) setState(next);
    return next !== current;
  };

  const close = async (): Promise<void> => {
    try {
      await deps.closeTab();
    } catch (cause) {
      deps.log.warn('Closing the consent tab failed', messageOf(cause));
      setCloseFailed(true);
    }
  };

  /**
   * Granted: the tools hear it (a waiting RUCSS run starts; the background
   * forgets this tab), then the tool carries on — PageSpeed Insights here,
   * the RUCSS Tester in its tab.
   */
  const proceed = async (): Promise<void> => {
    await deps.sendAnswer(true);
    if (deps.query.next !== null) deps.navigate(deps.query.next);
    else await close();
  };

  const start = async (): Promise<void> => {
    let granted = false;
    try {
      granted = await deps.hasConsent();
    } catch (cause) {
      // The prompt can still be asked: a failed read only costs a click.
      deps.log.warn('Reading the data-sharing consent failed', messageOf(cause));
    }
    if (dispatch({ type: 'checked', granted }) && granted) await proceed();
  };

  const allow = async (): Promise<void> => {
    const status = state().status;
    if (status !== 'asking' && status !== 'declined' && status !== 'failed') return;
    // First, synchronously: Firefox refuses the request once the input handler returned.
    const answer = deps.request(DATA_CONSENT_PERMISSIONS);
    dispatch({ type: 'request' });
    let granted: boolean;
    try {
      granted = await answer;
    } catch (cause) {
      deps.log.warn('The data-sharing request failed', messageOf(cause));
      dispatch({ type: 'request-failed', message: messageOf(cause) });
      return;
    }
    dispatch({ type: 'answered', granted });
    if (granted) await proceed();
    else await deps.sendAnswer(false);
  };

  const decline = async (): Promise<void> => {
    if (dispatch({ type: 'dismissed' })) await deps.sendAnswer(false);
  };

  // Event callbacks, not tracked scopes: each reads the state once per change.
  // eslint-disable-next-line solid/reactivity
  const stopRemoved = deps.watchRemoved((dataCollection) => {
    if (dataCollection.includes(DATA_CONSENT_TYPE)) dispatch({ type: 'revoked' });
  });
  // eslint-disable-next-line solid/reactivity
  const stopAdded = deps.watchAdded((dataCollection) => {
    // This page's own grant lands while `requesting` (ignored: its prompt answers).
    if (dataCollection.includes(DATA_CONSENT_TYPE) && dispatch({ type: 'granted-elsewhere' })) {
      void proceed();
    }
  });

  return {
    state,
    closeFailed,
    start,
    allow,
    decline,
    close,
    dispose: () => {
      stopRemoved();
      stopAdded();
    }
  };
}
