/**
 * The live wiring: the widget (set up before the test module, as in the
 * content script's registry) follows an applied RUCSS test — its pill gains
 * the test glyph with no new page pass — over the real mount, the real
 * test module and the fake browser's messaging.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { onMessage, sendMessage } from '../../../lib/messaging/index';
import { setupRucssTest } from '../rucss-test';
import { INSPECTOR_UI_NAME } from './strip-state';
import { setupInspectorWidget } from './index';

let ctx: ContentScriptContext;
let seq = 0;
let stopBackground = (): void => undefined;

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
    manifest_version: 3,
    name: 'test',
    version: '1.0.0'
  });
  // No page-data hub runs here: the widget logs its documented failure copy.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  seq += 1;
  ctx = new ContentScriptContext(`inspector-rucss-${String(seq)}`);
});

afterEach(() => {
  ctx.notifyInvalidated();
  stopBackground();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** The widget's shadow root, once rendered. */
async function widget(): Promise<ShadowRoot> {
  return vi.waitFor(() => {
    const root = document.querySelector(INSPECTOR_UI_NAME)?.shadowRoot;
    if (root?.querySelector('.ins-pill') == null) throw new Error('not rendered yet');
    return root;
  });
}

describe('the widget follows an applied RUCSS test', () => {
  it('shows the test glyph after the apply, set up before the test module', async () => {
    stopBackground = onMessage('fetchRucssShakenCss', () => ({
      kind: 'answered',
      requestUrl: 'u',
      outcome: { ok: true, shakenCss: 'a{}' }
    }));
    setupInspectorWidget(ctx);
    setupRucssTest(ctx);
    const root = await widget();
    expect(root.querySelector('[data-fdt-strip-pill-rucss]')).toBeNull();

    const started = await sendMessage('startRucssTest', {
      safelist: [],
      inlinePreserves: [],
      mobile: false,
      home: false
    });
    if (!started.ok) throw new Error('not started');
    await sendMessage('applyRucssTest', { runId: started.runId, css: 'b{}', keepLinks: [] });

    await vi.waitFor(() => {
      expect(root.querySelector('[data-fdt-strip-pill-rucss]')).not.toBeNull();
    });
  });
});
