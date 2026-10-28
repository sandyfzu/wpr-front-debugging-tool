/**
 * The in-page executor contract: what running each palette command does,
 * expressed over the shipped mechanisms — the same calls the context menu's
 * paths end in — never a re-implementation:
 * - Side-by-Side and its PageSpeed Insights flow: the compare module's own
 *   open triggers (the functions its `openSideBySide` /
 *   `openSideBySidePerformance` tab-message receivers call);
 * - the detection widget: `toggleDetectionWidgetSite` (the menu's writer; the
 *   widget follows the store live);
 * - the master gate: `setPageUiGate(false)` (every open page — this one
 *   included — follows the gate's watch);
 * - the exclusion builder: the background's overlay opener for the
 *   sender's own tab.
 *
 * Every executor answers a {@link PageCommandOutcome} and never rejects:
 * an expected failure is a result the palette surfaces to the user.
 */
import type { ExclusionOverlayOpenOutcome } from '../messaging/exclusion-panel';
import { toggleDetectionWidgetSite } from '../storage/detection-widget-sites';
import { setPageUiGate } from '../storage/page-ui-gate';
import { isHttpOrigin } from '../../utils/urls';
import type { PaletteCommandId } from './commands';

/** The mechanisms the executors call (injected: the page's live modules, or fakes). */
export interface PageCommandMechanisms {
  /** Open the Side-by-Side overlay on this page (resolves once settled). */
  openSideBySide(): Promise<void>;
  /** Start the PageSpeed Insights Side-by-Side flow from this page. */
  openSideBySidePerformance(): void;
  /** Flip the detection widget's per-origin override; resolves the new state. */
  toggleDetectionWidget(origin: string): Promise<boolean>;
  /** Persist the on-page UI master gate. */
  setPageUiGate(enabled: boolean): Promise<void>;
  /** Ask the background to open the builder overlay on this tab. */
  openExclusionBuilder(): Promise<ExclusionOverlayOpenOutcome>;
}

/** The storage-backed mechanisms, bound to their one owner each. */
export const STORAGE_MECHANISMS: Pick<
  PageCommandMechanisms,
  'toggleDetectionWidget' | 'setPageUiGate'
> = {
  toggleDetectionWidget: toggleDetectionWidgetSite,
  setPageUiGate
};

/** How one run ended: done, or a one-sentence failure for the user. */
export type PageCommandOutcome =
  { readonly ok: true } | { readonly ok: false; readonly failure: string };

/** The page a run acts on. */
export interface PageCommandPage {
  /** The page's origin (`location.origin`; opaque origins read `"null"`). */
  readonly origin: string;
}

/** One command's run. */
export type PageCommandExecutor = (page: PageCommandPage) => Promise<PageCommandOutcome>;

/** Every palette command's executor (one per palette row — the compiler checks). */
export type PageCommandExecutors = Readonly<Record<PaletteCommandId, PageCommandExecutor>>;

/** The run succeeded. */
const DONE: PageCommandOutcome = { ok: true };

/** The user-facing sentence for each builder open that did not show the overlay. */
const BUILDER_FAILURES: Readonly<
  Record<Exclude<ExclusionOverlayOpenOutcome, 'injected' | 'revealed'>, string>
> = {
  'unsupported-page': 'The browser does not let extensions open it on this page.',
  'not-html': 'This page is not an HTML page.',
  'tab-gone': 'The tab closed before it opened.',
  // Unreachable from the palette in practice (it dies with the gate), kept honest.
  'page-ui-off': 'On-page UI is off.',
  failed: 'Opening it failed. Try again from the toolbar button’s menu.'
};

/**
 * A failed outcome.
 *
 * @param failure The user-facing sentence.
 */
function failed(failure: string): PageCommandOutcome {
  return { ok: false, failure };
}

/**
 * Bind the executors to their mechanisms.
 *
 * @param mechanisms The calls each command ends in.
 * @returns One executor per palette command.
 */
export function createPageCommandExecutors(
  mechanisms: PageCommandMechanisms
): PageCommandExecutors {
  return {
    'side-by-side': async () => {
      await mechanisms.openSideBySide();
      return DONE;
    },
    'psi-side-by-side': () => {
      mechanisms.openSideBySidePerformance();
      return Promise.resolve(DONE);
    },
    'toggle-detection-widget': async (page) => {
      // Only a web origin is a site key (an opaque origin reads "null").
      if (!isHttpOrigin(page.origin)) return failed('This page has no web address to toggle.');
      await mechanisms.toggleDetectionWidget(page.origin);
      return DONE;
    },
    'exclusion-builder': async () => {
      const outcome = await mechanisms.openExclusionBuilder();
      return outcome === 'injected' || outcome === 'revealed'
        ? DONE
        : failed(BUILDER_FAILURES[outcome]);
    },
    'page-ui-gate': async () => {
      await mechanisms.setPageUiGate(false);
      return DONE;
    }
  };
}

/**
 * Run one command; a mechanism that throws or rejects becomes a failed
 * outcome (never a rejection), its cause handed to `onError` for the log.
 *
 * @param executors The bound executors.
 * @param id The command.
 * @param page The page it acts on.
 * @param onError Receives an unexpected mechanism failure.
 * @returns How the run ended.
 */
export async function runPageCommand(
  executors: PageCommandExecutors,
  id: PaletteCommandId,
  page: PageCommandPage,
  onError: (cause: unknown) => void
): Promise<PageCommandOutcome> {
  try {
    return await executors[id](page);
  } catch (cause) {
    onError(cause);
    return failed('Something went wrong. Try again from the right-click menu.');
  }
}
