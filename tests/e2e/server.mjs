#!/usr/bin/env node
/**
 * Local fixture server for the browser-test harness: one Node process serves
 * the committed static fixtures over both local origins (`localhost` and
 * `127.0.0.1` are distinct origins even though they share one port, so
 * cross-origin script errors and origin-tagged comparisons stay real).
 *
 * Behavior contract (why this server, not a generic static handler):
 * - every response carries `cache-control: no-store`, so every frame load and
 *   reload is a genuine network round-trip — the Side-by-Side refresh probe
 *   can count loads, not cache hits;
 * - the `__E2E_FRAME_TOKEN__` placeholder inside any served `.html` file is
 *   replaced with a fresh random value per request — a fixture page can prove
 *   "this body came from the latest request" without a separate token
 *   endpoint (committing static HTML, asserting live server facts);
 * - `/__e2e/health` answers `ok` for the runner's readiness gate.
 *
 * Tests-only, local-only, deliberately unauthenticated: the local browser
 * harness is the only client.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The single fixed port both origins are bound to (verified free before committing this value). */
export const PORT = Number(process.env.E2E_PORT ?? 8891);

/** The fixtures root: everything the browser may load under this directory. */
const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), 'fixtures'));

/** Minimal MIME map; unknown extensions stay raw bytes. */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/**
 * Fresh per-request token (the reload probe compares exact equality, so it
 * must only be distinguishable, not secret).
 *
 * @returns {string} Six random lowercase alphanumeric characters.
 */
function freshToken() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 6; i += 1)
    token += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return token;
}

/**
 * Map a request path to a file under {@link ROOT}, refusing path traversal.
 *
 * @param {string} urlPath The request's URL pathname.
 * @returns {string | null} Absolute fixture path, or null when traversal escapes the root.
 */
function resolveFixturePath(urlPath) {
  const relative = normalize(decodeURIComponent(urlPath)).replace(/^[/\\]+/, '');
  if (relative === '') return join(ROOT, 'index.html');
  const absolute = resolve(join(ROOT, relative));
  return absolute.startsWith(`${ROOT}${sep}`) ? absolute : null;
}

/**
 * Start the fixture server. Bound dual-stack so `localhost` (which may try
 * `::1`) and `127.0.0.1` both reach it.
 *
 * @returns {Promise<{ close(): Promise<void> }>} The bound server handle.
 */
export async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);
    if (url.pathname === '/__e2e/health') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('ok');
      return;
    }
    if (url.pathname === '/favicon.ico') {
      // Browsers always request this; answering 204 keeps the fixture pages'
      // console baseline clean (a 404 would surface as error-level noise the
      // suites would have to filter, forever).
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('GET/HEAD only');
      return;
    }
    const file = resolveFixturePath(url.pathname);
    /** @type {Buffer | undefined} */
    let body;
    if (file !== null) {
      try {
        if ((await stat(file)).isDirectory()) throw new Error('directory');
        body = await readFile(file);
      } catch {
        body = undefined;
      }
    }
    if (body === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`fixture not found: ${url.pathname}`);
      return;
    }
    const extension = extname(file).toLowerCase();
    const contentType = MIME_TYPES[extension] ?? 'application/octet-stream';
    if (extension === '.html' && body.includes(FRAME_TOKEN_PLACEHOLDER)) {
      body = Buffer.from(body.toString('utf8').replaceAll(FRAME_TOKEN_PLACEHOLDER, freshToken()));
    }
    response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
    response.end(body);
  });
  await new Promise((listenResolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, listenResolve);
  });
  return {
    close: () =>
      new Promise((closeResolve) => {
        server.close(() => closeResolve());
      })
  };
}

/** The HTML placeholder the server replaces with a fresh per-request token. */
export const FRAME_TOKEN_PLACEHOLDER = '__E2E_FRAME_TOKEN__';

/**
 * Running directly: `node tests/e2e/server.mjs` starts and stays (this is the
 * entry Playwright's webServer block runs; the health route reports ready).
 */
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await startFixtureServer();
  console.log(
    `fixture server listening on http://localhost:${PORT}/ and http://127.0.0.1:${PORT}/`
  );
}
