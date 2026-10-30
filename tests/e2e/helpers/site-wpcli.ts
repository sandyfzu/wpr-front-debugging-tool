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
 * next request renders under the new state. Suites that need a page of their
 * own create and delete it here, and read the site's access log (the
 * `wordpress` service's stdout) to prove which requests reached the site.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** The compose stack's directory (docker/), resolved from this file. */
const DOCKER_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'docker');

/** The WordPress root inside the wp-cli container. */
const WP_PATH = '/var/www/html';

/** One docker compose round's ceiling: a converged stack answers in ~2 s. */
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
 * Run one `docker compose` command against the site's stack.
 *
 * @param command The compose subcommand and its arguments.
 * @param stdin Text piped to the command's stdin, when any.
 * @returns The command's stdout.
 * @throws {Error} Naming the failed step and its stderr tail (never stdin).
 */
async function runCompose(command: readonly string[], stdin?: string): Promise<string> {
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
        ...command
      ],
      { timeout: WPCLI_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) {
          const detail = wpCliFailureDetail(stderr);
          settle(() => {
            reject(
              new Error(
                `docker compose step failed (${error.message.split('\n')[0] ?? 'unknown'}): ${detail} — is the docker site up (docker/scripts/up.sh)?`
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
        reject(new Error('docker compose step failed: the docker process has no stdin pipe'));
      });
      return;
    }
    // Unhandled, a stdin stream error would crash the runner; it names the
    // stream failure, never the piped text.
    child.stdin.on('error', (error: Error) => {
      settle(() => {
        reject(new Error(`docker compose step failed writing stdin: ${error.message}`));
      });
    });
    if (stdin === undefined) child.stdin.end();
    else child.stdin.end(stdin);
  });
}

/**
 * Run one shell script in the stack's one-shot wp-cli container.
 *
 * @param script The `sh -c` script (wp-cli calls inside).
 * @param stdin Text piped to the script's stdin, when any.
 * @returns The script's stdout.
 */
async function runInWpCli(script: string, stdin?: string): Promise<string> {
  return await runCompose(['run', '--rm', '-T', 'wp-bootstrap', 'sh', '-c', script], stdin);
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

/** A post slug as WordPress stores it (lowercase letters, digits, hyphens): safe inside the shell script. */
const PAGE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The ids of every page stored under `slug`, any status.
 *
 * @param slug The page slug.
 */
async function pageIds(slug: string): Promise<number[]> {
  const out = await runInWpCli(
    `wp --path=${WP_PATH} post list --post_type=page --post_status=any --name=${slug} --field=ID`
  );
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(Number);
}

/**
 * Delete a page for good (no trash), purging the page cache after it.
 *
 * @param id The page id.
 */
export async function deleteSitePage(id: number): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) throw new Error(`not a page id: ${String(id)}`);
  await runInWpCli(
    `wp --path=${WP_PATH} post delete ${String(id)} --force >/dev/null && ` +
      `wp --path=${WP_PATH} eval 'rocket_clean_domain();'`
  );
}

/**
 * Publish a page at `/<slug>/` whose content is `html` as written (author =
 * the admin, whose unfiltered HTML keeps style attributes and markup). A
 * page left under that slug by a killed run is deleted first, so the URL is
 * always this page.
 *
 * @param slug The page slug (the URL path).
 * @param title The page title.
 * @param html The post content (piped on stdin, never a shell argument).
 * @returns The new page's id.
 * @throws {Error} When the slug is not a plain WordPress slug, or wp-cli does not answer an id.
 */
export async function createSitePage(slug: string, title: string, html: string): Promise<number> {
  if (!PAGE_SLUG.test(slug) || !/^[\w -]+$/.test(title)) {
    throw new Error(`createSitePage: unsafe slug or title (${slug} / ${title})`);
  }
  for (const id of await pageIds(slug)) await deleteSitePage(id);
  const out = await runInWpCli(
    `wp --path=${WP_PATH} post create - --post_type=page --post_status=publish --user=1 ` +
      `--post_name=${slug} --post_title='${title}' --porcelain`,
    html
  );
  const id = Number(out.trim());
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`wp post create answered no page id for ${slug}: ${out.trim()}`);
  }
  return id;
}

/** A Unix timestamp as `date +%s.%N` prints it (seconds, nanosecond fraction). */
const UNIX_TIMESTAMP = /^\d{10,}\.\d{9}$/;

/**
 * The site's own clock, read inside the `wordpress` container: the fixed
 * start a later {@link siteRequestCount} reads from. Docker stamps each log
 * line with the daemon's clock, the one this container shares, so the mark
 * and the stamps compare without host/VM skew.
 *
 * @returns The container's current time as a Unix timestamp (`docker logs --since` accepts it).
 * @throws {Error} When the container is not running or answers no timestamp.
 */
export async function siteLogMark(): Promise<string> {
  const out = (await runCompose(['exec', '-T', 'wordpress', 'date', '+%s.%N'])).trim();
  if (!UNIX_TIMESTAMP.test(out))
    throw new Error(`siteLogMark: no timestamp from the site (${out})`);
  return out;
}

/**
 * How many requests for a path reached the site since `mark` (Apache's
 * combined log on the `wordpress` service's stdout). Every read with the same
 * mark covers the same fixed start up to now, so the count only grows: a later
 * read minus an earlier one is exactly the requests in between. (A relative
 * `--since` would slide its start between the reads, and an old hit ageing
 * out could hide a new one.) Take the mark before the step under test.
 *
 * @param pathPart The request path (or a fragment of it) to count.
 * @param mark The fixed start, from {@link siteLogMark}.
 * @returns The matching `GET` lines.
 * @throws {Error} When `mark` is not a {@link siteLogMark} timestamp.
 */
export async function siteRequestCount(pathPart: string, mark: string): Promise<number> {
  if (!UNIX_TIMESTAMP.test(mark)) throw new Error(`siteRequestCount: bad mark (${mark})`);
  const log = await runCompose(['logs', '--no-log-prefix', '--since', mark, 'wordpress']);
  // The request line: `"GET <path>[?query] HTTP/x"`.
  return log
    .split('\n')
    .filter((line) => /"GET \S+ HTTP\//.exec(line)?.[0].includes(pathPart) === true).length;
}
