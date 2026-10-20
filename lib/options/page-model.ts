/**
 * The options page's model: the store/state machine the page mounts, plus
 * the pure draft core it runs on. It owns the four behaviors the page's
 * contract names —
 *
 * - **Initial load:** skeleton (`'loading'`) → populated, or an actionable
 *   typed failure with the retry affordance pointed back at `load`.
 *   Corrupt storage never fails the load: the storage contract's validator
 *   degrades it to the documented defaults.
 * - **Dirty tracking:** the edit buffer (draft) is compared against the
 *   loaded options per registry row; Save only ever acts when dirty.
 * - **Save:** an awaited write that first re-reads the stored options and
 *   merges the draft onto that fresh value, so unknown boolean fields and
 *   concurrent non-registry options (another surface's writes between this
 *   page's load and save) survive the write. The outcome is typed for the
 *   UI's toast — never a swallowed error, never an artificial delay.
 * - **Registry discipline:** every option value flows through the immutable
 *   registry rows; the model holds no option copy outside its snapshot.
 */

import { createLogger, type Logger } from '../logger';
import { getOptions, optionsStore, type StoredOptions } from '../storage/options';
import type { Appearance } from '../../utils/theme';
import { isAppearanceChoice, isValidOptionValue, OPTION_ROWS, readOption } from './registry';

/** The actionable message the page renders when the initial load fails. */
const LOAD_FAILURE_MESSAGE =
  'Loading the options failed — check that the extension is still enabled, then retry.';

/** The actionable message the page renders when a save fails. */
const SAVE_FAILURE_MESSAGE =
  'Saving the options failed — your changes are kept as unsaved; try again.';

/**
 * The page's edit buffer: every registry row's pending value, keyed by row
 * id (ids are unique across the registry). Built by {@link draftFromOptions},
 * edited per row by the machine.
 */
export type OptionsDraft = Readonly<Record<string, boolean | Appearance>>;

/**
 * Build a draft from options: every registry row's current value.
 *
 * @param options Validated options (as the storage contract returns them).
 * @returns The frozen draft — one entry per registry row, nothing else.
 */
export function draftFromOptions(options: StoredOptions): OptionsDraft {
  return Object.freeze(
    Object.fromEntries(OPTION_ROWS.map((row) => [row.id, readOption(row, options)] as const))
  );
}

/**
 * Whether any registry row's pending value differs from the options it was
 * loaded from — the Save affordance's gate.
 *
 * @param options The loaded (baseline) options.
 * @param draft The page's edit buffer.
 */
export function isDraftDirty(options: StoredOptions, draft: OptionsDraft): boolean {
  return OPTION_ROWS.some((row) => readOption(row, options) !== draft[row.id]);
}

/**
 * Merge a draft onto a base options value — the save's write shape. The
 * base is expected to be a **fresh** validated read (so unknown boolean ids
 * and concurrent non-registry options ride through untouched); only the
 * registry rows the page owns are applied from the draft. A draft value
 * that is not legal for its row (a corrupted buffer) is skipped, keeping
 * the base value — the machine's input guard makes this belt-only.
 *
 * @param base The fresh validated options to merge onto.
 * @param draft The page's edit buffer.
 * @returns The new options value to persist (base and draft untouched).
 */
export function optionsWithDraft(base: StoredOptions, draft: OptionsDraft): StoredOptions {
  // Fresh group copies: the base's unknown/concurrent fields survive, the
  // base object itself is never mutated. Groups are aliased so the rows'
  // storage keys index the group's own index signature.
  const improvements: StoredOptions['improvements'] = { ...base.improvements };
  let appearance: Appearance = base.appearance;
  const features: StoredOptions['features'] = { ...base.features };
  for (const row of OPTION_ROWS) {
    const value = draft[row.id];
    if (value === undefined) continue; // Belt: a draft always carries every row.
    if (row.kind === 'appearance') {
      if (isAppearanceChoice(value)) appearance = value;
    } else if (typeof value === 'boolean') {
      if (row.section === 'improvements') improvements[row.id] = value;
      else features[row.id] = value;
    }
  }
  return { improvements, appearance, features };
}

/** The typed result a completed save hands the UI for its toast. */
export type OptionsSaveOutcome =
  | {
      readonly ok: true;
      /** Whether a write happened (`false` = the clean-save guard, nothing to persist). */
      readonly wrote: boolean;
      /** The options now stored — the merged write, or the unchanged value. */
      readonly options: StoredOptions;
    }
  | { readonly ok: false; readonly message: string };

/** The page's state, discriminated by what the page can render next. */
export type OptionsPageSnapshot =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly failure: string }
  | {
      readonly status: 'ready';
      /** The loaded options — the dirty baseline. */
      readonly options: StoredOptions;
      /** The edit buffer, keyed by registry row id. */
      readonly draft: OptionsDraft;
      /** Whether any row's pending value differs from the baseline. */
      readonly dirty: boolean;
      /** A save write is in flight (Save shows busy and is disabled). */
      readonly saving: boolean;
      /** The last save's typed outcome for the toast; cleared by the next edit. */
      readonly lastSave: OptionsSaveOutcome | null;
    };

/** The initial state: the skeleton the page renders until the load resolves. */
export const INITIAL_OPTIONS_PAGE_SNAPSHOT: Readonly<OptionsPageSnapshot> = Object.freeze({
  status: 'loading'
} satisfies OptionsPageSnapshot);

/**
 * The model's browser seams. The default wiring is the storage contract
 * (`getOptions` / `optionsStore.setValue`); tests and alternate surfaces
 * inject their own.
 */
export interface OptionsPageIO {
  /** Read the validated options — corrupt-tolerant per the storage contract. */
  read(): Promise<StoredOptions>;
  /** Persist the whole options shape; rejects as the platform does. */
  write(options: StoredOptions): Promise<void>;
  /** Degradation diagnostics. */
  log: Logger;
}

/**
 * The storage-backed seams: reads through the storage contract's validator,
 * writes through the options item (rejections propagate — the model branches
 * on them).
 *
 * @param log Diagnostics sink; defaults to the `options` tag.
 */
export function createStorageOptionsPageIO(log: Logger = createLogger('options')): OptionsPageIO {
  return {
    read: () => getOptions(),
    write: (options) => optionsStore.setValue(options),
    log
  };
}

/** The machine the page's wiring drives (one instance per mounted page). */
export interface OptionsPageModel {
  /** The current snapshot (frozen; also the payload of every `onChange`). */
  snapshot(): Readonly<OptionsPageSnapshot>;
  /**
   * The initial load — and the failed state's retry target: reads options,
   * populates the draft. A load while ready is a no-op (it would discard
   * unsaved edits); while a save is in flight it is refused (logged).
   */
  load(): Promise<void>;
  /**
   * Edit one row's pending value. Editing is what marks the page dirty and
   * clears the previous save's toast.
   *
   * @param rowId A registry row id.
   * @param value The new value — must be legal for the row (boolean rows
   *   demand a boolean, the appearance row a legal choice).
   * @throws {@link Error} When the page is not ready (no controls exist
   *   yet), the row id is unknown, or the value is illegal for the row —
   *   all wiring bugs, named by the message.
   */
  setOption(rowId: string, value: boolean | Appearance): void;
  /**
   * Persist the draft — only when dirty. The write merges the draft onto a
   * fresh validated read (unknown fields and concurrent non-registry options
   * survive), is awaited, and lands as a typed outcome on the snapshot; a
   * rejection keeps the page dirty (nothing lost) and never throws.
   *
   * @throws {@link Error} When the page is not ready — a wiring bug.
   */
  save(): Promise<void>;
}

/**
 * Create the page's model over its seams.
 *
 * @param io The browser seams; defaults to the storage contract.
 * @param onChange Receives every state movement (the wiring mirrors it into
 *   a Solid signal). Not called for the initial skeleton — seed the signal
 *   with {@link INITIAL_OPTIONS_PAGE_SNAPSHOT}.
 */
export function createOptionsPageModel(
  io: OptionsPageIO = createStorageOptionsPageIO(),
  onChange: (snapshot: OptionsPageSnapshot) => void = () => {}
): OptionsPageModel {
  let status: OptionsPageSnapshot['status'] = 'loading';
  let options: StoredOptions | null = null;
  let draft: OptionsDraft | null = null;
  let dirty = false;
  let saving = false;
  let lastSave: OptionsSaveOutcome | null = null;
  let failure: string | null = null;

  /** Publish a frozen copy of the current state, shaped by the status. */
  function notify(): void {
    if (status === 'ready' && options !== null && draft !== null) {
      onChange(Object.freeze({ status, options, draft, dirty, saving, lastSave }));
      return;
    }
    if (status === 'failed' && failure !== null) {
      onChange(Object.freeze({ status, failure }));
      return;
    }
    // 'loading' — the belt leg (a failed state always carries its message).
    onChange(Object.freeze({ status: 'loading' }));
  }

  return {
    snapshot(): Readonly<OptionsPageSnapshot> {
      if (status === 'ready' && options !== null && draft !== null) {
        return Object.freeze({ status, options, draft, dirty, saving, lastSave });
      }
      if (status === 'failed' && failure !== null) {
        return Object.freeze({ status, failure });
      }
      return INITIAL_OPTIONS_PAGE_SNAPSHOT;
    },

    async load(): Promise<void> {
      if (saving) {
        io.log.warn('Options load refused — a save is in flight');
        return;
      }
      if (status === 'ready') return; // A reload would discard unsaved edits.
      let loaded: StoredOptions;
      try {
        loaded = await io.read();
      } catch (cause) {
        io.log.error('Loading the options failed — the page offers a retry', cause);
        status = 'failed';
        failure = LOAD_FAILURE_MESSAGE;
        notify();
        return;
      }
      status = 'ready';
      failure = null;
      options = loaded;
      draft = draftFromOptions(loaded);
      dirty = false;
      lastSave = null;
      notify();
    },

    setOption(rowId: string, value: boolean | Appearance): void {
      if (status !== 'ready' || options === null || draft === null) {
        throw new Error(
          `setOption: the options page is not ready (status '${status}') — no control may edit yet.`
        );
      }
      const row = OPTION_ROWS.find((candidate) => candidate.id === rowId);
      if (row === undefined) {
        throw new Error(`setOption: unknown option row '${rowId}'.`);
      }
      if (!isValidOptionValue(row, value)) {
        throw new Error(
          `setOption: ${JSON.stringify(value)} is not a legal value for the '${rowId}' row.`
        );
      }
      draft = { ...draft, [rowId]: value };
      dirty = isDraftDirty(options, draft);
      lastSave = null; // A new edit supersedes the previous save's toast.
      notify();
    },

    async save(): Promise<void> {
      if (status !== 'ready' || options === null || draft === null) {
        throw new Error(
          `save: the options page is not ready (status '${status}') — nothing to save.`
        );
      }
      if (saving) {
        io.log.warn('Options save refused — a save is already in flight');
        return;
      }
      if (!dirty) {
        // The dirty-only gate: the UI disables Save when clean; this branch
        // is defense that still answers with an honest, write-free outcome.
        lastSave = { ok: true, wrote: false, options };
        notify();
        return;
      }
      const savedDraft = draft;
      saving = true;
      notify();
      // Fresh read first: the merge base must be what is stored *now*, so
      // concurrent writers' fields survive the write.
      let fresh: StoredOptions;
      try {
        fresh = await io.read();
      } catch (cause) {
        io.log.error('Saving the options failed — the fresh-options read rejected', cause);
        saving = false;
        lastSave = { ok: false, message: SAVE_FAILURE_MESSAGE };
        notify();
        return;
      }
      const merged = optionsWithDraft(fresh, savedDraft);
      try {
        await io.write(merged);
      } catch (cause) {
        io.log.error('Saving the options failed — the write rejected', cause);
        saving = false;
        lastSave = { ok: false, message: SAVE_FAILURE_MESSAGE };
        notify();
        return;
      }
      // The baseline moves to what is stored; the draft keeps any edits made
      // mid-flight (they re-dirty against the new baseline). Registry rows
      // the page owns were written as approved — last-write-wins there.
      options = merged;
      dirty = isDraftDirty(merged, draft);
      saving = false;
      lastSave = { ok: true, wrote: true, options: merged };
      notify();
    }
  };
}
