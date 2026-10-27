/**
 * The palette bridge: publish/read round trip on the isolated world's
 * global, refusal of anything missing, malformed, dead or throwing, and a
 * retraction that never removes a newer module's bridge, and the row list
 * the view renders.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  PALETTE_BRIDGE_GLOBAL,
  paletteRowViews,
  publishPaletteBridge,
  readPaletteBridge,
  retractPaletteBridge,
  type IsolatedWorld,
  type PaletteBridge
} from './palette-bridge';

/** A bridge whose liveness the test controls. */
function bridge(alive: () => boolean = () => true): PaletteBridge {
  return {
    alive,
    rows: () => [],
    run: vi.fn(),
    attach: () => true,
    detach: vi.fn()
  };
}

describe('palette bridge', () => {
  it('reads back the published live bridge', () => {
    const world: IsolatedWorld = {};
    const published = bridge();
    publishPaletteBridge(world, published);
    expect(world[PALETTE_BRIDGE_GLOBAL]).toBe(published);
    expect(readPaletteBridge(world)).toBe(published);
  });

  it('finds nothing in a world without a bridge', () => {
    expect(readPaletteBridge({})).toBeNull();
  });

  it.each<[string, unknown]>([
    ['a string', 'bridge'],
    ['null', null],
    ['a function', (): boolean => true],
    ['a partial object', { alive: (): boolean => true, rows: (): unknown[] => [] }],
    ['a method that is not a function', { ...bridge(), run: 'run' }]
  ])('refuses %s', (_label, value) => {
    expect(readPaletteBridge({ [PALETTE_BRIDGE_GLOBAL]: value })).toBeNull();
  });

  it('refuses a dead module and a liveness check that throws', () => {
    expect(readPaletteBridge({ [PALETTE_BRIDGE_GLOBAL]: bridge(() => false) })).toBeNull();
    const throwing = bridge((): boolean => {
      throw new Error('Extension context invalidated.');
    });
    expect(readPaletteBridge({ [PALETTE_BRIDGE_GLOBAL]: throwing })).toBeNull();
  });

  it('retracts only its own bridge (a newer module keeps the page)', () => {
    const world: IsolatedWorld = {};
    const older = bridge();
    const newer = bridge();
    publishPaletteBridge(world, older);
    publishPaletteBridge(world, newer);
    retractPaletteBridge(world, older);
    expect(world[PALETTE_BRIDGE_GLOBAL]).toBe(newer);
    retractPaletteBridge(world, newer);
    expect(PALETTE_BRIDGE_GLOBAL in world).toBe(false);
  });
});

describe('paletteRowViews', () => {
  it('lists the palette rows with resolved availability and confirm copy', () => {
    const rows = paletteRowViews({ analysisHost: false });
    expect(rows.map((row) => row.id)).toEqual([
      'side-by-side',
      'psi-side-by-side',
      'toggle-detection-widget',
      'exclusion-builder',
      'page-ui-gate'
    ]);
    expect(rows.every((row) => row.disabledNote === null)).toBe(true);
    expect(rows.find((row) => row.id === 'page-ui-gate')?.confirm?.action).toBe('Turn off');
    expect(rows.find((row) => row.id === 'side-by-side')?.confirm).toBeNull();
  });

  it('resolves the analysis host’s disabled row', () => {
    const psi = paletteRowViews({ analysisHost: true }).find(
      (row) => row.id === 'psi-side-by-side'
    );
    expect(psi?.disabledNote).toBe('Starts from a site, not from PageSpeed Insights');
  });
});
