/**
 * The storage-backed seams of the options page's instant rows: each row's
 * own item through its contract's validated read, guarded write and
 * validated watch — never the `sync:options` shape, so a write here can
 * never revert a pending draft.
 */
import type { Logger } from '../logger';
import { readPageUiEnabled, setPageUiGate, watchPageUiGate } from '../storage/page-ui-gate';
import {
  readPaletteChord,
  setPaletteChord,
  watchPaletteChord,
  type PaletteChord
} from '../storage/palette-chord';
import {
  readWhatsNewOnUpdate,
  setWhatsNewOnUpdate,
  watchWhatsNewOnUpdate
} from '../storage/whats-new';
import type { InstantSettingIO } from './instant-setting';

/**
 * The on-page UI gate's seams (`sync:page-ui-gate`).
 *
 * @param log Diagnostics sink.
 */
export function createPageUiGateIO(log: Logger): InstantSettingIO<boolean> {
  return { read: readPageUiEnabled, write: setPageUiGate, watch: watchPageUiGate, log };
}

/**
 * The palette shortcut's seams (`sync:palette-chord`); the write refuses an
 * invalid chord (a rejection the model reports as a failed write).
 *
 * @param log Diagnostics sink.
 */
export function createPaletteChordIO(log: Logger): InstantSettingIO<PaletteChord> {
  return { read: readPaletteChord, write: setPaletteChord, watch: watchPaletteChord, log };
}

/**
 * The "Show what's new after updates" seams (`sync:whats-new-on-update`) —
 * shared by the options row and the What's new page's footer switch.
 *
 * @param log Diagnostics sink.
 */
export function createWhatsNewOnUpdateIO(log: Logger): InstantSettingIO<boolean> {
  return {
    read: readWhatsNewOnUpdate,
    write: setWhatsNewOnUpdate,
    watch: watchWhatsNewOnUpdate,
    log
  };
}
