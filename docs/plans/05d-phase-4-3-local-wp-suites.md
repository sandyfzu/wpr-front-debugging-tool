# Phase 4.3 — Local-site browser suites (retroactive coverage of P2–P4)

**Depends on:** P4.1, P4.2. **Effort:** M. **Parallelizable with:** P5 implementation.

## TLDR

The WordPress-backed half of the retroactive test track: run P2–P4's real-site behaviors through the P4.1 harness against the P4.2 site — header capture on real responses, the badge pipeline, Known-Conflicts scans and DB flows over real plugin tables, the improvements entry on wp-admin, side-by-side on genuinely cached pages. Includes the permanent regression pin for the header-capture wiring the P2 audit caught (dead glue that no unit gate could see).

## Suites (each names its assert source)

1. **Header capture — the permanent pin.** Navigate real pages (fixture + normal) → from the SW context request `getPageHeaders` → validated row pairs returned (P1 shape), tab-scoped; tabless/malformed senders ignored (assert from the SW side); a navigation clears/supersedes a tab's rows; `null` when the tab never produced headers.
2. **Badge pipeline.** Real processed page → `{wprPresent, cached}` summary push → `chrome.action.getBadgeText/BackgroundColor` per state (cached → green, present-but-uncached → blue, non-WPR → gray — the badge states every processed page) via CDP; navigation clears then re-sets; `features.toolbarBadge` flip in `sync:options` clears/shows without a service-worker restart.
3. **Known Conflicts over real rows.** `plugins.php` with preinstalled conflict plugins → badge count + list entries match the committed DB rows for those plugins; zero-finding page → the empty state after a settled scan; DB flow: empty storage → the serve path (ask) triggers a refresh and returns rows; a storage `watch` update re-scans an open page **without reload**; offline-first-boot → seed-into-storage path produces the snapshot rows unstamped.
4. **Data-hub on the real site.** `[WPR FDT] Page data processed in X ms` format; no page-content logging (console sweep: only the whitelisted, non-content lines); `rocket-allScriptsLoaded` window-event path flips the flag observable in the panels' absence via the log contract.
5. **Improvements on wp-admin.** Option on → the D-bugger admin-bar link appears; off (flip via storage + reload) → gone; idempotent on re-render (builds the node once).
6. **Side-by-Side on the real site.** Message-driven open on a cached page vs a `?nowprocket=1` visit → the two frames carry the correct URLs; close restores scroll; per-side refresh works (reload same-origin; `src` reassignment cross-origin variant). Context-menu _clicks_ and the psi-host flow stay in the manual row.

## Definition of done

- All six suites green in `pnpm test:e2e` (site reset between groups so runs are order-independent).
- Every parent phase doc (03/04) records: "site checklists now covered by P4.3 suites for the named items; remainder manual".
- A rerun of the P2 audit's BLOCKER check (built worker calls the capture store) is deliberate here — the suite fails if the glue unwires again.

## Stays manual (recorded, from the parent checklists)

120-tab memory bound, HelpScout conversations, PSI production pages, context-menu click ergonomics, extension-reload-mid-page stale-capture behavior (CDP-driven reload remains feasible but is a stretch item — attempted last, recorded if flaky).
