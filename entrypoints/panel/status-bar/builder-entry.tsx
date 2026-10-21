/**
 * The status bar's exclusion builder entry: the inspected tab's session
 * state (a status badge, kept current by the background's pushes) and the
 * way to open the builder overlay on the inspected page — the panel's only
 * builder surface (the editor itself lives on the page).
 *
 * State matrix: checking (no badge, words say so) · off · on · unavailable
 * · unknown (the ask got no answer) · no inspected tab (held, explained) ·
 * opening (held, busy). Every open ends in a toast naming the result or
 * the remedy.
 */
import { ErrorBoundary, Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import Crosshair from 'lucide-solid/icons/crosshair';
import { FOCUS_RING } from '../../../components/ui/classes';
import { StatusBadge } from '../../../components/ui/status-badge';
import { toast } from '../../../components/ui/toast-store';
import { cn } from '../../../utils/cn';
import { createLogger } from '../../../lib/logger';
import { onMessage, sendMessage } from '../../../lib/messaging';
import { boundedAsk, type AskOutcome } from '../../../lib/messaging/bounded-ask';
import {
  EXCLUSION_SESSION_DEADLINES_MS,
  parseExclusionOverlayOpenOutcome,
  parseExclusionSessionStatus,
  parseExclusionSessionTabStatus,
  type ExclusionOverlayOpenOutcome,
  type ExclusionSessionStatus,
  type ExclusionSessionTabStatus
} from '../../../lib/messaging/exclusion-session';
import { resolveSenderTabId } from '../../../lib/messaging/sender';
import {
  BUILDER_SESSION_CHECKING,
  builderEntryView,
  openFeedback,
  withAnswer,
  withPush,
  type BuilderSessionState
} from './builder-session';
import { SEGMENT, SEGMENT_HOVER } from './status-bar';

const log = createLogger('panel');

/** The entry's transport (tests inject doubles). */
export interface BuilderEntryDeps {
  /** The DevTools-inspected tab, or null outside a DevTools window. */
  inspectedTabId(): number | null;
  /** Ask the tab's session status. */
  askStatus(tabId: number): Promise<AskOutcome<ExclusionSessionStatus>>;
  /** Ask the background to open the overlay on the tab's page. */
  open(tabId: number): Promise<AskOutcome<ExclusionOverlayOpenOutcome>>;
  /**
   * Listen to the session pushes (validated; `fromTab` = the sender had a
   * tab, i.e. not the background); returns the stop.
   */
  listen(handler: (push: ExclusionSessionTabStatus, fromTab: boolean) => void): () => void;
}

/** The entry's transport over the extension messenger. */
export function realBuilderEntryDeps(inspectedTabId: () => number | null): BuilderEntryDeps {
  return {
    inspectedTabId,
    askStatus: (tabId) =>
      boundedAsk({
        send: () => sendMessage('getExclusionSessionForTab', { tabId }),
        parse: parseExclusionSessionStatus,
        timeoutMs: EXCLUSION_SESSION_DEADLINES_MS.status
      }),
    open: (tabId) =>
      boundedAsk({
        send: () => sendMessage('openExclusionOverlay', { tabId }),
        parse: parseExclusionOverlayOpenOutcome,
        timeoutMs: EXCLUSION_SESSION_DEADLINES_MS.openOverlay
      }),
    listen: (handler) =>
      onMessage('exclusionSessionUpdated', ({ data, sender }) => {
        const push = parseExclusionSessionTabStatus(data);
        if (push === null) log.warn('Dropped an invalid exclusionSessionUpdated message');
        else handler(push, resolveSenderTabId(sender) !== null);
        return true;
      })
  };
}

/** Props of {@link BuilderEntry}. */
export interface BuilderEntryProps {
  readonly deps: BuilderEntryDeps;
}

/**
 * The entry (contained: a rendering failure leaves the strip whole).
 *
 * @param props See {@link BuilderEntryProps}.
 */
export function BuilderEntry(props: BuilderEntryProps): JSX.Element {
  return (
    <ErrorBoundary
      fallback={(cause: unknown) => {
        log.error('Exclusion builder entry crashed', cause);
        return null;
      }}
    >
      <BuilderEntryControl deps={props.deps} />
    </ErrorBoundary>
  );
}

/** The entry's control. */
function BuilderEntryControl(props: BuilderEntryProps): JSX.Element {
  // eslint-disable-next-line solid/reactivity -- the transport is fixed for the mount
  const deps = props.deps;
  const tabId = deps.inspectedTabId();
  const [session, setSession] = createSignal<BuilderSessionState>(BUILDER_SESSION_CHECKING);
  const [opening, setOpening] = createSignal(false);
  const view = (): ReturnType<typeof builderEntryView> => builderEntryView(session());

  onMount(() => {
    const stop = deps.listen((push, fromTab) => {
      setSession((state) => withPush(state, push, tabId, fromTab));
    });
    onCleanup(stop);
    if (tabId === null) return;
    void deps.askStatus(tabId).then((outcome) => {
      setSession((state) => withAnswer(state, outcome));
    });
  });

  const held = (): boolean => tabId === null || opening();
  const open = async (): Promise<void> => {
    if (tabId === null || opening()) return;
    setOpening(true);
    try {
      const outcome = await deps.open(tabId);
      if (outcome.kind === 'failed')
        log.warn('Opening the exclusion builder failed', outcome.cause);
      const feedback = openFeedback(outcome);
      if (feedback.tone === 'success') toast.success(feedback.title);
      else toast.error(feedback.title, { description: feedback.description });
    } finally {
      setOpening(false);
    }
  };

  const description = (): string =>
    tabId === null
      ? 'Open the panel in DevTools to use the exclusion builder.'
      : view().description;

  return (
    <button
      type="button"
      data-fdt="builder-entry"
      class={cn(SEGMENT, SEGMENT_HOVER, FOCUS_RING, 'shrink-0 px-1')}
      title={description()}
      aria-disabled={held() ? 'true' : undefined}
      aria-busy={opening()}
      onClick={() => {
        void open();
      }}
    >
      <Crosshair size={12} aria-hidden="true" class="text-fg-secondary" />
      <span>Exclusions</span>
      <Show when={view().badge}>
        {(badge) => (
          <StatusBadge kind={badge().kind} icon>
            {badge().label}
          </StatusBadge>
        )}
      </Show>
      <span class="sr-only"> — open the exclusion builder on the page. {description()}</span>
    </button>
  );
}
