/**
 * The palette module's notice copy: byte pins, and the gate-off notice
 * naming both ways back exactly as the confirm step and the options page do
 * (the shared vocabulary's phrases).
 */
import { describe, expect, it } from 'vitest';
import { PAGE_UI_MENU_RESCUE, PAGE_UI_OPTIONS_RESCUE } from '../../../lib/page-commands/commands';
import { paletteRowViews } from '../../../lib/page-commands/palette-rows';
import { GATE_OFF_NOTICE, LOAD_FAILED_NOTICE } from './copy';

describe('palette notice copy', () => {
  it('pins the gate-off notice, naming the menu and the options way back', () => {
    expect(GATE_OFF_NOTICE).toEqual({
      title: 'On-page UI is off',
      body: 'The command palette and the other on-page tools stay hidden on every page. Turn them back on from the page’s right-click menu (“Turn on all on-page UI”) or the extension’s options (“Show on-page UI”).'
    });
  });

  it('names the same two ways back as the gate row’s confirm step', () => {
    const confirm = paletteRowViews({ analysisHost: false }).find(
      (row) => row.id === 'page-ui-gate'
    )?.confirm;
    for (const phrase of [PAGE_UI_MENU_RESCUE, PAGE_UI_OPTIONS_RESCUE]) {
      expect(GATE_OFF_NOTICE.body).toContain(phrase);
      expect(confirm?.body).toContain(phrase);
    }
  });

  it('pins the load-failure notice', () => {
    expect(LOAD_FAILED_NOTICE).toEqual({
      title: 'The command palette could not open',
      body: 'Reload the page and try again.'
    });
  });
});
