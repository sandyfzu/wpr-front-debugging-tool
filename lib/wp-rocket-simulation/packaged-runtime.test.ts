/**
 * The packaged LazyLoad runtimes: every supported version's runtime ships
 * as its own file under the data folder at its `jsPath`, byte for byte the
 * data file's pin (size and sha256) — the bytes the simulated page's runtime
 * URL is answered with. `parity:wp-rocket` derives the file from the pinned
 * zips; this check holds it on every CI run.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_WPR_VERSIONS } from '../wp-rocket/versions';
import { LAZYLOAD_RUNTIME_FILE, SIMULATION_DATA_PATH, readSimulationData } from './simulation-data';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '../../public');

const DATA = (() => {
  const read = readSimulationData(
    JSON.parse(readFileSync(join(PUBLIC, SIMULATION_DATA_PATH), 'utf8'))
  );
  if (!read.ok) throw new Error(read.problem);
  return read.data;
})();

describe.each(SUPPORTED_WPR_VERSIONS.map((pin) => [pin.version] as const))(
  'the packaged LazyLoad runtime of WP Rocket %s',
  (version) => {
    it('is the pinned bytes', () => {
      const runtime = DATA.versions[version]?.lazyload.runtime;
      if (runtime === undefined) throw new Error(`no LazyLoad runtime for ${version}`);
      const file = readFileSync(join(PUBLIC, dirname(SIMULATION_DATA_PATH), runtime.jsPath));
      expect(file.byteLength).toBe(runtime.bytes);
      expect(createHash('sha256').update(file).digest('hex')).toBe(runtime.sha256);
    });

    it('is named as the session interception expects (a request for it is matched by name)', () => {
      expect(DATA.versions[version]?.lazyload.runtime.jsPath.split('/').at(-1)).toBe(
        LAZYLOAD_RUNTIME_FILE
      );
    });
  }
);
