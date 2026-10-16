# Panel UX: consolidated fixes and acceptance

## TLDR

Primary Chromium accepted2026-10-16 at `ea8269819438f3f6a1acf1b1dd99ee244472d5f2` (`integrate/panel-ux`), merged unsquashed into `review/panel-ux` with identical implementation tree. This consolidates copy/toast/layout/scrollbar implementation→audit→fix→verification records. Intermediate blockers below are **resolved**, except named platform limits. These historical results are not a fresh run on later code.

## Copy and notification semantics

- Complete-source copy's native-disabled pending state lost keyboard focus to body. Copy now stays focusable with aria-disabled/aria-busy and synchronous duplicate guard covering source read **and clipboard write**; never programmatically reclaims focus after user moves. Disposal aborts reads/suppresses late success or failure. An already-submitted clipboard write cannot be cancelled. Generic Button loading unchanged.
- Original unchanged focus regression plus Enter/Space/pointer/source-failure/retry/late-route-settle tests pass. Unit assertion requiring native disabling changed because it pinned the defect; no browser focus assertion weakened. Independent copy audit of `0338c935` found no remaining production issue (19 focused units/eight actual-extension tests).
- Toast `li role=status|alert` invalidated native list semantics. Keep ul/li; message wrapper carries per-tone status/alert+atomic title/remedy, dismiss outside message. Tests changed selectors to actual role/handler owner without dropping behavior. Real copied/denied clipboard axe cases now strict0 violations/incomplete.
- Hover and focus pause **independently**; exiting one never resumes while other active; internal focus transfer retains pause. Existing remaining-time/cleanup/enqueue/dismiss behavior kept; pre-fix unit/browser overlap regressions pin it. Queue remains≤6. No dependency or visual redesign.

## Centered canvas and truthful fallback headings

- PageCanvas centers header/actions/filters/results together. Data cap1280px (`max-w-7xl`), reading cap896 (`max-w-4xl`: references/Diagnoser), fluid below; route metadata owns reading choice once. Removed result-local caps. Unpadded query root/list floor/virtualization/refresh preserved.
- Original audit LAYOUT-1: loading full width→ready jumped289.5px at1920. LAYOUT-2: fixed256px loading bar overflowed narrow panel9px. All loading/error/crash/ready paths now share canvas; grid-cols-1 (minmax0) **plus** bounded bars fixes intrinsic-track overflow, not clipping.
- Independent geometry verified7 routes×5 sizes×loading/error×3 themes=210 samples, zero horizontal overflow, equal gutters, no loading→ready edge relocation. At320 padded content235px; at1920 data1280/reading896. Native200% zoom actually halves innerWidth, not CSS pretend zoom; restored afterward. Oversized-descendant negative control makes overflow positive, proving measurement isn't hiding it.
- Postfix audit accepted geometry but blocked h1-less loading/errors (`page-has-heading-one`); transparency was not a waiver. Loading now visibly **Loading page data**+three real-wait placeholders, PageHeader sole h1. Full-page ErrorState opts into existing truthful error title as h1; embedded uses unchanged. No hidden/fake destination heading or axe exclusion.
- Route navigation while loading focuses its real h1; data settle never steals focus. Error/crash focus policy unchanged. Tests hold genuine tab response, fail first transport callback, keyboard Retry error→held loading→ready; one-shot real attribute-write throw triggers actual crash boundary, recovery reloads panel only. No production test hook. Obsolete expected-heading-violation/no-h1 assertions necessarily updated; geometry assertions retained.
- Integration corrected **test measurement**, not application: native track occupies12px, so equal canvas gutters measure usable `clientWidth` from rect.left+clientLeft, not outer border box. Narrow error must overflow vertically **and occupy12px track**, caps/containment remain independent. Otherwise production cannot both reserve a track and paint content into it. First integration140 pass/4 fail retained as failed evidence; final144 clean after correction.

Tradeoffs kept explicit: ultrawide whitespace intentional; reading/data route edges differ192px once both caps engage. No unrequested density option. Finished fill-mode entrance objects may remain under reduced motion; no **running** animation is the verified result, not literal empty animation list on all ready pages.

## Fixed discoverable native scrollbars

- Initial standard thin/colored rule chose macOS overlay bars (0px occupied/no idle thumb). Universal owned-document/shadow treatment now fixed native Chromium12px track,8px rounded visible thumb,min24px length; identical idle/hover/drag geometry/color. No custom engine/JS/observers/polling/global gutter; fitting content has no phantom track. Existing ScrollArea stable gutter remains its own policy. Never target shadow host/host document.
- Chromium pseudo branch requires **both standard properties auto**, otherwise standards override it. Normal aliases fg-muted thumb/surface1 track-border-corner. Audit A1 found forced-color bypass restored invisible0px bars; fixed by retaining12px geometry with CanvasText/Canvas and forced-color-adjust auto on parts/elements.
- Harness now omits Playwright `--hide-scrollbars`; computed-CSS assertions alone did not prove visibility. PNG scans require distinct thumb/track and≥20 painted pixels/axis, held native drag both axes, idle2.2–2.3s, hover equality, keyboard/wheel, leave/reidle, disappear after shrink. Transparent-thumb negative control retained (any zero-alpha RGB valid in forced colors).
- Shadow probe moved **inside** visible overlay stacking context with identifying painted mark; a styled but occluded probe proves nothing. Host root stays unstyled. Light/dark/system repaint and both forced document palettes pass. Normal before/after PNG identical; forced before0×0 blank→after12×12 painted black/white reversed by palette.
- Audit A2 remains **Firefox platform limitation**, not fixed: exact stylesheet in Firefox155 CSS probe retains0×0 idle/hover overlay for auto/scroll/stable/thin/native-color candidates; wheel/keyboard reveal and scroll. No installed-extension claim, no global OS/browser preference changes. Always-painted guarantee is Chromium-only; README documents user-controlled macOS Always guidance without claiming it was changed/tested. If Firefox persistence becomes required, it remains unmet.

## Final evidence and limits

Independent combined gates: compile/lint/format, Chromium build/budgets, Firefox build pass. Node24.21/pinned pnpm12.9.1;175 test files,2698 passed/one existing opt-in `PERF_FIXTURE_OUT` skip; lines97.72%,functions99.50%. Full Chromium **144 passed, no retries/skips/failures**; additional headed **five passed** (three scrollbar/two independent geometry+zoom/real virtual-list cases). All budgets unchanged; panel~380.9 KiB raw/117.9 gzip at integration. Options/Builder were absent build rows, not verified surfaces. Firefox still warns about ID/data declarations.

Actual attached DevTools **is programmatically reachable** on installed Chromium156: owned disposable headed profile, Browser CDP `Target.openDevTools`, actual registered WPR FDT iframe/native inspectedTabId (no shim), frontend initialized before observed docking methods.28 ready geometry checks (7 routes×light/dark×right/bottom),four strict axe audits passed; native dock readback and inspected-page dimensions prove genuine docking. Canvases zero overflow/correct caps/usable-scrollport centering. This supersedes older impossibility claims but does **not** prove all docked fallback states, every width/control, undocked topology or native find interception. No user's browser/preferences changed.

Additional retained standalone coverage:320/480/768/1280/1920/3440px, shallow220px states, genuine200% zoom,5000 real captured scripts/<100 mounted rows, sampled search/clear/route actions no long task>50ms; broader P6.1 matrix still required.144 run includes site/refresh/theme/cold-start/strict fallback states; no blanket universal-performance claim.

Residual limits: Firefox extension runtime/clipboard/native auto-hide; Windows High Contrast (forced colors emulated on macOS); Chrome145 floor runtime; touch/RTL/exhaustive AT and actual speech; native popup envelope (built document tested in tab); every native fallback/docking/keyboard combination. No allowance for these becomes a claimed pass.

### Evidence locator

Local, **not committed/portable or guaranteed to persist**: `/private/var/folders/ch/n74cjyr900d98tcydn9lp8940000gn/T/opencode/`.

- `final-ux-gates.log`; `final-ux-audit/{full-e2e.log,headed-e2e.log,headed-report/,actual-docked.json,actual-docked.cjs,native-*.png,scrollbar-fix-firefox.json,fix-firefox-*.png}`: final independent acceptance.
- `panel-ux-integration/`: `browser-full-scrollport.log`, `full-report/`, `actual-docked.*`, native screenshots; earlier failed `browser-full-final.log` retained, not passing evidence.
- Earlier scoped roots `panel-layout-audit/`, `panel-layout-fix/`, `panel-layout-verification/`, `panel-state-headings/`; scrollbar `scrollbar-{audit,fix}-*` and gitignored Playwright reports contain repros/negative controls. Historical hashes: layout`a92e013`→geometry`ece6568`→headings`d315ce9`; scrollbar`fcea487`→fix`896675a`, accepted tip`20f7d4a`.

Isolated runtime copies used owned loopback ports and the fresh production build; some omitted unrelated Docker startup only after verifying existing site. Keep copied Playwright specs **outside unit discovery**. Failed shared-listener/old-worktree fixture runs are environment evidence, never clean full results; do not stop another session's server to make a gate pass. Current reproducible commands live in e2e README, not these temporary archives.
