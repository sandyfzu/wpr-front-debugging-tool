/**
 * What an extension's content scripts hold in one page, read over the page's
 * CDP session: its isolated worlds in the top frame, the `window`/`document`
 * listeners its scripts registered, the observers alive in its world, and the
 * page's post-GC heap.
 *
 * Why CDP: an isolated world is invisible to page script — its listeners
 * and observers can only be counted from outside (`DOMDebugger` attributes
 * each listener to its script, `Runtime.queryObjects` lists the live
 * instances of one world's constructor).
 */
import type { CDPSession, Page } from '@playwright/test';

/** The observer constructors counted per world. */
const OBSERVER_KINDS = [
  'MutationObserver',
  'IntersectionObserver',
  'ResizeObserver',
  'PerformanceObserver'
] as const;

/** One observer constructor's name. */
type ObserverKind = (typeof OBSERVER_KINDS)[number];

/** A snapshot of what the extension's scripts hold in the page. */
export interface WorldInventory {
  /** The extension's isolated worlds in the top frame (one per injected set). */
  readonly worlds: number;
  /** `window` + `document` listeners whose handler lives in an extension script. */
  readonly listeners: number;
  /** Live instances per observer constructor, summed over the extension's worlds. */
  readonly observers: Readonly<Record<ObserverKind, number>>;
}

/** A reader bound to one page. */
export interface WorldReader {
  /** Read the inventory now (after a forced GC, so dropped objects are gone). */
  read(): Promise<WorldInventory>;
  /** The page's used JS heap after a forced GC, in bytes (all worlds share it). */
  heapAfterGc(): Promise<number>;
  /** Detach the CDP session. */
  detach(): Promise<void>;
}

/** One execution context as `Runtime.executionContextCreated` reports it. */
interface ContextDescription {
  id: number;
  origin: string;
  auxData?: { isDefault?: boolean; frameId?: string };
}

/**
 * Open a reader on `page` for the extension at `extensionOrigin`.
 *
 * Enables `Runtime` (contexts are reported from then on, existing ones
 * included) and `Debugger` (script URLs, for listener attribution).
 *
 * @param page The page to inspect.
 * @param extensionOrigin `chrome-extension://<id>`.
 */
export async function openWorldReader(page: Page, extensionOrigin: string): Promise<WorldReader> {
  const session = await page.context().newCDPSession(page);
  const contexts = new Map<number, ContextDescription>();
  const scriptUrls = new Map<string, string>();
  session.on('Runtime.executionContextCreated', (event: { context: ContextDescription }) => {
    contexts.set(event.context.id, event.context);
  });
  session.on('Runtime.executionContextDestroyed', (event: { executionContextId: number }) => {
    contexts.delete(event.executionContextId);
  });
  // A navigation clears every context at once (no per-context event).
  session.on('Runtime.executionContextsCleared', () => {
    contexts.clear();
  });
  session.on('Debugger.scriptParsed', (event: { scriptId: string; url: string }) => {
    scriptUrls.set(event.scriptId, event.url);
  });
  await session.send('Runtime.enable');
  await session.send('Debugger.enable');
  const { frameTree } = await session.send('Page.getFrameTree');
  const topFrameId = frameTree.frame.id;

  const extensionWorlds = (): number[] =>
    [...contexts.values()]
      .filter(
        (context) =>
          context.origin === extensionOrigin &&
          context.auxData?.isDefault === false &&
          context.auxData.frameId === topFrameId
      )
      .map((context) => context.id);

  const heapAfterGc = async (): Promise<number> => {
    await session.send('HeapProfiler.collectGarbage');
    return (await session.send('Runtime.getHeapUsage')).usedSize;
  };

  return {
    heapAfterGc,
    async read(): Promise<WorldInventory> {
      await heapAfterGc();
      const worlds = extensionWorlds();
      return {
        worlds: worlds.length,
        listeners: await extensionListeners(session, scriptUrls, extensionOrigin),
        observers: await liveObservers(session, worlds)
      };
    },
    async detach(): Promise<void> {
      await session.detach().catch(() => undefined);
    }
  };
}

/**
 * Count the `window` and `document` listeners registered by extension scripts.
 *
 * @param session The page's CDP session.
 * @param scriptUrls Script id → URL, from `Debugger.scriptParsed`.
 * @param extensionOrigin `chrome-extension://<id>`.
 */
async function extensionListeners(
  session: CDPSession,
  scriptUrls: ReadonlyMap<string, string>,
  extensionOrigin: string
): Promise<number> {
  let count = 0;
  for (const target of ['window', 'document']) {
    const { result } = await session.send('Runtime.evaluate', { expression: target });
    if (result.objectId === undefined) throw new Error(`No remote object for ${target}`);
    const { listeners } = await session.send('DOMDebugger.getEventListeners', {
      objectId: result.objectId
    });
    count += listeners.filter((listener) =>
      (scriptUrls.get(listener.scriptId) ?? '').startsWith(`${extensionOrigin}/`)
    ).length;
  }
  return count;
}

/**
 * Count the live instances of each observer constructor in the given worlds
 * (each world has its own constructors, so the count is per world, summed).
 *
 * @param session The page's CDP session.
 * @param worlds The execution context ids to count in.
 */
async function liveObservers(
  session: CDPSession,
  worlds: readonly number[]
): Promise<Record<ObserverKind, number>> {
  const counts = Object.fromEntries(OBSERVER_KINDS.map((kind) => [kind, 0])) as Record<
    ObserverKind,
    number
  >;
  for (const contextId of worlds) {
    for (const kind of OBSERVER_KINDS) {
      const { result } = await session.send('Runtime.evaluate', {
        expression: `${kind}.prototype`,
        contextId
      });
      if (result.objectId === undefined)
        throw new Error(`No ${kind}.prototype in world ${String(contextId)}`);
      const { objects } = await session.send('Runtime.queryObjects', {
        prototypeObjectId: result.objectId
      });
      if (objects.objectId === undefined) throw new Error(`No ${kind} instance list`);
      const { result: length } = await session.send('Runtime.callFunctionOn', {
        objectId: objects.objectId,
        functionDeclaration: 'function () { return this.length; }',
        returnByValue: true
      });
      counts[kind] += Number(length.value);
    }
  }
  return counts;
}
