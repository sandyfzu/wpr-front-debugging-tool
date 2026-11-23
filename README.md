# WPR Front Debugging Tool

Browser extension for debugging the [WP Rocket](https://wp-rocket.me) WordPress plugin on the front end: running-target detection, runtime error capture, cache/CDN insights, an Exclusion Builder, and more. Built for Chromium first (Manifest V3), Firefox second.

## Stack

[WXT](https://wxt.dev) (extension framework) + [SolidJS](https://solidjs.com) + TypeScript strict + Tailwind CSS v4, tested with Vitest.

## Development

```bash
pnpm install            # Node 24, pnpm (see .nvmrc / packageManager)
pnpm dev                # dev build + watch → load .output/chrome-mv3 as an unpacked extension
pnpm test               # unit tests incl. coverage thresholds (the `test` gate)
pnpm compile && pnpm lint && pnpm format:check   # types, eslint, prettier
pnpm build && pnpm check:budgets   # production build + size-budget gate
```

Extension icons: `branding/icon.svg` is the master mark (never shipped). After editing it or the size table (`lib/branding/icons.ts`), run `pnpm icons` to re-render `public/icon/*.png` and commit them; `pnpm icons --check` fails naming any committed PNG that drifted.

Design tokens (light/dark/system appearance, status vocabulary, motion) live in `assets/css/tokens.css` (definitions) and `assets/css/theme.css` (Tailwind layer; every page surface imports it, injected shadow UIs import the tokens file); a unit test pins WCAG AA contrast for the committed text/background pairs in both palettes.

## Scrollbar visibility

Chromium uses fixed native scrollbars on overflowing content, including in forced
colors. Firefox keeps the platform's native scrollbar behavior: on systems with
auto-hide enabled, bars can disappear at idle, even with a stable gutter. Scroll
with the wheel/trackpad to reveal them, or focus a scrollable region and use the
arrow keys. For persistent native bars on macOS, you can choose **System Settings
→ Appearance → Show scroll bars → Always** ([Apple's instructions](https://support.apple.com/guide/mac-help/change-appearance-settings-mchlp1225/mac)).
This is a user-controlled system setting; the extension never changes it.

## Privacy

- The Known Conflicts DB, per-site options and the on-page detection widget's per-origin overrides and default option live entirely inside the extension's own storage — the host page never sees them, and the page-visible state of every injected surface is the shadow-isolated UI itself. The options and the widget's per-site overrides (origins as keys) sit in the browser's sync area, so they roam with the user's own browser sync when it is on; the widget's dragged positions (origins as keys) stay in this device's local area and never roam.
- Page data (detections, header tables, counts) is processed in the browser and either shown in the tool's surfaces or logged under the `[WPR FDT]` prefix in masked shapes (counts and versions, never markup, URLs or scripts). Nothing from a host page leaves the browser except the Known Conflicts DB refresh fetch against the plugin's public endpoint and the RUCSS Tester's user-started request (below).
- The **RUCSS Tester** sends one request per test, only when the user clicks Run (or Run again / Run on top) in the panel, to WP Rocket's RUCSS service (`https://mega.wp-rocket.me/support/wpr-rucss-v2.php`, fixed): the tested page's address (fragment and `user:password@` dropped), the Mobile/Home choices and the safelist entries — never cookies (`credentials: 'omit'`), page content or the other settings (markers, patterns, prepend/append and replacements apply locally). The panel shows the exact request address after each run.
- The **live tools** (Beacon Tester, LCP & Vitals, the JavaScript page's Runtime states) run only when asked in the panel and send nothing anywhere; results go to the panel only. The Beacon Tester runs WP Rocket's own beacon (the bundled `wp-rocket-scripts` package, loaded into the page on the first Run, never before) with every site side effect removed: it never asks the site whether data exists and never saves results (no `admin-ajax` call — no request at all), never marks the page's beacon script `beacon-completed`, and writes nothing to the page's console, so the site's stored WP Rocket data cannot change. LCP & Vitals and Runtime states read the browser's own performance entries and the live DOM: values are this visit's (never field/CrUX data), and the optional LCP frame is drawn for 5 s in the extension's own shadow layer, never by styling the page.

See `AGENTS.md` for the full operating guide and `docs/plans/` for the port plan.
