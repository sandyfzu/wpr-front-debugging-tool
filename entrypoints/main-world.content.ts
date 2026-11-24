/**
 * MAIN-world content script entrypoint: installs the undefined-references
 * capture on the page world before any page script runs (`document_start`),
 * so the first error of the page is observable. The Firefox build passes the
 * SpiderMonkey dialect (frames-only stacks, its own phrasing); the build-time
 * branch keeps that module out of the Chromium bundle.
 *
 * Registration runs inside a guard — a throw escaping this file would be
 * logged and re-thrown by the entrypoint wrapper into the page as our own
 * uncaught error, breaking the page-error neutrality the capture owes its
 * host.
 */
import { createLogger } from '../lib/logger';
import { startUndefinedReferenceCapture } from './main-world/capture-undefined-references';
import { FIREFOX_ERROR_DIALECT } from './main-world/firefox-error-dialect';

const log = createLogger('main-world');

export default defineContentScript({
  matches: ['https://*/*', 'http://*/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    try {
      startUndefinedReferenceCapture(
        import.meta.env.BROWSER === 'firefox' ? { dialect: FIREFOX_ERROR_DIALECT } : {}
      );
    } catch (cause) {
      log.error('Undefined-references capture could not start', cause);
    }
  }
});
