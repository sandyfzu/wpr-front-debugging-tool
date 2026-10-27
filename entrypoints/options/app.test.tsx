/**
 * The options page's component-tier contract: the load state matrix
 * (skeleton → populated, corrupt-degrades, failure+retry), the dirty-gated
 * Save flow with its busy/clean guards and typed toast outcomes (draft merges
 * preserve unknown and concurrent fields), the appearance choice's instant
 * write and its live restyle through the real storage watch, the toolbar
 * badge toggle's write, keyboard reachability, and the axe runs per state.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from './App';
import { toast, toastItems } from '../../components/ui/toast-store';
import { describeAxeViolations, runAxeAudit } from '../../components/ui/a11y-audit';
import { applyStoredAppearance } from '../../lib/appearance/appearance';
import { getOptions, optionsStore, type StoredOptions } from '../../lib/storage/options';
import { OPTION_ROWS } from '../../lib/options/registry';
import type { OptionsPageIO } from '../../lib/options/page-model';

beforeEach(() => {
  fakeBrowser.reset();
  toast.clear();
  // The fake browser leaves platform info unimplemented; the page's default
  // seam asks it for the shortcut's keyboard convention.
  vi.spyOn(browser.runtime, 'getPlatformInfo').mockResolvedValue({ os: 'mac' } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  // The appearance tests arm the real storage watch over the shared document
  // root; neither of its attributes may leak into the next test's renders.
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-lock');
});

/** The tested surface's props (the manifest's declared name; the version is a test value). */
const PROPS = { name: 'WPR Front Debugging Tool', version: '0.9.0' } as const;

/** The dbugger switch row's label (its registry copy, pinned verbatim here). */
const DBUGGER_ROW = "Add an entry to access the D-bugger to WP Rocket's menu";
const BADGE_ROW = 'Show the toolbar badge';
const GATE_ROW = 'Show on-page UI';

/**
 * A whole-shape options value with one choice (the documented defaults
 * elsewhere) — the tests' write shape, never the page's.
 */
function optionsWith(
  appearance: StoredOptions['appearance'],
  overrides?: Partial<StoredOptions>
): StoredOptions {
  return {
    ...storedDefaults(),
    appearance,
    ...overrides
  };
}

/** The storage contract's documented defaults, read through its validator. */
function storedDefaults(): StoredOptions {
  return {
    improvements: { 'wp-dashboard-dbugger-entry': true },
    appearance: 'system',
    features: {
      toolbarBadge: true,
      sbsScrollSync: true,
      sbsMobileSim: false,
      sbsDesktopWidth: true
    }
  };
}

/** The App's props with one model seam stubbed for a failure test. */
function propsWith(io: OptionsPageIO): typeof PROPS & { io: OptionsPageIO } {
  return { ...PROPS, io };
}

describe('the entrypoint document (index.html contract)', () => {
  it('opens in a tab, pins the pre-paint palette machinery and mounts the app', () => {
    const window = new Window({ url: 'chrome-extension://test/options/index.html' });
    const document = window.document;
    document.write(readFileSync(join(import.meta.dirname, 'index.html'), 'utf8'));
    // open_in_tab: the manifest generator reads this meta (never hand-editing
    // the generated manifest).
    expect(
      document.querySelector('meta[name="manifest.open_in_tab"]')?.getAttribute('content')
    ).toBe('true');
    // The pre-paint lock: hidden until `data-theme-lock=done` (a stylesheet arm).
    const lock = [...document.querySelectorAll('style')].map((style) => style.textContent).join('');
    expect(lock).toContain("html:not([data-theme-lock='done'])");
    expect(lock).toContain('visibility: hidden');
    // The tokens stylesheet is the render-blocking link; the boot resolves the
    // stored choice (see the appearance module's own tests for its semantics).
    expect(document.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe(
      '../../assets/css/theme.css'
    );
    expect(document.querySelector('#root')).toBeTruthy();
    expect(document.querySelector('script[type="module"]')?.getAttribute('src')).toBe('./main.tsx');
    window.close();
  });
});

describe('load states', () => {
  it('skeleton while the read is pending, then populated with stored values', async () => {
    await optionsStore.setValue(
      optionsWith('dark', { features: { ...storedDefaults().features, toolbarBadge: false } })
    );
    let release!: () => void;
    const gated = new Promise<void>((done) => {
      release = done;
    });
    const io: OptionsPageIO = {
      read: () => gated.then(() => getOptions()),
      write: (options) => optionsStore.setValue(options),
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    };
    render(() => <App {...propsWith(io)} />);
    // The skeleton is the loading state (never a timer, always a real wait).
    expect(screen.getByRole('status').textContent).toBe('Loading the options');
    expect(screen.queryByRole('switch')).toBeNull();
    release();
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: DBUGGER_ROW })).toBeTruthy();
    });
    // The stored rows' values are what rendered (on = stored on, off = stored off).
    expect(
      screen
        .getByRole<HTMLInputElement>('switch', { name: DBUGGER_ROW })
        .getAttribute('aria-checked')
    ).toBe('true');
    expect(
      screen.getByRole<HTMLInputElement>('switch', { name: BADGE_ROW }).getAttribute('aria-checked')
    ).toBe('false');
    // The three-way choice rendered the stored choice as the checked radio.
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeTruthy();
    // Header: product name + the manifest version chip.
    expect(screen.getByRole('heading', { name: 'WPR Front Debugging Tool' })).toBeTruthy();
    expect(screen.getByText('v0.9.0')).toBeTruthy();
  });

  it('degrades corrupt storage to the documented defaults', async () => {
    await fakeBrowser.storage.sync.set({ options: 'corrupted' });
    render(() => <App {...PROPS} />);
    await waitFor(() => {
      expect(
        screen
          .getByRole<HTMLInputElement>('switch', { name: BADGE_ROW })
          .getAttribute('aria-checked')
      ).toBe('true');
    });
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'System default' }).checked).toBe(
      true
    );
  });

  it('renders an actionable failure with a working retry', async () => {
    const read = vi
      .fn<() => Promise<StoredOptions>>()
      .mockRejectedValueOnce(new Error('Extension context invalidated.'))
      .mockImplementation(getOptions);
    const io: OptionsPageIO = {
      read,
      write: (options) => optionsStore.setValue(options),
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    };
    render(() => <App {...propsWith(io)} />);
    const failure = await screen.findByText("Couldn't load the options");
    expect(failure).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: DBUGGER_ROW })).toBeTruthy();
    });
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('the save flow', () => {
  it('Save stays disabled while clean, writes only on an edit, then lands a typed success toast', async () => {
    render(() => <App {...PROPS} />);
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: BADGE_ROW })).toBeTruthy();
    });
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
    expect(save.disabled).toBe(true); // the clean guard
    fireEvent.click(save);
    expect(toastItems()).toHaveLength(0); // nothing to save, nothing announced

    fireEvent.click(screen.getByText(BADGE_ROW)); // a real edit
    expect(save.disabled).toBe(false);
    // Dirty is draft-only: storage is untouched until Save runs.
    expect((await getOptions()).features.toolbarBadge).toBe(true);
    fireEvent.click(save);
    await waitFor(() => {
      expect(toastItems().at(-1)).toMatchObject({ tone: 'success', title: 'Options saved' });
    });
    expect((await getOptions()).features.toolbarBadge).toBe(false);
    // The write moved the baseline: the page is clean again.
    expect(save.disabled).toBe(true);
    // The queue holds exactly the success toast (no strays from the earlier
    // clean-guard click, and nothing announced for it).
    expect(toastItems().map((item) => [item.tone, item.title, item.description])).toEqual([
      ['success', 'Options saved', undefined]
    ]);
  });

  it('a failed save keeps the edits (typed failure toast, page stays dirty)', async () => {
    // The write seam: rejects the page's first attempt, then writes for real —
    // so the retry lands the persisted value through the same seam.
    const write = vi.fn<(options: StoredOptions) => Promise<void>>((options) =>
      optionsStore.setValue(options)
    );
    write.mockRejectedValueOnce(new Error('Extension context invalidated.'));
    const io: OptionsPageIO = {
      read: () => getOptions(),
      write,
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    };
    render(() => <App {...propsWith(io)} />);
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: BADGE_ROW })).toBeTruthy();
    });
    fireEvent.click(screen.getByText(BADGE_ROW));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(toastItems().at(-1)).toMatchObject({
        tone: 'error',
        title: 'Saving the options failed'
      });
    });
    // The remedy rides the toast's description; the edit is kept.
    expect(toastItems().at(-1)?.description).toMatch(/kept as unsaved|try again/iu);
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
    expect(save.disabled).toBe(false); // still dirty, still savable
    // A retry lands the write (the model owns the retry semantics).
    fireEvent.click(save);
    await waitFor(() => {
      expect(toastItems().at(-1)).toMatchObject({ tone: 'success' });
    });
    expect((await getOptions()).features.toolbarBadge).toBe(false);
    // The failure announced exactly once: the retry must not duplicate the
    // standing error outcome.
    await waitFor(() => {
      expect(
        toastItems().filter((item) => item.title === 'Saving the options failed')
      ).toHaveLength(1);
    });
  });

  it('shows the busy guard while the write is in flight', async () => {
    let release!: () => void;
    const gated = new Promise<void>((done) => {
      release = done;
    });
    const io: OptionsPageIO = {
      read: () => getOptions(),
      write: () => gated,
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    };
    render(() => <App {...propsWith(io)} />);
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: BADGE_ROW })).toBeTruthy();
    });
    fireEvent.click(screen.getByText(BADGE_ROW));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
    expect(save.getAttribute('aria-busy')).toBe('true');
    expect(save.disabled).toBe(true);
    release();
    await waitFor(() => {
      expect(save.getAttribute('aria-busy')).not.toBe('true');
    });
  });
});

describe('the appearance choice (a writer)', () => {
  it('persists the choice immediately and restyles this page live through the storage watch', async () => {
    // The boot's pre-paint leg, armed over the fake browser: the page's own
    // restyle is the same watch every other open surface runs.
    const stop = await applyStoredAppearance(document.documentElement);
    render(() => <App {...PROPS} />);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Light' })).toBeTruthy();
    });
    expect(document.documentElement.getAttribute('data-theme')).toBeNull(); // system default
    fireEvent.click(screen.getByText('Dark'));
    // The choice persisted as soon as it was chosen — no Save involved.
    await expect.poll(getOptions).toMatchObject({ appearance: 'dark' });
    // …and the armed watch restyled this page (and any other open surface) live.
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    stop();
  });

  it('keeps the draft dirty for the Save flow and preserves it when a write fails', async () => {
    const writeAppearance = vi.fn<(next: StoredOptions['appearance']) => Promise<void>>();
    writeAppearance.mockRejectedValueOnce(new Error('Extension context invalidated.'));
    render(() => <App {...PROPS} writeAppearance={writeAppearance} />);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Light' })).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Dark'));
    await waitFor(() => {
      expect(toastItems().at(-1)).toMatchObject({
        tone: 'error',
        title: 'The color theme could not be saved'
      });
    });
    // The remedy rides the toast's description (the unsaved-draft path).
    expect(toastItems().at(-1)?.description).toMatch(/kept as unsaved/iu);
    // The choice is kept as unsaved — Save still writes it through the model.
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await expect.poll(getOptions).toMatchObject({ appearance: 'dark' });
  });

  it('skips the instant write while a save is in flight (the choice stays drafted)', async () => {
    let release!: () => void;
    const gated = new Promise<void>((done) => {
      release = done;
    });
    const io: OptionsPageIO = {
      read: () => getOptions(),
      // The write stays in flight until released, then persists for real —
      // the assertions below read what the save actually wrote.
      write: (options) => gated.then(() => optionsStore.setValue(options)),
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    };
    const writeAppearance = vi.fn<(next: StoredOptions['appearance']) => Promise<void>>();
    render(() => <App {...propsWith(io)} writeAppearance={writeAppearance} />);
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: BADGE_ROW })).toBeTruthy();
    });
    fireEvent.click(screen.getByText(BADGE_ROW)); // dirty
    fireEvent.click(screen.getByRole('button', { name: 'Save' })); // write in flight
    fireEvent.click(screen.getByText('Dark')); // the choice lands mid-save
    // The model still drafted the choice (the control reflects it)…
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeTruthy();
    // …but the instant write never fired inside the save's RMW window.
    expect(writeAppearance).not.toHaveBeenCalled();
    release();
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false);
    });
    // The saved non-appearance edit landed; the mid-save choice is still
    // drafted, unsaved (the page's next Save owns it).
    expect((await getOptions()).features.toolbarBadge).toBe(false);
    expect((await getOptions()).appearance).toBe('system');
  });
});

describe('the toolbar badge toggle', () => {
  it("writes through the model and lands in storage on Save (the live badge watch is the background's)", async () => {
    render(() => <App {...PROPS} />);
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: BADGE_ROW })).toBeTruthy();
    });
    fireEvent.click(screen.getByText(BADGE_ROW));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(getOptions()).resolves.toMatchObject({ features: { toolbarBadge: false } })
    );
  });
});

describe('draft merge (unknown and pre-existing fields survive a page save)', () => {
  it('a future improvement id and the overlay flags ride a saved draft untouched', async () => {
    await optionsStore.setValue({
      improvements: { 'wp-dashboard-dbugger-entry': true, 'future-flag': true },
      appearance: 'system',
      features: { ...storedDefaults().features, sbsScrollSync: false, sbsMobileSim: true }
    });
    render(() => <App {...PROPS} />);
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: DBUGGER_ROW })).toBeTruthy();
    });
    fireEvent.click(screen.getByText(DBUGGER_ROW)); // the page's one edit
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(toastItems().at(-1)).toMatchObject({ tone: 'success' });
    });
    const stored = await getOptions();
    expect(stored.improvements).toEqual({
      'wp-dashboard-dbugger-entry': false,
      'future-flag': true
    });
    expect(stored.features.sbsScrollSync).toBe(false);
    expect(stored.features.sbsMobileSim).toBe(true);
    expect(stored.features.sbsDesktopWidth).toBe(true);
  });
});

describe('keyboard reachability (structure) and the state matrix', () => {
  it('every control is keyboard-reachable in reading order (Save, switches, radios, shortcut, refresh)', async () => {
    render(() => <App {...PROPS} />);
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: BADGE_ROW })).toBeTruthy();
    });
    // The instant rows render once their own reads (and the platform) land.
    await screen.findByRole('switch', { name: GATE_ROW });
    await screen.findByRole('button', { name: /^Command palette shortcut:/ });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh now' })).toBeTruthy();
    });
    // An edit arms the header's Save (the clean guard keeps it disabled; that
    // is also why the walk starts from a dirty page).
    fireEvent.click(screen.getByText(BADGE_ROW));
    // All of the page's interactive elements are focusable (never a disabled
    // dead zone); their DOM order IS the reading order (the markup renders rows
    // top-to-bottom, header actions first).
    const focusables = [
      ...document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')
    ]
      .filter(
        (element) =>
          !element.disabled && !(element instanceof HTMLInputElement && element.type === 'radio')
      )
      .map((element) => (element.tagName === 'BUTTON' ? 'button' : 'switch'));
    // Save first (header), the dbugger switch, (the radio group), the gate
    // switch, the shortcut field (a button), the badge switch, then the
    // refresh control — the default shortcut shows no Reset button.
    expect(focusables).toEqual(['button', 'switch', 'switch', 'button', 'switch', 'button']);
    // The choice group's radios share the native roving contract: all of this
    // page's radios carry ONE name — per-instance, never a hardcoded literal
    // that would merge with another group's set.
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.length).toBeGreaterThan(0);
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    expect(radios[0]?.name).not.toBe('');
  });

  it("wires every row's label and description (describedby ids and the group's name)", async () => {
    render(() => <App {...PROPS} />);
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: BADGE_ROW })).toBeTruthy();
    });
    // The switch row: the input's describedby is the row's description <p>,
    // whose copy is the registry row's (the page twin carries the same id).
    const badgeRow = OPTION_ROWS.find((row) => row.id === 'toolbarBadge');
    const badgeSwitch = screen.getByRole<HTMLInputElement>('switch', { name: BADGE_ROW });
    expect(badgeSwitch.getAttribute('aria-describedby')).toBe('option-toolbarBadge-description');
    const badgeDescription = document.getElementById('option-toolbarBadge-description');
    expect(badgeDescription?.tagName).toBe('P');
    expect(badgeDescription?.textContent).toBe(badgeRow?.description);
    // The appearance row: the group is named by the row's label, its radios
    // aggregate the row's describedby id, and the <p> twin holds the copy.
    const appearanceRow = OPTION_ROWS.find((row) => row.kind === 'appearance');
    const appearanceGroup = screen.getByRole('radiogroup', { name: 'Color theme' });
    expect(appearanceGroup.getAttribute('aria-label')).toBe(appearanceRow?.label);
    const radios = [...appearanceGroup.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.length).toBeGreaterThan(0);
    expect(
      radios.every((radio) =>
        radio.getAttribute('aria-describedby')?.includes('option-appearance-description')
      )
    ).toBe(true);
    expect(document.getElementById('option-appearance-description')?.textContent).toBe(
      appearanceRow?.description
    );
  });

  it('mounts the toast region outside both fixed-containing-block candidates', async () => {
    render(() => <App {...PROPS} />);
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: BADGE_ROW })).toBeTruthy();
    });
    const toasts = document.querySelector('[data-fdt="toasts"]');
    expect(toasts).toBeTruthy();
    // Neither the animated body nor the @container page root may appear on the
    // region's ancestor chain: either would become the containing block for
    // the region's position:fixed and anchor toasts to the scrolling content
    // instead of the viewport.
    expect(toasts?.closest('[data-fdt="options-body"]')).toBeNull();
    expect(toasts?.closest('main')).toBeNull();
  });

  it('raises zero a11y violations in every designed state (axe, component tier)', async () => {
    const audit = async (): Promise<void> => {
      const result = await runAxeAudit();
      expect(describeAxeViolations(result.violations)).toBe('');
    };

    // The populated page.
    render(() => <App {...PROPS} />);
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: BADGE_ROW })).toBeTruthy();
    });
    await audit();
    cleanup();
    toast.clear();

    // The failed page (a rejecting read) with its retry affordance.
    const io: OptionsPageIO = {
      read: () => Promise.reject(new Error('Extension context invalidated.')),
      write: (options) => optionsStore.setValue(options),
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    };
    render(() => <App {...propsWith(io)} />);
    await screen.findByText("Couldn't load the options");
    await audit();
    cleanup();
    toast.clear();

    // The loading page (a gated read → the skeleton state).
    let release!: () => void;
    const gated = new Promise<void>((done) => {
      release = done;
    });
    render(() => (
      <App
        {...propsWith({
          read: () => gated.then(() => getOptions()),
          write: (options) => optionsStore.setValue(options),
          log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
        })}
      />
    ));
    expect(screen.getByRole('status').textContent).toBe('Loading the options');
    await audit();
    release();
  });
});
