#!/usr/bin/env node
/**
 * Local fixture server for the browser-test harness: one process serving the
 * committed static fixtures over both local origins (`localhost` and
 * `127.0.0.1` are distinct origins even though they share one port, so
 * cross-origin script errors and origin-tagged comparisons stay real).
 *
 * Behavior contract (why this server, not a generic static handler):
 * - every response carries `cache-control: no-store`, so every frame load and
 *   reload is a genuine network round-trip — the Side-by-Side refresh probe
 *   can count loads, not cache hits. One deliberate exception:
 *   `/__e2e/cache-evidence` serves `max-age=3600` freshness evidence on
 *   purpose — it is the fixture exercising the caching verdicts;
 * - the `__E2E_FRAME_TOKEN__` placeholder inside any served `.html` file is
 *   replaced with a fresh random value per request — a fixture page can prove
 *   "this body came from the latest request" without a separate token
 *   endpoint (committing static HTML, asserting live server facts);
 * - `/__e2e/health` answers `ok` for the runner's readiness gate.
 *
 * Binding: loopback only. Two sockets carry the one port — `127.0.0.1` (IPv4)
 * and `::1` (IPv6, the host `localhost` may resolve to) — so the browser
 * reaches both origins while nothing on a network interface can. A wildcard
 * bind (a plain `listen(port)`) verified reachable from a LAN address, hence
 * the explicit loopback pair. The port is fixed: the runner's health gate in
 * `playwright.config.ts` hard-pins the same URL.
 *
 * Tests-only, local-only, deliberately unauthenticated: the local browser
 * harness is the only client.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The single fixed port both origins are bound to (verified free before
 * committing this value). `E2E_FIXTURE_PORT` overrides it for a local run —
 * the way to keep two concurrent harness users (another worktree's runs)
 * off each other's servers; the health gate in `playwright.config.ts` reads
 * the same override, so a run is self-consistent by construction. The
 * override is validated here, once: a junk value fails fast naming the env
 * var instead of surfacing as a NaN bind or a silent port 0 (whose health
 * gate would poll forever).
 */
const RAW_PORT = process.env.E2E_FIXTURE_PORT;
const PORT = Number(RAW_PORT ?? 8891);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(
    `E2E_FIXTURE_PORT must be a valid port number (1-65535), got "${String(RAW_PORT)}"`
  );
}

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
 * Serve one request: the whole handler of every bound socket.
 *
 * @param {import('node:http').IncomingMessage} request The incoming request.
 * @param {import('node:http').ServerResponse} response The response to write.
 * @returns {Promise<void>} Settles when the response is fully written.
 */
async function handle(request, response) {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);
  if (url.pathname === '/__e2e/header-filter') {
    // A main frame with a small, distinguishable header set for the Headers
    // page's filter: caching rows with a hit and a miss verdict, an
    // unrelated row, and cookies the page itself writes (the capture reads
    // only script-readable names — non-HttpOnly on purpose).
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-cache': 'HIT from edge-01',
      age: '7',
      via: '1.1 filter-fixture',
      'x-unique-header': 'unique-value'
    });
    response.end(
      `<!doctype html><html><head><title>header filter</title></head><body>header filter
        <script>
          document.cookie = 'fdt_filter_alpha=1; path=/; SameSite=Lax';
          document.cookie = 'fdt_filter_beta=2; path=/; SameSite=Lax';
          document.cookie = 'unrelated_name=3; path=/; SameSite=Lax';
        </script>
      </body></html>`
    );
    return;
  }
  if (url.pathname === '/__e2e/header-find-deep') {
    // The find's deep-scroll fixture for the Headers page: the same header
    // set as the filter fixture plus a long cookie list, so a find match
    // lands viewports deep among the cookie rows (landing it is a real
    // scroll) and the marked row can be a cookie row. Cookies are written
    // in capture order, so `fdt_deep_5…` matches exactly 50–59 in sequence.
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-cache': 'HIT from edge-01',
      age: '7',
      via: '1.1 find-deep fixture',
      'x-unique-header': 'unique-value'
    });
    const cookies = Array.from(
      { length: 60 },
      (_, index) =>
        `document.cookie = 'fdt_deep_${String(index + 1).padStart(2, '0')}=${String(index + 1)}; path=/; SameSite=Lax';`
    );
    response.end(
      `<!doctype html><html><head><title>header find deep</title></head><body>header find deep
        <script>
          ${cookies.join('\n          ')}
        </script>
      </body></html>`
    );
    return;
  }
  if (url.pathname === '/__e2e/cache-evidence') {
    // A main frame whose response carries one real caching-evidence header
    // class per verdict shape the panel documents (freshness, HIT probes, a
    // MISS probe, the WP Rocket marker family, Cloudflare DYNAMIC, edge
    // hints), the platform/server cards' headers, and one value-less row —
    // every verdict branch that a local dev site cannot produce. One class
    // has no hint copy (partial overlap: severity left unknown), and the
    // unrelated group carries capture-order rows incl. caching evidence
    // exempt from redaction. The page writes two cookies, so the
    // names-only-cookie guarantee is observable on this fixture too. The
    // body carries the cache-debug comment (a document sibling, its parse
    // position — the stamp's read site) so the strip's cached fact is
    // covered on this fixture as well.
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'max-age=3600, stale-while-revalidate=60',
      'cf-cache-status': 'DYNAMIC',
      age: '37',
      'x-cache': 'MISS from edge-02',
      'x-cache-lookup': 'HIT',
      'x-litespeed-cache': 'HIT',
      'x-kinsta-cache': 'MISS',
      'x-rocket-nginx-serving-static': 'HIT',
      'x-served-by': 'edge-01',
      via: '1.1 evidence-fixture',
      server: 'nginx',
      'x-powered-by': 'WP Engine/7.3',
      'x-plain-empty': '',
      'surrogate-key': 'post-1 term-2'
    });
    response.end(
      `<!doctype html><html><head><meta charset="utf-8" />
<meta name="generator" content="WP Rocket 3.20.1" /><title>Cache evidence fixture</title></head>
<body><h1>Cache evidence fixture</h1>
<script type="rocketlazyloadscript" data-rocket-src="/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"></script>
<script class="evidence-cookies">
  document.cookie = 'fdt_evidence=1; path=/; SameSite=Lax';
  document.cookie = 'fdt_evidence_two=fdt_never_served_value; path=/; SameSite=Lax';
</script></body></html>
<!-- This website is like a Rocket, isn't it? Performance optimized by WP Rocket. Learn more: https://wp-rocket.me - Debug: cached@1792411200 -->`
    );
    return;
  }
  if (url.pathname === '/__e2e/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }
  if (url.pathname === '/__e2e/header-flood') {
    // A main frame whose response carries more header rows than the
    // extension's capture cap (256): the capture is bounded to its first
    // rows and marked truncated (the suites read the served, labeled list).
    const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
    for (let i = 0; i < 300; i += 1) headers[`x-e2e-filler-${String(i)}`] = 'filler';
    response.writeHead(200, headers);
    response.end(
      '<!doctype html><html><head><title>header flood</title></head><body>header flood</body></html>'
    );
    return;
  }
  if (url.pathname === '/__e2e/secret-headers') {
    // A main frame whose response carries secret-bearing headers: the
    // capture must withhold or reduce every one before anything is stored.
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': ['fdt_session=E2E_SECRET_COOKIE; Path=/; HttpOnly', 'fdt_pref=E2E_SECRET_PREF'],
      location: '/next?token=E2E_SECRET_TOKEN&ok=1',
      'x-wp-nonce': 'E2E_SECRET_NONCE',
      'surrogate-key': 'post-1 term-2'
    });
    response.end(
      '<!doctype html><html><head><title>secret headers</title></head><body>secret headers</body></html>'
    );
    return;
  }
  if (url.pathname === '/__e2e/windows-1252') {
    // A main frame served as windows-1252 (header only, no `<meta>`), its
    // text holding bytes that differ from Latin-1 and UTF-8 (0x80 = €,
    // 0xE9 = é) and a script as Delay JavaScript execution serves it: an
    // applied session must serve the page back in its own charset, those
    // bytes intact.
    response.writeHead(200, {
      'content-type': 'text/html; charset=windows-1252',
      'cache-control': 'no-store'
    });
    response.end(
      Buffer.concat([
        Buffer.from(
          '<!doctype html><html lang="fr"><head><title>windows-1252</title></head><body><p id="w1252-text">Caf',
          'ascii'
        ),
        Buffer.from([0xe9, 0x20, 0x80]),
        Buffer.from(
          ' 5</p><script type="rocketlazyloadscript" data-rocket-src="/exclusion/lib/jquery-ui.js" id="jquery-ui-js"></script></body></html>',
          'ascii'
        )
      ])
    );
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
}

/**
 * Bind one loopback socket carrying {@link handle} on the fixed port.
 *
 * @param {string} host `'127.0.0.1'` (IPv4 loopback) or `'::1'` (IPv6, the
 *   `localhost` name may resolve here).
 * @returns {Promise<import('node:http').Server>} The bound server handle.
 * @throws {Error} When the bind fails (port taken, missing IPv6 support).
 */
function bindLoopback(host) {
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  return new Promise((listenResolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, host, listenResolve);
  });
}

/**
 * Close one bound socket, tolerating an already-closed one (the failure path
 * releases the sibling it did bind before refusing).
 *
 * @param {import('node:http').Server} server The server handle to close.
 * @returns {Promise<void>} Settles when the socket is released.
 */
async function closeLoopback(server) {
  await new Promise((closeResolve) => {
    server.close(() => closeResolve());
  });
}

/**
 * Start the fixture server: both loopback origins on the one fixed port.
 *
 * @returns {Promise<{ close(): Promise<void> }>} The bound server handle.
 * @throws {Error} With an actionable message when either bind fails — most
 *   commonly the port already held by a stale fixture-server run or any other
 *   local process.
 */
export async function startFixtureServer() {
  const bound = [];
  try {
    // IPv4 first: it is the socket the runner's health gate and both fixture
    // origins are documented against; IPv6 only widens `localhost` coverage.
    bound.push(await bindLoopback('127.0.0.1'));
    bound.push(await bindLoopback('::1'));
  } catch (cause) {
    // Release whatever did bind so a failed start leaves the port clean.
    for (const server of bound) await closeLoopback(server);
    const inUse =
      typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'EADDRINUSE';
    if (inUse) {
      throw new Error(
        `the fixture port ${String(PORT)} is already in use — a stale ` +
          `fixture-server run or another local process holds it (find it: lsof -nP -iTCP:${String(PORT)}).`,
        { cause }
      );
    }
    throw new Error(`binding the loopback fixture origins on port ${String(PORT)} failed`, {
      cause
    });
  }
  return {
    close: async () => {
      for (const server of bound) await closeLoopback(server);
    }
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
    `fixture server listening (loopback only) on http://localhost:${String(PORT)}/ and ` +
      `http://127.0.0.1:${String(PORT)}/`
  );
}
