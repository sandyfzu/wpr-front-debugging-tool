/**
 * The Elements sidebar pane ("WPR Lazyload"): a live object view of the
 * user's current `$0` selection, evaluated in the inspected page. The
 * expression it evaluates and the eval-callback mapping live in
 * `./sidebar-eval`; this module only registers the surface and keeps every
 * step failure-aware so a broken eval degrades to a logged error object
 * inside the pane, never a blank pane.
 */

import { createLogger } from '../../lib/logger';
import { LAZYLOAD_SIDEBAR_EXPRESSION, sidebarEvalOutcome } from './sidebar-eval';
import { lastErrorMessage } from '../../utils/last-error';

const log = createLogger('devtools');

/** The pane's title in the Elements sidebar (user-facing, parity string). */
const PANE_TITLE = 'WPR Lazyload';
/** The label the pane shows above the displayed object tree (parity string). */
const ROOT_TITLE = 'Object: ';

/**
 * Create the pane and populate it by evaluating the selection — once right
 * away, then on every selection change. Failed evals (`isException`/`isError`
 * from the eval callback, or a non-object result) log with context and show
 * the `{ evalError }` object instead of leaving the pane stale or `undefined`
 * — the pane view of "no dead ends".
 *
 * Registration, not display: the pane update simply re-runs the same static,
 * constants-only expression (no page data is ever interpolated into it).
 */
export function registerLazyloadSidebar(): void {
  // Callback form (not the promise form, which Chrome only added later than
  // the manifest's Chrome floor) — so any creation failure must be read from
  // `runtime.lastError` inside the callback, never left unread.
  browser.devtools.panels.elements.createSidebarPane(PANE_TITLE, (pane) => {
    const creationFailure = lastErrorMessage(browser.runtime.lastError);
    if (creationFailure !== null) {
      log.error('Lazyload sidebar pane creation failed', {
        title: PANE_TITLE,
        message: creationFailure
      });
      return;
    }

    /**
     * Run the selection eval and push its outcome into the pane. Guarded at
     * both layers: a synchronous start failure and a throwing callback each
     * log without ever touching the sibling listeners or the host page.
     */
    const evaluateSelection = (): void => {
      try {
        browser.devtools.inspectedWindow.eval(
          LAZYLOAD_SIDEBAR_EXPRESSION,
          (result, exceptionInfo) => {
            try {
              const outcome = sidebarEvalOutcome(result, exceptionInfo);
              if (outcome.failure !== undefined) {
                log.error('Lazyload sidebar eval failed', outcome.failure);
              }
              // Callback form, same Chrome-floor reasoning as above.
              pane.setObject(outcome.object, ROOT_TITLE, () => {
                const setFailure = lastErrorMessage(browser.runtime.lastError);
                if (setFailure !== null) {
                  log.error('Setting the lazyload sidebar object failed', {
                    message: setFailure
                  });
                }
              });
            } catch (cause) {
              log.error('Lazyload sidebar eval callback failed', cause);
            }
          }
        );
      } catch (cause) {
        log.error('Lazyload sidebar eval could not start', cause);
      }
    };

    browser.devtools.panels.elements.onSelectionChanged.addListener(evaluateSelection);
    // One initial eval on creation (parity): the pane is populated before the
    // user's first selection change, including for the pre-opened selection.
    evaluateSelection();
  });
}
