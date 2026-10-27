/**
 * The cascade's data-driven leg at the row renderer: a boolean row carrying
 * the registry's `onPage` marker (the planned chip-default row's shape)
 * disables with the gate's note while the watched gate is off — no
 * per-row code — while unmarked rows stay live.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstantSettingSnapshot } from '../../lib/options/instant-setting';
import type * as Registry from '../../lib/options/registry';
import { DEFAULT_PALETTE_CHORD, type PaletteChord } from '../../lib/storage/palette-chord';
import { OptionSections, type OptionRowScope } from './sections';
import type { InstantRowsScope } from './instant-rows';

/** A future marked boolean row, appended to the real registry for this file only. */
const { MARKED } = vi.hoisted(() => ({
  MARKED: Object.freeze({
    kind: 'boolean',
    id: 'futureOnPageRow',
    section: 'features',
    label: 'Show the future on-page thing',
    description: 'A marked row',
    onPage: true
  } as const)
}));

vi.mock('../../lib/options/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof Registry>();
  const rows = [...actual.OPTION_ROWS, MARKED];
  return {
    ...actual,
    OPTION_ROWS: rows,
    optionRowsIn: (id: Registry.OptionSectionId) => rows.filter((row) => row.section === id)
  };
});

afterEach(() => {
  cleanup();
});

describe('the cascade over a marked boolean row', () => {
  it('disables it with the note while the gate is off, and only it', async () => {
    const { ON_PAGE_UI_OFF_NOTE } = await import('../../lib/options/registry');
    const [gate, setGate] = createSignal<InstantSettingSnapshot<boolean>>({
      status: 'ready',
      value: true,
      writing: false
    });
    const chord: InstantSettingSnapshot<PaletteChord> = {
      status: 'ready',
      value: DEFAULT_PALETTE_CHORD,
      writing: false
    };
    const scope: OptionRowScope = { read: () => false, edit: vi.fn() };
    const instant: InstantRowsScope = {
      gate,
      chord: () => chord,
      platform: () => 'mac',
      legend: () => 'K',
      setGate: vi.fn(),
      setChord: vi.fn(),
      retryGate: vi.fn(),
      retryChord: vi.fn(),
      refreshLayout: vi.fn()
    };
    render(() => <OptionSections scope={scope} instant={instant} drafted />);
    const marked = screen.getByRole<HTMLInputElement>('switch', { name: MARKED.label });
    const badge = screen.getByRole<HTMLInputElement>('switch', { name: 'Show the toolbar badge' });
    expect(marked.disabled).toBe(false);
    expect(marked.getAttribute('aria-describedby')).toBe('option-futureOnPageRow-description');

    setGate({ status: 'ready', value: false, writing: false });
    expect(marked.disabled).toBe(true);
    expect(document.getElementById('option-futureOnPageRow-note')?.textContent).toBe(
      ON_PAGE_UI_OFF_NOTE
    );
    expect(marked.getAttribute('aria-describedby')).toBe(
      'option-futureOnPageRow-description option-futureOnPageRow-note'
    );
    expect(badge.disabled).toBe(false);

    // An unknown gate (loading) disables nothing.
    setGate({ status: 'loading' });
    expect(marked.disabled).toBe(false);
    expect(document.getElementById('option-futureOnPageRow-note')).toBeNull();
  });
});
