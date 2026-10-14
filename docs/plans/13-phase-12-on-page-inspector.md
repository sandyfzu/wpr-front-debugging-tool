# Phase 12 — On-page inspector (the floating detection strip)

**Depends on:** P11 (statuses + registry HUD facet), P3 (content-script infra + data hub), P5 (design tokens), and for the toggle rows: P8 (popup) + P9 (options). **Effort:** M. **Parallelizable:** with P13/P14 once its own deps are done (their quick-actions ride on it but degrade gracefully without it).

## Goal

Port the inspector source's floating on-page strip: a drag-aware, collapsible mini-panel showing every WP Rocket feature as a status chip grouped like the Detections page, plus quick-action entries for the live tools (RUCSS test, beacon test, LCP analysis — their execution follows in P13/P14). It is the piece the first baseline never had: glanceable WP Rocket status on any page **without opening devtools**.

Rebuilt, not copied: a **completely redesigned** chip-strip under the P5 strip design brief (a purpose-built floating-element visual language, not a re-skin of the source's CSS), shadow-DOM-isolated Solid UI, opt-in per site (the source shows itself on every page), per-site state in extension storage instead of cookies visible to the host page, one keyboard shortcut, and no console spam per feature.

## Early start — P12A (owner directive, 2026-10-13; [13a](./13a-phase-12a-inspector-strip-early-detections.md)) — **shipped, 2026-10-13**

The widget's presentations start **before** this phase's deps: the detections-only slice ships on the **Known Conflicts shell** (mood marker pill ⇄ floating report card, the audited motion/focus choreography), with the P5H brief's chip/state vocabulary inside the card. **The early start is live — its shipped state (sub-phase build-out, gates, audited receipts) is [13a §7](./13a-phase-12a-inspector-strip-early-detections.md#7-shipped-the-p12a-implementation-round-2026-10-13).** Deviations against this phase's committed pieces, recorded per the brief's §16 template (both in 13a): idle shape = KC-style pill (not the always-visible header bar; `SB-D11` collapse lands with the full phase), resting anchor bottom-right (drag + `SB-D1`'s persisted-wins rule arrive with the full phase anyway), no tool chips/`Alt+H`/banner (`P13`/`P14`), and the opt-in is provisionally a context-menu row writing **P12's final per-origin storage item** (the popup/Detections/options rows join it on landing). The chips' declaring site is a provisional strip registry that this phase (once P11's `hud` facet exists) replaces — delete-on-land, never a second feature list. The checklist items below marked by the mandate stay exactly as planned; the early-start rows they cover are ticked in 13a.

## Reference (wpr-inspector, verified on 2026-10-06 by full-source read)

- `wpr-inspector/templates/inspector.html` + `css/inspector.css` (imported `?raw` into a shadow root attached to `div.wpr_inspector_tool_root` on `document.body`; `adoptedStyleSheets`). Fixed top area (`top: 200px; left: 5px`, z-index `999999999` — the source figure everywhere in its CSS; the `2147483647` this plan previously quoted was a transcription error, see the strip design brief's `SB-D1` for the port's own, different value), `direction: ltr`; a vertical strip (`top: 50%`, `transform: translateY(-50%)`, `max-width: 100px`).
- Chip groups (verbatim labels): **Cache** (`version` chip "WPR-V-x" / "WPR-V-NF", `cache`, `cache_time` + `.cache_creation` "N/A"), **File Optimization** (`css_minify`, `rucss`, `cpcss`, `js_minify`, `ljd`, `dje` + hidden `.wpr_djev` version + hidden `#wpr_ins_check_scripts` "check scripts" action, unhidden only when DJE detected), **Media** (`lazyload` "LazyLoad img", `lazyload_bckg`, `lazyload_iframes`, `image_dimensions` "Image Dim...", `self_hosted_fonts` "SHGF"), **Preload** (`preload_links` "PL Links"), **CDN** (`rocketcdn` "RocketCDN"), **Features** (`oci`, `alr`), **Tools** (`#wpr_ins_rucss_tester_tool` "RUCSS Tester", `#wpr_ins_list_scripts_tool` "List Scripts", `#wpr_ins_beacon_tester_tool` "Beacon Tester", `#wpr_ins_lcp_tool` "LCP Tester"), footer with `[wpfeature="version"]` WordPress stamp + Notion-doc link + extension-version span (`.wpriv`).
- Chip state is class-driven: `.enabled` (green), `.disabled` (red), `.unsure` (amber); tool chips are blue + clickable.
- Visibility model: always injected on every matched page; production gate = content script itself only fires in incognito (`wpr-inspect.js`: `browser.extension.inIncognitoContext` asked directly; dev mode also fires). Toggle: `Alt+H`/`Alt+0` via `document.onkeydown =` assignment; persisted as a **host-page-visible cookie** `wprInspectorVisibility`.
- Drag: `js/draggable.js` — mousedown + touchstart on the strip, document move listeners, right-click cancels, touch uses a non-passive `touchmove` that disables page scroll; position saved as cookie `<id>-Position` = `"left,top"`; no viewport clamping.
- Every pass runs eagerly in the constructor (also with no devtools anywhere nearby), booting via `console.log` per feature.

## Source quirks fixed in this phase (verified in the source)

| #   | Quirk in the inspector source                                                                                                                                                       | Fix here                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `document.onkeydown =` assignment **clobbers any host-page keydown handler**                                                                                                        | `addEventListener('keydown', …, { capture: false })`, registered only while the strip is enabled, removed on context invalidation                                        |
| 2   | Two identical `save/loadInspectorVisibilityState` bodies kept in the class (lines 49–74 vs 80–105)                                                                                  | Single state module                                                                                                                                                      |
| 3   | Visibility + drag-position state in host-page cookies (`wprInspectorVisibility`, `<id>-Position`) — the site's own JS can read it                                                   | Extension storage (`local:on-page-inspector`), keyed per origin; nothing about our state visible to the page                                                             |
| 4   | `draggable` has no viewport clamping — the strip can be dragged off-screen; touch path listens on `document` `touchmove` non-passively for the whole drag with no cancel-card reset | Pointer-based drag with position clamped to the viewport minus a 4 px margin; the non-passive `touchmove` is registered per active drag and removed on pointer up/cancel |
| 5   | The strip auto-runs on every page in incognito/dev — no opt-out per site, no per-site memory                                                                                        | Opt-in per origin (popup switch / Detections page button / options default); per-site memory so a chosen site stays chosen                                               |
| 6   | Per-feature `console.log` on the host page (10+ lines per load)                                                                                                                     | Zero console usage; diagnosis output lives in the panel                                                                                                                  |

## Tasks

### 1. State: `lib/storage/on-page-inspector.ts`

- [ ] `onPageInspectorStore = storage.defineItem<OnPageInspectorState>('local:on-page-inspector', fallback: {})` — `{ [origin]: { enabled: boolean; position?: { x: number; y: number }; lastActivated: number } }` (`lastActivated` drives eviction only, never shown); `parseOnPageInspectorState` validator (origin keys only, coords finite numbers, empty-string origin rejected), **cap 200 origins** (evict the least-recently-used `lastActivated` entry — the same unbounded-map lesson as the header-map bugs reviewed in P2).
- [ ] Option default: `features.onPageInspector: false` in `StoredOptions` (owned by the P9 registry) — the _default activation state for unconfigured origins_. Per-origin entries always win over the default.
- [ ] Toggle flows: popup row (current tab's origin) and the Detections page button read/write this store (storage-watch, reusing the P3 KC re-scan pattern — no new messaging channel; the isolated CS watches and mounts/unmounts reactively).

### 2. Strip UI: `entrypoints/isolated.content.ts/inspector/` — completely redesigned per the P5 strip design brief

- [ ] **Design mandate (user requirement, binding):** this strip is NOT a visual re-creation of the source's DOM/CSS — it is a redesign under P5's committed strip design brief (visual spec, states, motion, outcome-banner pattern). The chips must look intentionally better than the source's strip: grouped chips on the P0 surface/status tokens (incl. the amber `attention-unsure` state), per-group iconography, one density scale for a floating element, crisp internal hierarchy (header row = identity + cache state; groups below; tools separated; footer micro-info). Design deviations from the brief are reported in this file, not invented here.
- [ ] **Isolation (user requirement, binding):** the strip lives entirely in its own shadow root via `createShadowRootUi` + Solid with adopted styles — nothing page-scoped, no host CSS in or out, per the P5 injectable-UI isolation standard; verified against a hostile-CSS host page in the checklist. **Palette per the P5 palette rule:** correct in both palettes via the P0 tokens, honoring the stored appearance (system default follows `prefers-color-scheme`, dark/light override; `[data-theme]` on the strip container).
- [ ] `createShadowRootUi` + Solid; groups and chips rendered from the P11 registry (`hud` facet: `shortLabel`, `group`, ordering) + the processed detections — one source of truth; nothing hardcodes a feature list a second time.
- [ ] Groups mirror the source's strip for transferable muscle memory: **Cache / File Optimization / Media / Preload / CDN / Features / Tools**; parity short labels carried verbatim (`WPR-V`, `N/A`, `LazyLoad img`, `Image Dim...`, `SHGF`, `PL Links`, `RocketCDN`, `OCI`, `ALR`, `RUCSS Tester`, `Beacon Tester`, `LCP Tester`, "List Scripts" becomes "Script overview" — full names in tooltips; label deltas listed here only).
- [ ] Statuses: green/red/amber from the P0 shared tokens; `unsure` state explains itself in the tooltip (e.g. "optimized but cache signature missing — headers point to siteground").
- [ ] Footer: WPR version, WP version, extension version — no Notion-doc link (product-surface decision: this extension's docs live in its README/options; recorded delta).
- [ ] Tools group: chips for RUCSS Test / Beacon Test / LCP / Script overview. They render disabled-with-tooltip until P13/P14 land; when available: RUCSS/Beacon/LCP trigger their runs with the persisted config (§4 below); "Script overview" deep-state: opens the JS page's section via `processPageData`-style data pull (P14); on devtools-open pages the chip also nudges "full view in the panel" (hint, not an action — the page cannot programmatically focus a devtools tab; documented).
- [ ] DJE-present affordance carried over: the "check scripts" chip shows only when `delay_js` is present (data from the same detections); it triggers the P14 runtime-status view or surfaces the JS summary in a tooltip when the panel is closed.
- [ ] Cache chip extra (union): the cache slot shows the shared `formatCacheTimestamp` output ("N/A" when uncached — P11's util, panel/strip single format) + the exclusion-marker hint line from P11.

### 3. Drag + visibility behaviors

- [ ] Drag: pointer events (pointerdown/move/up + touch passthrough) with the P1 pointer-utilities; viewport-clamped; position persisted per origin on drop (`position`, clamped to a sane integer range — validated by the store parser); the tools group's cards (P13/P14) are NOT draggable (single draggable element, unlike the source where every panel had its own drag cookie).
- [ ] Shortcut: `Alt+H` only (the source's duplicated `Alt+0` collapses to one binding — documented delta), `addEventListener`, capture false, no `preventDefault` when the strip is closed; hides/shows the strip **for the current page session** and persists per origin; listener removed via `ctx.onInvalidated`.
- [ ] Activation semantics: strip mounts once enabled (via toggle or default); the data hub's lazy processing is triggered on mount (why: an enabled origin opted into the extra work; unchanged origins keep the first-baseline lazy behavior). All detection state comes from the same hub cache the panel reads — no second detection pass, ever.
- [ ] Full cleanup on `ctx.onInvalidated`: shadow UI removed, keydown listener removed, any active drag terminated. **Owned alongside the mount-lifecycle work (carried from the 2026-10-12 P5H conformance round):** the shared mount's async window — WXT's `onRemove` can fire before the async mount resolves — currently leaves the armed appearance-follow watch plus the immature Solid tree as detached dead work in that losing race (page-safe, tiny, pre-existing; the shared leg adds one storage listener to a leak that already leaked the tree). This phase hardens the shared mount's lifecycle (both shipped injected UIs inherit it) — see the P5H receipts in `06` for the verified mechanics.

### 4. Quick-action contract (codesigned with P13/P14)

- [ ] The strip has no own test runtime: identical logic to panel-triggered runs (`runRucssTest` / `runBeaconTest` / `runLcpAnalysis` call sites) — P13/P14 own the executors under the tab CS; the strip call sites just await them. Config lives in the tester stores (P13/P14) — first-run affordance: the chip tooltip says "configure in the panel" when no config exists yet.
- [ ] Result feedback: a compact transient banner inside the strip's shadow UI (fixed top-center, auto-hide 5 s, `Show details → ` opens the panel route by hash when a devtools instance is already open; otherwise it states where the outcome landed) — outcome copy owned by each tool's phase.

## Explicit enhancements over the inspector source

- **Completely redesigned strip** on the shared design language + isolation standard (P5 brief): the source's strip styling/classes are treated as a baseline, not a target — the shipped strip is designed around the panel's status tokens, per-group icons, hover/drag/press states, and the outcome-banner pattern.
- Opt-in per origin (with a global default) instead of blanket-on per browser mode; host-page-invisible state (extension storage, capped map) instead of cookies; no keydown clobbering; no off-screen strip; one shortcut; zero host-console noise; clamped pointer drag with responsive touch; Solid shadow UI on the shared tokens; tooltips that carry full feature names + self-explaining `unsure` states; drag-with-cookie-spread removed (one element, no cookie writes).
- Registry-driven chips: P11's rows feed it — a future WP Rocket feature is one registry row for both panel and strip.

## Tests

- `lib/storage/on-page-inspector.test.ts` — validator matrix (valid/invalid origins, coords; cap eviction; no host-content inside).
- `entrypoints/isolated.content.ts/inspector/build-strip-items.test.ts` (pure view-model) — registry → chip list mapping (groups, ordering, short labels, tool gating by `delay_js` presence), state coloring matrix incl. cache-time insertion and exclusion hint; snapshot-stable.
- Drag clamp util tests (pure geometry): clamp within viewport, integer output, no drift on repeated drops.
- Storage-watch mount/unmount: enabling/disabling per origin via fake storage in tests (mounts on the origin's entry, unmounts otherwise, options-default honored).

## Verification checklist

- [ ] Gates green; `pnpm check:budgets` — the isolated-CS budget (§1.3) now includes the strip; the table row reported (strip ≤ 10 KB raw on top of the existing budget; virtualization not required for ~18 chips).
- [ ] **Design-brief conformance pass:** the shipped strip is reviewed against the P5 strip design brief item by item (states, motion, banner, density) — deviations listed with reasons; the strip's marked-up states match the "completely redesigned" mandate (no unfolded source CSS survives: grep the strip module for the source's class names as a 0-hit gate).
- [ ] **Isolation audit (hostile-CSS host page):** on a page with aggressive global CSS (`* { all: unset !important }`-style resets, high-specificity rules), the strip renders unchanged; page styles are unaffected by the strip (computed-style diff on host nodes before/after strip mount = none); no un-scoped `<style>` exists outside the strip's shadow root.
- [ ] Manual (dev on a normal window): strip hidden on every site by default; enabling via popup/Detections makes it appear at a sane position; disable hides and stays hidden across reloads; drag persists; per-origin memory works while another site stays hidden.
- [ ] Manual (incognito same origin): per-origin state applies (origin is the key, browser mode is not).
- [ ] `Alt+H` toggles on an enabled site, does nothing on a disabled one (until the option default flips it); page keydown handlers verified intact (a site with its own `keydown` handler, e.g. a code editor page, must not regress).
- [ ] Drag does not select text or trigger links beneath while dragging; right-click while dragging cancels cleanly (source-parity nicety kept).
- [ ] Mobile-sized viewport (touch): draggable, clamped, page scroll unaffected after drop.
- [ ] UX/interaction pass per the P5 strip design brief: glance test (status readable ≤ 2 s), hover/press/drag states all present, tooltips explain every non-obvious chip, keyboard reachable when focusable, axe run on the shadow UI (contrast inherited from P0 token pairs), reduced-motion honored; **both palettes verified and the stored appearance honored on the strip (system/dark/light — flipping the option in Options restyles the strip without a reload)**.
- [ ] `dev:firefox` smoke test: strip mounts, Alt+H works, no `chrome.*` calls (both browsers' outcomes documented).
- [ ] A page with zero WP Rocket markers: strip shows the disabled/unsure chips with honest tooltips, never fabricated states.

## Docs to update

AGENTS.md (entrypoints/isolated content structure additions if the strip adds colocated modules; options key `features.onPageInspector` listed); README privacy note extended ("no per-site state leaks to host pages; on-page strip is opt-in per site"); master plan §9 row states.
