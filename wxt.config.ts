import tailwindcss from '@tailwindcss/vite';
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

/** The packaged simulation folder (the data file's), where each LazyLoad runtime ships. */
const SIMULATION_PACKAGE_DIR = SIMULATION_DATA_PATH.slice(0, SIMULATION_DATA_PATH.lastIndexOf('/'));

export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  vite: () => ({
    plugins: [tailwindcss()]
  }),
  // Function form: WXT passes the target browser, so Firefox-only keys stay out
  // of the Chromium manifest.
  manifest: ({ browser }) => ({
    name: NAME,
    // `description` and `version` are filled from package.json by default.
    // Chromium floor per project policy; see AGENTS.md (Chromium-based primary target).
    minimum_chrome_version: '145',
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
    // putting that feature at risk) and lets the popup read the active web tab's URL
    // without the `tabs` permission. `tabs` is intentionally NOT requested; the
    // phases that would need it must first verify they cannot work without it.
    // Same list the runtime listeners use — single-sourced in lib/wp-rocket/constants.
    // It also covers the RUCSS test's one request, sent by the background only
    // when the user starts a test, to the fixed WP Rocket service
    // `https://mega.wp-rocket.me/support/wpr-rucss-v2.php` (never another
    // address): the page's address, the mobile/home flags and the safelist —
    // never page content. From the background, so no page CSP or CORS applies.
    host_permissions: [...URL_PATTERNS]
  })
});
