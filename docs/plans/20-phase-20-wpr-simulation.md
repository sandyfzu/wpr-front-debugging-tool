# P20: WP Rocket simulation on sites without the feature

## TLDR

Owner idea (2026-10-21): now that the extension can intercept and rewrite documents before parse (Chromium `chrome.debugger` + CDP `Fetch`, Firefox `filterResponseData` — P10), **simulate WP Rocket optimizations on a site where the feature is not active**. Use case: a customer reports a Delay JS problem; the support agent visits the site to reproduce it, but Delay JS is off and the customer won't share credentials — the extension "activates" Delay JS the way WP Rocket would (pure extension-side simulation) and the agent tries exclusions on top. Must compose with the exclusion builder: apply the simulated feature, then try exclusions, without the feature being active on the site. Placement undecided: inside the exclusion-builder overlay (the P10G tool-mode registry, `entrypoints/exclusion-overlay.content/modes.ts`, exists for exactly this kind of mode — no new UI) or the popup (its diagnoser use is blocked until the rebuilt plugin version ships, P7/P8).

Not P10's rejected G-3 "simulation fallback" (that was an approximation _instead of_ interception); P20 rides the interception.

**Depends:** P10 (session pipeline seam + overlay mode registry), P10K (WP Rocket stored/runtime row semantics — simulated features must match exclusions the same way). **Train slot: owner to confirm.** Only P20A is planned; later sub-phases are planned by P20A. Stack: installed; P20A decides any addition (none expected).

## P20A — Investigate, plan, settle decisions (no product code)

Depends:P10 (shipped seams), P10K.1 (runtime inventory reused). Parallel: any phase (docs + scratch only). Goal: a decision record answering every question below with evidence (plugin source anchors, live docker-site runs, dated), plus P20B+ planned in this doc in the repo's phase format. Owner-explicit: no investigation before this sub-phase starts.

Questions the investigation must answer:

1. **Features and order:** Delay JS first (owner use case); which next (Defer JS, Lazyload, Automatic Lazy Rendering, RUCSS-like via P13's TEST MODE?) and which are out of reach (server-side work: cache, minify/combine on the server, critical CSS generation needing the SaaS).
2. **Fidelity source:** WP Rocket's own PHP transforms (e.g. `DelayJS/HTML.php`) and its delay-js runtime script, pinned to a WP Rocket version; what "same as WP Rocket" means for each feature and how it is proven (diff against the docker site with the feature really on, same page).
3. **Licensing:** reusing WP Rocket's JS (GPL) inside this extension vs reimplementing; distribution/store implications; owner/legal sign-off needed?
4. **Composition with the P10 session:** simulation as pipeline transforms ordered before the exclusion transforms (simulate → un-optimize per exclusion); one session record; Reset/Stop/G-5 persistence semantics; report shape (what was simulated vs excluded).
5. **Already-active detection:** how a page that already has the feature live is detected (detection vocabulary in `lib/wp-rocket/`, `data-wpr-features` meta) and handled — refuse, no-op with a note, or exclusions-only.
6. **Placement:** overlay tool mode vs popup vs panel — UX, discoverability, interplay with the builder lanes; the decision lists rejected options with reasons.
7. **Per-browser feasibility:** Chromium CDP body rewrite + injected runtime script (CSP of the target page, nonce/hash, `script-src` blocking an injected inline script); Firefox streaming filter; any degradations declared explicitly (no half-working feature).
8. **Performance budgets:** transform wall time (P10B wall-time contract), added bytes per surface (`scripts/budgets.json` rows), page-load overhead of the simulated runtime.
9. **Honest status:** indicator words for "simulated, not the site's real configuration" everywhere (overlay, panel status row), so results are never mistaken for the live site's behavior (UX-D6).
10. **Versioning:** tracking WP Rocket releases — pinned version shown to the user, how updates are detected and re-verified (reuse P10K's PHP parity harness?).
11. **Test strategy:** pure transform tests from a fixture table cross-checked against the real plugin (P10K.2 pattern), docker-site comparisons (feature truly on vs simulated), local e2e arms (P10.1 harness), Firefox manual arms.

Deliverables:

- [ ] Decision record in this doc (one dated block per question: answer, evidence, rejected options).
- [ ] P20B+ sub-phases written here: each small, independently reviewable, with Depends/Parallel/Goal/checklist/DoD/effort·difficulty; stack/dependency additions stated with verified latest-stable versions.
- [ ] Owner decisions listed as explicit gates (licensing, placement, train slot).

DoD: every question answered or explicitly gated on the owner; follow-up sub-phases planned; README + master updated with the confirmed slot. Effort M · difficulty medium.

## P20B+ — to be planned by P20A
