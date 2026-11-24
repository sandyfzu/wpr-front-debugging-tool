# Changelog

User-facing changes per store release ([Semantic Versioning](https://semver.org)). The in-extension What's new page (`lib/release-notes/`) and the store copy ([`store/listing.md`](store/listing.md)) say the same in fewer words; keep all three in step.

## 3.0.0 — unreleased

A rebuilt, faster tool that replaces 2.2.5 in place (settings carry over; no data migration needed). Minimum browsers: Chrome 145 (and other Chromium-based browsers at that engine), Firefox 150.

### Added

- **Exclusion Builder**: try Delay JavaScript execution, Load JavaScript deferred and LazyLoad for images exclusions on the live page, or simulate those features on a page served without them. Apply reloads the tab with the exclusions, Reset goes back to the applied set, Stop ends the session; a session lasts across the tab's pages. Opens from the panel's top bar, the toolbar icon's right-click menu or the command palette.
- **RUCSS Tester**: runs WP Rocket's Remove Unused CSS on the page and shows the result until the page reloads (DevTools → WPR FDT → Tools).
- **Beacon Tester** and **LCP & Vitals**: run WP Rocket's beacon to see what it would find, and break this visit's Largest Contentful Paint into its parts beside its Core Web Vitals; the JavaScript page gains **Runtime states** (executed, failed, pending…).
- **Detection widget**: a draggable pill on the page with WP Rocket's state and, on click, the features the page uses with their evidence; on by default, switchable per site and in Options.
- **Toolbar status dot**: green (served from cache), blue (WP Rocket active, not cached), grey (not detected); the icon's tooltip names the state.
- **Command palette**: every on-page action in one searchable list (keyboard shortcut, toolbar click or right-click menu; shortcut set in Options).
- **What's new page**: opens once after an update that announces one (never on install or browser restart); can be switched off.

### Changed

- Redesigned panel: labeled sidebar or icon rail, lists with filters, search and a detail pane, syntax-highlighted code and CSS (minified code kept readable).
- Faster start: the panel loads only what it shows; each tool loads when first needed, and on-page tools cost a page nothing until opened.
- Light, dark or system appearance on every surface, the on-page UI included.
- Clicking the toolbar icon opens the command palette on the page (the options page on tabs without one).
- New browser permission (Chrome, Edge): "Access the page debugger backend", used only by the Exclusion Builder while a session runs on a tab (the browser shows its debugging bar meanwhile). Because it is new, the browser may turn the extension off after the update until the user accepts it.
- Firefox: the page address is sent (RUCSS Tester, PageSpeed Insights) only after the browser's data-sharing consent, asked at first use.

### Removed

- The toolbar popup and the Diagnoser; its support report is in the panel (Detections → Copy report).

### Notes

- WPR Inspector is retired: every feature it had is in this extension (the What's new page says where each one went), except its Alt+H strip toggle — the detection widget toggles from the right-click menu or the command palette.
- Third-party licence notices ship in the package (`THIRD_PARTY_NOTICES.txt`).
