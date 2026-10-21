/**
 * wp-cli against the local WordPress site, for suites that must change WP
 * Rocket's STORED settings (a per-request fixture flag cannot reach the
 * plugin's compiled per-host config).
 *
 * Every call is one `docker compose run --rm -T wp-bootstrap sh -c …` — the
 * stack's own one-shot wp-cli container, which shares the site's volume and
 * fixture mount (`docker/docker-compose.yml`). Settings are written whole
 * from stdin (never as an argument: the option carries the site's synthetic
 * licence values, which must not reach a process list or a log), and every
 * write is followed by the plugin's own config regeneration + purge so the
 * next request renders under the new state.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** The compose stack's directory (docker/), resolved from this file. */
const DOCKER_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'docker');

/** The WordPress root inside the wp-cli container. */
const WP_PATH = '/var/www/html';

/** One wp-cli round's ceiling: a converged stack answers in ~2 s. */
const WPCLI_TIMEOUT_MS = 60_000;

/** WP Rocket's settings option row. */
const SETTINGS_OPTION = 'wp_rocket_settings';

/** The stored settings, opaque except for the keys a suite reads or overrides. */
export type WprSettings = Record<string, unknown>;

/**
 * The env file compose reads: the machine's `docker/.env`, else the
 * committed example (`up.sh` seeds `.env` from it, so both agree).
 *
 * @returns The absolute env-file path.
 */
function envFile(): string {
  const local = path.join(DOCKER_DIR, '.env');
  return existsSync(local) ? local : path.join(DOCKER_DIR, '.env.example');
}

/**
 * The stderr lines a failed wp-cli step reports: the first PHP fatal-error line (a
 * fatal's stack trace pushes it out of the tail) plus the last three lines.
 *
 * @param stderr The step's stderr (never stdin, which is not echoed there).
 * @returns The lines joined by ` | `, the fatal first and never repeated.
 */
export function wpCliFailureDetail(stderr: string): string {
  const lines = stderr.split('\n').filter((line) => line.trim() !== '');
  const tail = lines.slice(-3);
  const fatal = lines.find((line) => /\bFatal error:/.test(line));
  return (fatal === undefined || tail.includes(fatal) ? tail : [fatal, ...tail]).join(' | ');
}

/**
 * Run one shell script in the wp-cli container.
 *
 * @param script The `sh -c` script (wp-cli calls inside).
 * @param stdin Text piped to the script's stdin, when any.
 * @returns The script's stdout.
 * @throws {Error} Naming the failed step and its stderr tail (never stdin).
 */
async function runInWpCli(script: string, stdin?: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    // The exit callback and a stdin stream error can both fire (an EPIPE when
    // the container dies before reading stdin): the first one settles.
    let settled = false;
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      outcome();
    };
    const child = execFile(
      'docker',
      [
        'compose',
        '-f',
        path.join(DOCKER_DIR, 'docker-compose.yml'),
        '--env-file',
        envFile(),
        'run',
        '--rm',
        '-T',
        'wp-bootstrap',
        'sh',
        '-c',
        script
      ],
      { timeout: WPCLI_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) {
          const detail = wpCliFailureDetail(stderr);
          settle(() => {
            reject(
              new Error(
                `wp-cli step failed (${error.message.split('\n')[0] ?? 'unknown'}): ${detail} — is the docker site up (docker/scripts/up.sh)?`
              )
            );
          });
          return;
        }
        settle(() => {
          resolve(stdout);
        });
      }
    );
    if (child.stdin === null) {
      child.kill();
      settle(() => {
        reject(new Error('wp-cli step failed: the docker process has no stdin pipe'));
      });
      return;
    }
    // Unhandled, a stdin stream error would crash the runner; it names the
    // stream failure, never the piped text.
    child.stdin.on('error', (error: Error) => {
      settle(() => {
        reject(new Error(`wp-cli step failed writing stdin: ${error.message}`));
      });
    });
    if (stdin === undefined) child.stdin.end();
    else child.stdin.end(stdin);
  });
}

/**
 * Read WP Rocket's stored settings.
 *
 * @returns The parsed option.
 * @throws {Error} When the option is not a JSON object.
 */
export async function readWprSettings(): Promise<WprSettings> {
  const raw = await runInWpCli(`wp --path=${WP_PATH} option get ${SETTINGS_OPTION} --format=json`);
  const parsed: unknown = JSON.parse(raw.trim());
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${SETTINGS_OPTION} did not read back as a JSON object`);
  }
  return parsed as WprSettings;
}

/**
 * Write WP Rocket's settings whole, regenerate the plugin's per-host config
 * and purge every cached page + minified asset, so the next request renders
 * under exactly these settings.
 *
 * @param settings The full option value to store.
 */
export async function writeWprSettings(settings: WprSettings): Promise<void> {
  await runInWpCli(
    `wp --path=${WP_PATH} option update ${SETTINGS_OPTION} --format=json >/dev/null && ` +
      `wp --path=${WP_PATH} eval 'do_action( "permalink_structure_changed" ); rocket_clean_domain(); rocket_clean_minify();'`,
    JSON.stringify(settings)
  );
}
