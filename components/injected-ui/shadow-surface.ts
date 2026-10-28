/**
 * A host-page surface that shows and hides over and over (the on-page UI
 * gate, a per-site toggle, a dismissed notice): ONE shadow-root UI per
 * surface, created on the first show and cycled with `mount()`/`remove()`
 * afterwards.
 *
 * Why one instance: WXT's factory registers the instance's `remove` on the
 * context's invalidation and never unregisters it, so a fresh instance per
 * show would keep every removed host (its shadow root, the stylesheet copy,
 * the hooks' closures) reachable until the page ends — and re-fetch the
 * entry stylesheet per show. WXT's `mount` re-appends the same host and
 * re-runs `onMount`; its `remove` runs `onRemove`, detaches the host and
 * empties the container — so cycling the instance is the factory's own
 * contract.
 *
 * Each mount is one record: the render (`./mount`, awaited appearance read
 * included) is bound to it, so a remove landing before the render resolves
 * aborts the render (or disposes it the moment it resolves) and never lets
 * a late disposer overwrite a newer mount's. WXT may call `remove` on an
 * unmounted instance (the invalidation hook after a hide): the hooks treat
 * that as a no-op.
 */
import type { JSX } from 'solid-js';
import { createLogger } from '../../lib/logger';
import { mountShadowUi } from './mount';

const log = createLogger('injected-ui');

/** The part of WXT's shadow-root UI handle the surface drives. */
export interface ShadowUiInstance {
  readonly shadow: ShadowRoot;
  mount(): void;
  remove(): void;
}

/** The hooks the surface hands the UI factory (WXT's `onMount`/`onRemove`). */
export interface ShadowUiHooks {
  readonly onMount: (container: HTMLElement, shadow: ShadowRoot) => void;
  readonly onRemove: () => void;
}

/** What one mount gives its owner while it lasts. */
export interface ShadowMount {
  readonly shadow: ShadowRoot;
  /** Aborted when this mount's host leaves the page (listener scope). */
  readonly signal: AbortSignal;
}

/** The surface's seams and per-mount hooks. */
export interface ShadowSurfaceOptions {
  /** Build the shadow-root UI with these hooks (WXT's factory in production). */
  readonly create: (hooks: ShadowUiHooks) => Promise<ShadowUiInstance>;
  /** The view rendered into each mount. */
  readonly view: () => JSX.Element;
  /** Whether the owner's context is dead (extension reloaded, superseded). */
  readonly isInvalid: () => boolean;
  /** Runs as a mount's host lands, before its render starts. */
  readonly onMounted?: (mount: ShadowMount) => void;
  /** Runs once a mount's host left the page (after the view's disposal). */
  readonly onRemoved?: () => void;
  /** Receives the original failure of a render that did not complete. */
  readonly onRenderError: (cause: unknown) => void;
}

/** How a show ended. */
export type ShowOutcome = 'shown' | 'already-shown' | 'refused';

/** A surface's lifecycle handle. */
export interface ShadowSurface {
  /**
   * Show the surface: create the UI once (concurrent shows share the
   * creation), then mount it unless the context died or `allowed` turned
   * false during the creation wait.
   *
   * @param allowed Re-read after the creation wait (a hide may have won it).
   * @throws {@link Error} when the UI cannot be created or its host cannot be
   *   placed (WXT's anchor lookup) — the next show retries.
   */
  show(allowed: () => boolean): Promise<ShowOutcome>;
  /** Remove the current mount's host (no-op when nothing is shown). */
  hide(): void;
  /** Whether a mount's host is on the page. */
  isShown(): boolean;
  /**
   * Whether the current mount's view came up: resolves once its render
   * settles; `false` for a failed or removed render, or with no mount.
   */
  rendered(): Promise<boolean>;
}

/** One mount's bookkeeping. */
interface MountRecord {
  readonly scope: AbortController;
  /** The view's disposer, once its render resolved while still mounted. */
  dispose: (() => void) | null;
  /** The render's settlement (whether the view is up). */
  settled: Promise<boolean>;
}

/**
 * Run one teardown step; a throw is logged, never propagated, so the steps
 * after it (and WXT's host removal after `onRemove`) still run.
 *
 * @param step The step.
 * @param what The step's name, for the log.
 */
function guarded(step: () => void, what: string): void {
  try {
    step();
  } catch (cause) {
    log.error(`${what} failed during a shadow-host removal`, cause);
  }
}

/**
 * Build a surface (nothing is created until the first show).
 *
 * @param options The factory, the view and the per-mount hooks.
 * @returns The lifecycle handle.
 */
export function createShadowSurface(options: ShadowSurfaceOptions): ShadowSurface {
  let instance: ShadowUiInstance | null = null;
  let creating: Promise<ShadowUiInstance> | null = null;
  let current: MountRecord | null = null;

  /** Whether a mount's host is on the page (a call: awaits flip it). */
  const shown = (): boolean => current !== null;

  /** Bind a render to a fresh mount record. */
  const onMount = (container: HTMLElement, shadow: ShadowRoot): void => {
    if (current !== null) return; // WXT mount without a remove: the live mount stays.
    const record: MountRecord = {
      scope: new AbortController(),
      dispose: null,
      settled: Promise.resolve(false)
    };
    current = record;
    const onMounted = options.onMounted;
    if (onMounted !== undefined) {
      guarded(() => {
        onMounted({ shadow, signal: record.scope.signal });
      }, 'The mount hook');
    }
    record.settled = mountShadowUi(container, shadow, options.view, record.scope.signal).then(
      (dispose) => {
        if (record.scope.signal.aborted) {
          // Removed while rendering: the late tree goes at once, never stored.
          guarded(dispose, 'Disposing a late render');
          return false;
        }
        record.dispose = dispose;
        return true;
      },
      (cause: unknown) => {
        if (!record.scope.signal.aborted) options.onRenderError(cause);
        return false;
      }
    );
  };

  /** Tear the current mount down (no-op on an unmounted instance). */
  const onRemove = (): void => {
    const record = current;
    if (record === null) return;
    current = null;
    record.scope.abort();
    const dispose = record.dispose;
    record.dispose = null;
    if (dispose !== null) guarded(dispose, 'Disposing the view');
    if (options.onRemoved !== undefined) guarded(options.onRemoved, 'The removal hook');
  };

  /** The instance, created once; a failed creation is retried by the next show. */
  const ensureInstance = async (): Promise<ShadowUiInstance> => {
    if (instance !== null) return instance;
    creating ??= options.create({ onMount, onRemove }).then(
      (created) => {
        instance = created;
        creating = null;
        return created;
      },
      (cause: unknown) => {
        creating = null;
        throw cause;
      }
    );
    return creating;
  };

  return {
    async show(allowed) {
      if (shown()) return 'already-shown';
      if (options.isInvalid() || !allowed()) return 'refused';
      const ui = await ensureInstance();
      // Re-checked after the wait: the context or the owner may have moved on.
      if (options.isInvalid() || !allowed()) return 'refused';
      if (shown()) return 'already-shown'; // a concurrent show won
      ui.mount();
      return 'shown';
    },
    hide() {
      if (shown()) instance?.remove();
    },
    isShown: shown,
    rendered: () => current?.settled ?? Promise.resolve(false)
  };
}
