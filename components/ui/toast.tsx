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
import { CircleCheck, CircleX, Info, X } from 'lucide-solid';
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

// `success`/`info` announce politely; `error` is an assertive live region.
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
 * present it floats bottom-end so it never covers the status bar's answers.
 *
 * @param props.class Extra classes, merged last so callers win.
 */
export function Toasts(props: ToastsProps): JSX.Element {
  return (
    <div
      data-fdt="toasts"
      role="region"
      aria-label="Notifications"
      class={cn('pointer-events-none fixed bottom-2 end-2 z-50', props.class)}
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
  const [paused, setPaused] = createSignal(false);
  createRenderEffect(() => setRemaining(Math.max(props.item.duration, 0)));

  // The interval is created/destroyed per pause state AND per remaining
  // write (both are tracked by this effect): a paused toast's remaining
  // time never drifts, every tick re-anchors the wall-clock deadline, and
  // unmounts always cancel the interval.
  createEffect(() => {
    if (paused() || remaining() <= 0) return;
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
      role={TONE_ROLES[props.item.tone]}
      data-fdt="toast"
      data-fdt-tone={props.item.tone}
      class="pointer-events-auto flex items-start gap-1.5 rounded-md border border-line-2 bg-surface-2 px-2 py-1.5 shadow-elev-2"
      onPointerEnter={() => {
        setPaused(true);
      }}
      onPointerLeave={() => {
        setPaused(false);
      }}
      onFocusIn={() => {
        setPaused(true);
      }}
      onFocusOut={() => {
        setPaused(false);
      }}
    >
      <Dynamic
        component={TONE_ICONS[props.item.tone]}
        size={14}
        class={cn('mt-px shrink-0', STATUS_TEXT_CLASSES[TONE_STATUS_KIND[props.item.tone]])}
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1">
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
