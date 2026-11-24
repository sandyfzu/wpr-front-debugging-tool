/**
 * The beacon test form's settings store: one value shared by every site
 * (`local:` — machine-local, survives restarts, never synced), written by
 * the panel form (debounced). Tolerant reads, strict writes
 * (rules: `./validated-config-store`).
 */
import {
  BEACON_TEST_SETTINGS_KEY,
  DEFAULT_BEACON_TEST_SETTINGS,
  findBeaconSettingsProblem,
  parseBeaconTestSettings,
  type BeaconTestSettings
} from '../beacon-test/settings';
import { defineValidatedConfigStore } from './validated-config-store';

/** The store key (declared with the value's shape). */
export { BEACON_TEST_SETTINGS_KEY };

/** The bound store (read, write, watch). */
const store = defineValidatedConfigStore<BeaconTestSettings>({
  key: BEACON_TEST_SETTINGS_KEY,
  fallback: DEFAULT_BEACON_TEST_SETTINGS,
  parse: parseBeaconTestSettings,
  findProblem: findBeaconSettingsProblem,
  label: 'beacon test settings'
});

/**
 * Read the settings through the tolerant reader.
 *
 * @throws The storage read's own rejection (e.g. an invalidated extension context).
 */
export const getBeaconTestSettings: () => Promise<BeaconTestSettings> = store.get;

/**
 * Persist the settings: one snapshot is taken, validated and stored.
 *
 * @throws {@link RangeError} naming the problem for an invalid value; the
 *   storage write's own rejection otherwise.
 */
export const setBeaconTestSettings: (settings: BeaconTestSettings) => Promise<void> = store.set;

/**
 * Follow the settings (a removal reads as the defaults).
 *
 * @returns The unsubscribe handle.
 */
export const watchBeaconTestSettings: (
  onChange: (settings: BeaconTestSettings) => void
) => () => void = store.watch;
