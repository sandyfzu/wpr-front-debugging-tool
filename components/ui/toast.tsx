/**
 * The toast region — renders the {@link toastItems} queue as a floating
 * corner stack with `status`/`alert` semantics, hover/focus pausing of the
 * auto-dismiss timers, and a keyboard-reachable close control per toast.
 *
 * Escape handling is intentionally NOT here: the shell (P5E) owns Esc
 * semantics shell-wide, and toasts are not focus-trapped overlays.
 */
import type { JSX } from 'solid-js';
import { createEffect, createRenderEffect, onCleanup } from 'solid-js';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import CircleCheck from 'lucide-solid/icons/circle-check';
import CircleX from 'lucide-solid/icons/circle-x';
import Info from 'lucide-solid/icons/info';
import X from 'lucide-solid/icons/x';
import type { LucideIcon } from 'lucide-solid';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './classes';
import { STATUS_TEXT_CLASSES } from './status-badge';
import { toast, toastItems, TONE_STATUS_KIND } from './toast-store';
import type { ToastItem, ToastTone } from './toast-store';

/** How often the auto-dismiss countdown ticks. */
const TICK_MS = 100;

/** Icon per tone — the vocabulary checks/flags, colored by the status tables. */
const TONE_ICONS: Record<ToastTone, LucideIcon> = {
  success: CircleCheck,
  error: CircleX,
  info: Info
};

/** Success/info announce politely; errors use an assertive live region. */
const TONE_ROLES: Record<ToastTone, 'status' | 'alert'> = {
  success: 'status',
  info: 'status',
  error: 'alert'
};

export interface ToastsProps {
  /** Extra classes on the fixed region wrapper, merged last. */
  class?: string;
}

/**
 * Render the toast notification stack.
 *
 * Mount once per surface (the panel shell mounts it). The region is a no-op
 * layer while the queue is empty (pointer events pass through); with toasts
 * present it floats bottom-end, away from the page's top bar and its answers.
 *
 * @param props.class Extra classes, merged last so callers win.
 */
export function Toasts(props: ToastsProps): JSX.Element {
  return (
    <div
      data-fdt="toasts"
      role="region"
      aria-label="Notifications"
      // The notifications' layer rank: above the dialog plate and tooltips
      // (both z-50; a toast must stay visible over an open overlay surface —
      // this region mounts inside the shell root, before any later portal,
      // so the explicit rank decides where DOM order would not).
      class={cn('pointer-events-none fixed bottom-2 end-2 z-[60]', props.class)}
    >
      <ul class="flex w-72 max-w-[calc(100vw-1rem)] flex-col gap-1.5">
        <For each={toastItems()}>{(item) => <ToastCard item={item} />}</For>
      </ul>
    </div>
  );
}

export interface ToastCardProps {
  /** The toast to render. */
  item: ToastItem;
}

/**
 * Render one toast with its countdown timer.
 *
 * The timer ticks down only while the toast is neither hovered nor focused —
 * a reader skipping a toast keeps it; hands busy elsewhere let it go on
 * schedule. Hover/focus pausing restarts cleanly via the effect's lifecycle.
 *
 * @param props.item The queue item (own id dismisses it).
 */
function ToastCard(props: ToastCardProps): JSX.Element {
  // Initial duration within a tracked scope (the item is immutable per queue
  // entry — duration can never change under it).
  const [remaining, setRemaining] = createSignal(Number.MAX_SAFE_INTEGER);
  // Each interaction owns its pause; leaving one must not cancel the other.
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  createRenderEffect(() => setRemaining(Math.max(props.item.duration, 0)));

  // The interval is created/destroyed per pause state AND per remaining
  // write (both are tracked by this effect): a paused toast's remaining
  // time never drifts, every tick re-anchors the wall-clock deadline, and
  // unmounts always cancel the interval.
  createEffect(() => {
    if (hovered() || focused() || remaining() <= 0) return;
    // The deadline is wall-clock anchored: each tick measures real elapsed
    // time, so under a throttled interval (hidden tab, busy devtools host)
    // the visible lifetime stays true to the enqueued duration instead of
    // inflating one fixed step per late tick.
    const deadlineAt = Date.now() + remaining();
    const timer = setInterval(() => {
      const left = Math.max(deadlineAt - Date.now(), 0);
      if (left <= 0) {
        toast.dismiss(props.item.id);
      } else {
        setRemaining(left);
      }
    }, TICK_MS);
    onCleanup(() => {
      clearInterval(timer);
    });
  });

  return (
    <li
      data-fdt="toast"
      data-fdt-tone={props.item.tone}
      class="pointer-events-auto flex items-start gap-1.5 rounded-md border border-line-2 bg-surface-2 px-2 py-1.5 shadow-elev-2"
      onPointerEnter={() => {
        setHovered(true);
      }}
      onPointerLeave={() => {
        setHovered(false);
      }}
      onFocusIn={() => {
        setFocused(true);
      }}
      onFocusOut={(event) => {
        // Descendant-to-descendant focus moves stay inside the same pause.
        setFocused(
          event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
        );
      }}
    >
      <Dynamic
        component={TONE_ICONS[props.item.tone]}
        size={14}
        class={cn('mt-px shrink-0', STATUS_TEXT_CLASSES[TONE_STATUS_KIND[props.item.tone]])}
        aria-hidden="true"
      />
      {/* Keep the native list item; only message text belongs to the live region. */}
      <div role={TONE_ROLES[props.item.tone]} aria-atomic="true" class="min-w-0 flex-1">
        <div class="text-xs font-medium text-fg-primary">{props.item.title}</div>
        <Show when={props.item.description}>
          <div class="mt-0.5 text-2xs leading-snug text-fg-secondary">{props.item.description}</div>
        </Show>
      </div>
      <button
        type="button"
        data-fdt="toast-close"
        aria-label={`Dismiss — ${props.item.title}`}
        class={cn(
          '-me-1 -ms-0.5 -mt-1 inline-grid size-6 place-items-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg-primary',
          FOCUS_RING
        )}
        onClick={() => {
          toast.dismiss(props.item.id);
        }}
      >
        <X size={12} class="shrink-0" aria-hidden="true" />
      </button>
    </li>
  );
}
