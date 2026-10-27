/**
 * The palette module's notice copy, single-sourced (title line + one
 * sentence naming what happened and the way forward).
 */
import { PAGE_UI_GATE_RESCUE_LABEL } from '../../../lib/page-commands/commands';
import type { PageNotice } from './notice';

/** Shown on every open page when the on-page UI gate turns off. */
export const GATE_OFF_NOTICE: PageNotice = {
  title: 'On-page UI is off',
  body: `The command palette and the other on-page tools stay hidden on every page. To bring them back, right-click a page and choose “${PAGE_UI_GATE_RESCUE_LABEL}”.`
};

/** Shown when the palette's view could not be loaded into the page. */
export const LOAD_FAILED_NOTICE: PageNotice = {
  title: 'The command palette could not open',
  body: 'Reload the page and try again.'
};
