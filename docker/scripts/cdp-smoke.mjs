/**
 * Phase 4.2 smoke proof: drive system Chrome headless over raw CDP (Node's built-in
 * WebSocket only, zero dependencies) and verify the fixture site's scripted problems.
 *
 *  1. /fdt/?fdt-error=reference  -> an immediate ReferenceError at load (no interaction)
 *  2. /fdt/?fdt-delay=1          -> the delayed scripts are held until interaction, and
 *     dispatching a real mousemove (WP Rocket's delay queue listens for it; verified in
 *     the 3.24 lazyload-scripts runtime) runs the queue: the delayed script throws
 *     its ReferenceError at execution time, the benign one tags itself
 *     data-fdt-delay="executed", WP Rocket sets data-rocket-status on the nodes, and
 *     the definer — held in the queue as the last delayed script — runs only after the
 *     throw and defines the thrown name (the found-verdict replay: a real throw, a
 *     real late definition).
 *  3. /wp-json/fdt/v1/ua-echo    -> the uncached text echo of the request's User-Agent
 *     (marker first): the body carries the browser UA, changes when the UA is
 *     overridden — a stored or HTTP-cached copy could not — and carries no WP Rocket
 *     footprint (the compiled wp-json cache rejection)
 *  4. the Priority-Elements beacon knobs (P1.1 fixture flags) -> the beacon page's
 *     inline config per URL flag: baseline (fonts off: no `preload_fonts` key), fonts
 *     forced on, OCI filter-disabled (`atf` absent entirely, the atf payloads with it),
 *     the two flags combined, and the inert `.invalid` novelty link — read from the
 *     raw served HTML (delay-independent), with the browser's own UA restored first so
 *     the arms always drive the desktop copies. Per-arm config absence is a legitimate
 *     row-state outcome (the beacon injects only while a registered factory row is
 *     missing; the smoke never resets site tables) — rule violations are the failures.
 *  5. the versionless generator arm (?fdt-wpr-versionless=1, read as raw served HTML):
 *     the baseline /fdt/ copy carries the versioned WP Rocket generator meta, the
 *     flagged copy carries the SAME meta with no version tail, and both stay cached
 *     pages (the flag removes the stamp, nothing else).
 *
 * Exits nonzero on any expectation miss: a missing proof is a failure, never a pass.
 */
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = Number(process.env.FDT_CDP_PORT ?? 19222);
const SITE = process.env.FDT_SITE_URL ?? 'http://127.0.0.1:8493';
const { spawn } = await import('node:child_process');

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=/tmp/fdt-cdp-${Date.now()}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1280,900',
    'about:blank'
  ],
  { stdio: 'ignore' }
);
// The spawned Chrome must not outlive a failed run: every exit path (including an
// uncaught error mid-run) terminates it.
process.on('exit', () => {
  chrome.kill();
});
process.on('uncaughtException', (err) => {
  console.error('FAIL: uncaught — ' + (err?.message ?? err));
  process.exit(1); // the exit hook above kills Chrome
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for the CDP endpoint, then use the *browser-level* websocket (targets deduped there).
let wsUrlBase = null;
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    wsUrlBase = (await res.json()).webSocketDebuggerUrl;
    break;
  } catch {
    await sleep(250);
  }
}
if (!wsUrlBase) {
  console.error('FAIL: chrome CDP endpoint never came up');
  process.exit(1);
}

const ws = new WebSocket(wsUrlBase);
// The two real failure modes are bounded explicitly: a server that answered the HTTP
// probe but never completed the WebSocket handshake, and connection refusal — either
// must fail the run fast instead of awaiting forever (Node WebSocket has no `onreject`).
await new Promise((res, rej) => {
  const timeout = setTimeout(
    () => rej(new Error(`CDP WebSocket on :${CDP_PORT} never opened`)),
    10000
  );
  ws.onopen = () => {
    clearTimeout(timeout);
    res();
  };
  ws.onerror = () => {
    clearTimeout(timeout);
    rej(new Error(`CDP WebSocket to :${CDP_PORT} failed to open`));
  };
});

let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
  const data = JSON.parse(ev.data);
  if (data.id !== undefined && pending.has(data.id)) {
    pending.get(data.id)(data);
    pending.delete(data.id);
  } else if (data.method) events.push(data);
};
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });

const {
  result: { targetInfos }
} = await send('Target.getTargets');
// Use the initial about:blank target as our tab.
const target = targetInfos.find((t) => t.type === 'page');
const {
  result: { sessionId }
} = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });

const navigate = (url) => send('Page.navigate', { url }, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);

const errorsFor = (sinceTs) => events.filter((e) => e.params?.timestamp >= sinceTs);
const thrown = (sinceTs) =>
  errorsFor(sinceTs).filter((e) => e.method === 'Runtime.exceptionThrown');
const statusOf = (selector, attrs) =>
  send(
    'Runtime.evaluate',
    {
      expression: `JSON.stringify([...document.querySelectorAll(${JSON.stringify(selector)})].map(n => ({${attrs.map((a) => `[${JSON.stringify(a)}]: n.getAttribute(${JSON.stringify(a)})`).join(',')}})))`,
      returnByValue: true
    },
    sessionId
  ).then((r) => JSON.parse(r.result.result.value));

const results = { immediate: null, delay: null, uaEcho: null };

// ---- Scenario 0: the remaining two immediate classes (reading / notfunction) ----
const immediateAll = [];
for (const [flag, want] of [
  ['reading', "Cannot read properties of undefined (reading 'fdtFixtureProperty')"],
  ['notfunction', 'document.body.fdtFixtureNotAFunction is not a function'],
  ['minified', 'a is not defined']
]) {
  const from = Date.now();
  await navigate(`${SITE}/fdt/?fdt-error=${flag}`);
  await sleep(1800);
  const got = thrown(from).map((e) => e.params.exceptionDetails?.exception?.description || '');
  immediateAll.push({
    flag,
    got: got.filter(Boolean).find((m) => m.includes(want)) || null,
    raw: got[0] || null
  });
}
results.immediateExtras = immediateAll;

// ---- Scenario 0b: ?nowprocket must bypass optimization entirely -------------------
// The bypass check uses a URL that still carries a fixture flag: the proof is that the
// flag's own script ENQUEUES as a plain script (WordPress flow) while WP Rocket's
// optimization pipeline — the thing the bypass removes — adds nothing.
const fromNp = Date.now();
await navigate(`${SITE}/fdt/?fdt-error=reference&nowprocket=1`);
await sleep(1500);
const np = await send(
  'Runtime.evaluate',
  {
    expression: `JSON.stringify({
  delayed: [...document.querySelectorAll('script[type$="rocketlazyloadscript"]')].length,
  plain: [...document.querySelectorAll('script[src*="fdt-error-reference"]')].length,
  footprinted: document.documentElement.outerHTML.includes('Performance optimized by WP Rocket'),
})`,
    returnByValue: true
  },
  sessionId
);
results.nowprocket = JSON.parse(np.result.result.value);

// ---- Scenario 1: immediate load-time ReferenceError -----------------------------
let t0 = Date.now();
await navigate(`${SITE}/fdt/?fdt-error=reference`);
await sleep(2500);
const im = thrown(t0).map((e) => e.params);
results.immediate = im.map((e) => ({
  text: e.exceptionDetails?.exception?.description || e.exceptionDetails?.text,
  cls: e.exceptionDetails?.exception?.className
}));

// ---- Scenario 2: delay queue throws on interaction ------------------------------
events.length = 0;
t0 = Date.now() / 1000;
await navigate(`${SITE}/fdt/?fdt-delay=1`);
await sleep(2500);
const beforeStatus = await statusOf('[data-fdt-delay], [data-rocket-status]', [
  'data-rocket-status',
  'data-fdt-delay'
]);
// The definer must sit in the delay queue at this point: served as a held
// script (type moved off the runtime value, src rewritten into the plugin's
// data attribute), never as a plain load-time script.
const heldBefore = await send(
  'Runtime.evaluate',
  {
    expression: `JSON.stringify({
  definerNotHeld: [...document.querySelectorAll('script[src*="fdt-delayed-definer"]')].length,
  definerHeld: [
    ...document.querySelectorAll(
      'script[type$="rocketlazyloadscript"][data-rocket-src*="fdt-delayed-definer"]'
    )
  ].length,
  definedBefore: typeof window.fdtDelayTypedDependency,
})`,
    returnByValue: true
  },
  sessionId
).then((r) => JSON.parse(r.result.result.value));
const thrownBefore = thrown(t0).length;
// a real user action: move + press + release (the runtime listens on mousemove & co.)
await send('Input.dispatchMouseEvent', { type: 'mousemove', x: 200, y: 200 }, sessionId);
await send(
  'Input.dispatchMouseEvent',
  { type: 'mousePressed', x: 200, y: 200, button: 'left', clickCount: 1 },
  sessionId
);
await send(
  'Input.dispatchMouseEvent',
  { type: 'mouseReleased', x: 200, y: 200, button: 'left', clickCount: 1 },
  sessionId
);
await sleep(3500);
const afterStatus = await statusOf('[data-rocket-status], [data-fdt-delay]', [
  'data-rocket-status',
  'data-fdt-delay'
]);
const definedAfter = await send(
  'Runtime.evaluate',
  { expression: 'typeof window.fdtDelayTypedDependency', returnByValue: true },
  sessionId
).then((r) => r.result.result.value);
const delayErrs = thrown(t0).map(
  (e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text
);
results.delay = {
  beforeStatus,
  heldBefore,
  afterStatus,
  thrownBeforeInteraction: thrownBefore,
  errorsAfter: delayErrs,
  definedAfter
};

// ---- Scenario 3: the uncached UA-echo endpoint (the per-request network truth) ----
// One pass with the browser's own UA, one with an override: a live per-request echo is
// only proven when the body CHANGES with the requesting UA — a stored or HTTP-cached
// copy could not. The override happens here (after the other scenarios) so it cannot
// leak into their assertions.
const UA_OVERRIDE =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';
await send('Network.enable', {}, sessionId);
const readEcho = async () => {
  const r = await send(
    'Runtime.evaluate',
    {
      expression: `JSON.stringify({
  text: document.body.innerText,
  footprint: document.documentElement.outerHTML.includes('Performance optimized by WP Rocket'),
  ua: navigator.userAgent,
})`,
      returnByValue: true
    },
    sessionId
  );
  return JSON.parse(r.result.result.value);
};
await navigate(`${SITE}/wp-json/fdt/v1/ua-echo`);
await sleep(1200);
results.uaEcho = { marker: 'fdt-ua-echo', browser: await readEcho(), overridden: null };
await send('Network.setUserAgentOverride', { userAgent: UA_OVERRIDE }, sessionId);
await navigate(`${SITE}/wp-json/fdt/v1/ua-echo`);
await sleep(1200);
results.uaEcho.overridden = await readEcho();
// Restore the browser's own UA: the Priority-Elements arms below must drive the
// desktop copies (the documented baseline), not the mobile ones a lingering override
// would select (`wp_is_mobile()` reads the header and the plugin keys the cache on it).
await send('Network.setUserAgentOverride', { userAgent: results.uaEcho.browser.ua }, sessionId);

// ---- Scenario 4: the Priority-Elements beacon knobs (P1.1 fixture flags) ---------
// The beacon's inline config is the assert surface: it is literal text in the served
// HTML, so the check is independent of the delay queue (the config script hides from
// runtime reads until WP Rocket's delay queue runs it). Each flagged URL is its own
// cached copy; the flags force state per request, so nothing here persists. One
// baseline arm plus one flags-combine arm proves "flags combine".
const PROBE_URLS = [
  'baseline',
  `${SITE}/fdt-beacon/`,
  'fonts-on',
  `${SITE}/fdt-beacon/?fdt-fonts-on=1`,
  'oci-off',
  `${SITE}/fdt-beacon/?fdt-oci-off=1`,
  'combined',
  `${SITE}/fdt-beacon/?fdt-oci-off=1&fdt-fonts-on=1`
];
const readBeaconConfig = async () => {
  const r = await send(
    'Runtime.evaluate',
    {
      expression: `JSON.stringify({
  config: (() => {
    const m = document.documentElement.outerHTML.match(/rocket_beacon_data\\s*=\\s*(\\{.*?\\})<\\/script>/s);
    return m ? m[1] : null;
  })(),
  isMobile: window.rocket_beacon_data?.is_mobile ?? null,
  noveltyHint: !!document.querySelector('link[rel=novelty][href*="ExampleInvalidHost.invalid"]'),
})`,
      returnByValue: true
    },
    sessionId
  );
  return JSON.parse(r.result.result.value);
};
results.priorityElements = {};
for (let i = 0; i < PROBE_URLS.length; i += 2) {
  await navigate(PROBE_URLS[i + 1]);
  await sleep(1200);
  const served = await readBeaconConfig();
  let config = null;
  try {
    config = served.config ? JSON.parse(served.config) : null;
  } catch {
    // A malformed config is still a finding: the arm must fail its assert below.
    config = null;
  }
  results.priorityElements[PROBE_URLS[i]] = {
    status: config?.status ?? null,
    isMobile: Boolean(served.isMobile),
    atlasElementPayloads: 'elements' in (config ?? {}),
    noveltyHint: served.noveltyHint
  };
}

// ---- Scenario 5: the versionless generator arm (the WPR meta without the stamp) ---
// `?fdt-wpr-versionless=1` serves WP Rocket's generator meta with no version stamp via
// the plugin's own filter; every other footprint stays. Both arms read the meta + the
// cache comment off the served HTML, one baseline copy and one flagged copy.
const readGeneratorStamp = async () => {
  const r = await send(
    'Runtime.evaluate',
    {
      expression: `JSON.stringify((() => {
  // The cache debug comment rides AFTER the document element (the plugin writes it
  // behind </html>), so it is invisible to document.documentElement.outerHTML: the
  // probe walks the document's own child nodes.
  const m = document.documentElement.outerHTML.match(/<meta name="generator" content="WP Rocket([^"]*)"\\s*data-wpr-features="([^"]*)"/);
  const cacheComment = Array.from(document.childNodes).some(
    (n) => n.nodeType === Node.COMMENT_NODE && n.data.includes('This website is like a Rocket')
  );
  return {
    meta: m ? { versionTail: m[1], features: m[2] } : null,
    cacheComment,
    wpCoreMeta: document.documentElement.outerHTML.includes('name="generator" content="WordPress'),
  };
})())`,
      returnByValue: true
    },
    sessionId
  );
  return JSON.parse(r.result.result.value);
};
results.generatorStamp = {};
for (const armName of ['baseline', 'versionless']) {
  const url = armName === 'baseline' ? `${SITE}/fdt/` : `${SITE}/fdt/?fdt-wpr-versionless=1`;
  await navigate(url);
  await sleep(1500);
  results.generatorStamp[armName] = await readGeneratorStamp();
}

// ---- Report ---------------------------------------------------------------------
console.log(JSON.stringify(results, null, 2));

let ok = true;
const fail = (msg) => {
  ok = false;
  console.error('FAIL: ' + msg);
};
const imm = results.immediate.find(
  (e) => e.text?.includes('ReferenceError') && e.text?.includes('is not defined')
);
if (!imm) fail('scenario 1: no immediate ReferenceError captured');
const refMsg = results.delay.errorsAfter.find(
  (m) => m?.includes('ReferenceError') && m?.includes('fdtDelayTypedDependency')
);
if (results.delay.thrownBeforeInteraction !== 0)
  fail('scenario 2: errors before the interaction — delay queue did not hold the scripts');
if (!refMsg) fail('scenario 2: the delayed ReferenceError for fdtDelayTypedDependency never fired');
if (results.delay.heldBefore.definerNotHeld !== 0 || results.delay.heldBefore.definerHeld < 1)
  fail(
    'scenario 2: the definer is not held in the delay queue as a last delayed script ' +
      `(served ${JSON.stringify(results.delay.heldBefore)})`
  );
if (results.delay.heldBefore.definedBefore !== 'undefined')
  fail(
    `scenario 2: the definer already defined the name before the interaction (${results.delay.heldBefore.definedBefore}) — the throw would not be real`
  );
if (results.delay.definedAfter !== 'function')
  fail(
    `scenario 2: the definer never defined fdtDelayTypedDependency after the interaction (${results.delay.definedAfter})`
  );
if (!results.delay.afterStatus.some((s) => s['data-rocket-status'] === 'executed'))
  fail('scenario 2: no data-rocket-status="executed" observed after interaction');
if (!results.delay.afterStatus.some((s) => s['data-fdt-delay'] === 'executed'))
  fail('scenario 2: the benign delayed script never tagged data-fdt-delay="executed"');
if (!results.immediateExtras.every((e) => e.got))
  fail(
    'scenario 0: reading/notfunction immediate errors incomplete: ' +
      JSON.stringify(results.immediateExtras)
  );
if (results.nowprocket.delayed !== 0 || results.nowprocket.footprinted)
  fail('scenario 0b: ?nowprocket did not bypass optimization');
if (results.nowprocket.plain < 1)
  fail('scenario 0b: the flagged script never enqueued as a plain script under ?nowprocket');
if (!results.uaEcho.browser.text.startsWith(results.uaEcho.marker))
  fail('scenario 3: the echo body does not open with the fdt-ua-echo marker');
if (!results.uaEcho.browser.text.includes(results.uaEcho.browser.ua))
  fail('scenario 3: the echo does not carry the requesting browser UA');
if (results.uaEcho.browser.footprint)
  fail('scenario 3: the echo carried a WP Rocket footprint — wp-json must stay out of the cache');
if (!results.uaEcho.overridden.text.includes(UA_OVERRIDE))
  fail('scenario 3: the echo stayed static across a UA override — not per-request truth');
if (results.uaEcho.overridden.footprint)
  fail('scenario 3: the overriden echo carried a WP Rocket footprint');

// Scenario 4 verdict. The knobs change the beacon's inline config, and the beacon only
// injects while a row is missing for the URL+device (the fonts factory always joins on
// its flag). The smoke cannot reset the site's row tables (browser-only contract), so
// per-arm config ABSENCE is a legitimate row-state outcome and only RULE VIOLATIONS
// fail. Any config that exists must match its arm's exact rules; absence is reported.
{
  const arms = results.priorityElements;
  const armNames = Object.keys(arms);
  const arm = (name) => arms[name];
  if (armNames.some((n) => arms[n].isMobile))
    fail(
      'scenario 4: arms served mobile copies — the UA override must be restored before this scenario'
    );
  const assertStatusShape = (name, status) => {
    if (typeof status !== 'object' || status === null)
      fail(`scenario 4: ${name} status is not an object: ${JSON.stringify(status)}`);
  };
  const check = (name, want) => {
    const { status, atlasElementPayloads, noveltyHint } = arm(name);
    if (status === null) {
      console.log(`scenario 4: ${name} served no beacon config (row state applied for this arm)`);
      return;
    }
    assertStatusShape(name, status);
    for (const p of want) {
      if (!p.match(status, atlasElementPayloads, noveltyHint ?? false)) {
        fail(
          `scenario 4: ${name} — ${p.message ?? p.name} (served ${JSON.stringify({ status, atlasElementPayloads, noveltyHint })})`
        );
      }
    }
  };
  if (arm('baseline').noveltyHint !== true)
    fail('scenario 4: the inert external-origin novelty link is missing from the beacon page');
  if (armNames.every((n) => arms[n].status === null))
    console.log(
      'scenario 4: note — no arm served a beacon config: the row state is fully applied; the knobs assert fully on the pending state (a fresh stack: `docker/scripts/reset.sh` returns to it)'
    );
  check('baseline', [
    {
      name: 'status',
      message: 'baseline status',
      match: (s) =>
        s.atf === true &&
        s.lrc === true &&
        s.preconnect_external_domain === true &&
        !('preload_fonts' in s)
    },
    {
      name: 'payloads',
      message: 'baseline carries the atf elements payload',
      match: (_s, payloads) => payloads === true
    }
  ]);
  check('fonts-on', [
    {
      name: 'status',
      message: 'fonts-on must set preload_fonts true',
      match: (s) =>
        s.preload_fonts === true &&
        s.lrc === true &&
        s.preconnect_external_domain === true &&
        s.atf === true
    },
    {
      name: 'payloads',
      message: 'fonts-on keeps the atf elements payload',
      match: (_s, payloads) => payloads === true
    }
  ]);
  check('oci-off', [
    {
      name: 'status',
      message: 'oci-off must omit the atf key entirely',
      match: (s) => !('atf' in s) && s.lrc === true && s.preconnect_external_domain === true
    },
    {
      name: 'payloads',
      message: 'oci-off drops the atf elements payload with the factory',
      match: (_s, payloads) => payloads === false
    }
  ]);
  check('combined', [
    {
      name: 'status',
      message: 'combined must answer both flags',
      match: (s) =>
        !('atf' in s) &&
        s.preload_fonts === true &&
        s.lrc === true &&
        s.preconnect_external_domain === true
    }
  ]);
}

// Scenario 5 verdict: the baseline copy stamps the version, the flagged copy must serve
// the same meta WITHOUT a version tail — the fixture arm the versionless-detection
// rounds drive — and both stay cached pages (the flag only removes the stamp).
{
  const baseline = results.generatorStamp?.baseline;
  const flagged = results.generatorStamp?.versionless;
  if (!baseline || baseline.meta === null || !/\d/.test(baseline.meta.versionTail))
    fail(
      `scenario 5: the baseline /fdt/ copy does not carry a versioned generator meta: ${JSON.stringify(baseline)}`
    );
  if (!baseline.cacheComment)
    fail('scenario 5: the baseline copy is not a cached page (no cache debug comment)');
  if (!flagged || flagged.meta === null)
    fail(
      `scenario 5: the flagged copy lost the WP Rocket generator meta entirely: ${JSON.stringify(flagged)}`
    );
  if (/\d/.test(flagged.meta?.versionTail ?? ''))
    fail(`scenario 5: the flagged copy still carries a version stamp: ${JSON.stringify(flagged)}`);
  if (!flagged.meta?.features)
    fail('scenario 5: the flagged copy lost the data-wpr-features footprint list');
  if (!flagged.cacheComment)
    fail('scenario 5: the flagged copy is not a cached page (no cache debug comment)');
}

console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
process.exit(ok ? 0 : 1); // the exit hook kills Chrome; the WebSocket dies with the process
