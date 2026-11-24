import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'wxt';
import type { FirefoxDataCollectionPermissions, WxtHooks } from 'wxt';
import { toolbarIconMap } from './lib/branding/icons';
import { DATA_CONSENT_TYPE } from './lib/data-consent/consent';
import { URL_PATTERNS } from './lib/wp-rocket/constants';
import {
  LAZYLOAD_RUNTIME_FILE,
  SIMULATION_DATA_PATH
} from './lib/wp-rocket-simulation/simulation-data';
import {
  NOTICES_FILE,
  createNoticeCollector,
  mitLicenseText,
  type PackageNotice
} from './scripts/third-party-notices';
import { assertCleanSources } from './scripts/sources-zip-guard';

// Extension name rendered in the browser UI.
const NAME = 'WPR Front Debugging Tool';

/**
 * Firefox add-on identity (owner-chosen GUID: no control over a wp-media
 * domain for an `id@domain` form). A stable id is what gives the add-on
 * `storage.sync` (Firefox refuses it to a temporary add-on without one) and
 * keeps users' synced settings across updates; it is permanent once
 * published on AMO — never change it.
 */
export const FIREFOX_ADDON_ID = '{f6991cc9-09e3-43d0-a6dd-4aae5f676452}';

/** Explicit supported Firefox floor (owner-chosen). */
export const FIREFOX_MIN_VERSION = '150.0';

/**
 * Firefox's built-in data-collection consent (required for new AMO
 * submissions; Firefox 140+, below the floor). Collection here means data
 * leaving the browser for a server other than the page's own site.
 *
 * - `required: ['none']`: installing collects nothing (Firefox shows no data
 *   line at install).
 * - `optional: ['browsingActivity']`: two features send the current page's
 *   address off-device, each only on the user's explicit command — the
 *   RUCSS Tester's start (the address minus fragment and credentials, the
 *   Mobile/Home flags and the user's safelist, to WP Rocket's RUCSS
 *   service; no page content, no cookies) and the PageSpeed Insights views
 *   (the address in a `pagespeed.web.dev` tab or frame). Every such send
 *   is gated: the RUCSS start (checked in the panel and again by the
 *   background before the request), the PageSpeed Insights tab (opened by
 *   the background only once allowed) and the analysis page's two
 *   comparison frames (loaded only once allowed). Each asks at its first
 *   use (`lib/data-consent`, the consent page) and checks on every use, so
 *   a grant revoked in the Add-ons Manager is asked again.
 * - Not declared, because nothing about the user travels: the Known
 *   Conflicts DB and the latest exclusion list are plain downloads of
 *   public data (a fixed address, no query, no body); every other request
 *   (reloads, header reads, the beacon test, Exclusion Builder rewrites)
 *   stays between the browser and the site being debugged; no analytics,
 *   telemetry or crash reports exist (`technicalAndInteraction` none).
 */
const FIREFOX_DATA_COLLECTION = {
  required: ['none'],
  optional: [DATA_CONSENT_TYPE]
} satisfies FirefoxDataCollectionPermissions;

/** The clobber-proof extension namespace module `@wxt-dev/browser` resolves to. */
const EXTENSION_API_MODULE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'utils/extension-api/index.ts'
);

/** The Chromium resolver + pin that module calls at load (`utils/extension-api/chromium.ts`). */
const CHROMIUM_EXTENSION_API_MODULE = path.join(path.dirname(EXTENSION_API_MODULE), 'chromium.ts');

/** The messaging library's extension entry: it reads the bare `chrome` global on every call. */
const MESSAGING_ENTRY = /[\\/]@webext-core[\\/]messaging[\\/]dist[\\/]index\.mjs(\?.*)?$/;

/**
 * The statements prepended to the messaging library's entry so the genuine
 * namespace is the world's own `chrome` before the library runs — it reads
 * that global at each call and the shared messenger reads it once at load.
 *
 * Chromium: the pin is called in the library's own module body, not only
 * through an import of the namespace module. Module evaluation already runs
 * imports first, but a bundle split can put the library in a chunk apart
 * from the namespace module (a page that uses `browser` without messaging
 * moves that module to a chunk the two share); the call keeps "every bundle
 * reading `chrome` pins it first" true of the library's own chunk, whatever
 * the split. The call is idempotent: a world that already owns `chrome` (an
 * extension page, or a second call) is left alone.
 * Firefox: no pin exists (`chrome` is the browser's own alias there); the
 * namespace module is imported first, as every other user does.
 *
 * @param browser - The target browser WXT builds for.
 * @returns The source to prepend, newline-terminated.
 */
export function messagingPrelude(browser: string): string {
  if (browser === 'firefox') return `import ${JSON.stringify(EXTENSION_API_MODULE)};\n`;
  return (
    `import { chromiumExtensionApi, pinChromeNamespace } from ${JSON.stringify(CHROMIUM_EXTENSION_API_MODULE)};\n` +
    'pinChromeNamespace(globalThis, chromiumExtensionApi(globalThis));\n'
  );
}

/** The bare specifier every messaging user imports (the `page` subpath is a separate entry). */
const MESSAGING_SPECIFIER = '@webext-core/messaging';

/**
 * The build failure for a pass that imported the messaging library but never
 * prepended its prelude — the entry was renamed or moved, so
 * {@link MESSAGING_ENTRY} no longer matches and bundles would read `chrome`
 * unpinned with nothing else failing.
 *
 * @param imported - Whether this pass resolved {@link MESSAGING_SPECIFIER}.
 * @param transformed - Whether this pass prepended the prelude to the entry.
 * @returns The error message, or `null` when the pass is consistent.
 */
export function missingMessagingEntryError(imported: boolean, transformed: boolean): string | null {
  if (!imported || transformed) return null;
  return (
    `[WPR FDT] ${MESSAGING_SPECIFIER} was imported but its entry was never transformed: ` +
    `no module id matched ${String(MESSAGING_ENTRY)} (expected …/@webext-core/messaging/dist/index.mjs). ` +
    "Update MESSAGING_ENTRY in wxt.config.ts to the package's new entry."
  );
}

/**
 * Make the messaging library pin the extension namespace before its body runs
 * (see {@link messagingPrelude}). Prepending is what guarantees the order:
 * the prelude's import evaluates before the module, its call before the
 * library's own statements. A build pass that imports the library without
 * transforming its entry fails at `buildEnd` ({@link missingMessagingEntryError});
 * passes that never import it, and dev serving (modules transform lazily), are
 * never checked. WXT creates one plugin per pass (its `vite` config runs per
 * build), and `buildStart` resets the record anyway.
 *
 * @param browser - The target browser WXT builds for (picks the prelude).
 * @returns The Vite plugin.
 */
export function extensionApiBeforeMessaging(browser: string): Plugin {
  const prelude = messagingPrelude(browser);
  let isBuild = false;
  let imported = false;
  let transformed = false;
  return {
    name: 'wpr-fdt:extension-api-before-messaging',
    enforce: 'pre',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    buildStart() {
      imported = false;
      transformed = false;
    },
    resolveId(source) {
      if (source === MESSAGING_SPECIFIER) imported = true;
      return null;
    },
    transform(code, id) {
      if (!MESSAGING_ENTRY.test(id)) return null;
      transformed = true;
      return { code: `${prelude}${code}`, map: null };
    },
    buildEnd(error) {
      // A pass already failing reports its own error, not this one.
      if (!isBuild || error) return;
      const message = missingMessagingEntryError(imported, transformed);
      if (message) this.error(message);
    }
  };
}

/** The packaged simulation folder (the data file's), where each LazyLoad runtime ships. */
const SIMULATION_PACKAGE_DIR = SIMULATION_DATA_PATH.slice(0, SIMULATION_DATA_PATH.lastIndexOf('/'));

/**
 * The notices of the packaged LazyLoad runtimes: each is vanilla-lazyload's
 * release build as WP Rocket packages it (MIT, verlok/vanilla-lazyload),
 * copied from `public/` rather than bundled from npm, so the build's
 * collector cannot see it. One entry per packaged version, read from the
 * folder that ships it (`<package dir>/…/<version>/<runtime file>`).
 *
 * @param publicDir - The `public/` folder.
 * @returns One notice per packaged runtime version.
 */
export function lazyloadRuntimeNotices(publicDir: string): PackageNotice[] {
  const packageDir = path.join(publicDir, SIMULATION_PACKAGE_DIR);
  const runtimes = readdirSync(packageDir, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((entry) => path.posix.basename(entry) === LAZYLOAD_RUNTIME_FILE)
    .sort();
  return runtimes.map((entry) => ({
    name: 'vanilla-lazyload',
    version: path.posix.basename(path.posix.dirname(entry)),
    license: 'MIT',
    text: mitLicenseText('Copyright (c) 2015 Andrea Verlicchi'),
    files: `${SIMULATION_PACKAGE_DIR}/${entry}`
  }));
}

/**
 * Licence texts of bundled packages whose npm tarball carries no licence
 * file, copied from the package repository at the shipped version
 * (`wxt-dev/wxt` tag `wxt-v0.21.5`, `LICENSE`); the notices build fails for
 * any other such package until it gets a row here.
 */
const MISSING_LICENSE_TEXTS: Readonly<Record<string, string>> = {
  wxt: mitLicenseText('Copyright (c) 2023 Aaron')
};

/**
 * Packages whose CSS ships through the CSS pipeline (Tailwind's preflight and
 * generated utilities), which no chunk lists as a module: declared here and
 * cross-checked against the licence banners in the built CSS, so the build
 * fails when the two disagree.
 */
export const CSS_PIPELINE_PACKAGES = ['tailwindcss'] as const;

/**
 * Records the npm packages every build pass emits, for the notices file
 * written into the output once all passes are done (`build:publicAssets`).
 */
const notices = createNoticeCollector();

/**
 * The build hooks that write the notices file: the collector starts empty on
 * each build, and the file is added once every entrypoint pass (and its
 * worker sub-builds) is done — `build:publicAssets` runs after the last
 * one. Production builds only: a dev session's passes are partial. A build
 * that recorded no package fails rather than shipping an empty notice.
 */
export const noticesHooks = {
  'build:before': () => {
    notices.reset();
  },
  'build:publicAssets': (wxt, files) => {
    if (wxt.config.command !== 'build') return;
    if (notices.empty) throw new Error(`[WPR FDT] ${NOTICES_FILE}: no bundled package recorded`);
    files.push({
      relativeDest: NOTICES_FILE,
      contents: notices.render(
        lazyloadRuntimeNotices(wxt.config.publicDir),
        MISSING_LICENSE_TEXTS,
        CSS_PIPELINE_PACKAGES.map((name) => path.join(wxt.config.root, 'node_modules', name))
      )
    });
  }
} satisfies Partial<WxtHooks>;

/**
 * The sources-zip hook: refuses the Firefox sources zip while the checkout
 * holds untracked, non-ignored files, which the excludes below (a mirror of
 * `.gitignore`) cannot know about and would ship to reviewers. It runs on
 * `zip:start` (after the build, before WXT writes any zip) and only when
 * the run zips sources, so a refused run never leaves a new extension zip
 * beside an older sources zip in the output folder.
 */
export const sourcesZipHooks = {
  'zip:start': (wxt) => {
    if (wxt.config.zip.zipSources) assertCleanSources(wxt.config.zip.sourcesRoot);
  }
} satisfies Partial<WxtHooks>;

/**
 * Paths the Firefox sources zip (what AMO reviewers rebuild from) leaves out,
 * on top of WXT's defaults (`node_modules`, `.output`, test files, dot
 * files): the store listing folder (listing copy and images, never build
 * input) and every git-ignored machine-state path a dot-free glob would
 * otherwise pick up from a working checkout — coverage and e2e reports,
 * logs, bundle stats, the docker site's state, certificates and WP Rocket
 * plugin zips, and editor files (the unit test keeps this list a superset
 * of `.gitignore`). The store zips never hold any of it (they pack the
 * build output only).
 */
export const SOURCES_ZIP_EXCLUDES = [
  'store/**',
  'coverage/**',
  '**/test-results/**',
  '**/playwright-report/**',
  'logs/**',
  '**/*.log',
  '**/*-debug.log*',
  '**/yarn-error.log*',
  'stats.html',
  'stats-*.json',
  'docker/wpr/**',
  'docker/certs/**',
  'docker/state/**',
  '**/*.suo',
  '**/*.ntvs*',
  '**/*.njsproj',
  '**/*.sln',
  '**/*.sw?'
] as const;

export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  zip: { excludeSources: [...SOURCES_ZIP_EXCLUDES] },
  hooks: { ...noticesHooks, ...sourcesZipHooks },
  vite: (env) => ({
    plugins: [tailwindcss(), extensionApiBeforeMessaging(env.browser), notices.plugin()],
    // Workers build as ES modules (Vite's default `iife` cannot split code):
    // the code highlighter's worker fetches its CSS/HTML grammar chunk on the
    // first block that needs it. Every worker is spawned `type: 'module'`
    // (module workers and `import()` in them: Chromium 80+, Firefox 114+).
    // The notices plugin runs in worker sub-builds too: the highlighter's
    // worker bundles shiki and its grammars.
    worker: { format: 'es', plugins: () => [notices.plugin()] },
    resolve: {
      // Every runtime `browser` (ours, WXT's, its storage's) comes from
      // `@wxt-dev/browser`, whose lookup a page's DOM can forge in a content
      // script world (created after parse, or at document_start under a
      // root element named so); the project's resolver
      // replaces it (`utils/extension-api`). Exact match: the package has no
      // runtime subpaths, and its types stay the package's. Build-only: the
      // test runner keeps WXT's fake browser.
      alias: [{ find: /^@wxt-dev\/browser$/, replacement: EXTENSION_API_MODULE }]
    }
  }),
  // Function form: WXT passes the target browser, so Firefox-only keys stay out
  // of the Chromium manifest.
  manifest: ({ browser }) => ({
    name: NAME,
    // `description` and `version` are filled from package.json by default.
    // Chromium floor per project policy; see AGENTS.md (Chromium-based primary target).
    minimum_chrome_version: '145',
    // The toolbar button, declared without a popup: it carries the per-tab
    // detection badge and the action-menu rows (`contextMenus` context
    // `action`); a left click opens the on-page command palette, else the
    // options page (`onClicked` fires only while no popup is declared — a
    // popup would silence it). Declared here because WXT only emits the key
    // for a popup entrypoint; the MV2 build gets it renamed to
    // `browser_action`. This tooltip names the extension: each badged tab gets
    // its own, naming the dot's state, and clears write this one back. Its
    // icon is pinned to the full-bleed toolbar sizes: left to the manifest
    // `icons`, a high-density toolbar could pick a padded (store-layout) one.
    action: { default_title: NAME, default_icon: toolbarIconMap() },
    // Firefox only: the add-on id (see FIREFOX_ADDON_ID), the supported
    // floor — without it any old Firefox could install a build it was never
    // verified on — and the data-collection declaration (see
    // FIREFOX_DATA_COLLECTION).
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: FIREFOX_ADDON_ID,
          strict_min_version: FIREFOX_MIN_VERSION,
          data_collection_permissions: FIREFOX_DATA_COLLECTION
        }
      },
      // Firefox only: a simulated page's LazyLoad runtime request is
      // redirected (`webRequest`) to its packaged copy, and a page may load
      // an extension file only when it is web-accessible — so the packaged
      // runtimes (only those: never the data file) are. Firefox serves them at
      // a random per-install `moz-extension://<uuid>/` origin, so a page cannot
      // guess them blindly; but the MV2 manifest flattens this entry to a plain
      // resource list (`matches` is not applied), so any page that learns the
      // UUID (e.g. from a redirected request) can load them (owner-accepted).
      // Chromium answers the request inside its debugger session, so its
      // build exposes nothing.
      web_accessible_resources: [
        {
          resources: [`${SIMULATION_PACKAGE_DIR}/*/${LAZYLOAD_RUNTIME_FILE}`],
          matches: [...URL_PATTERNS]
        }
      ]
    }),
    // Least privilege — every permission has a concrete consumer somewhere in the
    // ported feature set; each is added/removed by the phase that owns that feature.
    permissions: [
      // Options and per-site choices (sync), saved exclusion sets, panel layout,
      // tool settings and the cached data files (local), builder sessions (session).
      'storage',
      // Hourly checks of the two public data files: the Known Conflicts DB is
      // fetched on every alarm (also at browser start + manual update); WP
      // Rocket's latest exclusion list refreshes only 24 h after a success.
      'alarms',
      // Read main-frame response headers for the Server / Known Platform cards;
      // Firefox also rewrites builder session documents through
      // `filterResponseData` and redirects the simulated LazyLoad runtime to
      // its packaged copy (both with `webRequestBlocking` below).
      'webRequest',
      // Side-by-Side, PSI Side-by-Side, Exclusion Builder, manual KC DB update.
      'contextMenus',
      // The exclusion builder overlay and the on-page command palette's view
      // are runtime content scripts, and the beacon test runner an unlisted
      // script (none in the manifest, so their code never loads with a page):
      // opening one, or a test's first run, injects its script into the tab's
      // top frame (`scripting.executeScript`). No install warning; it acts
      // only within the host permissions below.
      'scripting',
      // Simulated-device sessions (compare overlay): one tab-scoped session rule
      // rewrites `user-agent` on document requests. The WithHostAccess variant —
      // no install-time warning, rules act only within the host permissions
      // below. Both engines implement the mechanism (BCD: tabIds 92/113,
      // modifyHeaders 86/113); Firefox's MV2 build folds those host permissions
      // into `permissions` itself, and an older Firefox without the namespace
      // degrades through the runtime's feature detection.
      'declarativeNetRequestWithHostAccess',
      // Exclusion-builder sessions, Chromium builds only: the debugger
      // protocol's `Fetch` domain rewrites a tab's top-level documents before
      // parse — the only Chromium mechanism that can (Firefox uses its
      // response stream filter, so its manifest never carries this). Install
      // warnings (Chrome permissions list, read 2026-10-20): "Access the page
      // debugger backend" + "Read and change all your data on all websites";
      // while attached, Chrome shows its "started debugging this browser"
      // infobar. Accepted by the owner 2026-10-20, on the condition that store
      // review does not block it.
      ...(browser === 'firefox' ? [] : ['debugger']),
      // Exclusion-builder sessions on Firefox: `webRequest.filterResponseData`
      // (the streaming rewrite of an applied tab's top-level documents) needs a
      // blocking `webRequest` listener, which MV2 gates behind this permission
      // (MDN). Firefox build only — Chromium's MV3 build has no body filter.
      ...(browser === 'firefox' ? ['webRequestBlocking'] : [])
    ],
    // Required for `webRequest` main-frame header capture. `tabs` is intentionally NOT requested; a
    // feature that would need it must first verify it cannot work without it.
    // Same list the runtime listeners use — single-sourced in lib/wp-rocket/constants.
    // It also covers the RUCSS test's one request, sent by the background only
    // when the user starts a test, to the fixed WP Rocket service
    // `https://mega.wp-rocket.me/support/wpr-rucss-v2.php` (never another
    // address): the page's address, the mobile/home flags and the safelist —
    // never page content. From the background, so no page CSP or CORS applies.
    host_permissions: [...URL_PATTERNS]
  })
});
