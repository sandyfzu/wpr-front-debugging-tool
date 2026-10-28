/**
 * The options page model's contract, over the fake browser for the storage
 * seams and traced seams for the failure branches: load (populated, fresh
 * defaults, corrupt storage, one read in flight at a time), dirty tracking
 * and the dirty-only save gate, the merged write that preserves unknown
 * boolean fields and concurrent non-registry options, typed save-failure
 * outcomes (rejections never swallowed), the load-rejection retry path,
 * immutable exposed state, and the input guards.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getOptions, optionsStore, type StoredOptions } from '../storage/options';
import type { Logger } from '../logger';
import {
  createOptionsPageModel,
  createStorageOptionsPageIO,
  draftFromOptions,
  INITIAL_OPTIONS_PAGE_SNAPSHOT,
  isDraftDirty,
  optionsWithDraft,
  type OptionsDraft,
  type OptionsPageIO,
  type OptionsPageModel,
  type OptionsPageSnapshot
} from './page-model';

beforeEach(() => {
  fakeBrowser.reset();
});

/** A non-default stored shape: every registry row off/dark, siblings varied. */
const STORED_NONDEFAULT: StoredOptions = {
  improvements: { 'wp-dashboard-dbugger-entry': false },
  appearance: 'dark',
  features: {
    toolbarBadge: false,
    sbsScrollSync: true,
    sbsMobileSim: true,
    sbsDesktopWidth: true,
    detectionWidget: true
  }
};

/** A logger whose every method is a traced mock the failure tests assert on. */
type LogTrace = { [level in keyof Logger]: Mock<(message: string, ...details: unknown[]) => void> };

/** A silent logger trace. */
function silentLog(): LogTrace {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * The traced seams: Mock-typed properties (never method signatures) so the
 * assertions may read the references; per-test stubs pass overrides.
 */
interface TracedIO extends OptionsPageIO {
  read: Mock<() => Promise<StoredOptions>>;
  write: Mock<(options: StoredOptions) => Promise<void>>;
  log: LogTrace;
}

/** A traced IO over the real (fake-browser) storage, with optional stubs. */
function tracedIO(
  overrides: {
    read?: Mock<() => Promise<StoredOptions>>;
    write?: Mock<(options: StoredOptions) => Promise<void>>;
  } = {}
): TracedIO {
  return {
    read: overrides.read ?? vi.fn(() => getOptions()),
    write: overrides.write ?? vi.fn((options: StoredOptions) => optionsStore.setValue(options)),
    log: silentLog()
  };
}

/** The model plus every snapshot it ever announced. */
interface ModelFixture {
  snapshots: OptionsPageSnapshot[];
  model: OptionsPageModel;
}

/** A model over the given seams (default: fake-browser storage), collecting snapshots. */
function createFixture(io: OptionsPageIO = createStorageOptionsPageIO(silentLog())): ModelFixture {
  const snapshots: OptionsPageSnapshot[] = [];
  const model = createOptionsPageModel(io, (snapshot) => {
    snapshots.push(snapshot);
  });
  return { snapshots, model };
}

describe('the pure draft core', () => {
  it('draftFromOptions mirrors every registry row; an untouched draft is never dirty', () => {
    const draft = draftFromOptions(STORED_NONDEFAULT);
    expect(draft).toEqual({
      'wp-dashboard-dbugger-entry': false,
      appearance: 'dark',
      detectionWidget: true,
      toolbarBadge: false
    });
    expect(isDraftDirty(STORED_NONDEFAULT, draft)).toBe(false);
  });

  it('isDraftDirty is true as soon as one row differs, and false again when it matches', () => {
    const draft = draftFromOptions(STORED_NONDEFAULT);
    const edited: OptionsDraft = { ...draft, toolbarBadge: true };
    expect(isDraftDirty(STORED_NONDEFAULT, edited)).toBe(true);
    const reverted: OptionsDraft = { ...edited, toolbarBadge: false };
    expect(isDraftDirty(STORED_NONDEFAULT, reverted)).toBe(false);
  });

  it('optionsWithDraft applies the registry rows and preserves unknown and non-registry fields', () => {
    // The base carries a future improvement id (unknown to this registry)
    // and sibling feature flags the overlay owns — none of them may be
    // erased by a page save.
    const base: StoredOptions = {
      improvements: { 'wp-dashboard-dbugger-entry': true, 'future-flag': false },
      appearance: 'system',
      features: {
        toolbarBadge: true,
        sbsScrollSync: false,
        sbsMobileSim: true,
        sbsDesktopWidth: true,
        detectionWidget: true
      }
    };
    const merged = optionsWithDraft(base, {
      'wp-dashboard-dbugger-entry': false,
      appearance: 'light',
      toolbarBadge: false
    });
    expect(merged.improvements).toEqual({
      'wp-dashboard-dbugger-entry': false,
      'future-flag': false
    });
    expect(merged.appearance).toBe('light');
    expect(merged.features).toEqual({
      toolbarBadge: false,
      sbsScrollSync: false,
      sbsMobileSim: true,
      sbsDesktopWidth: true,
      detectionWidget: true
    });
    // The base is never mutated.
    expect(base.improvements).toEqual({
      'wp-dashboard-dbugger-entry': true,
      'future-flag': false
    });
    expect(base.features.toolbarBadge).toBe(true);
  });

  it('optionsWithDraft skips an illegal draft value, keeping the base (belt — the machine guards input)', () => {
    const base = STORED_NONDEFAULT;
    const corrupted = {
      'wp-dashboard-dbugger-entry': false,
      appearance: 'neon',
      toolbarBadge: 'yes'
    } as unknown as OptionsDraft;
    const merged = optionsWithDraft(base, corrupted);
    expect(merged.appearance).toBe('dark');
    expect(merged.features).toEqual(base.features);
    expect(merged.improvements).toEqual(base.improvements);
  });
});

describe('load', () => {
  it('populates the draft from stored options and starts clean', async () => {
    await optionsStore.setValue(STORED_NONDEFAULT);
    const fx = createFixture();
    expect(fx.model.snapshot()).toEqual(INITIAL_OPTIONS_PAGE_SNAPSHOT);
    await fx.model.load();
    expect(fx.model.snapshot()).toEqual({
      status: 'ready',
      options: STORED_NONDEFAULT,
      draft: draftFromOptions(STORED_NONDEFAULT),
      dirty: false,
      saving: false,
      lastSave: null
    });
  });

  it('populates the documented defaults on a fresh install (no stored value)', async () => {
    const fx = createFixture();
    await fx.model.load();
    const snapshot = fx.model.snapshot();
    expect(snapshot.status).toBe('ready');
    if (snapshot.status !== 'ready') return;
    expect(snapshot.options).toEqual(await getOptions());
    expect(snapshot.dirty).toBe(false);
  });

  it('tolerates corrupt storage — the validator degrades it to the defaults', async () => {
    await fakeBrowser.storage.sync.set({ options: 'corrupted' });
    const fx = createFixture();
    await fx.model.load();
    const snapshot = fx.model.snapshot();
    expect(snapshot.status).toBe('ready');
    if (snapshot.status !== 'ready') return;
    expect(snapshot.options).toEqual(await getOptions());
  });

  it('wires its default seams when none are injected (the storage IO, a noop observer)', async () => {
    const bare = createOptionsPageModel();
    await bare.load();
    expect(bare.snapshot().status).toBe('ready');
  });

  it('a rejected read is a typed, actionable failure — and a retry recovers', async () => {
    const io = tracedIO({
      read: vi
        .fn<() => Promise<StoredOptions>>()
        .mockRejectedValueOnce(new Error('Extension context invalidated.'))
        .mockImplementation(getOptions)
    });
    const fx = createFixture(io);
    await fx.model.load();
    expect(fx.model.snapshot()).toMatchObject({ status: 'failed' });
    // Actionable: the message tells the user what to do next.
    const failed = fx.model.snapshot();
    if (failed.status !== 'failed') throw new Error('expected failed');
    expect(failed.failure).toMatch(/retry/i);
    // The retry affordance re-runs the load against the recovered seam —
    // the busy guard released on the failure, the door is not stuck.
    await fx.model.load();
    expect(fx.model.snapshot().status).toBe('ready');
    expect(io.read).toHaveBeenCalledTimes(2);
  });

  it('refuses to reload while ready (a reload would discard unsaved edits)', async () => {
    const io = tracedIO();
    const fx = createFixture(io);
    await fx.model.load();
    expect(io.read).toHaveBeenCalledTimes(1);
    await fx.model.load();
    expect(io.read).toHaveBeenCalledTimes(1); // no second read
  });

  it('refuses a second load while one is still in flight (one read resolves over the state)', async () => {
    let releaseRead: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const io = tracedIO({
      read: vi.fn(async () => {
        await gate;
        return getOptions();
      })
    });
    const fx = createFixture(io);
    const first = fx.model.load();
    await fx.model.load(); // Refused, logged — no second, racing read.
    releaseRead?.();
    await first;
    expect(io.read).toHaveBeenCalledTimes(1);
    expect(fx.model.snapshot()).toMatchObject({ status: 'ready', dirty: false });
    expect(io.log.warn).toHaveBeenCalled();
  });
});

describe('dirty tracking and input guards', () => {
  it('setOption marks the page dirty and reverts cleanly; every snapshot is frozen', async () => {
    await optionsStore.setValue(STORED_NONDEFAULT);
    const fx = createFixture();
    await fx.model.load();
    fx.model.setOption('toolbarBadge', true);
    expect(fx.model.snapshot()).toMatchObject({ dirty: true, lastSave: null });
    fx.model.setOption('toolbarBadge', false);
    expect(fx.model.snapshot()).toMatchObject({ dirty: false });
    expect(fx.snapshots.every((snapshot) => Object.isFrozen(snapshot))).toBe(true);
  });

  it('an edit after a successful save clears the toast (lastSave back to null)', async () => {
    await optionsStore.setValue(STORED_NONDEFAULT);
    const fx = createFixture();
    await fx.model.load();
    fx.model.setOption('toolbarBadge', true);
    await fx.model.save();
    const saved = fx.model.snapshot();
    expect(saved).toMatchObject({ dirty: false });
    if (saved.status !== 'ready' || saved.lastSave === null || !saved.lastSave.ok) {
      throw new Error('expected a successful save outcome');
    }
    fx.model.setOption('appearance', 'light');
    expect(fx.model.snapshot()).toMatchObject({ dirty: true, lastSave: null });
  });

  it('exposes only frozen state — drafts after an edit, options after load and save', async () => {
    await optionsStore.setValue(STORED_NONDEFAULT);
    const fx = createFixture();
    await fx.model.load();
    // After load: the baseline (with its two boolean groups — the values are
    // primitives, so this is the whole shape) hands out immutable.
    const loaded = fx.model.snapshot();
    if (loaded.status !== 'ready') throw new Error('expected ready');
    expect(Object.isFrozen(loaded.options)).toBe(true);
    expect(Object.isFrozen(loaded.options.improvements)).toBe(true);
    expect(Object.isFrozen(loaded.options.features)).toBe(true);
    // After setOption: the replacement draft, too.
    fx.model.setOption('toolbarBadge', true);
    const edited = fx.model.snapshot();
    if (edited.status !== 'ready') throw new Error('expected ready');
    expect(Object.isFrozen(edited.draft)).toBe(true);
    // After save: the merged write is the exposed baseline and toast payload.
    await fx.model.save();
    const saved = fx.model.snapshot();
    if (saved.status !== 'ready') throw new Error('expected ready');
    const outcome = saved.lastSave;
    if (outcome === null || !outcome.ok) throw new Error('expected a successful save outcome');
    expect(Object.isFrozen(saved.options)).toBe(true);
    expect(Object.isFrozen(outcome.options)).toBe(true);
    expect(Object.isFrozen(outcome.options.features)).toBe(true);
  });

  it('setOption edits during a save re-dirty the page against the new baseline', async () => {
    await optionsStore.setValue(STORED_NONDEFAULT);
    const fx = createFixture();
    await fx.model.load();
    fx.model.setOption('toolbarBadge', true);
    const pending = fx.model.save();
    // The mid-flight edit is not part of the in-flight save's captured draft.
    fx.model.setOption('wp-dashboard-dbugger-entry', true);
    await pending;
    const snapshot = fx.model.snapshot();
    expect(snapshot.status).toBe('ready');
    if (snapshot.status !== 'ready') return;
    // The mid-flight edit survived the save's baseline move and still reads dirty.
    expect(snapshot.dirty).toBe(true);
    expect(snapshot.draft['wp-dashboard-dbugger-entry']).toBe(true);
    expect(snapshot.options.features.toolbarBadge).toBe(true);
    // The save itself still succeeded, typed for the toast.
    expect(snapshot.lastSave).toMatchObject({ ok: true, wrote: true });
  });

  it('rejects an unknown row id, an illegal value, and edits before load — naming the offender', async () => {
    const fx = createFixture();
    await fx.model.load();
    expect(() => {
      fx.model.setOption('not-an-option', true);
    }).toThrow(/not-an-option/);
    expect(() => {
      fx.model.setOption('appearance', 'neon' as never);
    }).toThrow(/appearance/);
    expect(() => {
      fx.model.setOption('toolbarBadge', 'yes' as never);
    }).toThrow(/toolbarBadge/);
    const unloaded = createFixture();
    expect(() => {
      unloaded.model.setOption('toolbarBadge', false);
    }).toThrow(/not ready/);
    await expect(unloaded.model.save()).rejects.toThrow(/not ready/);
  });
});

describe('save', () => {
  it('is a no-op write when clean, answering an honest wrote:false outcome', async () => {
    await optionsStore.setValue(STORED_NONDEFAULT);
    const fx = createFixture();
    await fx.model.load();
    await fx.model.save();
    const snapshot = fx.model.snapshot();
    expect(snapshot.status).toBe('ready');
    if (snapshot.status !== 'ready') return;
    expect(snapshot.lastSave).toEqual({ ok: true, wrote: false, options: STORED_NONDEFAULT });
    // Nothing was rewritten: the raw stored value is byte-identical.
    expect(await optionsStore.getValue()).toEqual(STORED_NONDEFAULT);
  });

  it('persists a dirty draft merged onto a fresh read — unknown and concurrent fields survive', async () => {
    await optionsStore.setValue({
      ...STORED_NONDEFAULT,
      improvements: { ...STORED_NONDEFAULT.improvements, 'future-flag': true }
    });
    const fx = createFixture();
    await fx.model.load();
    // A concurrent writer (another surface) lands between the load and the
    // save: it owns the overlay flags and a future id, none of them rows.
    await optionsStore.setValue({
      ...STORED_NONDEFAULT,
      improvements: { 'wp-dashboard-dbugger-entry': false, 'future-flag': false },
      features: { ...STORED_NONDEFAULT.features, sbsScrollSync: false, sbsMobileSim: false }
    });
    fx.model.setOption('toolbarBadge', true);
    fx.model.setOption('appearance', 'light');
    await fx.model.save();
    const stored = await getOptions();
    // The page's own rows: written as approved.
    expect(stored.appearance).toBe('light');
    expect(stored.features).toEqual({
      toolbarBadge: true,
      sbsScrollSync: false,
      sbsMobileSim: false,
      sbsDesktopWidth: true,
      detectionWidget: true
    });
    // Concurrent, non-registry options: preserved from the fresh read, not
    // clobbered by the page's stale load-time values.
    expect(stored.improvements).toEqual({
      'wp-dashboard-dbugger-entry': false,
      'future-flag': false
    });
    // The snapshot settles clean with the typed success outcome.
    const snapshot = fx.model.snapshot();
    expect(snapshot.status).toBe('ready');
    if (snapshot.status !== 'ready') return;
    expect(snapshot.dirty).toBe(false);
    expect(snapshot.saving).toBe(false);
    expect(snapshot.lastSave).toEqual({ ok: true, wrote: true, options: stored });
  });

  it('a rejected write is a typed failure — never thrown, never swallowed, still dirty', async () => {
    const io = tracedIO({
      write: vi.fn(() => Promise.reject(new Error('Extension context invalidated.')))
    });
    const fx = createFixture(io);
    await fx.model.load();
    fx.model.setOption('toolbarBadge', false);
    await expect(fx.model.save()).resolves.toBeUndefined();
    const snapshot = fx.model.snapshot();
    expect(snapshot.status).toBe('ready');
    if (snapshot.status !== 'ready') return;
    const lastSave = snapshot.lastSave;
    if (lastSave === null || lastSave.ok) throw new Error('expected a failed save outcome');
    expect(lastSave.message).toMatch(/try again/i);
    expect(snapshot.dirty).toBe(true); // Nothing lost.
    expect(snapshot.saving).toBe(false);
    expect(io.log.error).toHaveBeenCalledTimes(1);
  });

  it('a rejected fresh-read before the write is the same typed failure', async () => {
    // The load must succeed for the page to be ready, so the read only
    // rejects from the save onward.
    const io = tracedIO({
      read: vi
        .fn<() => Promise<StoredOptions>>()
        .mockImplementationOnce(() => getOptions())
        .mockRejectedValue(new Error('Extension context invalidated.'))
    });
    const fx = createFixture(io);
    await fx.model.load();
    fx.model.setOption('toolbarBadge', false);
    await expect(fx.model.save()).resolves.toBeUndefined();
    const snapshot = fx.model.snapshot();
    if (snapshot.status !== 'ready') throw new Error('expected ready');
    const lastSave = snapshot.lastSave;
    if (lastSave === null || lastSave.ok) throw new Error('expected a failed save outcome');
    expect(lastSave.message).toMatch(/failed/i);
    expect(snapshot.dirty).toBe(true);
    expect(io.write).not.toHaveBeenCalled();
  });

  it('refuses a second save while one is in flight (single write)', async () => {
    await optionsStore.setValue(STORED_NONDEFAULT);
    let releaseWrite: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const io = tracedIO({
      write: vi.fn(async () => {
        await gate;
      })
    });
    const fx = createFixture(io);
    await fx.model.load();
    fx.model.setOption('toolbarBadge', true); // Loaded off → a genuine edit.
    const first = fx.model.save();
    expect(fx.model.snapshot()).toMatchObject({ saving: true });
    await fx.model.save(); // Refused, logged — no second write.
    const readsBefore = io.read.mock.calls.length;
    await fx.model.load(); // Also refused while saving — no re-read.
    expect(io.read.mock.calls.length).toBe(readsBefore);
    releaseWrite?.();
    await first;
    expect(io.write).toHaveBeenCalledTimes(1);
    expect(fx.model.snapshot()).toMatchObject({ saving: false, dirty: false });
    expect(io.log.warn).toHaveBeenCalled();
  });
});
