/**
 * The RUCSS tester's configuration store: one value shared by every site
 * (`local:` — machine-local, survives restarts, never synced). The panel
 * form writes it (debounced); every run trigger reads it at run time.
 *
 * Reads are tolerant (see `parseRucssTesterConfig`): a junk field reads as
 * its default, unknown keys are dropped. Writes are strict: an invalid value
 * is refused, never stored (rules: `./validated-config-store`).
 */
import {
  DEFAULT_RUCSS_TESTER_CONFIG,
  findRucssTesterConfigProblem,
  parseRucssTesterConfig,
  type RucssTesterConfig
} from '../rucss-tester/config';
import { defineValidatedConfigStore } from './validated-config-store';

/** The store key, single-sourced. */
export const RUCSS_TESTER_CONFIG_KEY = 'local:rucss-tester-config';

/** The bound store (read, write, watch). */
const store = defineValidatedConfigStore<RucssTesterConfig>({
  key: RUCSS_TESTER_CONFIG_KEY,
  fallback: DEFAULT_RUCSS_TESTER_CONFIG,
  parse: parseRucssTesterConfig,
  findProblem: findRucssTesterConfigProblem,
  label: 'RUCSS tester configuration'
});

/**
 * Read the configuration through the tolerant reader.
 *
 * @throws The storage read rejects as the platform does (e.g. an invalidated
 *   extension context) — callers branch.
 */
export const getRucssTesterConfig: () => Promise<RucssTesterConfig> = store.get;

/**
 * Persist the configuration: one snapshot is taken, validated and stored.
 *
 * @throws {@link RangeError} naming the offending field when `config` is
 *   invalid (a broken caller); the storage write's own rejection otherwise.
 */
export const setRucssTesterConfig: (config: RucssTesterConfig) => Promise<void> = store.set;

/**
 * Follow the configuration: every write reaches the callback through the
 * tolerant reader (a removal reads as the defaults).
 *
 * @returns The unsubscribe handle.
 */
export const watchRucssTesterConfig: (onChange: (config: RucssTesterConfig) => void) => () => void =
  store.watch;
