# Store listing copy — WPR Front Debugging Tool 3.0.0

Single source for every store's listing text and dashboard fields (Chrome Web Store, Firefox AMO, Edge Add-ons if listed). Specs, limits and asset status: [README.md](README.md). Every claim was checked against the code on 2026-11-23; re-check after any feature change. Status: **draft — owner approval pending** (copy, WP Rocket name use).

## Name

`WPR Front Debugging Tool` (manifest `name`, `wxt.config.ts`; rename cancelled 2026-11-23).

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
The main tool is a panel in the browser's DevTools ("WPR FDT"). The on-page tools open from the toolbar icon, the right-click menu or the command palette. Light, dark or system appearance everywhere.

Privacy
Page data is processed in your browser. The page address leaves the browser only when you start a RUCSS test (sent to WP Rocket's RUCSS service) or open PageSpeed Insights; nothing else about you or the pages you visit is sent, and there are no analytics. The extension downloads two public data files, the Known Conflicts list (apps.wpr-support.com) and WP Rocket's latest exclusion list (b.rucss.wp-rocket.me), with no information about you.

About the debugger permission (Chrome, Edge)
The Exclusion Builder rewrites the page before the browser reads it, which needs the "debugger" permission. It is attached only to a tab while you run a builder session there; the browser shows its debugging bar meanwhile.

This is an independent support tool; WP Rocket is a trademark of its owner.
```

Firefox build: drop the "About the debugger permission" paragraph (its manifest has no `debugger`; it uses `webRequestBlocking`, see below).

## Category

- CWS: **Developer Tools** (dashboard list, [best practices](https://developer.chrome.com/docs/webstore/best-practices), fetched 2026-11-23).
- AMO: **Web Development** (`web-development`; up to two allowed — one is enough), [AMO categories API](https://addons.mozilla.org/api/v5/addons/categories/) 2026-11-23.
- Edge: pick the developer-tools category in Partner Center (list not published in the docs read; verify there).

## Single purpose (CWS, Edge)

> Debug the WP Rocket WordPress plugin on the page in the current tab: show which WP Rocket optimizations the page receives and their effects, and let the user test WP Rocket changes (exclusions, Remove Unused CSS, the beacon) on that page without changing the site.

## Permission justifications

Manifests read from `pnpm zip` / `pnpm zip:firefox` output (3.0.0, 2026-11-23). Chromium MV3: `storage, alarms, webRequest, contextMenus, scripting, declarativeNetRequestWithHostAccess, debugger` + hosts `https://*/*, http://*/*`. Firefox MV2: same minus `debugger`, plus `webRequestBlocking`, hosts folded into `permissions`. No optional permissions.

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

Matches `FIREFOX_DATA_COLLECTION` in `wxt.config.ts` and the sends in code (`lib/rucss-tester/endpoint.ts`, `lib/side-by-side/analysis-host.ts`, `entrypoints/background/known-conflicts.ts`, `entrypoints/background/latest-exclusion-list.ts`).

- **Firefox manifest** `data_collection_permissions`: `required: ['none']`, `optional: ['browsingActivity']` — asked at first use of each tool that sends the address (RUCSS Tester, PageSpeed Insights), checked on every use.
- **CWS / Edge data collected:** the user-data FAQ's _web browsing activity_ ("the domains or URLs the browser interacts with"; dashboard checkbox names are not in the docs — tick the one covering web history/browsing): the current page's address, only on two user commands:
  - RUCSS Tester Run → `https://mega.wp-rocket.me/support/wpr-rucss-v2.php`: the address (fragment and credentials removed), the Mobile/Home choices and the user's safelist entries; no cookies, no page content.
  - Side By Side Performance → opens `https://pagespeed.web.dev` with the address (Google's PageSpeed Insights, in a tab or frames).
  - Stored in the browser only, never sent by the extension:
    - sync storage (roams with the user's own browser sync): options, the on-page UI switch, the palette shortcut and the per-site detection widget choices keyed by site origin;
    - local storage (this device, never synced): the exclusion sets saved per site origin, detection widget positions, panel layout (nav pin, detail pane width), RUCSS Tester and Beacon Tester settings, and the cached public data files;
    - session storage (in memory, cleared when the browser closes): Exclusion Builder sessions and overlay state per tab, and per-tab simulation markers.
- Not collected: personally identifiable, health, financial, authentication, personal communications, location, website content, analytics/telemetry/crash reports.
- **Certifications (all true):** not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used or transferred to determine creditworthiness or for lending.
- **Privacy policy:** required (CWS: any product handling user data; AMO: personal data incl. browsing activity; Edge: privacy information). URL: **owner open** — host the text below on a site the owner controls; it must include the CWS Limited Use statement.

### Privacy policy text (draft)

```text
WPR Front Debugging Tool — Privacy policy

The extension processes the pages you debug inside your browser. It has no analytics, telemetry or crash reporting, and no account.

Data that leaves your browser, only when you ask:
• RUCSS Tester: when you click Run, the tested page's address (without fragment or login), your Mobile/Home choices and your safelist entries are sent to WP Rocket's RUCSS service (mega.wp-rocket.me) to compute the page's used CSS. No cookies or page content are sent.
• PageSpeed Insights: when you open Side By Side Performance, the page's address is opened in Google PageSpeed Insights (pagespeed.web.dev), subject to Google's privacy policy.
On Firefox, each of these asks your permission first.

Downloads without your data: the extension periodically downloads two public files, the Known Conflicts list (apps.wpr-support.com) and WP Rocket's latest exclusion list (b.rucss.wp-rocket.me); the requests carry no information about you or your pages.

Stored in your browser, never sent by the extension:
• In the browser's sync storage, which your browser may sync to your own account: your options and per-site detection widget choices.
• On this device only (never synced): the exclusion sets you save per site, widget positions, panel layout, RUCSS Tester and Beacon Tester settings, and the cached public files.
• For the browser session only (cleared when it closes): Exclusion Builder sessions per tab.

The use of information received by this extension adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is never sold, used for advertising, or used for purposes unrelated to debugging WP Rocket.

Contact: <owner to fill>
```

## Reviewer notes (CWS/Edge certification notes, AMO "notes to reviewer")

- Testing: open any WordPress site running WP Rocket, then DevTools → "WPR FDT" panel; Exclusion Builder: right-click the toolbar icon → Exclusion Builder → Apply (Chromium shows its debugging bar while the session runs).
- `debugger` (Chromium): used only by the Exclusion Builder session the user starts; see the permission table.
- AMO sources: the sources zip (`pnpm zip:firefox`) holds the full source; build with Node 24 (`engines.node` in `package.json`) and the pnpm version pinned in its `packageManager` field: `pnpm install --frozen-lockfile && pnpm zip:firefox` → `.output/*-firefox.zip`. Packaged third-party code: `wp-rocket-scripts` 1.2.2 (npm, unmodified) and WP Rocket's LazyLoad runtime (`public/wp-rocket-simulation/`, byte for byte).

## Pending cross-checks

- **What's new page (P15F, not on develop yet):** if it ships, add to the description: "After an update, the extension opens a page listing what's new, once per release." Keep the description's feature list consistent with `lib/release-notes/` 3.0.0 highlights (checked 2026-11-23 against the in-flight copy: Exclusion Builder, RUCSS Tester, Beacon Tester + LCP & Vitals, detection widget, toolbar status dot, command palette — all present above).
- WP Rocket name/trademark use in name and copy: owner OK (P15D store-policy row).
- Support email/homepage (optional on every store; AMO recommends an email): owner open.
