import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'wxt';
import { URL_PATTERNS } from './lib/wp-rocket/constants';
import {
  LAZYLOAD_RUNTIME_FILE,
  SIMULATION_DATA_PATH
} from './lib/wp-rocket-simulation/simulation-data';

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

/** The clobber-proof extension namespace module `@wxt-dev/browser` resolves to. */
const EXTENSION_API_MODULE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'utils/extension-api/index.ts'
);

/** The messaging library's extension entry: it reads the bare `chrome` global on every call. */
const MESSAGING_ENTRY = /[\\/]@webext-core[\\/]messaging[\\/]dist[\\/]index\.mjs(\?.*)?$/;

/**
 * Make the messaging library evaluate the extension namespace module first.
 * That module pins the genuine namespace as the world's own `chrome` (see
 * `utils/extension-api/chromium.ts`) — the library reads that global at each
 * call and the shared messenger reads it once at load, so the pin must run
 * before both. Prepending the import is what guarantees the order: module
 * evaluation runs a module's imports before its body, whatever the importer.
 *
 * @returns The Vite plugin.
 */
export function extensionApiBeforeMessaging(): Plugin {
  return {
    name: 'wpr-fdt:extension-api-before-messaging',
    enforce: 'pre',
    transform(code, id) {
      if (!MESSAGING_ENTRY.test(id)) return null;
      return { code: `import ${JSON.stringify(EXTENSION_API_MODULE)};\n${code}`, map: null };
    }
  };
}

/** The packaged simulation folder (the data file's), where each LazyLoad runtime ships. */
const SIMULATION_PACKAGE_DIR = SIMULATION_DATA_PATH.slice(0, SIMULATION_DATA_PATH.lastIndexOf('/'));

export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  vite: () => ({
    plugins: [tailwindcss(), extensionApiBeforeMessaging()],
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
    // `action`); a left click opens nothing. Declared here because WXT only
    // emits the key for a popup entrypoint; the MV2 build gets it renamed to
    // `browser_action`. The tooltip names the extension.
    action: { default_title: NAME },
    // Firefox only: the add-on id (see FIREFOX_ADDON_ID) and the supported
    // floor — without it any old Firefox could install a build it was never
    // verified on.
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: { id: FIREFOX_ADDON_ID, strict_min_version: FIREFOX_MIN_VERSION }
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
      // Options (`sync:options`) + Known Conflicts DB cache (`local:known-conflicts-db`).
      'storage',
      // Hourly Known Conflicts DB refresh alarm.
      'alarms',
      // Read main-frame response headers for the Server / Known Platform cards.
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
    // Required for `webRequest` main-frame header capture (the source omitted these,
    // putting that feature at risk). `tabs` is intentionally NOT requested; a
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
