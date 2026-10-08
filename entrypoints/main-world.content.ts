/**
 * MAIN-world content script entrypoint: installs the undefined-references
 * capture on the page world before any page script runs (`document_start`),
 * so the first error of the page is observable.
 *
 * Registration runs inside a guard — a throw escaping this file would be
 * logged and re-thrown by the entrypoint wrapper into the page as our own
 * uncaught error, breaking the page-error neutrality the capture owes its
 * host.
 */
import { createLogger } from '../lib/logger';
import { startUndefinedReferenceCapture } from './main-world/capture-undefined-references';

const log = createLogger('main-world');

export default defineContentScript({
  matches: ['https://*/*', 'http://*/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    try {
      startUndefinedReferenceCapture();
    } catch (cause) {
      log.error('Undefined-references capture could not start', cause);
    }
  }
});
