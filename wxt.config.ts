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
  manifest: {
    name: NAME,
    // `description` and `version` are filled from package.json by default.
    // Chromium floor per project policy; see AGENTS.md (Chromium-based primary target).
    minimum_chrome_version: '145',
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
      'contextMenus'
    ],
    // Required for `webRequest` main-frame header capture (the source omitted these,
    // putting that feature at risk) and lets the popup read the active web tab's URL
    // without the `tabs` permission. `tabs` is intentionally NOT requested; the
    // phases that would need it must first verify they cannot work without it.
    // Same list the runtime listeners use — single-sourced in lib/wp-rocket/constants.
    host_permissions: [...URL_PATTERNS]
  }
});
