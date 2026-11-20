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
  draftAfterSave,
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
    // Baseline = base: no concurrent write, every differing row is an edit.
    const merged = optionsWithDraft(
      base,
      { 'wp-dashboard-dbugger-entry': false, appearance: 'light', toolbarBadge: false },
      base
    );
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
    const merged = optionsWithDraft(base, corrupted, base);
    expect(merged.appearance).toBe('dark');
    expect(merged.features).toEqual(base.features);
    expect(merged.improvements).toEqual(base.improvements);
  });
});

describe('edited rows only — concurrent registry-row writes survive', () => {
  /** The loaded baseline: defaults, so the draft starts as the fallback shape. */
  const BASELINE: StoredOptions = {
    improvements: { 'wp-dashboard-dbugger-entry': true },
    appearance: 'system',
    features: { ...STORED_NONDEFAULT.features, toolbarBadge: true, detectionWidget: true }
  };

  it('optionsWithDraft keeps a fresh appearance another surface wrote when another row is saved', () => {
    const fresh: StoredOptions = { ...BASELINE, appearance: 'dark' };
    const draft: OptionsDraft = {
      ...draftFromOptions(BASELINE),
      'wp-dashboard-dbugger-entry': false
    };
    const merged = optionsWithDraft(fresh, draft, BASELINE);
    expect(merged.appearance).toBe('dark'); // Untouched on the page: the fresh value wins.
    expect(merged.improvements['wp-dashboard-dbugger-entry']).toBe(false); // The edit lands.
  });

  it('optionsWithDraft still writes a row the user changed over a concurrent write to it', () => {
    const fresh: StoredOptions = { ...BASELINE, appearance: 'dark' };
    const draft: OptionsDraft = { ...draftFromOptions(BASELINE), appearance: 'light' };
    expect(optionsWithDraft(fresh, draft, BASELINE).appearance).toBe('light');
  });

  it('optionsWithDraft skips a corrupted changed value, keeping the fresh (not the baseline) value', () => {
    const fresh: StoredOptions = { ...BASELINE, appearance: 'dark' };
    const corrupted = {
      ...draftFromOptions(BASELINE),
      appearance: 'neon'
    } as unknown as OptionsDraft;
    expect(optionsWithDraft(fresh, corrupted, BASELINE).appearance).toBe('dark');
  });

  it('draftAfterSave follows the stored value except rows edited while the write was in flight', () => {
    const stored: StoredOptions = {
      ...BASELINE,
      appearance: 'dark',
      improvements: { 'wp-dashboard-dbugger-entry': false }
    };
    const saved: OptionsDraft = {
      ...draftFromOptions(BASELINE),
      'wp-dashboard-dbugger-entry': false
    };
    const current: OptionsDraft = { ...saved, toolbarBadge: false };
    const rebased = draftAfterSave(stored, saved, current);
    expect(rebased).toEqual({
      'wp-dashboard-dbugger-entry': false, // saved edit
      appearance: 'dark', // the concurrent write the merge kept
      detectionWidget: true,
      toolbarBadge: false // the in-flight edit
    });
    expect(Object.isFrozen(rebased)).toBe(true);
    expect(isDraftDirty(stored, rebased)).toBe(true); // Only the in-flight edit is pending.
    expect(isDraftDirty(stored, { ...rebased, toolbarBadge: true })).toBe(false);
  });

  it('a Save of one row neither reverts a concurrent appearance write nor re-reverts it on the next Save', async () => {
    await optionsStore.setValue(BASELINE);
    const fx = createFixture();
    await fx.model.load();
    // Another surface (the panel's appearance menu) writes after the load.
    await optionsStore.setValue({ ...BASELINE, appearance: 'dark' });
    fx.model.setOption('wp-dashboard-dbugger-entry', false);
    await fx.model.save();
    expect((await getOptions()).appearance).toBe('dark');
    expect((await getOptions()).improvements['wp-dashboard-dbugger-entry']).toBe(false);
    const snapshot = fx.model.snapshot();
    if (snapshot.status !== 'ready') throw new Error('expected ready');
    // The draft caught up with the kept write: clean, so no later Save carries the stale choice.
    expect(snapshot.draft['appearance']).toBe('dark');
    expect(snapshot.dirty).toBe(false);
    fx.model.setOption('toolbarBadge', false);
    await fx.model.save();
    expect((await getOptions()).appearance).toBe('dark');
  });
});

describe('markOptionStored — a row persisted outside Save', () => {
  it('an instant-written appearance reads clean and a later Save keeps a newer write from another surface', async () => {
    await optionsStore.setValue(STORED_NONDEFAULT);
    const fx = createFixture();
    await fx.model.load();
    // The page's own pick, written instantly (the row's write path).
    fx.model.setOption('appearance', 'light');
    await optionsStore.setValue({ ...STORED_NONDEFAULT, appearance: 'light' });
    fx.model.markOptionStored('appearance', 'light');
    expect(fx.model.snapshot()).toMatchObject({ dirty: false });
    // A newer pick elsewhere (the panel menu), then a Save of another row.
    await optionsStore.setValue({ ...STORED_NONDEFAULT, appearance: 'system' });
    fx.model.setOption('toolbarBadge', true);
    await fx.model.save();
    expect((await getOptions()).appearance).toBe('system');
    expect((await getOptions()).features.toolbarBadge).toBe(true);
  });

  it("moves only that row's baseline: other pending edits stay dirty", async () => {
    await optionsStore.setValue(STORED_NONDEFAULT);
    const fx = createFixture();
    await fx.model.load();
    fx.model.setOption('toolbarBadge', true);
    fx.model.setOption('appearance', 'light');
    fx.model.markOptionStored('appearance', 'light');
    const snapshot = fx.model.snapshot();
    if (snapshot.status !== 'ready') throw new Error('expected ready');
    expect(snapshot.dirty).toBe(true); // the badge edit is still pending
    expect(snapshot.options.appearance).toBe('light');
    expect(snapshot.options.features).toEqual(STORED_NONDEFAULT.features);
    expect(Object.isFrozen(snapshot.options)).toBe(true);
    expect(Object.isFrozen(snapshot.options.features)).toBe(true);
    fx.model.setOption('toolbarBadge', false); // reverted → clean
    expect(fx.model.snapshot()).toMatchObject({ dirty: false });
  });

  it('a draft moved on past the written value stays dirty (an older write landing late)', async () => {
    await optionsStore.setValue(STORED_NONDEFAULT);
    const fx = createFixture();
    await fx.model.load();
    fx.model.setOption('appearance', 'light');
    fx.model.setOption('appearance', 'system');
    fx.model.markOptionStored('appearance', 'light');
    expect(fx.model.snapshot()).toMatchObject({ dirty: true });
  });

  it('throws on wiring bugs: not ready, unknown row, illegal value', async () => {
    const fx = createFixture();
    expect(() => {
      fx.model.markOptionStored('appearance', 'dark');
    }).toThrow(/markOptionStored: the options page is not ready \(status 'loading'\)/);
    await fx.model.load();
    expect(() => {
      fx.model.markOptionStored('nope', true);
    }).toThrow("markOptionStored: unknown option row 'nope'.");
    expect(() => {
      fx.model.markOptionStored('appearance', true);
    }).toThrow("markOptionStored: true is not a legal value for the 'appearance' row.");
  });
});

describe('followStoredOption — a value another writer stored', () => {
  /** The ready snapshot, or a thrown expectation. */
  function readySnapshot(fx: ModelFixture): Extract<OptionsPageSnapshot, { status: 'ready' }> {
    const snapshot = fx.model.snapshot();
    if (snapshot.status !== 'ready') throw new Error(`expected ready, got ${snapshot.status}`);
    return snapshot;
  }

  it('a clean row adopts it live: baseline and draft move, the page stays clean', async () => {
    await optionsStore.setValue(STORED_NONDEFAULT);
    const fx = createFixture();
    await fx.model.load();
    const before = fx.snapshots.length;
    fx.model.followStoredOption('appearance', 'light');
    const snapshot = readySnapshot(fx);
    expect(snapshot.draft['appearance']).toBe('light');
    expect(snapshot.options.appearance).toBe('light');
    expect(snapshot.dirty).toBe(false);
    expect(fx.snapshots.length).toBe(before + 1); // one notify
    // Other rows' baselines are untouched; exposed state stays frozen.
    expect(snapshot.options.features).toEqual(STORED_NONDEFAULT.features);
    expect(snapshot.options.improvements).toEqual(STORED_NONDEFAULT.improvements);
    expect(Object.isFrozen(snapshot.options)).toBe(true);
    expect(Object.isFrozen(snapshot.options.features)).toBe(true);
    expect(Object.isFrozen(snapshot.draft)).toBe(true);
  });

  it('an unsaved edit is kept (never clobbered) and re-dirties against the new baseline', async () => {
    await optionsStore.setValue(STORED_NONDEFAULT); // dark
    const fx = createFixture();
    await fx.model.load();
    fx.model.setOption('appearance', 'light'); // e.g. its instant write failed
    fx.model.followStoredOption('appearance', 'system');
    let snapshot = readySnapshot(fx);
    expect(snapshot.draft['appearance']).toBe('light');
    expect(snapshot.options.appearance).toBe('system');
    expect(snapshot.dirty).toBe(true);
    // The writer stores the very value drafted here: nothing is pending any more.
    fx.model.followStoredOption('appearance', 'light');
    snapshot = readySnapshot(fx);
    expect(snapshot.draft['appearance']).toBe('light');
    expect(snapshot.dirty).toBe(false);
  });

  it('a value equal to the baseline changes nothing and notifies nothing', async () => {
    await optionsStore.setValue(STORED_NONDEFAULT);
    const fx = createFixture();
    await fx.model.load();
    fx.model.setOption('appearance', 'light');
    const before = fx.snapshots.length;
    const draft = readySnapshot(fx).draft;
    fx.model.followStoredOption('appearance', 'dark'); // the loaded baseline
    expect(fx.snapshots.length).toBe(before);
    expect(readySnapshot(fx).draft).toBe(draft);
  });

  it("leaves other rows' pending edits and the last save's outcome alone", async () => {
    await optionsStore.setValue(STORED_NONDEFAULT);
    const fx = createFixture();
    await fx.model.load();
    fx.model.setOption('toolbarBadge', true);
    await fx.model.save();
    const lastSave = readySnapshot(fx).lastSave;
    fx.model.setOption('wp-dashboard-dbugger-entry', true);
    fx.model.followStoredOption('appearance', 'light');
    const snapshot = readySnapshot(fx);
    expect(snapshot.dirty).toBe(true); // the dbugger edit is still pending
    expect(snapshot.draft['wp-dashboard-dbugger-entry']).toBe(true);
    expect(snapshot.lastSave).toBeNull(); // cleared by the edit, not by the follow
    fx.model.setOption('wp-dashboard-dbugger-entry', false);
    fx.model.followStoredOption('appearance', 'system');
    expect(readySnapshot(fx).lastSave).toBeNull();
    expect(lastSave).toMatchObject({ ok: true, wrote: true });
    // A Save after the follow writes only the edited row: the followed value
    // is the baseline, never written back over storage.
    fx.model.setOption('toolbarBadge', false);
    await optionsStore.setValue({ ...STORED_NONDEFAULT, appearance: 'light' }); // newer elsewhere
    await fx.model.save();
    expect((await getOptions()).appearance).toBe('light');
  });

  it('holds a value observed during the load and takes it once loaded (it may be newer than the read)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    await optionsStore.setValue(STORED_NONDEFAULT); // dark — what the read returns
    const read = vi.fn(async () => {
      const value = await getOptions();
      await gate;
      return value;
    });
    const fx = createFixture(tracedIO({ read }));
    const loading = fx.model.load();
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalled();
    });
    fx.model.followStoredOption('appearance', 'system');
    fx.model.followStoredOption('appearance', 'light'); // the latest wins
    expect(fx.model.snapshot().status).toBe('loading');
    release();
    await loading;
    const snapshot = readySnapshot(fx);
    expect(snapshot.draft['appearance']).toBe('light');
    expect(snapshot.options.appearance).toBe('light');
    expect(snapshot.dirty).toBe(false);
  });

  it('holds a value observed mid-save and takes it after the save (success and failure arms)', async () => {
    for (const outcome of ['written', 'rejected'] as const) {
      fakeBrowser.reset();
      await optionsStore.setValue(STORED_NONDEFAULT); // dark
      let release!: () => void;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      const write = vi.fn(async (options: StoredOptions) => {
        await gate;
        if (outcome === 'rejected') throw new Error('QUOTA_BYTES quota exceeded');
        await optionsStore.setValue(options);
      });
      const fx = createFixture(tracedIO({ write }));
      await fx.model.load();
      fx.model.setOption('toolbarBadge', true);
      const saving = fx.model.save();
      await vi.waitFor(() => {
        expect(write).toHaveBeenCalled();
      });
      fx.model.followStoredOption('appearance', 'light');
      // Never mid-save: the save's own rebase would read it as an edit.
      expect(readySnapshot(fx).draft['appearance']).toBe('dark');
      release();
      await saving;
      const snapshot = readySnapshot(fx);
      expect(snapshot.saving, outcome).toBe(false);
      expect(snapshot.draft['appearance'], outcome).toBe('light');
      expect(snapshot.options.appearance, outcome).toBe('light');
      // Only the badge edit decides dirtiness: clean once written, dirty when not.
      expect(snapshot.dirty, outcome).toBe(outcome === 'rejected');
    }
  });

  /**
   * A read that waits on a gate the test opens.
   *
   * @param outcome What the read settles with once released.
   * @returns The read and its release.
   */
  function gatedRead(outcome: StoredOptions | Error): {
    read: () => Promise<StoredOptions>;
    release: () => void;
  } {
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const read = async (): Promise<StoredOptions> => {
      await gate;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    };
    return { read, release };
  }

  it('a taken value is spent: a newer direct follow survives a later save', async () => {
    await optionsStore.setValue(STORED_NONDEFAULT); // dark
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const read = vi
      .fn<() => Promise<StoredOptions>>()
      .mockImplementationOnce(() => getOptions()) // the load
      .mockImplementationOnce(async () => {
        await gate; // the first save's fresh read
        return getOptions();
      })
      .mockImplementation(() => getOptions());
    const fx = createFixture(tracedIO({ read }));
    await fx.model.load();
    fx.model.setOption('toolbarBadge', true);
    const saving = fx.model.save();
    // Another surface stores light while the save is in flight.
    await optionsStore.setValue({ ...STORED_NONDEFAULT, appearance: 'light' });
    fx.model.followStoredOption('appearance', 'light'); // held mid-save
    release();
    await saving;
    expect(readySnapshot(fx).draft['appearance']).toBe('light');
    // A newer value, the page idle: followed directly.
    await optionsStore.setValue({ ...(await getOptions()), appearance: 'system' });
    fx.model.followStoredOption('appearance', 'system');
    expect(readySnapshot(fx).draft['appearance']).toBe('system');
    fx.model.setOption('toolbarBadge', false);
    await fx.model.save();
    // The second save's settle takes nothing: the spent held value never returns.
    const snapshot = readySnapshot(fx);
    expect(snapshot.draft['appearance']).toBe('system');
    expect(snapshot.options.appearance).toBe('system');
    expect(snapshot.dirty).toBe(false);
  });

  it('a value held during a load that fails is dropped: the retry shows only what it reads', async () => {
    const failing = gatedRead(new Error('Extension context invalidated.'));
    const read = vi
      .fn<() => Promise<StoredOptions>>()
      .mockImplementationOnce(failing.read)
      .mockImplementation(() => Promise.resolve(STORED_NONDEFAULT));
    const fx = createFixture(tracedIO({ read }));
    const loading = fx.model.load();
    fx.model.followStoredOption('appearance', 'light'); // held: the read is in flight
    failing.release();
    await loading;
    expect(fx.model.snapshot().status).toBe('failed');
    await fx.model.load(); // the retry returns dark
    const snapshot = readySnapshot(fx);
    expect(snapshot.draft['appearance']).toBe('dark');
    expect(snapshot.options.appearance).toBe('dark');
  });

  it("drops a value while a failed page is idle (the retry reads fresh), holds it during the retry's read", async () => {
    const retry = gatedRead(STORED_NONDEFAULT); // dark, badge off
    const read = vi
      .fn<() => Promise<StoredOptions>>()
      .mockRejectedValueOnce(new Error('Extension context invalidated.'))
      .mockImplementationOnce(retry.read);
    const fx = createFixture(tracedIO({ read }));
    // Before any load: dropped, no throw, no notify.
    fx.model.followStoredOption('toolbarBadge', true);
    expect(fx.snapshots.length).toBe(0);
    await fx.model.load();
    expect(fx.model.snapshot().status).toBe('failed');
    // Idle and failed: dropped, no notify.
    const before = fx.snapshots.length;
    fx.model.followStoredOption('toolbarBadge', true);
    expect(fx.snapshots.length).toBe(before);
    const retrying = fx.model.load();
    fx.model.followStoredOption('appearance', 'light'); // held: the retry's read is in flight
    retry.release();
    await retrying;
    const snapshot = readySnapshot(fx);
    // The held value is taken over the read's dark; the dropped badge never is.
    expect(snapshot.draft['appearance']).toBe('light');
    expect(snapshot.options.appearance).toBe('light');
    expect(snapshot.draft['toolbarBadge']).toBe(false);
    expect(snapshot.options.features.toolbarBadge).toBe(false);
    expect(snapshot.dirty).toBe(false);
  });

  it("a value held while the save's fresh read rejects is taken once the save settles", async () => {
    const fresh = gatedRead(new Error('Extension context invalidated.'));
    const read = vi
      .fn<() => Promise<StoredOptions>>()
      .mockImplementationOnce(() => Promise.resolve(STORED_NONDEFAULT)) // the load: dark
      .mockImplementationOnce(fresh.read);
    const io = tracedIO({ read });
    const fx = createFixture(io);
    await fx.model.load();
    fx.model.setOption('toolbarBadge', true);
    const saving = fx.model.save();
    fx.model.followStoredOption('appearance', 'light'); // held: the fresh read is in flight
    expect(readySnapshot(fx).draft['appearance']).toBe('dark');
    fresh.release();
    await saving;
    const snapshot = readySnapshot(fx);
    expect(snapshot.lastSave).toMatchObject({ ok: false });
    expect(snapshot.saving).toBe(false);
    expect(snapshot.draft['appearance']).toBe('light');
    expect(snapshot.options.appearance).toBe('light');
    expect(snapshot.dirty).toBe(true); // the badge edit was never written
    expect(io.write).not.toHaveBeenCalled();
  });

  it('throws on wiring bugs in every state: unknown row, illegal value', async () => {
    const fx = createFixture();
    expect(() => {
      fx.model.followStoredOption('nope', true);
    }).toThrow("followStoredOption: unknown option row 'nope'.");
    await fx.model.load();
    expect(() => {
      fx.model.followStoredOption('appearance', true);
    }).toThrow("followStoredOption: true is not a legal value for the 'appearance' row.");
    expect(() => {
      fx.model.followStoredOption('toolbarBadge', 'dark');
    }).toThrow('followStoredOption: "dark" is not a legal value for the \'toolbarBadge\' row.');
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
