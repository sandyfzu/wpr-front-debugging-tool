/**
 * The Open-Exclusion-Builder action's mechanism: open the builder page in a
 * browser tab, the same way the background's context menu does — one
 * `tabs.create` at the page's packaged URL. Tab opening requires no
 * permission, but the API surface must exist in the calling context; a
 * DevTools page that cannot reach it (or whose open call fails) reports the
 * result honestly — never a silent failure, never a throw past the click.
 *
 * The action's toast feedback rides this module: 'opened' confirms, and the
 * unavailable/failed arms answer with the replacement path (the toolbar's
 * context menu still opens the builder).
 */
import { createLogger } from '../../../lib/logger';
import { toast } from '../../../components/ui/toast-store';

const log = createLogger('panel');

/** How one open attempt ended. */
export type ExclusionBuilderOutcome = 'opened' | 'unavailable' | 'failed';

export interface ExclusionBuilderDeps {
  /** Open a browser tab at a URL (`browser.tabs.create`; arrow — no `this`). */
  openTab: (url: string) => Promise<unknown>;
  /** Resolve the packaged page's absolute URL (`browser.runtime.getURL`). */
  pageUrl: (pagePath: string) => string;
}

/** The shape of the runtime this context may or may not expose, probed. */
interface RuntimeShape {
  readonly runtime?: { readonly getURL?: (pagePath: string) => string };
  readonly tabs?: {
    readonly create?: (createProperties: { readonly url: string }) => Promise<unknown>;
  };
}

/**
 * The deps this context can build, feature-detected at construction — never
 * an assumed namespace. The probe narrows through the runtime shape (a
 * DevTools panel page runs in the extension context, but the availability is
 * verified, not trusted).
 *
 * @returns The real deps, or null when this context cannot open tabs (the
 *   action row then renders disabled with its explanation, and enabling it
 *   later is a registry-level check away).
 */
export function realExclusionBuilderDeps(): ExclusionBuilderDeps | null {
  const api: RuntimeShape = browser;
  const create = api.tabs?.create;
  const getURL = api.runtime?.getURL;
  if (create === undefined || getURL === undefined) {
    return null;
  }
  return {
    openTab: (url: string) => create({ url }),
    pageUrl: (pagePath: string) => getURL(pagePath)
  };
}

/**
 * Open the builder page in a new tab.
 *
 * @param deps The verified seams ({@link realExclusionBuilderDeps}).
 * @param pagePath The packaged page path (the registry's own constant).
 * @returns The outcome: opened, or a failure the action's disabled state
 *   (the unavailable case) and the error toast name for the failed one.
 */
export async function openExclusionBuilder(
  deps: ExclusionBuilderDeps,
  pagePath: string
): Promise<ExclusionBuilderOutcome> {
  try {
    await deps.openTab(deps.pageUrl(pagePath));
    toast.info('Exclusion Builder opened in a new tab');
    return 'opened';
  } catch (cause) {
    log.warn('Opening the exclusion builder failed', {
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    toast.error('Exclusion Builder did not open', {
      description: "Open it from the extension toolbar's context menu instead."
    });
    return 'failed';
  }
}
