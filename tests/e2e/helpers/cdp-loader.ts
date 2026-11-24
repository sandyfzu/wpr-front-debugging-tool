/**
 * The CDP extension loader: a browser launched without extensions that loads
 * (and reloads) an unpacked folder through `Extensions.loadUnpacked`, plus a
 * heap reader for any target the browser session can see.
 *
 * Why not the shared driver: a command-line `--load-extension` launch is
 * always an install (verified live), and `chrome.runtime.reload()` drops a
 * content-script extension in this Chromium build (see
 * `boot-and-registry.spec.ts`). A second `loadUnpacked` of the same folder
 * is a real in-place reload: same id, a new worker, `runtime.onInstalled`
 * with reason `update` — so the upgrade and reload suites drive it here,
 * each on its own throwaway profile (the shared driver's profile is never
 * touched).
 */
import { chromium, type BrowserContext, type CDPSession, type Worker } from '@playwright/test';
import { HOST_RESOLVER_RULES } from './blocked-hosts';

/** A launched loader browser and its browser-level CDP session. */
export interface LoaderBrowser {
  readonly context: BrowserContext;
  readonly session: CDPSession;
}

/** Launch choices of a loader browser. */
export interface LoaderOptions {
  /**
   * Keep Chromium's back/forward cache, which Playwright disables by default
   * (`--disable-back-forward-cache`); without it a back navigation is always
   * a reload.
   */
  readonly backForwardCache?: boolean;
}

/**
 * Launch a browser without extensions that accepts CDP extension loads
 * (headless unless `E2E_HEADED=1`; the remote hosts the shared driver blocks
 * are blocked here too).
 *
 * @param profileDir The persistent profile (the caller owns its cleanup).
 * @param options Launch choices.
 * @throws {Error} When the context exposes no browser for a CDP session.
 */
export async function launchLoader(
  profileDir: string,
  options: LoaderOptions = {}
): Promise<LoaderBrowser> {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: process.env.E2E_HEADED !== '1',
    // Playwright's default `--disable-extensions` would keep the load inert.
    ignoreDefaultArgs: [
      '--disable-extensions',
      ...(options.backForwardCache === true ? ['--disable-back-forward-cache'] : [])
    ],
    viewport: { width: 1280, height: 800 },
    timeout: 30_000,
    args: ['--enable-unsafe-extension-debugging', HOST_RESOLVER_RULES]
  });
  const browser = context.browser();
  if (browser === null) throw new Error('The persistent context exposes no browser for CDP');
  return { context, session: await browser.newBrowserCDPSession() };
}

/**
 * Load (or reload) an unpacked folder and wait for its new worker.
 *
 * @param loader The loader browser.
 * @param dir The extension folder.
 * @param previous The previous load's worker (a reload replaces it).
 * @returns The extension id and its new worker.
 */
export async function loadUnpacked(
  loader: LoaderBrowser,
  dir: string,
  previous?: Worker
): Promise<{ id: string; worker: Worker }> {
  const { id } = await loader.session.send('Extensions.loadUnpacked', { path: dir });
  const isNew = (worker: Worker): boolean =>
    new URL(worker.url()).host === id && worker !== previous;
  const worker =
    loader.context.serviceWorkers().find(isNew) ??
    (await loader.context.waitForEvent('serviceworker', { predicate: isNew, timeout: 20_000 }));
  return { id, worker };
}

/** One CDP reply as the non-flattened target transport delivers it. */
interface TargetReply {
  id: number;
  result?: { usedSize?: number };
  error?: { message: string };
}

/** Message ids for the non-flattened target transport (one counter per run). */
let targetMessageId = 0;

/** How long one target command may go unanswered before the read fails (ms). */
const TARGET_REPLY_TIMEOUT_MS = 10_000;

/** How long a target lookup waits for exactly one match (ms). */
const TARGET_SETTLE_TIMEOUT_MS = 10_000;

/**
 * The one target of `type` whose URL starts with `urlPrefix`, waiting until
 * exactly one is listed: right after a reload the dying worker can still be
 * listed beside the new one (same URL), and reading either would be a guess.
 *
 * @param session The browser-level CDP session.
 * @param urlPrefix The target URL prefix.
 * @param type The target type.
 * @returns The target's id.
 * @throws {Error} When no single match settles within the timeout (names the count).
 */
async function singleTarget(session: CDPSession, urlPrefix: string, type: string): Promise<string> {
  const deadline = Date.now() + TARGET_SETTLE_TIMEOUT_MS;
  let count = 0;
  while (Date.now() < deadline) {
    const { targetInfos } = await session.send('Target.getTargets');
    const matches = targetInfos.filter(
      (info) => info.type === type && info.url.startsWith(urlPrefix)
    );
    count = matches.length;
    const [only] = matches;
    if (count === 1 && only !== undefined) return only.targetId;
    await new Promise((settle) => setTimeout(settle, 100));
  }
  throw new Error(
    `Expected one ${type} target at ${urlPrefix}, found ${String(count)} after ${String(TARGET_SETTLE_TIMEOUT_MS)} ms`
  );
}

/**
 * Send one command over the non-flattened target transport and await its
 * reply, failing after {@link TARGET_REPLY_TIMEOUT_MS} instead of hanging
 * until the test timeout.
 *
 * @param session The browser-level CDP session.
 * @param sessionId The attached target session.
 * @param method The CDP method (no params).
 * @throws {Error} When the send fails or no reply arrives in time (names the method).
 */
function targetCall(session: CDPSession, sessionId: string, method: string): Promise<TargetReply> {
  return new Promise((resolve, reject) => {
    targetMessageId += 1;
    const id = targetMessageId;
    const finish = (): void => {
      clearTimeout(timer);
      session.off('Target.receivedMessageFromTarget', onMessage);
    };
    const onMessage = (event: { sessionId?: string; message: string }): void => {
      const reply = JSON.parse(event.message) as TargetReply;
      if (event.sessionId !== sessionId || reply.id !== id) return;
      finish();
      resolve(reply);
    };
    const timer = setTimeout(() => {
      finish();
      reject(
        new Error(
          `${method} got no reply in ${String(TARGET_REPLY_TIMEOUT_MS)} ms (target session ${sessionId})`
        )
      );
    }, TARGET_REPLY_TIMEOUT_MS);
    session.on('Target.receivedMessageFromTarget', onMessage);
    session
      .send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id, method, params: {} })
      })
      .catch((cause: unknown) => {
        finish();
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      });
  });
}

/**
 * Used JS heap of one target after a forced garbage collection, in bytes.
 *
 * Playwright's CDP sessions open on pages only, so a service worker is
 * reached through the browser session's non-flattened target transport
 * (`Target.attachToTarget` + `sendMessageToTarget`; verified live on this
 * Chromium build).
 *
 * @param session The browser-level CDP session.
 * @param urlPrefix The target URL prefix (e.g. the extension's worker URL).
 * @param type The target type (`service_worker`, `page`, …).
 * @throws {Error} When no single target matches or a command fails or times out.
 */
export async function targetHeapAfterGc(
  session: CDPSession,
  urlPrefix: string,
  type: string
): Promise<number> {
  const targetId = await singleTarget(session, urlPrefix, type);
  const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: false });
  try {
    await targetCall(session, sessionId, 'HeapProfiler.collectGarbage');
    const usage = await targetCall(session, sessionId, 'Runtime.getHeapUsage');
    if (usage.error !== undefined || usage.result?.usedSize === undefined) {
      throw new Error(`Heap read failed at ${urlPrefix}: ${usage.error?.message ?? 'no size'}`);
    }
    return usage.result.usedSize;
  } finally {
    await session.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
}

/**
 * Probe menu ids by duplicate-create (the API has no read-back): a refused
 * create means the id exists; an accepted probe is removed again, so the
 * registry is left as found.
 *
 * @param worker The extension's worker.
 * @param ids The ids to probe.
 * @returns Per id, whether it was registered.
 */
export function probeMenuIds(
  worker: Worker,
  ids: readonly string[]
): Promise<Record<string, boolean>> {
  return worker.evaluate(async (list) => {
    const result: Record<string, boolean> = {};
    for (const id of list) {
      result[id] = await new Promise<boolean>((done) => {
        chrome.contextMenus.create({ id, title: 'probe', contexts: ['all'] }, () => {
          if (chrome.runtime.lastError !== undefined) {
            done(true);
            return;
          }
          // Either outcome leaves the id absent, which is the answer.
          chrome.contextMenus.remove(id).then(
            () => {
              done(false);
            },
            () => {
              done(false);
            }
          );
        });
      });
    }
    return result;
  }, ids);
}
