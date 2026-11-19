/**
 * The options page's appearance menu, kept off the page's start: the menu's
 * code (the floating-menu stack) is its own chunk, fetched at the first idle
 * moment after boot (or on first use). Until it lands a stand-in renders the
 * same face — icon, name, frame — so the bar never shifts or shows a wrong
 * palette; a press on the stand-in (click, Enter, Space, ↓/↑) fetches the
 * menu, hands focus to its trigger and replays the press there, so even a
 * first press before the fetch opens the menu the way the press asked —
 * unless the user moved on before it landed (focus left the stand-in, or
 * Escape withdrew the press): then nothing opens and focus stays put.
 *
 * States: stand-in (not landed) → menu (landed; stays). A failed fetch is
 * logged and keeps the stand-in (the Appearance row on the page still
 * edits the choice); the next press fetches again.
 */
import { Show, createSignal, onCleanup, onMount, type Component, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { AppearanceMenuProps } from '../../components/appearance-menu';
import {
  AppearanceFrame,
  AppearanceIcon,
  createAppearanceTrigger
} from '../../components/appearance-trigger';
import { FOCUS_RING, TOOLTIP_TRIGGER_FRAME } from '../../components/ui/classes';
import { MENU_ICON_TRIGGER_CLASSES } from '../../components/ui/menu-classes';
import { createLogger } from '../../lib/logger';
import { createChunkLoader, prefetchWhenIdle, type ChunkLoader } from '../../utils/chunk-loader';
import { cn } from '../../utils/cn';

const log = createLogger('options');

/** The menu component the chunk exports. */
export type AppearanceMenuComponent = Component<AppearanceMenuProps>;

/** A press on the stand-in, replayed on the real trigger once it lands. */
export type PendingOpen =
  { readonly kind: 'pointer' } | { readonly kind: 'key'; readonly key: OpenKey };

/** The keys that open a menu from its trigger (Enter/Space/↓ at the first item, ↑ at the last). */
const OPEN_KEYS = ['Enter', ' ', 'ArrowDown', 'ArrowUp'] as const;

/** One of {@link OPEN_KEYS}. */
export type OpenKey = (typeof OPEN_KEYS)[number];

/**
 * The open request a key press on the stand-in makes, if any.
 *
 * @param key The pressed key (`KeyboardEvent.key`).
 * @returns The request, or null for a key that opens nothing.
 */
export function pendingOpenFromKey(key: string): PendingOpen | null {
  const match = OPEN_KEYS.find((candidate) => candidate === key);
  return match === undefined ? null : { kind: 'key', key: match };
}

/**
 * Replay a stand-in press on the real trigger: the same event the menu's
 * trigger opens on (a primary-button mouse `pointerdown`, or the `keydown`),
 * so the menu decides focus placement exactly as for a direct press.
 *
 * @param trigger The real trigger.
 * @param pending The press to replay.
 */
export function replayOpen(trigger: HTMLElement, pending: PendingOpen): void {
  const event =
    pending.kind === 'key'
      ? new KeyboardEvent('keydown', { key: pending.key, bubbles: true, cancelable: true })
      : new PointerEvent('pointerdown', {
          button: 0,
          pointerType: 'mouse',
          bubbles: true,
          cancelable: true
        });
  trigger.dispatchEvent(event);
}

/**
 * Whether a waiting press still stands when the menu lands: a key press
 * only while the stand-in keeps focus; a pointer press also while focus
 * sits on the page body (a browser that never focuses a pressed button),
 * never once another control took it.
 *
 * @param pending The waiting press.
 * @param standIn The stand-in button.
 * @param active The focused element (`document.activeElement`).
 * @returns True to replay the press.
 */
export function pressStillStands(
  pending: PendingOpen,
  standIn: HTMLElement | undefined,
  active: Element | null
): boolean {
  if (standIn !== undefined && active === standIn) return true;
  return pending.kind === 'pointer' && (active === null || active === document.body);
}

/** The production loader: one fetch per options document, shared by every mount. */
let defaultLoader: ChunkLoader<AppearanceMenuComponent> | undefined;

/**
 * The production loader, created on first use (no fetch scheduled by import).
 *
 * @returns The shared loader.
 */
function appearanceMenuLoader(): ChunkLoader<AppearanceMenuComponent> {
  defaultLoader ??= createChunkLoader(
    () => import('../../components/appearance-menu').then((module) => module.AppearanceMenu),
    null
  );
  return defaultLoader;
}

/** Props of {@link LazyAppearanceMenu}. */
export interface LazyAppearanceMenuProps extends AppearanceMenuProps {
  /** The menu's loader (tests inject; default: its chunk). */
  readonly loader?: ChunkLoader<AppearanceMenuComponent>;
  /** Schedules the early fetch (default: the first idle moment; `null`: first press only). */
  readonly prefetch?: ((fetch: () => void) => void) | null;
}

/**
 * The stand-in trigger: the menu trigger's face and frame, reporting presses.
 *
 * @param props.value The stored choice.
 * @param props.systemScheme The OS preference query.
 * @param props.onPress Receives each opening press.
 * @param props.onWithdraw Called when the user leaves the press (Escape, or focus leaves).
 * @param props.ref Receives the button.
 */
function AppearanceStandIn(props: {
  value: AppearanceMenuProps['value'];
  systemScheme: AppearanceMenuProps['systemScheme'];
  onPress: (pending: PendingOpen) => void;
  onWithdraw: () => void;
  ref: (button: HTMLButtonElement) => void;
}): JSX.Element {
  // Read once: the query is a mount-time seam, never swapped while mounted.
  // eslint-disable-next-line solid/reactivity
  const { resolved, label } = createAppearanceTrigger(() => props.value, props.systemScheme);
  return (
    <AppearanceFrame resolved={resolved()} pending>
      <button
        ref={props.ref}
        type="button"
        data-fdt="appearance-menu-stand-in"
        aria-label={label()}
        // The menu's tooltip says the same; until it lands the native hint does.
        title={label()}
        aria-haspopup="menu"
        aria-expanded="false"
        class={cn(TOOLTIP_TRIGGER_FRAME, FOCUS_RING, MENU_ICON_TRIGGER_CLASSES)}
        onPointerDown={(event) => {
          // The menu opens on a primary mouse/pen press; touch opens on click.
          if (event.button === 0 && event.pointerType !== 'touch')
            props.onPress({ kind: 'pointer' });
        }}
        onClick={() => {
          props.onPress({ kind: 'pointer' });
        }}
        onBlur={() => {
          props.onWithdraw();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            props.onWithdraw();
            return;
          }
          const pending = pendingOpenFromKey(event.key);
          if (pending === null) return;
          // No native click from Enter/Space: the replay is the one open.
          event.preventDefault();
          props.onPress(pending);
        }}
      >
        <AppearanceIcon resolved={resolved()} />
      </button>
    </AppearanceFrame>
  );
}

/**
 * Render the appearance menu, its code fetched lazily (see the module doc).
 *
 * @param props See {@link LazyAppearanceMenuProps}.
 */
export function LazyAppearanceMenu(props: LazyAppearanceMenuProps): JSX.Element {
  // Read once: per-mount seams, never swapped while mounted.
  // eslint-disable-next-line solid/reactivity
  const loader = props.loader ?? appearanceMenuLoader();
  // eslint-disable-next-line solid/reactivity
  const prefetch = props.prefetch === undefined ? prefetchWhenIdle : props.prefetch;
  const [menu, setMenu] = createSignal<AppearanceMenuComponent | null>(loader.loaded());
  let slot: HTMLSpanElement | undefined;
  let standIn: HTMLButtonElement | undefined;
  let pending: PendingOpen | null = null;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  /** Show the landed menu; a pressed or focused stand-in hands over to its trigger. */
  const land = (pick: AppearanceMenuComponent): void => {
    if (disposed || menu() !== null) return;
    const active = document.activeElement;
    const replay = pending !== null && pressStillStands(pending, standIn, active) ? pending : null;
    pending = null;
    const hadFocus = standIn !== undefined && active === standIn;
    setMenu(() => pick);
    if (replay === null && !hadFocus) return;
    const trigger = slot?.querySelector<HTMLElement>('[data-fdt="tooltip-trigger"]');
    if (trigger == null) return;
    trigger.focus();
    if (replay !== null) replayOpen(trigger, replay);
  };

  /** Fetch (once) and land; a failure is logged and the next press retries. */
  const load = (): void => {
    loader.fetch().then(land, (cause: unknown) => {
      pending = null;
      log.error(
        'Loading the appearance menu failed',
        cause instanceof Error ? cause.message : cause
      );
    });
  };

  onMount(() => {
    if (menu() === null) prefetch?.(load);
  });

  return (
    <span ref={slot} data-fdt="appearance-menu-slot" class="inline-flex shrink-0">
      <Show
        when={menu()}
        fallback={
          <AppearanceStandIn
            value={props.value}
            systemScheme={props.systemScheme}
            ref={(button) => (standIn = button)}
            onPress={(press) => {
              // The first press decides how the menu opens; repeats only wait.
              pending ??= press;
              load();
            }}
            onWithdraw={() => {
              pending = null;
            }}
          />
        }
      >
        {(component) => (
          <Dynamic
            component={component()}
            value={props.value}
            onChange={props.onChange}
            systemScheme={props.systemScheme}
          />
        )}
      </Show>
    </span>
  );
}
