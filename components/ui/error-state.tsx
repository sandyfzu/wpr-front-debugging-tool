/**
 * The error view — the no-dead-ends pattern's owner (UX-D9): every async
 * surface renders this when data/contract handling fails, always with a
 * working retry affordance (the type system enforces one). Same anatomy as
 * the empty view (a toned icon tile, title, sentence, actions), in the error
 * tone.
 *
 * Context-specific failures (extension context invalidated after a reload,
 * content script not injected yet, unreadable data) are named in the
 * message by the caller; the recovery affordance lives here.
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import TriangleExclamationPoint from 'lucide-solid/icons/triangle-exclamation-point';
import { cn } from '../../utils/cn';
import { Button } from './button';
import { PageHeader } from './page-header';
import { StateIcon } from './state-icon';

export interface ErrorStateProps {
  /** The state name (default a neutral "couldn't render this" headline). */
  title?: string;
  /** Own the document's h1 only when this error replaces the entire page. */
  pageHeading?: boolean;
  /** What failed + what it means (the caller names the actual failure). */
  message?: string;
  /** Required recovery action — a page reload, a re-fetch, whatever applies. */
  onRetry: () => void;
  /** Retry control label (default "Retry"). */
  retryLabel?: string;
  /** Additional recovery affordances after the retry button (context actions). */
  children?: JSX.Element;
  /** Extra classes, merged last so callers win. */
  class?: string;
}

/** The default headline. */
const DEFAULT_TITLE = "Couldn't load this view";

/** The default retry label. */
const DEFAULT_RETRY_LABEL = 'Retry';

/**
 * Render an actionable error state with a retry.
 *
 * `onRetry` is required — an error surface without a next step is the exact
 * dead-end this component forbids; pages whose retry is not a plain refetch
 * still pass *some* recovery (e.g. a page-reload callback). The retry control
 * is a normal button, so it composes with toasts and shortcuts.
 *
 * @param props.title State name (default "Couldn't load this view").
 * @param props.pageHeading Render the title as the page's single h1 (default false).
 * @param props.message What failed, named concretely.
 * @param props.onRetry The recovery callback (required).
 * @param props.retryLabel Label of the retry control (default "Retry").
 * @param props.children Extra recovery affordances (secondary actions).
 * @param props.class Extra classes, merged last so callers win.
 */
export function ErrorState(props: ErrorStateProps): JSX.Element {
  return (
    <div
      data-fdt="error-state"
      role="alert"
      class={cn('flex flex-col items-center gap-1.5 py-6 text-center', props.class)}
    >
      {/* The page-level view leads with the larger tile, as a tool's empty result does. */}
      <StateIcon tone="error" size={props.pageHeading ? 'lg' : 'md'} class="mb-1">
        <TriangleExclamationPoint size={props.pageHeading ? 22 : 16} aria-hidden="true" />
      </StateIcon>
      <Show
        when={props.pageHeading}
        fallback={
          <div class="text-xs font-semibold text-fg-primary">{props.title ?? DEFAULT_TITLE}</div>
        }
      >
        <PageHeader title={props.title ?? DEFAULT_TITLE} />
      </Show>
      <Show when={props.message}>
        <p class="max-w-72 text-2xs leading-snug text-fg-secondary">{props.message}</p>
      </Show>
      <div class="mt-2 flex items-center gap-1.5">
        <Button variant="secondary" size="sm" onClick={props.onRetry}>
          {props.retryLabel ?? DEFAULT_RETRY_LABEL}
        </Button>
        {props.children}
      </div>
    </div>
  );
}
