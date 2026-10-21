import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';
import { URL_PATTERNS } from './lib/wp-rocket/constants';

// Extension name rendered in the browser UI.
const NAME = 'WPR Front Debugging Tool';

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
    // Explicit supported Firefox floor (owner-chosen): without it any old Firefox
    // could install a build it was never verified on.
    ...(browser === 'firefox' && {
      browser_specific_settings: { gecko: { strict_min_version: '150.0' } }
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
      // Simulated-device sessions (compare overlay): one tab-scoped session rule
      // rewrites `user-agent` on document requests. The WithHostAccess variant —
      // no install-time warning, rules act only within the host permissions
      // below. Both engines implement the mechanism (BCD: tabIds 92/113,
      // modifyHeaders 86/113); Firefox's MV2 build folds those host permissions
      // into `permissions` itself, and an older Firefox without the namespace
      // degrades through the runtime's feature detection.
      'declarativeNetRequestWithHostAccess',
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
    host_permissions: [...URL_PATTERNS]
  })
});
