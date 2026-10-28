/**
 * The shared chord follower: watch before read (a write during the read
 * wins), live writes, a failed read degrading to the default unless a write
 * arrived, a failed watch still reading; and the navigator stand-in.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PALETTE_CHORD, type PaletteChord } from '../storage/palette-chord';
import { followPaletteChord, navigatorChordPlatform, type ChordSource } from './follow';

const ALT_P: PaletteChord = { code: 'KeyP', alt: true };
const MOD_ALT_O: PaletteChord = { code: 'KeyO', mod: true, alt: true };

/** Wait for queued promise callbacks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** A source over a hand-settled read and a capturable watcher. */
function source(read: Promise<PaletteChord>) {
  let watcher: ((chord: PaletteChord) => void) | null = null;
  const unwatch = vi.fn();
  const order: string[] = [];
  const deps: ChordSource = {
    readChord: vi.fn(() => {
      order.push('read');
      return read;
    }),
    watchChord: vi.fn((onChange: (chord: PaletteChord) => void) => {
      order.push('watch');
      watcher = onChange;
      return unwatch;
    }),
    log: { warn: vi.fn() }
  };
  return { deps, unwatch, order, write: (chord: PaletteChord) => watcher?.(chord) };
}

describe('followPaletteChord', () => {
  it('watches before it reads, applies the read, then every write', async () => {
    const s = source(Promise.resolve(ALT_P));
    const apply = vi.fn();
    const stop = followPaletteChord(s.deps, apply);
    expect(s.order).toEqual(['watch', 'read']);
    await settle();
    expect(apply).toHaveBeenLastCalledWith(ALT_P);
    s.write(MOD_ALT_O);
    expect(apply).toHaveBeenLastCalledWith(MOD_ALT_O);
    stop();
    expect(s.unwatch).toHaveBeenCalledOnce();
  });

  it('a write landing during the read wins over the read’s older value', async () => {
    let resolveRead!: (chord: PaletteChord) => void;
    const s = source(new Promise((resolve) => (resolveRead = resolve)));
    const apply = vi.fn();
    followPaletteChord(s.deps, apply);
    s.write(MOD_ALT_O);
    resolveRead(ALT_P);
    await settle();
    expect(apply.mock.calls).toEqual([[MOD_ALT_O]]);
  });

  it('a failed read applies the default and logs', async () => {
    const s = source(Promise.reject(new Error('dead')));
    const apply = vi.fn();
    followPaletteChord(s.deps, apply);
    await settle();
    expect(apply).toHaveBeenCalledWith(DEFAULT_PALETTE_CHORD);
    expect(s.deps.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('using the default'),
      expect.any(Error)
    );
  });

  it('a failed read after a write keeps the write', async () => {
    let rejectRead!: (cause: unknown) => void;
    const s = source(new Promise((_resolve, reject) => (rejectRead = reject)));
    const apply = vi.fn();
    followPaletteChord(s.deps, apply);
    s.write(MOD_ALT_O);
    rejectRead(new Error('dead'));
    await settle();
    expect(apply.mock.calls).toEqual([[MOD_ALT_O]]);
  });

  it('a throwing watch is logged; the read still applies and the stop is a no-op', async () => {
    const s = source(Promise.resolve(ALT_P));
    s.deps.watchChord = () => {
      throw new Error('no storage');
    };
    const apply = vi.fn();
    const stop = followPaletteChord(s.deps, apply);
    await settle();
    expect(apply).toHaveBeenCalledWith(ALT_P);
    expect(s.deps.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('unwatched'),
      expect.any(Error)
    );
    expect(() => {
      stop();
    }).not.toThrow();
  });

  it('a synchronously throwing read degrades like a rejecting one', async () => {
    const s = source(Promise.resolve(ALT_P));
    s.deps.readChord = () => {
      throw new Error('sync');
    };
    const apply = vi.fn();
    followPaletteChord(s.deps, apply);
    await settle();
    expect(apply).toHaveBeenCalledWith(DEFAULT_PALETTE_CHORD);
  });
});

describe('navigatorChordPlatform', () => {
  it('reads macOS as mac and everything else as other', () => {
    expect(navigatorChordPlatform({ platform: 'MacIntel' })).toBe('mac');
    expect(navigatorChordPlatform({ userAgentData: { platform: 'macOS' } })).toBe('mac');
    expect(navigatorChordPlatform({ platform: 'Win32' })).toBe('other');
    expect(navigatorChordPlatform({})).toBe('other');
  });
});
