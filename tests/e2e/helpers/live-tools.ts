/**
 * Shared probes for the live-tools acceptance suites (Beacon Tester, LCP &
 * Vitals, Runtime states): what a page's DOM cannot show — which scripts the
 * page parsed (any world), what the extension's isolated world holds, and
 * every request and console message the page made — read over the page's own
 * DevTools protocol session, so nothing is injected into the page under test.
 *
 * Harness-only: no shipped module imports this file.
 */
import type { CDPSession, ConsoleMessage, Page, Request } from '@playwright/test';

/** One execution context as `Runtime.executionContextCreated` describes it. */
interface ExecutionContext {
  readonly id: number;
  readonly origin: string;
  readonly name: string;
  readonly auxData?: { readonly type?: string; readonly isDefault?: boolean; frameId?: string };
}

/** A page's protocol session, with the probes this tier reads. */
export interface PageProbe {
  /** URLs of every script the page parsed so far, in order (every world). */
  readonly parsedScripts: () => readonly string[];
  /**
   * Evaluate an expression in the extension's isolated world of the top frame.
   *
   * @param expression The JS expression (its value must be JSON-serializable).
   * @returns Its value.
   * @throws {@link Error} When the world does not exist or the expression threw.
   */
  readonly inIsolatedWorld: <T>(expression: string) => Promise<T>;
  /** Detach the session. */
  readonly close: () => Promise<void>;
}

/**
 * Attach a protocol session to a page: script parsing and execution contexts
 * are recorded from now on (the contexts that exist already are reported too).
 *
 * @param page The page under test.
 * @param extensionId The extension whose isolated world {@link PageProbe.inIsolatedWorld} reads.
 * @returns The probe.
 */
export async function probePage(page: Page, extensionId: string): Promise<PageProbe> {
  const session: CDPSession = await page.context().newCDPSession(page);
  const scripts: string[] = [];
  const contexts = new Map<number, ExecutionContext>();
  session.on('Debugger.scriptParsed', (event: { url: string }) => {
    scripts.push(event.url);
  });
  session.on('Runtime.executionContextCreated', (event: { context: ExecutionContext }) => {
    contexts.set(event.context.id, event.context);
  });
  session.on('Runtime.executionContextDestroyed', (event: { executionContextId: number }) => {
    contexts.delete(event.executionContextId);
  });
  session.on('Runtime.executionContextsCleared', () => {
    contexts.clear();
  });
  await session.send('Runtime.enable');
  await session.send('Debugger.enable');
  const mainFrameId = (await session.send('Page.getFrameTree')).frameTree.frame.id;

  const isolatedContext = (): ExecutionContext => {
    const found = [...contexts.values()].find(
      (context) =>
        context.auxData?.type === 'isolated' &&
        context.auxData.frameId === mainFrameId &&
        context.origin.includes(extensionId)
    );
    if (found === undefined) {
      throw new Error(
        `No isolated world of extension ${extensionId} in the top frame (contexts: ${JSON.stringify([...contexts.values()].map((context) => [context.origin, context.auxData?.type]))})`
      );
    }
    return found;
  };

  return {
    parsedScripts: () => [...scripts],
    inIsolatedWorld: async <T>(expression: string): Promise<T> => {
      const answer = (await session.send('Runtime.evaluate', {
        expression,
        contextId: isolatedContext().id,
        returnByValue: true,
        awaitPromise: true
      })) as { result: { value?: unknown }; exceptionDetails?: { text: string } };
      if (answer.exceptionDetails !== undefined) {
        throw new Error(`Isolated-world evaluation threw: ${answer.exceptionDetails.text}`);
      }
      return answer.result.value as T;
    },
    close: async () => {
      await session.detach();
    }
  };
}

/** What a page sent and logged while being recorded. */
export interface PageTraffic {
  /** Requests the page (any world, any frame) made since the recording started. */
  readonly requests: () => readonly Request[];
  /** Console messages of the page (any world) since the recording started. */
  readonly messages: () => readonly ConsoleMessage[];
  /** Stop recording. */
  readonly stop: () => void;
}

/**
 * Record a page's requests and console messages from now on.
 *
 * @param page The page under test.
 * @returns The recording.
 */
export function recordTraffic(page: Page): PageTraffic {
  const requests: Request[] = [];
  const messages: ConsoleMessage[] = [];
  const onRequest = (request: Request): void => {
    requests.push(request);
  };
  const onConsole = (message: ConsoleMessage): void => {
    messages.push(message);
  };
  page.on('request', onRequest);
  page.on('console', onConsole);
  return {
    requests: () => [...requests],
    messages: () => [...messages],
    stop: () => {
      page.off('request', onRequest);
      page.off('console', onConsole);
    }
  };
}

/**
 * Toggle a switch the way a pointer does: its track (the input is visually hidden).
 *
 * @param panel The panel page.
 * @param name The switch's label.
 */
export async function toggleSwitch(panel: Page, name: string): Promise<void> {
  const id = await panel.getByRole('switch', { name }).getAttribute('id');
  if (id === null) throw new Error(`The ${name} switch has no id`);
  await panel.locator(`[id="${id.replace(/-input$/, '-control')}"]`).click();
}
