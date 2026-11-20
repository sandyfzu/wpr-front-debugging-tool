/**
 * The consent page's boot (Firefox only): error handlers first, the stored
 * appearance onto `<html>` before the first render (the paint lock in
 * `index.html` releases in every arm), then the view over the real
 * permissions, messaging and tab APIs.
 */
import { render } from 'solid-js/web';
import { bootAppearance } from '../../components/boot-appearance';
import { releaseThemeLock } from '../../lib/appearance/appearance';
import { hasDataConsent, type DataConsentApi } from '../../lib/data-consent/consent';
import { parseDataConsentPageQuery } from '../../lib/data-consent/consent-page-url';
import { createLogger } from '../../lib/logger';
import { onUncaughtError, onUnhandledRejection } from '../../lib/uncaught-errors';
import App from './App';
import { createConsentFlow, type ConsentFlow } from './consent-flow';
import { realConsentFlowDeps } from './real-deps';

const log = createLogger('data-consent');

window.addEventListener('error', onUncaughtError({ log }));
window.addEventListener('unhandledrejection', onUnhandledRejection({ log }));

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from data-consent/index.html');

/** Boot: appearance → lock released → render. */
async function boot(mountPoint: HTMLElement): Promise<void> {
  await bootAppearance(document.documentElement, log);
  const query = parseDataConsentPageQuery(window.location.search);
  // Firefox's `data_collection` key is missing from the shared API typings.
  const api = browser.permissions as unknown as DataConsentApi;
  const flow: ConsentFlow | null =
    query === null
      ? null
      : createConsentFlow(realConsentFlowDeps(query, api, () => hasDataConsent(api), log));
  render(
    () => <App query={query} flow={flow} name={browser.runtime.getManifest().name} />,
    mountPoint
  );
}

void boot(root).catch((cause: unknown) => {
  releaseThemeLock(document.documentElement);
  log.error(
    'Consent page boot failed',
    cause instanceof Error ? { message: cause.message } : cause
  );
});
