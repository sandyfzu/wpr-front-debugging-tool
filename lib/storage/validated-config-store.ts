/**
 * One shape for a tool's settings store: a single machine-local value
 * (`local:` — survives restarts, never synced) read tolerantly and written
 * strictly. Reads go through the tool's parser (a junk field reads as its
 * default, unknown keys are dropped); a write snapshots the value once,
 * validates the snapshot and stores exactly it — an invalid value is
 * refused, never stored. Each tool binds its key, defaults, parser and
 * validator; the read/write/watch rules exist only here.
 */
import { storage } from 'wxt/utils/storage';

/** What a tool declares for its store. */
export interface ValidatedConfigSpec<T> {
  /** The storage key (`local:` area). */
  readonly key: `local:${string}`;
  /** The value read when nothing (or a removal) is stored. */
  readonly fallback: T;
  /** Tolerant reader: any input becomes a valid value. */
  readonly parse: (input: unknown) => T;
  /** Strict validator: why a value cannot be stored, or null. */
  readonly findProblem: (input: unknown) => string | null;
  /** The value's name in error messages ("RUCSS tester configuration"). */
  readonly label: string;
}

/** The bound store. */
export interface ValidatedConfigStore<T> {
  /**
   * Read the value through the tolerant reader.
   *
   * @throws The storage read's own rejection (e.g. an invalidated extension context).
   */
  readonly get: () => Promise<T>;
  /**
   * Persist a value: one snapshot is taken, validated and stored.
   *
   * @throws {@link RangeError} naming the problem when the value is invalid
   *   (a broken caller); the storage write's own rejection otherwise.
   */
  readonly set: (value: T) => Promise<void>;
  /**
   * Follow the value: every write reaches the callback through the tolerant
   * reader (a removal reads as the fallback).
   *
   * @returns The unsubscribe handle.
   */
  readonly watch: (onChange: (value: T) => void) => () => void;
}

/**
 * Copy a candidate into plain data, reading each property exactly once, so
 * what is validated is what gets stored (an accessor cannot return one value
 * to the check and another to the write).
 *
 * @param value The caller's value.
 * @param label The value's name for the error.
 * @returns The plain-data snapshot.
 * @throws {@link RangeError} when the value cannot be copied (a function, a
 *   proxy, … — never a settings value).
 */
function snapshotOf(value: unknown, label: string): unknown {
  try {
    return structuredClone(value);
  } catch (cause) {
    throw new RangeError(`Invalid ${label}: not plain data`, { cause });
  }
}

/**
 * Bind a tool's settings store.
 *
 * @param spec See {@link ValidatedConfigSpec}.
 * @returns The store's read, write and watch.
 */
export function defineValidatedConfigStore<T>(
  spec: ValidatedConfigSpec<T>
): ValidatedConfigStore<T> {
  const item = storage.defineItem<T>(spec.key, { fallback: spec.fallback });
  return {
    get: async () => spec.parse(await item.getValue()),
    set: async (value) => {
      const snapshot = snapshotOf(value, spec.label);
      const problem = spec.findProblem(snapshot);
      if (problem !== null) throw new RangeError(`Invalid ${spec.label}: ${problem}`);
      // Validated plain data: the tolerant reader returns it field for field, typed.
      await item.setValue(spec.parse(snapshot));
    },
    watch: (onChange) =>
      item.watch((raw: unknown) => {
        onChange(spec.parse(raw));
      })
  };
}
