/**
 * A tool page's stored settings form, the one machinery every tool binds
 * (its store, check and form shape stay its own): the form's reactive
 * state, loaded once from the store, then written back debounced through
 * {@link createConfigWriter}; writes from elsewhere (another DevTools
 * window) land in the form while it has nothing unsaved.
 *
 * Load machine: `loading` → `ready` | `failed` (retry → `loading`). The
 * form holds `initial` until the load lands; a page shows it only on `ready`.
 */
import { createSignal, type Accessor } from 'solid-js';
import { createStore, reconcile, unwrap, type SetStoreFunction } from 'solid-js/store';
import type { Logger } from '../../../../lib/logger';
import type { ScheduleTimer } from '../../../../lib/messaging/bounded-ask';
import { createConfigWriter, type ConfigSaveState } from './config-writer';

/** The stored settings' load. */
export type SettingsLoadState =
  { readonly status: 'loading' } | { readonly status: 'ready' } | { readonly status: 'failed' };

/** What the form binds (production: the tool's store; tests inject doubles). */
export interface StoredSettingsDeps<Value, Form extends object> {
  /** Read the stored value (rejects as the storage does). */
  readonly read: () => Promise<Value>;
  /** Store a value (rejects as the storage does). */
  readonly write: (value: Value) => Promise<void>;
  /** Follow writes from elsewhere; returns the unsubscribe. */
  readonly watch: (onChange: (value: Value) => void) => () => void;
  /** Why the store would refuse a value (user words), or null. */
  readonly check: (value: Value) => string | null;
  /** Fresh, writable form state of a value (clamped to the fields' caps where needed). */
  readonly toForm: (value: Value) => Form;
  /** The value a form state stands for (receives plain data, never the reactive proxy). */
  readonly toValue: (form: Form) => Value;
  /** The value the form holds until the load lands. */
  readonly initial: Value;
  readonly schedule: ScheduleTimer;
  /** Quiet time (ms) after an edit before it is written. */
  readonly delayMs: number;
  readonly log: Logger;
  /** The tool's name in log lines ("RUCSS tester"). */
  readonly label: string;
}

/** The bound form. */
export interface StoredSettings<Value, Form extends object> {
  /** The form's state (read-only; change it with `setForm`, then call `edited`). */
  readonly form: Form;
  readonly setForm: SetStoreFunction<Form>;
  readonly load: Accessor<SettingsLoadState>;
  readonly save: Accessor<ConfigSaveState>;
  /** The form's current value, as plain data. */
  readonly value: () => Value;
  /** Queue the form's current value for writing (call after each change). */
  readonly edited: () => void;
  /** Load the stored value again (after a failed load). */
  readonly retryLoad: () => void;
  /**
   * Write any queued edit now.
   *
   * @returns Whether the store holds what the form showed at the call.
   */
  readonly flush: () => Promise<boolean>;
  /** Stop following the store and drop a queued write. */
  readonly dispose: () => void;
}

/**
 * Create the form (call inside a reactive root that outlives the page body).
 *
 * @param deps See {@link StoredSettingsDeps}.
 */
export function createStoredSettings<Value, Form extends object>(
  deps: StoredSettingsDeps<Value, Form>
): StoredSettings<Value, Form> {
  const [form, setForm] = createStore<Form>(deps.toForm(deps.initial));
  const [load, setLoad] = createSignal<SettingsLoadState>({ status: 'loading' });
  const writer = createConfigWriter<Value>({
    write: deps.write,
    check: deps.check,
    schedule: deps.schedule,
    delayMs: deps.delayMs
  });
  let disposed = false;

  /** The form as plain data. */
  const value = (): Value => deps.toValue(unwrap(form));

  /** Load the stored value into the form (loading → ready | failed). */
  const readStored = async (): Promise<void> => {
    setLoad({ status: 'loading' });
    try {
      const stored = await deps.read();
      if (disposed) return;
      setForm(reconcile(deps.toForm(stored)));
      setLoad({ status: 'ready' });
    } catch (cause) {
      deps.log.warn(
        `${deps.label}: reading the settings failed`,
        cause instanceof Error ? cause.message : cause
      );
      if (!disposed) setLoad({ status: 'failed' });
    }
  };

  // Another window's write lands here too; local edits in flight win (theirs would undo typing).
  // A storage callback, not a render scope: it reads the current states once per write.
  // eslint-disable-next-line solid/reactivity
  const stopWatch = deps.watch((stored) => {
    if (load().status === 'ready' && writer.state().status === 'saved') {
      setForm(reconcile(deps.toForm(stored)));
    }
  });
  void readStored();

  return {
    form,
    setForm,
    load,
    save: writer.state,
    value,
    edited: () => {
      writer.queue(value());
    },
    retryLoad: () => {
      void readStored();
    },
    flush: writer.flush,
    dispose: () => {
      disposed = true;
      stopWatch();
      writer.cancel();
    }
  };
}
