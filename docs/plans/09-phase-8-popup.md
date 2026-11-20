# P8: popup and P8.1 suites

## TLDR

Build the12-parameter optimization popup with exact Apply/Reset URL behavior, accessible switches and truthful initial state. Depends:P1/P3/P5. **Deferred post-release** (owner 2026-11-17): the 12 URL parameters are read only by the Support Diagnoser plugin (none in WP Rocket 3.24.1's code), so the popup returns only with a rebuilt Diagnoser (P7), its URL contract re-verified against it. First release ships **no popup** (scaffold removed pre-release 2026-11-17, with the Diagnoser entry): the toolbar button stays declared in `wxt.config.ts` (`action: { default_title }`; badge + per-tab tooltip + action-menu rows), and its left click opens the on-page command palette, else the options page (`entrypoints/background/toolbar-click.ts`, `action`/`browserAction.onClicked`). **A popup silences `onClicked`** (both browsers): a revival must re-decide the click (drop it, or move the palette/options entry into the popup) and retire that module + its e2e leg (`toolbar-button` click). A revival adds `entrypoints/popup/` (WXT then writes `default_popup` into that key), a `popup JS` `scripts/budgets.json` row (≤ 50 KiB raw), and its surface back in AGENTS.md/`docs/ui-ux-bar.md`; the e2e tabless-sender probes use `options.html`. Installed stack/shared UI; no planned dependencies. Mobile-simulation popup row is **withdrawn**, including its obsolete P8.1 suite/dependency.

## Reference/contract

First baseline popup App/activate-deactivate-options/style. Fixed320×576; list scrolls between header/actions/footer, no clipped rows. One pure registry:

`wpr_cache`, `minify_css`, `minify_js`, `minify_concatenate_js`, `remove_unused_css`, `async_css`, `delay_js`, `defer_all_js`, `lazyload`, `lazyload_iframes`, `lazyload_css_bg_img`, `cdn`.

- Initial cache from cached verdict, detectable rows from present; **cdn/Combine never automatically selected under source contract**. Reassess only with documented later detection decision, not accidental default.
- Enable/Disable all affects **all12**, including cdn/Combine.
- Apply sets every12 to0, active ones1; removes nowprocket/wpr_activate_all/wpr_deactivate_all. Reset deletes12 plus those3 **and wpr_new_cache**. Preserve unrelated URL fields/query; new URL objects, no mutation. Working URL strips nowprocket.
- URL tab query active/currentWindow; tab-targeted detections. Producer is now eager single-flight: redundant processPageData ping omitted intentionally, not a lazy-processing requirement.

## Slices

- **P8A pure/state:** depsP1/P3. Models/URL builders+typed fetching→incompatible/error/ready, failure-aware tab query/retry, detection-synchronous initialization (no all-off flash/debug dump). DoD: full param/strip/preserve/initial/detectedIds/Enable-all matrix, query/no-CS/nonHTTP/error tests. Verify web tab.url readable via current host permissions **without tabs**; only restore permission if empirically necessary, with rationale/AGENTS.
- **P8B UI:** depsA/P5. Header “Disable or enable optimizations,” Cache first, native-name grouped switches/unique associated IDs, Enable/Disable-all; sticky Apply/Reset URL; safe Diagnoser releases link. Detected-vs-untouched tick. Stored theme before paint/live read; only panel/options change appearance. Apply awaits explicit target update, closes only success; failure toast stays actionable. `main.tsx` registers the global `error`/`unhandledrejection` handlers (`lib/uncaught-errors.ts`, as panel/options do — the scaffold has none, [doc 17 F10](./17-firefox-runtime-parity.md)). DoD: keyboard Tab/Space/Apply, first frame correct, fixed-height scroll/all controls reachable, UI bar §D/budget≤50KiB raw.
- **P8.1 suites:** depsB/P4.1 (+P4.2/plugin for live contract). Real capture→extension-page popup first ready frame/ticks; exact Apply/Reset+one plugin/site round; incompatible/no-context/no-CS retry;320×576 scroll/12 rows/footer (keyboard walk/new axe dropped — owner 2026-10-27: no screen-reader support). DoD: local green with automated/manual annotations, no simulation row reintroduced. Browser-action envelope and exact chrome-page topology distinct from page-state proxy; Firefox popup runtime/manual UX remain.

Final: same-page first-baseline resulting URLs/state match with recorded simplifications; reverify Apply/Reset against rebuilt Diagnoser when P7 unblocks, adapting pure builders/tests if evidenced. Gates/build/budgets and docs for any actual permission change required.
