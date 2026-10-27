/**
 * The on-page command vocabulary: unique ids, the user-facing labels pinned
 * byte for byte (the menu titles its rows from them — a drift here is a
 * visible menu change), the palette/menu split and the lookups.
 */
import { describe, expect, it } from 'vitest';
import {
  PAGE_COMMANDS,
  PAGE_UI_GATE_RESCUE_LABEL,
  isPaletteCommandId,
  pageCommand,
  pageCommandLabel,
  paletteCommands,
  type PageCommandId
} from './commands';

describe('PAGE_COMMANDS', () => {
  it('declares every id exactly once', () => {
    const ids = PAGE_COMMANDS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pins the user-facing labels (the menu titles) byte for byte', () => {
    expect(Object.fromEntries(PAGE_COMMANDS.map((row) => [row.id, row.label]))).toEqual({
      'side-by-side': 'Open Side By Side',
      'psi-side-by-side': 'Open Side By Side Performance',
      'toggle-detection-widget': 'Toggle the detection widget on this site',
      'exclusion-builder': 'Exclusion Builder',
      'page-ui-gate': 'Turn off all on-page UI',
      'open-command-palette': 'Open command palette',
      'open-nowprocket': 'Open ?nowprocket'
    });
    expect(PAGE_UI_GATE_RESCUE_LABEL).toBe('Turn on all on-page UI');
  });

  it('offers every row in the menu and keeps the triggers out of the palette', () => {
    expect(PAGE_COMMANDS.map((row) => row.menu)).not.toContain(false);
    expect(PAGE_COMMANDS.filter((row) => !row.palette).map((row) => row.id)).toEqual([
      'open-command-palette',
      'open-nowprocket'
    ]);
  });
});

describe('paletteCommands', () => {
  it('lists the palette rows in display order, the master gate last', () => {
    expect(paletteCommands().map((row) => row.id)).toEqual([
      'side-by-side',
      'psi-side-by-side',
      'toggle-detection-widget',
      'exclusion-builder',
      'page-ui-gate'
    ]);
  });
});

describe('lookups', () => {
  it('resolves rows and labels by id', () => {
    expect(pageCommand('exclusion-builder').id).toBe('exclusion-builder');
    expect(pageCommandLabel('open-nowprocket')).toBe('Open ?nowprocket');
  });

  it('throws naming the id outside the table (a broken invariant)', () => {
    expect(() => pageCommand('nope' as PageCommandId)).toThrow('Unknown on-page command: nope');
  });

  it('narrows untrusted ids to palette commands only', () => {
    expect(isPaletteCommandId('side-by-side')).toBe(true);
    expect(isPaletteCommandId('page-ui-gate')).toBe(true);
    expect(isPaletteCommandId('open-command-palette')).toBe(false);
    expect(isPaletteCommandId('open-nowprocket')).toBe(false);
    for (const junk of ['', 'Side-By-Side', null, undefined, 42, {}]) {
      expect(isPaletteCommandId(junk)).toBe(false);
    }
  });
});
