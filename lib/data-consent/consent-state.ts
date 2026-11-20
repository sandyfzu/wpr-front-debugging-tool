/**
 * The consent page's state machine — the one place where the user answers
 * Firefox's data-sharing prompt. Pure: the page feeds it the events and
 * renders the state.
 *
 * `unknown` → (checked) `granted` | `asking`; `asking` → (request)
 * `requesting` | (dismissed) `declined`; `requesting` → (answered)
 * `granted` | `declined`, or (request-failed) `failed`; `declined` and
 * `failed` → (request) `requesting` again (the "Ask again" action);
 * `granted` → (revoked: a later check found it gone) `asking`; `asking`,
 * `declined` and `failed` → (granted-elsewhere: allowed from another
 * consent tab or the Add-ons Manager) `granted`. Any other
 * event leaves the state as it is (e.g. a second click while the prompt is
 * up never starts a second request).
 */

/** Where the consent stands, as the page shows it. */
export type DataConsentState =
  | { readonly status: 'unknown' }
  | { readonly status: 'asking' }
  | { readonly status: 'requesting' }
  | { readonly status: 'granted' }
  | { readonly status: 'declined' }
  | { readonly status: 'failed'; readonly message: string };

/** What happened. */
export type DataConsentEvent =
  /** The grant was read. */
  | { readonly type: 'checked'; readonly granted: boolean }
  /** The user asked to allow (a click: the browser prompt opens). */
  | { readonly type: 'request' }
  /** The browser prompt was answered. */
  | { readonly type: 'answered'; readonly granted: boolean }
  /** The request rejected (e.g. no user input, an undeclared type). */
  | { readonly type: 'request-failed'; readonly message: string }
  /** The user chose not to allow, without opening the prompt. */
  | { readonly type: 'dismissed' }
  /** A check found an earlier grant gone. */
  | { readonly type: 'revoked' }
  /** The grant arrived from elsewhere (another consent tab, the Add-ons Manager). */
  | { readonly type: 'granted-elsewhere' };

/** The machine's first state. */
export const INITIAL_DATA_CONSENT_STATE: DataConsentState = { status: 'unknown' };

/**
 * Apply one event.
 *
 * @param state The current state.
 * @param event What happened.
 * @returns The next state (the same object when the event does not apply).
 */
export function dataConsentStep(
  state: DataConsentState,
  event: DataConsentEvent
): DataConsentState {
  switch (event.type) {
    case 'checked':
      if (state.status !== 'unknown') return state;
      return { status: event.granted ? 'granted' : 'asking' };
    case 'request':
      return state.status === 'asking' || state.status === 'declined' || state.status === 'failed'
        ? { status: 'requesting' }
        : state;
    case 'answered':
      if (state.status !== 'requesting') return state;
      return { status: event.granted ? 'granted' : 'declined' };
    case 'request-failed':
      return state.status === 'requesting' ? { status: 'failed', message: event.message } : state;
    case 'dismissed':
      return state.status === 'asking' ? { status: 'declined' } : state;
    case 'revoked':
      return state.status === 'granted' ? { status: 'asking' } : state;
    case 'granted-elsewhere':
      // `requesting` waits for its own prompt's answer instead.
      return state.status === 'asking' || state.status === 'declined' || state.status === 'failed'
        ? { status: 'granted' }
        : state;
  }
}
