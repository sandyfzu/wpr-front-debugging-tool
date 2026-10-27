/**
 * The instant rows' storage seams: each targets its own item (never
 * `sync:options`), reads validated, writes guarded, and watches validated.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { optionsStore } from '../storage/options';
import { readPageUiEnabled } from '../storage/page-ui-gate';
import {
  DEFAULT_PALETTE_CHORD,
  readPaletteChord,
  type PaletteChord
} from '../storage/palette-chord';
import { createPageUiGateIO, createPaletteChordIO } from './instant-io';

beforeEach(() => {
  fakeBrowser.reset();
});

/** A silent logger. */
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** Let the storage watch deliver. */
async function flush(): Promise<void> {
  await new Promise((done) => setTimeout(done, 0));
}

describe('createPageUiGateIO', () => {
  it('reads/writes/watches sync:page-ui-gate only', async () => {
    const io = createPageUiGateIO(log);
    const seen: boolean[] = [];
    const unwatch = io.watch((value) => seen.push(value));
    expect(await io.read()).toBe(true);
    await io.write(false);
    await flush();
    expect(await readPageUiEnabled()).toBe(false);
    expect(seen).toEqual([false]);
    expect(await optionsStore.getValue()).toEqual(optionsStore.fallback);
    unwatch();
  });
});

describe('createPaletteChordIO', () => {
  it('reads the default, writes canonical, watches validated', async () => {
    const io = createPaletteChordIO(log);
    const seen: PaletteChord[] = [];
    const unwatch = io.watch((value) => seen.push(value));
    expect(await io.read()).toEqual(DEFAULT_PALETTE_CHORD);
    await io.write({ code: 'KeyP', mod: true, shift: false, alt: true });
    await flush();
    expect(await readPaletteChord()).toEqual({ code: 'KeyP', mod: true, alt: true });
    expect(seen).toEqual([{ code: 'KeyP', mod: true, alt: true }]);
    unwatch();
  });

  it('refuses an invalid chord (the model reports the failed write)', async () => {
    await expect(createPaletteChordIO(log).write({ code: 'KeyC', mod: true })).rejects.toThrow(
      /Refused an invalid palette chord/
    );
  });
});
