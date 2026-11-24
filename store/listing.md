# Store listing copy — WPR Front Debugging Tool 3.0.0

Single source for every store's listing text and dashboard fields (Chrome Web Store, Firefox AMO; Edge Add-ons post-release). Specs, limits and asset status: [README.md](README.md). Privacy policy: [privacy-policy.md](privacy-policy.md). Status: **draft — owner approval pending**. Publisher: WP Media. Re-check every claim against the code after any feature change.

## Name

`WPR Front Debugging Tool` (manifest `name`, `wxt.config.ts`).

## Summary

The manifest `description` (`package.json`), 125 characters — CWS summary (≤ 132, plain text), Edge short description (read from the manifest), AMO summary (≤ 250):

> See how WP Rocket optimizes any page, inspect scripts and styles, and test exclusions, Remove Unused CSS and the beacon live.

## Description

Plain text; AMO accepts it as is (limited Markdown). Edge: 250–10,000 characters (this text is within).

```text
WPR Front Debugging Tool shows how the WP Rocket WordPress plugin treats the page in your current tab, and lets you try changes on that page without touching the site. Built for the people who support and tune WP Rocket sites.

What it shows
• Detections: whether WP Rocket serves the page and from cache, which of its optimizations the page uses (Remove Unused CSS, Delay JavaScript execution, Load JavaScript deferred, LazyLoad, Minify, CDN, Preload and more) and the evidence for each, plus the page's response headers and cookies and known plugin/theme conflicts.
• Inspect lists for the page's JavaScript, stylesheets, lazyloaded elements, preloaded resources and undefined references, each with filters, search and a detail pane with highlighted code.
• A status dot on the toolbar icon (green: served from cache, blue: WP Rocket active but not cached, grey: not detected) and a detection widget on the page — both optional.

What you can try live
• Exclusion Builder: try Delay JavaScript execution, Load JavaScript deferred and LazyLoad for images exclusions on the live page, or simulate those features on a page served without them, before changing the site's settings.
• RUCSS Tester: run WP Rocket's Remove Unused CSS on the page and see the result until it reloads.
• Beacon Tester and LCP & Vitals: run WP Rocket's beacon to see what it would find, and break down this visit's Largest Contentful Paint and Core Web Vitals.
• Side By Side: the cached page next to its cache-bypassed version, or both in PageSpeed Insights.
• Command palette: every on-page action in one searchable list (keyboard shortcut, toolbar click or right-click menu).

Where to find it
The main tool is a panel in the browser's DevTools ("WPR FDT"). The on-page tools open from the toolbar icon, the right-click menu or the command palette. Light, dark or system appearance everywhere. After an update that brings new features, the extension opens a tab listing what's new, once (switch it off on that page or in the options).

Privacy
Page data is processed in your browser. Data leaves the browser only when you ask: starting a RUCSS test sends the page's address, a timestamp, the Mobile and Home choices and your safelist to WP Rocket's RUCSS service (no page content), and opening PageSpeed Insights sends the page's address and its cache-bypassed copy (?nowprocket=1) to Google; nothing else about you or the pages you visit is sent, and there are no analytics. The extension downloads two public data files, the Known Conflicts list (apps.wpr-support.com) and WP Rocket's latest exclusion list (b.rucss.wp-rocket.me), with no information about you.

About the debugger permission (Chrome, Edge)
The Exclusion Builder rewrites the page before the browser reads it, which needs the "debugger" permission. It is attached only to a tab while you run a builder session there; the browser shows its debugging bar meanwhile.

Made by WP Media, the makers of WP Rocket. Support: support@wp-rocket.me
```

Firefox build: drop the "About the debugger permission" paragraph (its manifest has no `debugger`; it uses `webRequestBlocking`, see below).

Edge build (post-release): title the paragraph "About the debugger permission" (a listing "must not reference other browsers"); host an Edge variant of the privacy policy without the Chrome Web Store sentence (it must "primarily refer to the Microsoft Edge browser").

Last line: the support address is `SUPPORT_EMAIL` (`lib/support/contact.ts`).

## Category

- CWS: **Developer Tools** (dashboard list).
- AMO: **Web Development** (`web-development`; up to two allowed — one is enough).
- Edge (post-release): pick the developer-tools category in Partner Center.

## Single purpose (CWS, Edge)

> Debug the WP Rocket WordPress plugin on the page in the current tab: show which WP Rocket optimizations the page receives and their effects, and let the user test WP Rocket changes (exclusions, Remove Unused CSS, the beacon) on that page without changing the site.

## Permission justifications

Built manifests (`pnpm zip` / `pnpm zip:firefox`): Chromium MV3: `storage, alarms, webRequest, contextMenus, scripting, declarativeNetRequestWithHostAccess, debugger` + hosts `https://*/*, http://*/*`. Firefox MV2: same minus `debugger`, plus `webRequestBlocking`, hosts folded into `permissions`. No optional permissions.

| Permission                                   | Justification (paste as is)                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                    | Saves the user's options, per-site detection widget choices and exclusion sets, panel layout and tool settings, keeps Exclusion Builder session state per tab (session storage), and caches the known-conflicts list and WP Rocket's latest exclusion list so the tool works offline.                                                                                  |
| `alarms`                                     | Hourly checks that refresh the two public data files (known-conflicts list, WP Rocket's latest exclusion list) when they are due.                                                                                                                                                                                                                                      |
| `webRequest`                                 | Reads the response headers of the tab's top-level page to show the server, cache and CDN headers WP Rocket's diagnosis depends on. Firefox only: also used by the Exclusion Builder to rewrite a builder tab's page as it loads.                                                                                                                                       |
| `contextMenus`                               | Adds the tool's commands to the page and toolbar-icon right-click menus (Side By Side, Exclusion Builder, detection widget toggle, command palette, ?nowprocket, known-conflicts update).                                                                                                                                                                              |
| `scripting`                                  | Injects the on-page tools (Exclusion Builder overlay, command palette, beacon test runner) into the current tab only when the user opens one, so pages carry none of their code until then.                                                                                                                                                                            |
| `declarativeNetRequestWithHostAccess`        | Side By Side's mobile comparison: while the user has it switched on, one rule scoped to that tab sends a phone user agent on its page requests, so the site serves its mobile cache. Removed when the comparison ends.                                                                                                                                                 |
| `debugger` (Chromium only)                   | The Exclusion Builder rewrites the tab's HTML before the browser parses it (the debugger protocol's Fetch domain is the only extension mechanism able to do this), so the user sees the page as it would be served with their exclusions without changing the site. Attached only to a tab with an active builder session, only on the user's Apply; detached on Stop. |
| `webRequestBlocking` (Firefox only)          | The Exclusion Builder's Firefox mechanism: `webRequest.filterResponseData` rewrites a builder tab's HTML as it loads, which requires a blocking listener; also redirects a simulated page's LazyLoad script to the copy packaged with the extension.                                                                                                                   |
| Host permissions `https://*/*`, `http://*/*` | The tool debugs whichever WordPress site the user opens: its content scripts detect WP Rocket on the page, it reads the page's headers and rewrites it during a builder session. Also covers the RUCSS Tester's single request to WP Rocket's service (only on the user's Run).                                                                                        |

Remote code (CWS/Edge "Are you using remote code?"): **No.** All code ships in the package (incl. WP Rocket's beacon and LazyLoad scripts as packaged files). The two downloaded files are JSON data, validated and never executed.

## Data use / privacy fields

Must match `FIREFOX_DATA_COLLECTION` in `wxt.config.ts` and the sends in code (`lib/rucss-tester/endpoint.ts`, `lib/side-by-side/analysis-host.ts`, `entrypoints/background/known-conflicts.ts`, `entrypoints/background/latest-exclusion-list.ts`).

- **Firefox manifest** `data_collection_permissions`: `required: ['none']`, `optional: ['browsingActivity']` — asked at first use of each tool that sends the address (RUCSS Tester, PageSpeed Insights), checked on every use.
- **CWS / Edge data collected:** the user-data FAQ's _web browsing activity_ ("the domains or URLs the browser interacts with"; dashboard checkbox names are not in the docs — tick the one covering web history/browsing): the current page's address, only on two user commands:
  - RUCSS Tester Run → `https://mega.wp-rocket.me/support/wpr-rucss-v2.php`: the address (fragment and credentials removed) with a request timestamp, the Mobile/Home choices and the user's safelist entries; no cookies, no page content.
  - Side By Side Performance → opens `https://pagespeed.web.dev` with the address and its cache-bypassed copy (`?nowprocket=1`) (Google's PageSpeed Insights, in a tab or frames).
  - Stored in the browser only, never sent by the extension:
    - sync storage (roams with the user's own browser sync): options, the on-page UI switch, the palette shortcut and the per-site detection widget choices keyed by site origin;
    - local storage (this device, never synced): the exclusion sets saved per site origin, detection widget positions, panel layout (nav pin, detail pane width), RUCSS Tester and Beacon Tester settings, and the cached public data files;
    - session storage (in memory, cleared when the browser closes): Exclusion Builder sessions and overlay state per tab, and per-tab simulation markers.
- Not collected: personally identifiable, health, financial, authentication, personal communications, location, website content, analytics/telemetry/crash reports.
- **Certifications (all true):** not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used or transferred to determine creditworthiness or for lending.
- **Privacy policy:** required by every store. Text: [privacy-policy.md](privacy-policy.md), published as is on a web page; that page's URL goes in each store's privacy-policy field (AMO takes the full text). URL: **owner open**.

## Reviewer notes (CWS/Edge certification notes, AMO "notes to reviewer")

- Testing: open any WordPress site running WP Rocket, then DevTools → "WPR FDT" panel; Exclusion Builder: right-click the toolbar icon → Exclusion Builder → Apply (Chromium shows its debugging bar while the session runs).
- `debugger` (Chromium): used only by the Exclusion Builder session the user starts; see the permission table.
- AMO sources (paste as is): "Build environment differs from your default: Node.js 24.22.3 (`package.json` `engines.node` >= 24.20.0) and pnpm 12.9.1 (`packageManager`; `corepack enable` installs it). Unzip the sources, then run `pnpm install --frozen-lockfile && pnpm zip:firefox`; the add-on is `.output/firefox-mv2` (zipped as `.output/wpr-front-debugging-tool-<version>-firefox.zip`). Verified byte-identical to the submitted zip on macOS arm64 and on Linux arm64 (Debian bookworm, `node:24-bookworm`). Third-party code: npm packages from the lockfile, unmodified; `wp-rocket-simulation/lazyload/17.8.3/lazyload.min.js` is vanilla-lazyload 17.8.3's release build (https://github.com/verlok/vanilla-lazyload/blob/17.8.3/dist/lazyload.min.js) as WP Rocket packages it — identical but for the missing final newline; `wp-rocket-simulation/simulation-data.json` holds WP Rocket's own inline snippets as data, inserted into the page only when the user runs a simulation, never run in the extension's own pages. Licence notices: `THIRD_PARTY_NOTICES.txt`."
- Build the sources zip from a clean checkout: `pnpm zip:firefox` refuses, naming them, while git shows untracked non-ignored files (they would ship to reviewers).

## Contact fields

- AMO "Support email": `support@wp-rocket.me`.
- CWS "Support URL": leave empty (the address is in the description).
- Homepage URL (every store, optional): **owner open**.
