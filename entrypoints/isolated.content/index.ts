/**
 * The isolated-world content script: the data hub plus the page-level
 * feature set. Every feature is a registry row (`setup(ctx)`) that accepts
 * the content script's context and owns its own cleanup through it — adding
 * one means adding a row (and its colocated folder), never touching the
 * siblings.
 *
 * Page-safety model (all observable from this wiring alone):
 * - one failing feature module cannot take down siblings (each setup is
 *   guarded);
 * - global `error`/`unhandledrejection` handlers (attached first) turn any
 *   error escaping the guards into one console line — never into the page;
 * - all listeners, observers and timers register through `ctx`, so an
 *   invalidation (extension reload) tears the whole world down cleanly;
 * - risky page work happens in the modules' own guarded flows, never here.
 */

import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { URL_PATTERNS } from '../../lib/wp-rocket/constants';
import { createLogger } from '../../lib/logger';
import { setupDataHub } from './data-hub';
import { setupImprovements } from './improvements';
import { setupKnownConflicts } from './known-conflicts';
import { setupSideBySide } from './side-by-side';
import { setupInspectorWidget } from './inspector';
import { setupCommandPalette } from './palette';
import { setupRucssTest } from './rucss-test';
import { setupStylesheetInventory } from './style-inventory';
import { setupBeaconTest } from './beacon-test';
import { setupLcpAnalysis } from './lcp-analysis';
import { setupScriptRuntime } from './script-runtime';
import { setupCurrentVisitVitals } from './current-visit-vitals';
import { onUnhandledRejection, onUncaughtError } from '../../lib/uncaught-errors';
import { GUARDED_HOST_NAMES, installKeyGuard } from '../../components/injected-ui/key-guard';
import { recordNavigationAnchor } from '../../lib/exclusion-session/navigation-anchor';
import './styles.css';

const log = createLogger('isolated');

/**
 * One feature module this content script wires up. Phases after this port's
 * content-script work (the on-page strip, the live-test
 * executors) land as rows here, never as sibling edits.
 */
interface IsolatedWorldModule {
  /** Short, greppable name for the failure log. */
  name: string;
  /** Wire the feature; cleanup registers on the given context. */
  setup(ctx: ContentScriptContext): void;
}

/**
 * Feature registry, in setup order. Data, so the wiring loop is the only
 * structural code: adding a feature = one row; removing one = delete the
 * row with its folder.
 */
const ISOLATED_WORLD_MODULES: readonly IsolatedWorldModule[] = [
  // At document_start, before anything else: the navigation's wall-clock
  // start, kept in this isolated world for the builder overlay (a later
  // reading would move by any system sleep since).
  {
    name: 'navigation-anchor',
    setup: () => {
      recordNavigationAnchor(
        globalThis,
        () => Date.now(),
        () => performance.now()
      );
    }
  },
  // Then at document_start: its window-capture listeners must precede the
  // page's own to keep keys typed in our injected text surfaces (the
  // exclusion builder overlay, the command palette view) from it.
  {
    name: 'key-guard',
    setup: (ctx) => {
      installKeyGuard(window, GUARDED_HOST_NAMES, ctx.signal);
    }
  },
  // Then at document_start: the visit's vitals observer (buffered, but the
  // short interactions and a hide-and-return on Firefox count only from here).
  { name: 'current-visit-vitals', setup: setupCurrentVisitVitals },
  { name: 'data-hub', setup: setupDataHub },
  { name: 'improvements', setup: setupImprovements },
  { name: 'known-conflicts', setup: setupKnownConflicts },
  { name: 'side-by-side', setup: setupSideBySide },
  { name: 'inspector', setup: setupInspectorWidget },
  { name: 'rucss-test', setup: setupRucssTest },
  { name: 'stylesheet-inventory', setup: setupStylesheetInventory },
  { name: 'beacon-test', setup: setupBeaconTest },
  { name: 'lcp-analysis', setup: setupLcpAnalysis },
  { name: 'script-runtime', setup: setupScriptRuntime },
  // Last: its executors call the compare module's triggers (provided above).
  { name: 'command-palette', setup: setupCommandPalette }
];

/**
 * The page-safety last line: any error that escapes a module's own guards
 * surfaces as one console line below the shared prefix. The handlers change
 * nothing about the page (no retries, no state) — the content script and its
 * siblings stay alive; the listeners ride the context, so a reload tears
 * them down with it and a re-injected page never gets a dead world's logs.
 *
 * @param ctx The content script's context the handlers register through.
 */
function initGlobalErrorReporting(ctx: ContentScriptContext): void {
  // The window is shared with the host page: only errors raised by our own
  // scripts are claimed (attribution by runtime URL — see lib/uncaught-errors).
  // Page scripts' own failures stay the page's business; reporting them here
  // once polluted the extension's error page with `[object ErrorEvent]` noise
  // that read as our fault and carried no details either way.
  const ownPrefix = browser.runtime.getURL('');
  ctx.addEventListener(window, 'error', onUncaughtError({ log, ownPrefix }));
  ctx.addEventListener(window, 'unhandledrejection', onUnhandledRejection({ log, ownPrefix }));
}

export default defineContentScript({
  matches: [...URL_PATTERNS],
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  main(ctx: ContentScriptContext) {
    // Attached first, like every surface's: an error escaping any module's
    // own guards still surfaces as one console line while the world — and
    // every sibling feature — stays alive.
    initGlobalErrorReporting(ctx);
    for (const module of ISOLATED_WORLD_MODULES) {
      try {
        module.setup(ctx);
      } catch (error) {
        // One module failing must neither silence nor kill the siblings:
        // report and continue (the affected surface stays absent; the page
        // is untouched).
        log.error(
          `Setting up the ${module.name} module failed`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }
});
