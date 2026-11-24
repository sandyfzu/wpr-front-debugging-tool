/**
 * The options page's instant rows at the component tier, mounted in the real
 * page over the fake browser's storage: the on-page UI gate (instant write +
 * toasts, the draft surviving it, live follow, write/read failures) with the
 * cascade against the watched gate, and the shortcut field's state matrix —
 * focus/activation, recording, capture + toast, refusal reasons in the live
 * region, Escape/blur/pointer cancel, Tab passing, waiting keystrokes (IME,
 * lone modifiers), platform notation, layout legends, the Ctrl+Alt caveat
 * per platform, Reset, live follow, failures — plus axe per state; and the
 * What's new switch (instant write + toasts, live follow, the page link,
 * read/write failures).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, type OptionsPageProps } from './App';
import { toast, toastItems } from '../../components/ui/toast-store';
import { describeAxeViolations, runAxeAudit } from '../../components/ui/a11y-audit';
import { optionsStore } from '../../lib/storage/options';
import { createStorageOptionsPageIO } from '../../lib/options/page-model';
import { readPageUiEnabled, setPageUiGate } from '../../lib/storage/page-ui-gate';
import {
  DEFAULT_PALETTE_CHORD,
  readPaletteChord,
  setPaletteChord,
  type PaletteChord
} from '../../lib/storage/palette-chord';
import { createPageUiGateIO, createPaletteChordIO } from '../../lib/options/instant-io';
import { readWhatsNewOnUpdate, setWhatsNewOnUpdate } from '../../lib/storage/whats-new';
import { ON_PAGE_UI_OFF_NOTE } from '../../lib/options/registry';
import type { ChordPlatform } from '../../lib/storage/palette-chord-platform';
import type { KeyLayoutLookup } from '../../lib/options/keyboard-layout';

beforeEach(() => {
  fakeBrowser.reset();
  toast.clear();
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

const GATE_ROW = 'Show on-page UI';
const BADGE_ROW = 'Show the toolbar badge';
const FIELD_NAME = /^Command palette shortcut:/;

/** A silent logger. */
const quiet = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** Mount the page with a fixed platform and layout (default: macOS, no layout map). */
function mount(
  overrides: Partial<OptionsPageProps> & { platform?: ChordPlatform; layout?: KeyLayoutLookup } = {}
): void {
  const { platform = 'mac', layout = null, ...rest } = overrides;
  render(() => (
    <App
      name="WPR Front Debugging Tool"
      version="0.9.0"
      resolvePlatform={() => Promise.resolve(platform)}
      readLayout={() => Promise.resolve(layout)}
      {...rest}
    />
  ));
}

/** The gate switch once the instant read has landed. */
async function gateSwitch(): Promise<HTMLInputElement> {
  return screen.findByRole<HTMLInputElement>('switch', { name: GATE_ROW });
}

/** The shortcut field once its read and the platform have landed. */
async function field(): Promise<HTMLButtonElement> {
  return screen.findByRole<HTMLButtonElement>('button', { name: FIELD_NAME });
}

/** The shortcut field's live region. */
function fieldStatus(): HTMLElement {
  const status = document.getElementById('option-palette-chord-status');
  if (status === null) throw new Error('the shortcut field has no live region');
  return status;
}

/** Start recording the way the keyboard does (activation = click with detail 0). */
async function record(): Promise<HTMLButtonElement> {
  const control = await field();
  control.focus();
  fireEvent.click(control, { detail: 0 });
  expect(control.getAttribute('aria-pressed')).toBe('true');
  return control;
}

/** A keydown on the field; returns whether the field consumed it. */
function press(control: HTMLElement, init: KeyboardEventInit): boolean {
  return !fireEvent.keyDown(control, init);
}

/**
 * A keydown with an explicit AltGraph state — happy-dom's `getModifierState`
 * mirrors `altKey` for AltGraph, unlike browsers, where only a real AltGr
 * press (or an engine reading Ctrl+Alt as one) reports it.
 *
 * @returns Whether the field consumed it.
 */
function pressWithAltGraph(
  control: HTMLElement,
  init: KeyboardEventInit,
  altGraph: boolean
): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'getModifierState', {
    value: (held: string) => (held === 'AltGraph' ? altGraph : false)
  });
  return !fireEvent(control, event);
}

/** The toast titles currently queued. */
function toastTitles(): string[] {
  return toastItems().map((item) => item.title);
}

describe('the on-page UI gate row', () => {
  it('reads the gate, applies an off-switch instantly and confirms it', async () => {
    mount();
    const gate = await gateSwitch();
    expect(gate.getAttribute('aria-checked')).toBe('true');
    expect(gate.getAttribute('aria-describedby')).toBe('option-page-ui-gate-description');
    fireEvent.click(screen.getByText(GATE_ROW));
    await waitFor(async () => {
      expect(await readPageUiEnabled()).toBe(false);
    });
    await waitFor(() => {
      expect(toastTitles()).toContain('On-page UI turned off');
    });
    expect(toastItems().at(-1)?.description).toContain('right-click menu');
    fireEvent.click(screen.getByText(GATE_ROW));
    await waitFor(() => {
      expect(toastTitles()).toContain('On-page UI turned on');
    });
    expect(await readPageUiEnabled()).toBe(true);
  });

  it('never touches the draft: a pending edit stays dirty and unsaved', async () => {
    mount();
    await gateSwitch();
    await screen.findByRole('switch', { name: BADGE_ROW });
    const before = await optionsStore.getValue();
    fireEvent.click(screen.getByText(BADGE_ROW)); // A pending, unsaved edit.
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
    expect(save.disabled).toBe(false);
    fireEvent.click(screen.getByText(GATE_ROW));
    await waitFor(async () => {
      expect(await readPageUiEnabled()).toBe(false);
    });
    expect(save.disabled).toBe(false);
    expect(
      screen.getByRole<HTMLInputElement>('switch', { name: BADGE_ROW }).getAttribute('aria-checked')
    ).toBe('false');
    expect(await optionsStore.getValue()).toEqual(before);
  });

  it("follows another surface's write live (the context-menu rescue)", async () => {
    await setPageUiGate(false);
    mount();
    const gate = await gateSwitch();
    expect(gate.getAttribute('aria-checked')).toBe('false');
    await setPageUiGate(true);
    await waitFor(() => {
      expect(gate.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('a rejected write toasts the remedy and shows the stored value again', async () => {
    const io = createPageUiGateIO(quiet);
    mount({ pageUiIO: { ...io, write: () => Promise.reject(new Error('quota')) } });
    const gate = await gateSwitch();
    fireEvent.click(screen.getByText(GATE_ROW));
    await waitFor(() => {
      expect(toastTitles()).toContain('The on-page UI setting could not be saved');
    });
    expect(gate.getAttribute('aria-checked')).toBe('true');
    expect(await readPageUiEnabled()).toBe(true);
  });

  it('a rejected read offers Retry, which recovers', async () => {
    const io = createPageUiGateIO(quiet);
    let fail = true;
    mount({
      pageUiIO: {
        ...io,
        read: () => (fail ? Promise.reject(new Error('gone')) : io.read())
      }
    });
    const row = await waitFor(() => {
      const found = document.querySelector(
        '[data-fdt-option="page-ui-gate"] [data-fdt="option-read-failure"]'
      );
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    expect(row.textContent).toContain('This setting could not be read.');
    fail = false;
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0] as HTMLElement);
    expect((await gateSwitch()).getAttribute('aria-checked')).toBe('true');
  });
});

describe('read failures', () => {
  it('a retry holds the failure line busy, and a failed retry is visibly a new attempt', async () => {
    const io = createPageUiGateIO(quiet);
    const reads: Array<{ resolve: (v: boolean) => void; reject: (e: unknown) => void }> = [];
    mount({
      pageUiIO: {
        ...io,
        read: () =>
          new Promise<boolean>((resolve, reject) => {
            reads.push({ resolve, reject });
          })
      }
    });
    const failure = (): HTMLElement | null =>
      document.querySelector('[data-fdt-option="page-ui-gate"] [data-fdt="option-read-failure"]');
    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    reads[0]?.reject(new Error('gone'));
    await waitFor(() => {
      expect(failure()?.textContent).toContain('This setting could not be read.');
    });
    const retry = screen.getAllByRole<HTMLButtonElement>('button', { name: 'Retry' })[0];
    if (retry === undefined) throw new Error('no Retry');
    retry.focus();
    fireEvent.click(retry);
    // Busy, never natively disabled: focus stays on Retry through the attempt.
    expect(failure()?.textContent).toContain('Reading the setting again');
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(retry.getAttribute('aria-busy')).toBe('true');
    expect(retry.disabled).toBe(false);
    expect(document.activeElement).toBe(retry);
    // A click while busy starts nothing.
    fireEvent.click(retry);
    expect(reads).toHaveLength(2);
    reads[1]?.reject(new Error('still gone'));
    await waitFor(() => {
      expect(failure()?.textContent).toContain('This setting could not be read.');
    });
    expect(retry.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(retry);
    reads[2]?.resolve(false);
    expect((await gateSwitch()).getAttribute('aria-checked')).toBe('false');
  });

  it('a failed options read keeps the instant rows reachable (the gate rescue)', async () => {
    await setPageUiGate(false);
    mount({
      io: { ...createStorageOptionsPageIO(quiet), read: () => Promise.reject(new Error('gone')) }
    });
    await screen.findByText("Couldn't load the options");
    const gate = await gateSwitch();
    expect(gate.getAttribute('aria-checked')).toBe('false');
    // Drafted rows wait for the draft; their cards are not rendered empty.
    expect(screen.queryByRole('switch', { name: BADGE_ROW })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Appearance' })).toBeNull();
    fireEvent.click(screen.getByText(GATE_ROW));
    await waitFor(async () => {
      expect(await readPageUiEnabled()).toBe(true);
    });
  });
});

describe('the cascade against the watched gate', () => {
  it('disables the on-page rows with the note while the gate is off, and only them', async () => {
    mount();
    const control = await field();
    expect(control.disabled).toBe(false);
    await setPageUiGate(false);
    await waitFor(() => {
      expect(control.disabled).toBe(true);
    });
    const note = document.getElementById('option-palette-chord-note');
    expect(note?.textContent).toBe(ON_PAGE_UI_OFF_NOTE);
    expect(control.getAttribute('aria-describedby')?.split(' ')).toContain(
      'option-palette-chord-note'
    );
    // Unaffected rows stay live.
    expect(screen.getByRole<HTMLInputElement>('switch', { name: BADGE_ROW }).disabled).toBe(false);
    expect((await gateSwitch()).disabled).toBe(false);
    await setPageUiGate(true);
    await waitFor(() => {
      expect(control.disabled).toBe(false);
    });
    expect(document.getElementById('option-palette-chord-note')).toBeNull();
  });
});

describe('the shortcut field', () => {
  it('shows the bound chord in platform notation, named in words', async () => {
    mount();
    const control = await field();
    expect(control.textContent).toBe('⌥K');
    expect(control.getAttribute('aria-label')).toBe('Command palette shortcut: Option+K');
    expect(control.getAttribute('aria-pressed')).toBe('false');
    cleanup();
    mount({ platform: 'other' });
    const other = await field();
    expect(other.textContent).toBe('Alt+K');
    expect(other.getAttribute('aria-label')).toBe('Command palette shortcut: Alt+K');
  });

  it('records, captures a valid combination, writes it at once and toasts', async () => {
    mount();
    const control = await record();
    expect(fieldStatus().getAttribute('role')).toBe('status');
    expect(fieldStatus().textContent).toContain('hold Option or Command');
    // The bound chord stays the visible content (it is bound until replaced).
    expect(control.textContent).toBe('⌥K');
    expect(press(control, { code: 'KeyP', altKey: true })).toBe(true);
    await waitFor(async () => {
      expect(await readPaletteChord()).toEqual({ code: 'KeyP', alt: true });
    });
    expect(control.getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => {
      expect(control.textContent).toBe('⌥P');
    });
    expect(control.getAttribute('aria-label')).toBe('Command palette shortcut: Option+P');
    await waitFor(() => {
      expect(toastTitles()).toContain('Command palette shortcut saved');
    });
    // Spelled in words (toasts are read aloud; glyphs read poorly).
    expect(toastItems().at(-1)?.description).toBe(
      'Option+P opens the command palette on inspected pages.'
    );
  });

  it('refuses reserved and bare combinations with the reason, still recording', async () => {
    mount();
    const control = await record();
    expect(press(control, { code: 'KeyC', metaKey: true })).toBe(true);
    expect(fieldStatus().textContent).toBe(
      'Command+C is taken by text editing — choose another one'
    );
    expect(control.getAttribute('aria-pressed')).toBe('true');
    expect(press(control, { code: 'KeyK' })).toBe(true);
    expect(fieldStatus().textContent).toBe(
      'Hold Option or Command with the key, or use F1–F12 alone'
    );
    // Enter is a refused key while recording, never an activation.
    expect(press(control, { code: 'Enter', key: 'Enter' })).toBe(true);
    expect(fieldStatus().textContent).toContain('That key cannot be part of the shortcut');
    expect(await readPaletteChord()).toEqual(DEFAULT_PALETTE_CHORD);
  });

  it('waits through lone modifiers, auto-repeat and IME keystrokes', async () => {
    mount();
    const control = await record();
    const prompt = fieldStatus().textContent;
    expect(press(control, { code: 'AltLeft', altKey: true })).toBe(true);
    expect(press(control, { code: 'KeyP', altKey: true, isComposing: true })).toBe(true);
    expect(press(control, { code: 'KeyP', altKey: true, repeat: true })).toBe(true);
    expect(fieldStatus().textContent).toBe(prompt);
    expect(control.getAttribute('aria-pressed')).toBe('true');
    expect(await readPaletteChord()).toEqual(DEFAULT_PALETTE_CHORD);
  });

  it('Escape cancels (and stays inside the field); Tab passes through', async () => {
    mount();
    const control = await record();
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    expect(press(control, { code: 'Escape', key: 'Escape' })).toBe(true);
    document.removeEventListener('keydown', outer);
    expect(outer).not.toHaveBeenCalled();
    expect(control.getAttribute('aria-pressed')).toBe('false');
    expect(fieldStatus().textContent).toBe('Shortcut unchanged');
    fireEvent.click(control, { detail: 0 });
    expect(press(control, { code: 'Tab', key: 'Tab' })).toBe(false);
    expect(control.getAttribute('aria-pressed')).toBe('true');
  });

  it('leaving the field or a pointer click cancels recording; idle keys are ignored', async () => {
    mount();
    const control = await record();
    fireEvent.blur(control);
    expect(control.getAttribute('aria-pressed')).toBe('false');
    // Idle: keystrokes are the platform's (no capture, nothing consumed).
    expect(press(control, { code: 'KeyP', altKey: true })).toBe(false);
    fireEvent.click(control, { detail: 1 });
    expect(control.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(control, { detail: 1 });
    expect(control.getAttribute('aria-pressed')).toBe('false');
    expect(fieldStatus().textContent).toBe('Shortcut unchanged');
    // Space's keyup activation is held only while recording.
    expect(fireEvent.keyUp(control, { code: 'Space' })).toBe(true);
    fireEvent.click(control, { detail: 0 });
    expect(fireEvent.keyUp(control, { code: 'Space' })).toBe(false);
  });

  it('keeps its name while recording; the prompt is the one announcement', async () => {
    mount();
    const control = await record();
    expect(control.getAttribute('aria-label')).toBe('Command palette shortcut: Option+K');
    expect(fieldStatus().textContent).toContain('Press the new shortcut');
  });

  it('keeps its visible text inside its name in every state (WCAG 2.5.3)', async () => {
    /** Visible text vs name, compared on letters and digits only (glyphs read as words). */
    const comparable = (text: string | null): string =>
      (text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const assertIncluded = (control: HTMLElement, state: string): void => {
      const visible = comparable(control.textContent);
      expect(visible, state).not.toBe('');
      expect(comparable(control.getAttribute('aria-label')), state).toContain(visible);
    };
    for (const platform of ['mac', 'other'] as const) {
      mount({ platform });
      const control = await field();
      assertIncluded(control, `${platform} idle`);
      fireEvent.click(control, { detail: 0 });
      expect(control.getAttribute('aria-pressed')).toBe('true');
      assertIncluded(control, `${platform} recording`);
      press(control, { code: 'KeyK' });
      expect(fieldStatus().textContent).not.toContain('Press the new shortcut');
      assertIncluded(control, `${platform} refused`);
      press(control, { code: 'Escape', key: 'Escape' });
      expect(fieldStatus().textContent).toBe('Shortcut unchanged');
      assertIncluded(control, `${platform} unchanged`);
      cleanup();
    }
  });

  it('a click on the row label never starts a recording', async () => {
    mount();
    const control = await field();
    const label = screen.getByText('Command palette shortcut', { selector: 'span' });
    expect(label.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(label);
    expect(control.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('label[for="option-palette-chord-field"]')).toBeNull();
  });

  it('re-pressing the bound chord ends with "Shortcut unchanged" and writes nothing', async () => {
    const write = vi.fn(() => Promise.resolve());
    mount({ chordIO: { ...createPaletteChordIO(quiet), write } });
    const control = await record();
    expect(press(control, { code: 'KeyK', altKey: true })).toBe(true);
    expect(control.getAttribute('aria-pressed')).toBe('false');
    expect(fieldStatus().textContent).toBe('Shortcut unchanged');
    expect(write).not.toHaveBeenCalled();
    expect(toastTitles()).not.toContain('Command palette shortcut saved');
  });

  it('turning the gate off mid-recording stops the recording', async () => {
    mount();
    const control = await record();
    await setPageUiGate(false);
    await waitFor(() => {
      expect(control.disabled).toBe(true);
    });
    expect(control.getAttribute('aria-pressed')).toBe('false');
    expect(fieldStatus().textContent).toBe('Shortcut unchanged');
    await setPageUiGate(true);
    await waitFor(() => {
      expect(control.disabled).toBe(false);
    });
    // Back to idle: a keystroke is the platform's again.
    expect(press(control, { code: 'KeyP', altKey: true })).toBe(false);
    expect(await readPaletteChord()).toEqual(DEFAULT_PALETTE_CHORD);
  });

  it('shows layout-true legends when the layout map is known', async () => {
    const azerty: KeyLayoutLookup = { get: (code) => (code === 'KeyQ' ? 'a' : undefined) };
    mount({ layout: azerty });
    const control = await record();
    press(control, { code: 'KeyQ', altKey: true });
    await waitFor(() => {
      expect(control.textContent).toBe('⌥A');
    });
    expect(control.getAttribute('aria-label')).toBe('Command palette shortcut: Option+A');
  });

  it('Reset returns to the default and disappears with it', async () => {
    await setPaletteChord({ code: 'KeyP', alt: true });
    mount();
    const reset = await screen.findByRole('button', { name: 'Reset to default (Option+K)' });
    expect(reset.textContent).toBe('Reset to default (⌥K)');
    fireEvent.click(reset);
    await waitFor(async () => {
      expect(await readPaletteChord()).toEqual(DEFAULT_PALETTE_CHORD);
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Reset to default/ })).toBeNull();
    });
  });

  it("follows another surface's rebinding live", async () => {
    mount();
    const control = await field();
    await setPaletteChord({ code: 'KeyL', mod: true, shift: true });
    await waitFor(() => {
      expect(control.textContent).toBe('⇧⌘L');
    });
  });

  it('a rejected write toasts the remedy and keeps the previous shortcut', async () => {
    const io = createPaletteChordIO(quiet);
    mount({ chordIO: { ...io, write: () => Promise.reject(new Error('quota')) } });
    const control = await record();
    press(control, { code: 'KeyP', altKey: true });
    await waitFor(() => {
      expect(toastTitles()).toContain('The command palette shortcut could not be saved');
    });
    expect(control.textContent).toBe('⌥K');
  });

  it('a rejected read offers Retry', async () => {
    const io = createPaletteChordIO(quiet);
    let fail = true;
    mount({
      chordIO: { ...io, read: () => (fail ? Promise.reject(new Error('gone')) : io.read()) }
    });
    await waitFor(() => {
      expect(
        document.querySelector('[data-fdt-option="palette-chord"] [data-fdt="option-read-failure"]')
      ).toBeTruthy();
    });
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await field()).textContent).toBe('⌥K');
  });

  it('degrades a rejecting platform or layout seam (Ctrl notation, US legends)', async () => {
    mount({
      resolvePlatform: () => Promise.reject(new Error('gone')),
      readLayout: () => Promise.reject(new Error('gone'))
    });
    expect((await field()).textContent).toBe('Alt+K');
  });
});

describe('the Ctrl+Alt caveat', () => {
  it('outside macOS: captured Ctrl+Alt saves and shows the persistent warning', async () => {
    mount({ platform: 'other' });
    const control = await record();
    pressWithAltGraph(control, { code: 'KeyO', ctrlKey: true, altKey: true }, false);
    await waitFor(async () => {
      expect(await readPaletteChord()).toEqual({ code: 'KeyO', mod: true, alt: true });
    });
    const caveat = await waitFor(() => {
      const found = document.getElementById('option-palette-chord-caveat');
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    expect(caveat.textContent).toContain('Ctrl+Alt shortcuts may never fire on Windows');
    expect(control.getAttribute('aria-describedby')?.split(' ')).toContain(
      'option-palette-chord-caveat'
    );
  });

  it('outside macOS: a keystroke the keyboard reports as AltGr is refused with its reason', async () => {
    mount({ platform: 'other' });
    const control = await record();
    expect(pressWithAltGraph(control, { code: 'KeyO', ctrlKey: true, altKey: true }, true)).toBe(
      true
    );
    expect(fieldStatus().textContent).toContain('reads as AltGr on this keyboard');
    expect(control.getAttribute('aria-pressed')).toBe('true');
    expect(await readPaletteChord()).toEqual(DEFAULT_PALETTE_CHORD);
  });

  it('on macOS: a Command+Option binding warns with its synced Windows chord', async () => {
    const chord: PaletteChord = { code: 'KeyO', mod: true, alt: true };
    await setPaletteChord(chord);
    mount();
    await field();
    const caveat = await waitFor(() => {
      const found = document.getElementById('option-palette-chord-caveat');
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    expect(caveat.textContent).toContain('On Windows this shortcut is Ctrl+Alt+O');
  });

  it('no warning for the default binding', async () => {
    mount({ platform: 'other' });
    await field();
    expect(document.getElementById('option-palette-chord-caveat')).toBeNull();
  });
});

describe('axe per state', () => {
  /** Audit the current document. */
  async function audit(): Promise<void> {
    const result = await runAxeAudit();
    expect(describeAxeViolations(result.violations)).toBe('');
  }

  it('recording, refused, gate-off and caveat states raise zero violations', async () => {
    await setPaletteChord({ code: 'KeyO', mod: true, alt: true }); // Caveat + Reset visible.
    mount({ platform: 'other' });
    const control = await record();
    await audit();
    press(control, { code: 'KeyC', ctrlKey: true });
    await audit();
    await setPageUiGate(false);
    await waitFor(() => {
      expect(control.disabled).toBe(true);
    });
    await audit();
  });

  it('the failed-read state raises zero violations', async () => {
    mount({
      pageUiIO: { ...createPageUiGateIO(quiet), read: () => Promise.reject(new Error('gone')) },
      chordIO: { ...createPaletteChordIO(quiet), read: () => Promise.reject(new Error('gone')) }
    });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(2);
    });
    await audit();
  });
});

describe('the What’s new row', () => {
  const ROW = 'Show what’s new after updates';

  it('applies instantly, toasts each direction, and links the page', async () => {
    mount();
    const toggle = await screen.findByRole<HTMLInputElement>('switch', { name: ROW });
    expect(toggle.checked).toBe(true);
    const link = document.querySelector<HTMLAnchorElement>('[data-fdt="options-whats-new-link"]');
    expect(link?.getAttribute('href')).toBe('/whats-new.html');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.textContent).toBe('Open What’s new');

    fireEvent.click(toggle);
    await waitFor(async () => {
      expect(await readWhatsNewOnUpdate()).toBe(false);
    });
    await waitFor(() => {
      expect(toastItems().map((item) => item.title)).toContain(
        'What’s new won’t open after updates'
      );
    });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toastItems().map((item) => item.title)).toContain(
        'What’s new will open after updates'
      );
    });
    expect(await readWhatsNewOnUpdate()).toBe(true);
  });

  it('follows the page footer’s write live, and never touches the draft', async () => {
    mount();
    const badge = await screen.findByRole<HTMLInputElement>('switch', { name: BADGE_ROW });
    fireEvent.click(badge);
    const toggle = await screen.findByRole<HTMLInputElement>('switch', { name: ROW });
    await setWhatsNewOnUpdate(false);
    await waitFor(() => {
      expect(toggle.checked).toBe(false);
    });
    // The pending badge edit is still pending (the draft stayed untouched).
    expect(badge.checked).toBe(false);
    expect((await optionsStore.getValue()).features.toolbarBadge).toBe(true);
  });

  it('shows a failed read with Retry, and toasts a failed write', async () => {
    let failRead = true;
    mount({
      whatsNewIO: {
        read: () => (failRead ? Promise.reject(new Error('dead')) : Promise.resolve(true)),
        write: () => Promise.reject(new Error('quota')),
        watch: () => () => undefined,
        log: quiet
      }
    });
    await screen.findByText('This setting could not be read.');
    failRead = false;
    fireEvent.click(screen.getByText('Retry'));
    const toggle = await screen.findByRole<HTMLInputElement>('switch', { name: ROW });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toastItems().map((item) => item.title)).toContain(
        'The What’s new setting could not be saved'
      );
    });
    expect(toggle.checked).toBe(true);
  });
});
