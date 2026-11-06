/**
 * The LCP analysis's page module (top frame): answers the panel's
 * `runLcpAnalysis` with the executor; the highlighter is created on the
 * first asked highlight. No on-page trigger: the panel is the only way in.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createLogger } from '../../../lib/logger';
import { onMessage } from '../../../lib/messaging';
import { parseLcpAnalysisRequest } from '../../../lib/messaging/lcp-analysis';
import { analyseLcp, type ObserverClass } from './executor';
import { createLcpHighlighter, type LcpHighlighter } from './highlight';

const log = createLogger('lcp-analysis');

/**
 * Wire the module (registry row of the isolated world). Top frame only: the
 * page's LCP is the top document's.
 *
 * @param ctx The content script's context; the handler rides its lifetime.
 */
export function setupLcpAnalysis(ctx: ContentScriptContext): void {
  if (window !== window.top) return;
  let highlighter: LcpHighlighter | null = null;
  ctx.onInvalidated(
    onMessage('runLcpAnalysis', ({ data }) => {
      const request = parseLcpAnalysisRequest(data);
      // Both ends ship in one build: a malformed request is a defect, refused loudly.
      if (request === null) throw new Error('runLcpAnalysis: malformed request');
      return analyseLcp(request, {
        Observer: (globalThis as { PerformanceObserver?: ObserverClass }).PerformanceObserver,
        performance,
        highlight: (element) => (highlighter ??= createLcpHighlighter(ctx, log)).show(element)
      });
    })
  );
}
