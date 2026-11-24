/**
 * Who may end an isolated-world content script: never the host page.
 *
 * WXT's content-script context ends itself when `document` receives the
 * `<extension id>:<entrypoint>:wxt:content-script-started` event of a newer
 * start with another message id. The page shares that DOM and the id is
 * public (store listing, add-on id), so any page could forge the event and
 * silence the tool for its whole load. The event cannot be authenticated
 * (a page-made event looks exactly like ours), so the decision moves to
 * facts the page cannot touch:
 * - **a dead extension context** (reload, update: `runtime.id` gone) — the
 *   restart signal's real purpose; the forged-event filter steps aside and
 *   the context ends (WXT's own liveness check ends it on the spot);
 * - **a newer start in the same world** (one extension's content scripts
 *   share a frame's isolated world, which the page can neither read nor
 *   write) — the newer instance ends the older one through a world global.
 * Any other start event is stopped before WXT's `document` listener sees it.
 *
 * WXT also `postMessage`s every start to the page (`'*'`), handing it the
 * id; {@link QUIET_START} turns that broadcast off.
 */
import type { Logger } from './logger';

/** WXT's start-event name after `<extension id>:<entrypoint>:`. */
export const SCRIPT_STARTED_EVENT = 'wxt:content-script-started';

/** The isolated-world global holding each entrypoint's live instance. */
export const LIVE_INSTANCES_GLOBAL = '__wprFdtLiveContentScripts';

/**
 * Definition options every isolated-world content script spreads: WXT
 * skips its `window.postMessage` start broadcast (the `document` event it
 * keeps is the only start signal it still reads).
 */
export const QUIET_START = { noScriptStartedPostMessage: true } as const;

/** The part of WXT's content-script context the guard drives. */
export interface RestartGuardHost {
  /** True once ended — also when the extension context is gone (the read then ends it). */
  readonly isInvalid: boolean;
  /** Aborts when the instance ends (removes the guard's listener). */
  readonly signal: AbortSignal;
  /** End this instance now. */
  abort(reason?: unknown): void;
}

/** What {@link guardRestartSignal} needs; injected so it runs on any DOM. */
export interface RestartGuardDeps {
  /** The instance's context. */
  readonly ctx: RestartGuardHost;
  /** The entrypoint's name (WXT's `ENTRYPOINT`). */
  readonly entrypoint: string;
  /** The start event's full name (see {@link restartEventName}). */
  readonly eventName: string;
  /** The frame's window: its capture phase precedes WXT's `document` listener. */
  readonly target: EventTarget;
  /** The isolated world's global object (shared by our scripts, closed to the page). */
  readonly world: Record<string, unknown>;
  /** Reports an older instance whose end threw. */
  readonly log: Pick<Logger, 'debug'>;
}

/**
 * WXT's start-event name for one entrypoint (its `getUniqueEventName`).
 *
 * @param extensionId The extension's `runtime.id`.
 * @param entrypoint The entrypoint's name.
 * @returns `<extensionId>:<entrypoint>:wxt:content-script-started`.
 */
export function restartEventName(extensionId: string, entrypoint: string): string {
  return `${extensionId}:${entrypoint}:${SCRIPT_STARTED_EVENT}`;
}

/**
 * The world's live-instance table, created on first use. Anything else at
 * the key (only our own scripts can write it) is replaced, never trusted.
 *
 * @param world The isolated world's global object.
 * @returns Entrypoint name → the end of its live instance.
 */
function liveInstances(world: Record<string, unknown>): Map<string, () => void> {
  const existing = world[LIVE_INSTANCES_GLOBAL];
  if (existing instanceof Map) return existing as Map<string, () => void>;
  const table = new Map<string, () => void>();
  world[LIVE_INSTANCES_GLOBAL] = table;
  return table;
}

/**
 * End the world's older instance of this entrypoint and register this one
 * in its place; its own end leaves the table unless a newer one took over.
 *
 * @param deps The guard's dependencies.
 */
function replaceOlderInstance(deps: RestartGuardDeps): void {
  const table = liveInstances(deps.world);
  const older = table.get(deps.entrypoint);
  const end = (): void => {
    deps.ctx.abort(`Replaced by a newer start of "${deps.entrypoint}"`);
  };
  table.set(deps.entrypoint, end);
  deps.ctx.signal.addEventListener('abort', () => {
    if (table.get(deps.entrypoint) === end) table.delete(deps.entrypoint);
  });
  if (older === undefined) return;
  try {
    older();
  } catch (cause) {
    // An older instance's own teardown is guarded; a throw here is its
    // dead world's leftovers and must not stop this start.
    deps.log.debug(`Ending the older "${deps.entrypoint}" instance threw`, cause);
  }
}

/**
 * Stop every start event that reaches a live instance: the page's forgeries
 * and WXT's own newer-start dispatch alike (the latter's job is done by
 * {@link replaceOlderInstance}). A dead context lets it through.
 *
 * @param deps The guard's dependencies.
 */
function filterStartEvents(deps: RestartGuardDeps): void {
  deps.target.addEventListener(
    deps.eventName,
    (event) => {
      // Reading `isInvalid` ends a context whose extension went away (WXT's
      // liveness check): the restart signal's real case, so it passes on.
      if (deps.ctx.isInvalid) return;
      event.stopImmediatePropagation();
    },
    { capture: true, signal: deps.ctx.signal }
  );
}

/**
 * Install the guard. Call it first thing in the entrypoint's `main`: no page
 * code runs between WXT's listener registration and that synchronous call.
 * The filter goes in before the older instance ends, since that end can run
 * page listeners synchronously (DOM events of its teardown).
 *
 * @param deps The guard's dependencies.
 */
export function guardRestartSignal(deps: RestartGuardDeps): void {
  if (deps.ctx.isInvalid) return;
  filterStartEvents(deps);
  replaceOlderInstance(deps);
}

/**
 * Wire {@link guardRestartSignal} for the running content script: this
 * bundle's entrypoint name, extension id, window and isolated world.
 *
 * @param ctx The content script's context.
 * @param log The surface logger.
 */
export function installRestartGuard(ctx: RestartGuardHost, log: Pick<Logger, 'debug'>): void {
  const entrypoint = import.meta.env.ENTRYPOINT;
  guardRestartSignal({
    ctx,
    entrypoint,
    eventName: restartEventName(browser.runtime.id, entrypoint),
    target: window,
    world: globalThis,
    log
  });
}
