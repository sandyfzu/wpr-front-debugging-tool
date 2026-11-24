/**
 * The top bar's exclusion builder entry: the inspected tab's session
 * state (a status badge, kept current by the background's pushes) and the
 * way to open the builder overlay on the inspected page — the panel's only
 * builder surface (the editor itself lives on the page).
 *
 * State matrix: checking (no badge, words say so) · off · on · unavailable
 * · unknown (the ask got no answer) · no inspected tab (held: muted, no
 * hover surface, explained in its description) · opening (held, its words
 * read "Opening…"). Every open ends in a toast naming the
 * result or the remedy. Name = the visible words + "open the exclusion
 * builder on the page"; description = the `title` (one reading each).
 *
 * Offered on every build: the background answers only tab-less extension
 * senders, and a devtools panel is one on Chromium and Firefox alike (a
 * Firefox panel's message carries no `tab`, verified on Firefox 158).
 */
import {
  ErrorBoundary,
  Show,
  catchError,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type JSX
} from 'solid-js';
import Crosshair from 'lucide-solid/icons/crosshair';
import { FOCUS_RING } from '../../../components/ui/classes';
import { StatusBadge, StatusDot } from '../../../components/ui/status-badge';
import { toast } from '../../../components/ui/toast-store';
import { cn } from '../../../utils/cn';
import { createLogger } from '../../../lib/logger';
import { onMessage, sendMessage } from '../../../lib/messaging';
import { boundedAsk, type AskOutcome } from '../../../lib/messaging/bounded-ask';
import { EXCLUSION_SESSION_DEADLINES_MS } from '../../../lib/messaging/exclusion-session';
import {
  parseExclusionOverlayOpenOutcome,
  parseExclusionSessionSummary,
  parseExclusionSessionTabSummary,
  type ExclusionOverlayOpenOutcome,
  type ExclusionSessionSummary,
  type ExclusionSessionTabSummary
} from '../../../lib/messaging/exclusion-panel';
import { resolveSenderTabId } from '../../../lib/messaging/sender';
import {
  BUILDER_SESSION_CHECKING,
  builderEntryView,
  builderNeedsGlance,
  openFeedback,
  withAnswer,
  withPush,
  type BuilderEntryView,
  type BuilderSessionState
} from './builder-session';

const log = createLogger('panel');

/** The entry's transport (tests inject doubles). */
export interface BuilderEntryDeps {
  /** The DevTools-inspected tab, or null outside a DevTools window. */
  inspectedTabId(): number | null;
  /** Ask the tab's session (its summary). */
  askStatus(tabId: number): Promise<AskOutcome<ExclusionSessionSummary>>;
  /** Ask the background to open the overlay on the tab's page. */
  open(tabId: number): Promise<AskOutcome<ExclusionOverlayOpenOutcome>>;
  /**
   * Listen to the session pushes (validated; `fromTab` = the sender had a
   * tab, i.e. not the background); returns the stop.
   */
  listen(handler: (push: ExclusionSessionTabSummary, fromTab: boolean) => void): () => void;
}

/** The entry's transport over the extension messenger. */
export function realBuilderEntryDeps(inspectedTabId: () => number | null): BuilderEntryDeps {
  return {
    inspectedTabId,
    askStatus: (tabId) =>
      boundedAsk({
        send: () => sendMessage('getExclusionSessionForTab', { tabId }),
        parse: parseExclusionSessionSummary,
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
        const push = parseExclusionSessionTabSummary(data);
        if (push === null) log.warn('Dropped an invalid exclusionSessionUpdated message');
        else handler(push, resolveSenderTabId(sender) !== null);
        return true;
      })
  };
}

/**
 * The entry's live state, shared by every place that offers the builder
 * (the bar's entry and its "⋯" menu row): one status ask, one push
 * listener, one opening guard.
 */
export interface BuilderEntryModel {
  /** The badge + description of the current session state. */
  readonly view: () => BuilderEntryView;
  /** True while there is no tab to act on, or an open is in flight. */
  readonly held: () => boolean;
  /** True while an open is in flight. */
  readonly opening: () => boolean;
  /** The entry's description (its `title`). */
  readonly description: () => string;
  /** Open the builder on the inspected page; every outcome ends in a toast. */
  readonly open: () => Promise<void>;
}

/**
 * Create the entry's state. Call inside a component: the status ask and the
 * push listener start on mount and stop with the owner.
 *
 * @param deps The entry's transport.
 * @returns The shared state.
 */
export function createBuilderEntryModel(deps: BuilderEntryDeps): BuilderEntryModel {
  const tabId = deps.inspectedTabId();
  const [session, setSession] = createSignal<BuilderSessionState>(BUILDER_SESSION_CHECKING);
  const [opening, setOpening] = createSignal(false);
  const view = (): BuilderEntryView => builderEntryView(session());

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

  return {
    view,
    held: () => tabId === null || opening(),
    opening,
    description: () =>
      tabId === null
        ? 'Open the panel in DevTools to use the Exclusion Builder.'
        : view().description,
    open
  };
}

/**
 * Create the shared entry state inside its own error scope: a throw while
 * building it, or later in its mount work (the status ask, the listener),
 * logs once and turns the accessor null — every place offering the builder
 * then drops its entry while the rest of the bar stays whole.
 *
 * @param deps The entry's transport.
 * @returns The state, or null once it failed.
 */
export function createContainedBuilderEntryModel(
  deps: BuilderEntryDeps
): Accessor<BuilderEntryModel | null> {
  const [failed, setFailed] = createSignal(false);
  const model = catchError(
    () => createBuilderEntryModel(deps),
    (cause) => {
      log.error('Exclusion builder entry failed — the bar drops it', cause);
      setFailed(true);
    }
  );
  return () => (failed() ? null : (model ?? null));
}

/** Props of {@link BuilderEntry}: its own transport, or a shared model. */
export type BuilderEntryProps = (
  | { readonly deps: BuilderEntryDeps; readonly model?: never }
  | { readonly model: BuilderEntryModel; readonly deps?: never }
) & {
  /**
   * The labeled form (default true): crosshair + "Exclusions" + a news
   * badge. False renders the 28 px icon form (folded bar): the word stays in
   * the accessible name, a news state rides a dot (its word sr-only).
   */
  readonly showLabel?: boolean;
};

/** The entry's control look: a ghost toolbar button (hover surface only while live). */
const ENTRY =
  'flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-control text-xs font-medium no-underline';

/** The labeled form's padding. */
const ENTRY_LABELED = 'px-1.5';

/** The icon form: a 28 px square (the toolbar's icon size), anchoring its dot. */
const ENTRY_ICON = 'relative w-7 justify-center px-0';

/** The live entry's pointer feedback. */
const ENTRY_LIVE = 'text-fg-secondary hover:bg-surface-3 hover:text-fg-primary';

/**
 * The entry (contained: a rendering failure leaves the bar whole).
 *
 * @param props See {@link BuilderEntryProps}.
 */
export function BuilderEntry(props: BuilderEntryProps): JSX.Element {
  // Built once for the mount (the transport or the shared model is fixed).
  // eslint-disable-next-line solid/reactivity
  const model = props.model ?? createBuilderEntryModel(props.deps);
  return (
    <ErrorBoundary
      fallback={(cause: unknown) => {
        log.error('Exclusion builder entry crashed', cause);
        return null;
      }}
    >
      <BuilderEntryControl model={model} showLabel={props.showLabel ?? true} />
    </ErrorBoundary>
  );
}

/**
 * The entry's control.
 *
 * @param props.model The shared state.
 * @param props.showLabel Whether the "Exclusions" word shows.
 */
function BuilderEntryControl(props: {
  readonly model: BuilderEntryModel;
  readonly showLabel: boolean;
}): JSX.Element {
  // eslint-disable-next-line solid/reactivity -- the model is fixed for the mount
  const model = props.model;
  // News only (On, Unavailable): the quiet states keep the bar's room for
  // the answers; their words stay in the title and the "⋯" row.
  const news = () => (builderNeedsGlance(model.view()) ? model.view().badge : null);
  return (
    <button
      type="button"
      data-fdt="builder-entry"
      class={cn(
        ENTRY,
        props.showLabel ? ENTRY_LABELED : ENTRY_ICON,
        FOCUS_RING,
        // Held: muted words, no hover surface (it is not actionable now).
        model.held() ? 'cursor-not-allowed text-fg-muted' : ENTRY_LIVE
      )}
      title={model.description()}
      aria-disabled={model.held() ? 'true' : undefined}
      aria-busy={model.opening()}
      onClick={() => {
        void model.open();
      }}
    >
      <Crosshair size={14} aria-hidden="true" class="shrink-0" />
      {/* The open takes a few ms: words, not motion (a spinner would only flash). */}
      <span class={props.showLabel ? undefined : 'sr-only'}>
        {model.opening() ? 'Opening…' : 'Exclusions'}
      </span>
      <Show when={news()}>
        {(badge) => (
          <Show
            when={props.showLabel}
            fallback={
              <>
                <span class="sr-only"> {badge().label}</span>
                <StatusDot
                  kind={badge().kind}
                  data-fdt="builder-entry-dot"
                  class="absolute top-1 right-1"
                />
              </>
            }
          >
            <StatusBadge kind={badge().kind} icon>
              {badge().label}
            </StatusBadge>
          </Show>
        )}
      </Show>
      <span class="sr-only"> — open the Exclusion Builder on the page</span>
    </button>
  );
}
