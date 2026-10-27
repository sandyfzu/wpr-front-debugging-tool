/**
 * The palette module's notice copy, single-sourced (title line + one
 * sentence naming what happened and the way forward).
 */
import {
  PAGE_SURFACE_NAMES,
  PAGE_UI_MENU_RESCUE,
  PAGE_UI_OPTIONS_RESCUE
} from '../../../lib/page-commands/commands';
import type { PageNotice } from './notice';

/** Shown on every open page when the on-page UI gate turns off. */
export const GATE_OFF_NOTICE: PageNotice = {
  title: 'On-page UI is off',
  body: `The ${PAGE_SURFACE_NAMES.commandPalette} and the other on-page tools stay hidden on every page. Turn them back on from ${PAGE_UI_MENU_RESCUE} or ${PAGE_UI_OPTIONS_RESCUE}.`
};

/** Shown when the palette's view could not be loaded into the page. */
export const LOAD_FAILED_NOTICE: PageNotice = {
  title: `The ${PAGE_SURFACE_NAMES.commandPalette} could not open`,
  body: 'Reload the page and try again.'
};
