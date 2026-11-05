/**
 * The RUCSS tester's configuration store: one value shared by every site
 * (`local:` — machine-local, survives restarts, never synced). The panel
 * form writes it (debounced); every run trigger reads it at run time.
 *
 * Reads are tolerant (see `parseRucssTesterConfig`): a junk field reads as
 * its default, unknown keys are dropped. Writes are strict: an invalid value
 * is refused, never stored.
 */
import { storage } from 'wxt/utils/storage';
import {
  DEFAULT_RUCSS_TESTER_CONFIG,
  findRucssTesterConfigProblem,
  parseRucssTesterConfig,
  type RucssTesterConfig
} from '../rucss-tester/config';

/** The store key, single-sourced. */
export const RUCSS_TESTER_CONFIG_KEY = 'local:rucss-tester-config';

/** The raw storage item (reads, writes and watches go through the helpers below). */
export const rucssTesterConfigStore = storage.defineItem<RucssTesterConfig>(
  RUCSS_TESTER_CONFIG_KEY,
  { fallback: DEFAULT_RUCSS_TESTER_CONFIG }
);

/**
 * Read the configuration through the tolerant reader.
 *
 * @throws The storage read rejects as the platform does (e.g. an invalidated
 *   extension context) — callers branch.
 */
export async function getRucssTesterConfig(): Promise<RucssTesterConfig> {
  return parseRucssTesterConfig(await rucssTesterConfigStore.getValue());
}

/**
 * Copy a candidate into plain data, reading each property exactly once, so
 * what is validated is what gets stored (an accessor cannot return one value
 * to the check and another to the write).
 *
 * @param config The caller's value.
 * @returns The plain-data snapshot.
 * @throws {@link RangeError} when the value cannot be copied (a function, a
 *   proxy, … — never a configuration).
 */
function snapshotConfig(config: RucssTesterConfig): unknown {
  try {
    return structuredClone(config);
  } catch (cause) {
    throw new RangeError('Invalid RUCSS tester configuration: not plain data', { cause });
  }
}

/**
 * Persist the configuration: one snapshot is taken, validated and stored.
 *
 * @param config The configuration to store.
 * @throws {@link RangeError} naming the offending field when `config` is
 *   invalid (a broken caller); the storage write's own rejection otherwise.
 */
export async function setRucssTesterConfig(config: RucssTesterConfig): Promise<void> {
  const snapshot = snapshotConfig(config);
  const problem = findRucssTesterConfigProblem(snapshot);
  if (problem !== null) throw new RangeError(`Invalid RUCSS tester configuration: ${problem}`);
  // Validated plain data: the tolerant reader returns it field for field, typed.
  await rucssTesterConfigStore.setValue(parseRucssTesterConfig(snapshot));
}

/**
 * Follow the configuration: every write reaches the callback through the
 * tolerant reader (a removal reads as the defaults).
 *
 * @param onChange Receives the validated configuration after each write.
 * @returns The unsubscribe handle.
 */
export function watchRucssTesterConfig(onChange: (config: RucssTesterConfig) => void): () => void {
  return rucssTesterConfigStore.watch((raw: unknown) => {
    onChange(parseRucssTesterConfig(raw));
  });
}
