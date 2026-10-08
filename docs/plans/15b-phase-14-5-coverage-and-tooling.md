# Phase 14.5 — Full feature coverage & new DevTools tooling

**Depends on:** P11, P12, P13, P14 (it extends their rows, cards and pages). **Runs:** as the **last phase before release** — after P14, right before P15 (hardening & release). **Effort:** L. **Parallelizable:** nothing inside the port while it runs.

> **Self-contained phase.** Every fact, decision, design and task for this phase lives in **this file only** — the master plan links here and adds nothing else. The raw research it is based on is `audit-feature-coverage.md` (full inventory of WP Rocket 3.23.5.1 against this tool's detection, verified from the plugin's source on 2026-10-07).

## 0. Sub-phase 1 — Decisions first (a gate, not a formality)

Nothing below is built before this sub-phase is done:

1. **Re-verify the audit's facts against the plugin's current release.** WP Rocket moves fast — the audit was made against `develop` @ 3.23.5.1. Walk `audit-feature-coverage.md` §2 (the feature-by-feature matrix) and confirm each cited footprint still exists in the plugin's then-current source. Anything that drifted gets corrected in this doc before the decisions are taken (README rule 6 — sources are moving targets).
2. **Take a decision per item** in the decision table below: **BUILD / DROP / DEFER** + one sentence of why. Fill the last column here.
3. **Confirm the exact on-screen spellings** for every new card/page label on a real WP Rocket install (the naming rule, master §4 #12), and record any correction here.

| Item | What it is (one line)                                                                                    | Default | Decision (fill during the phase) |
| ---- | -------------------------------------------------------------------------------------------------------- | ------- | -------------------------------- |
| D1   | New detection row: mobile cache (`mobile_cache`)                                                         | BUILD   |                                  |
| D2   | New detection row: DNS prefetch (`dns_prefetch`) + corrects the related mix-up in P11                    | BUILD   |                                  |
| D3   | New detection row: Combine JavaScript (`minify_concatenate_js`) — the feature still exists in the plugin | BUILD   |                                  |
| D4   | Stronger fingerprint for minify (`data-minify="1"`)                                                      | BUILD   |                                  |
| D5   | Stronger fingerprint for async CSS (`data-rocket-async="style"`)                                         | BUILD   |                                  |
| D6   | Delay-JS keeps each script's original `type` in `data-rocket-type` (record enrichment)                   | BUILD   |                                  |
| D7   | Self-host Google Fonts footprint corrections (style variant + non-hard-coded cache path)                 | BUILD   |                                  |
| T1   | New tool: "This page ± cache" diff probe (inside the Side-by-Side page)                                  | BUILD   |                                  |
| T2   | New panel page: Assets (one row per CSS/JS file with every transformation as chips)                      | BUILD   |                                  |
| T3   | Header-based detection upgrade: more hosting platforms + cache-layer cards (registry rows)               | BUILD   |                                  |
| T4   | Preloaded Resources page upgrade: everything the plugin asks the browser to warm up, grouped             | BUILD   |                                  |
| T5   | Beacon instruction-sheet viewer (decoded beacon config, inside P14's page)                               | BUILD   |                                  |
| T6   | RUCSS size metrics (inside P13's tester results)                                                         | BUILD   |                                  |
| T7   | Cache-age line on the Detections card (+ expiry hint when the Diagnoser report is available)             | BUILD   |                                  |
| T8   | Mobile-UA cache snapshot (refetch the page as a phone)                                                   | DEFER   |                                  |
| T9   | Speculation-rules viewer                                                                                 | DROP    |                                  |

The defaults are the audit's recommendations; the sub-phase may overturn any of them with a recorded reason. T8/T9 keep their audit verdicts (deferred / rejected — reasons in §2/§5) unless a decision row says otherwise.

---

## 1. The problem this phase solves (plain language)

WP Rocket has far more features than this tool detects today. Our detection currently covers **19** of them. The audit listed every option the plugin has, checked which ones leave readable traces on a page, and found: some traces we don't read yet (five new rows / three fingerprint upgrades), some questions that need a small tool rather than a row (diff probe, assets matrix, header cards…), and a set of features that genuinely leave **no** trace on a page and can never be detected from here (they stay covered by the Diagnoser report, which is where their state actually shows).

This phase lands all of that in one go — **after** the second-baseline phases (P11–P14) are done, **before** hardening. That late position is deliberate and cheap here: every card, strip chip and report line is registry-driven, so new detection rows land as data rows, not as edits sprinkled across pages.

**Counts to keep honest:** 19 rows exist when this phase starts → 27 when it ends (19 + D1, D2, D3 as rows + D4–D7 upgrades inside existing rows), plus the tools.

## 2. Detection upgrades (plain language, each verified in the plugin's source)

> **How to read the "How the tool knows" parts:** they cite the exact plugin source files read during the audit (2026-10-07). During Sub-phase 1 they are re-checked against the current release.

### D1 — Mobile cache (`mobile_cache`)

- **What you'll see:** a Detections card stating whether the site keeps a **separate cache for phones**, and which copy of the page you are looking at right now (the mobile copy or the desktop copy).
- **Why it matters:** "works on desktop, broken on mobile" is one of the most common WP Rocket support tickets. Today the tool can't tell which cache variant was served.
- **How the tool knows:** when the separate-mobile-files setting is on, the plugin stamps every page it optimizes with a hidden meta tag: `wpr_mobile` for phone-built copies, `wpr_desktop` for desktop-built copies (`inc/Engine/Support/Meta.php`, verified). The beacon's config also carries an `is_mobile` field saying which device is currently viewing — kept as **context** next to the card, not as proof.
- **What could go wrong:** none of the stamps appear when the setting is off — so the card has exactly three honest states: "separate mobile cache active (this page: mobile copy)", "…desktop copy", "not detected". It never guesses.
- **Result row:** `mobile_cache { present, variant: 'mobile' | 'desktop' | null, deviceContext: boolean }` + validator + registry entry.

### D2 — DNS prefetch (`dns_prefetch`) — and a correction to P11

- **What you'll see:** a card listing the domains the plugin told the browser to look up early ("Prefetch DNS requests").
- **Why it matters (and the mix-up):** the plan currently treats the plugin's `wpr_dns_prefetch` mark as a weak signal of the _Preconnect to external domains_ feature (P11). That is wrong — they are two different features:
  - **Prefetch DNS requests** is a hidden option (no settings field; filter `rocket_dns_prefetch` → `inc/front/dns-prefetch.php`, `inc/functions/options.php:149`) that emits **plain** `link[rel=dns-prefetch]` hints;
  - **Preconnect to external domains** (P1.1's row) emits links carrying `data-rocket-preconnect` / `data-rocket-prefetch` attributes.
- **How the tool knows:** the hidden meta key `wpr_dns_prefetch`, emitted under a verified condition (prefetch domains exist **and** (CDN off **or** more than one domain) — `Support/Meta.php`). Plain dns-prefetch links without the meta stay corroborating evidence only: themes and other plugins emit those too, so they never produce a verdict alone.
- **Result row:** `dns_prefetch { present, domains: string[] }` (domains only when observed as links; the meta alone → present with an empty list). P11's weak-key mapping for `wpr_dns_prefetch` is removed — this row owns it.

### D3 — Combine JavaScript (`minify_concatenate_js`)

- **What you'll see:** a card saying JS files are being **combined** into one (or few) merged files.
- **Why it matters:** the plan assumed this feature was gone (removed from the UI in older versions) — the audit proved it still exists in 3.23 (settings field "Combine JavaScript files" with "Excluded Inline JavaScript"). Pairing failures are a classic support topic: a combined file can break a site that minify alone didn't.
- **How the tool knows:** the plugin stamps combined output with its own meta-comment key `wpr_minify_concatenate_js` (`inc/Engine/Optimization/Minify/JS/Combine.php:135` — **this key is missing from P11's meta-key table; it is added by this phase**), and the combined file is a `<script src="…/cache/min/…" data-minify="1">` placed just before `</body>` (`:129`).
- **What could go wrong:** a combined file and a plain minified file look alike by URL — the meta key is the discriminator; without it the card stays "not detected".

### D4 — Minify gets a stronger fingerprint

- **What changes:** both minify checks (CSS and JS) gain `data-minify="1"` as their primary footprint — WP Rocket adds this attribute to its own minified `<link>` and `<script>` tags (`Minify/CSS/Minify.php:197`, `Minify/JS/Minify.php:265`, also on combined output). The existing `cache/min/<n>/` URL match stays as a second, weaker layer.
- **Why it matters:** the URL pattern alone can be spoofed by other tools writing to the same cache path; the attribute is WP-Rocket-specific.

### D5 — Async CSS gets a stronger fingerprint

- **What changes:** the async-CSS check (the "Fallback critical CSS" method behind Optimize CSS delivery) gains the swap markup `link[data-rocket-async="style"] … onload` as a footprint (`inc/Engine/CriticalPath/CriticalCSSSubscriber.php:749`), next to the existing inline-`wprRemoveCPCSS` script check. The plugin also stamps the feature `wpr_async_css` (`:618` — confirmed).

### D6 — Delay-JS records keep the script's original type

- **What changes:** when the plugin delays a script, it moves the script's original `type` into `data-rocket-type` (`inc/Engine/Optimization/DelayJS/HTML.php:249`). The detection's per-script record gains that original value, and the JavaScript page shows it (a "real type" detail on delayed rows) — today that information is destroyed by the transform.

### D7 — Self-host Google Fonts footprint corrections (P11 nuance)

- **What changes:** the self-host fonts footprint in P11 is corrected: (a) newer versions emit a `<style data-wpr-hosted-gf-parameters>` block, not only the `link` variant (`inc/Engine/Media/Fonts/Frontend/Controller.php:227` link, `:322` style); (b) the local assets live under `/cache/fonts/<blog-id>/…` (`inc/Engine/Media/Fonts/Filesystem.php:32`) — the plan's literal hard-codes blog `1`.

## 3. New tooling (plain language, all of it)

### T1 — "This page ± cache" diff probe ⭐ the flagship

- **The support story:** "What does WP Rocket actually change on THIS page?" Not in general — on the exact URL being debugged. One click: the tool fetches the same address with **`?nowprocket`** — the plugin's own documented switch that makes it skip everything (verified: `inc/API/bypass.php`, `rocket_bypass()` since 3.7) — and compares the two served pages: which optimizations appear only in the optimized copy, which scripts the plugin removed (that is where _Disable emoji_ and _Combine Google Fonts_ — features with no fingerprints of their own — finally become provable), which assets got renamed (minify/combine), which links changed (CDN).
- **Where it lives:** as a one-click preset + automatic diff summary inside the existing **Side-by-Side** page (P7's page already compares two URLs side by side — this is the same tool pointed at the same page twice). The diff summary is a plain list: per feature, "only present with cache" / "removed by the cache".
- **Permissions:** none beyond what exists — the extension already holds host permissions for every http/https site, and the fetch targets the page's own origin. (If a site's CSP blocks the page-context fetch, the background performs it; both paths are stated in the design, error states explicit.)
- **What it needs:** a pure diff engine (two parsed documents → list of differences grouped by feature) with golden tests; the side-by-side page gets the preset button + the summary section.

### T2 — Assets page (transformation matrix)

- **The support story:** "What happened to THIS file?" — the single most-asked question in support, today spread across three different pages. One row per CSS/JS resource on the page; chips on the row say everything the tool knows about that file: **Minified / Combined / Deferred / Delayed / Excluded (by the site's own exclusions or by this tool's markers) / Lazyloaded / Served from the CDN / Preloaded / Self-hosted fonts**. Search + the same filter-chip pattern as the existing pages.
- **Where it lives:** a new panel page (registry-driven, like all pages). It does **not** replace the JavaScript / Lazyload pages — those stay (parity); the Assets page is the per-file cross-feature view on top of them.
- **What it needs:** one small additive engine pass that builds the asset inventory (the checks already read every script/link; this adds one shared list), a pure matrix builder, and a **new budget row** in `scripts/budgets.json` (checked by `pnpm check:budgets`).

### T3 — Hosting & cache-layer detection upgrade (headers)

- **The support story:** "What's in front of this site?" — the Detections page already has Server + Known Platform cards (WP Engine, Kinsta, Hostinger) built from response headers. This extends that registry: **SiteGround** (`x-sg-optimizer`), **LiteSpeed**, **Cloudflare** (`cf-ray`, `cf-cache-status`), **Sucuri**, **Varnish**, and generic proxy-cache signals (`x-cache`, `age`, `x-proxy-cache`…), each a registry row verified against real hosting before it renders.
- **Honesty rule:** a header proves the host **layer** (e.g. "behind Cloudflare"), never the plugin's Cloudflare add-on state — the card wording says exactly that. No new capture: the headers are already collected for the tab.

### T4 — Preloaded Resources page upgrade

- **What changes:** the page (P6) grows from "images + fonts" to the full warm-up picture, grouped: **preloaded** resources (by type), **preconnect** links, **DNS-prefetch** hints (D2's row feeds it), and the beacon's instruction status beside them (see T5). Same filter/summary pattern.

### T5 — Beacon instruction-sheet viewer (folded into P14's page)

- **What it is:** the plugin writes a small inline JavaScript object (`rocket_beacon_data`) for its beacon — the instruction sheet: per-feature on/off (`status`), the elements it may collect, its exclusion lists, the mobile flag. P1.1 already parses the `status` map; this renders the **whole** decoded sheet as read-only JSON in P14's beacon page, next to the live tester's runs — "what the plugin told the beacon to do here", the ground truth behind the detection rows.

### T6 — RUCSS size metrics (folded into P13's tester results)

- **What it is:** in the RUCSS live tester's results, per-stylesheet and total sizes — original bytes vs the "shaken" used-CSS bytes the endpoint returns — plus a simple "would save ≈ X%" line. Pure math over data the tester already fetches.

### T7 — Cache-age line (Detections card subtitle)

- **What it is:** the cached card gains "this copy is N old" (the cache timestamp exists in the `wpr` row since P1); when the Diagnoser report was parsed (P7), it also shows "cache expires after ≈ N hours" (`cache_lifespan` from the report). Small subtitle logic — no new capture.

### Deferred & rejected (kept visible so nobody re-proposes them blindly)

- **T8 — Mobile-UA cache snapshot — DEFERRED:** it would require the extension to refetch the page while pretending to be a phone, which needs a request-header-override permission (`declarativeNetRequest`). That is a real permission cost, and the least-privilege rule says: don't until support demand materializes. The workarounds (documented manual flow: open a device-emulated tab and use the tool there) cover the need today. **Related note (2026-10-08):** a separate owner-committed phase, P16, added a per-tab mobile **simulation** — changing the live tab's UA identity, not snapshotting a page — which makes this manual flow trivial; T8's own decision stays as recorded here, and the two mechanisms must not be conflated.
- **T9 — Speculation-rules viewer — REJECTED:** WP Rocket 3.23.5.1 does not emit speculation rules — nothing in the plugin does (verified: the develop tree contains no such emission; the plugin's head engine only adds preconnect/preload items). Building a viewer for another plugin's territory would be inventing a feature.

## 4. Corrections this phase applies to earlier phase docs

All applied **by this phase** (the earlier docs get a one-line pointer, no rework there):

1. **P11 meta-key table:** add `wpr_minify_concatenate_js`; record that the verified real keys are `minify_css`, `minify_js`, `minify_concatenate_js`, `defer_js`, `delay_js`, `remove_unused_css`, `async_css`, `cdn`, `lazyload_images`, `lazyload_iframes`, `lazyload_css_bg_img`, `wpr_oci`, `wpr_automatic_lazy_rendering`, `wpr_auto_preload_fonts`, `wpr_preconnect_external_domains`, `wpr_image_dimensions`, plus the generator-map keys `wpr_preload_links`, `wpr_host_fonts_locally`, `wpr_dns_prefetch`, `wpr_mobile`/`wpr_desktop` (audit §3). Remove the `wpr_dns_prefetch`-as-preconnect-key mapping (superseded by D2).
2. **P11 self-host-fonts footprint:** style variant + `<blog-id>` path (D7).
3. **P11 merge verdicts:** minify checks gain `data-minify` (D4); `async_css` gains the swap attribute (D5); delay-JS records gain `data-rocket-type` (D6).
4. **P11 doc** gets one line: corrections to this doc's meta-key table and footprints are recorded and applied by P14.5 — no rework happens in P11.
5. **P6 cards / JS page / Preloaded page:** all extensions arrive as registry rows and data-driven sections (already the standing rule) — no page-by-page branching.

## 5. Implementation notes (architecture, brief)

- **Same patterns as P1.1/P11:** each new check = one registry row + boundary validator + engine check + fixture + **reference-engine lockstep** (the parity baseline implements the new checks independently, over the shared vocabulary from `lib/wp-rocket/` — the one-declaring-site rule and its sanctioned exception apply unchanged).
- **New naming:** row keys mirror the plugin's option/hidden-option ids (`mobile_cache` → the plugin's `do_caching_mobile_files` concept, `dns_prefetch`, `minify_concatenate_js`); labels follow master §4 #12 (exact settings wording, confirmed in Sub-phase 1).
- **No new permissions expected** (T1 reuses existing host permissions; T8 stays unbuilt). If a decision in Sub-phase 1 changes that, the why-comment goes into `wxt.config.ts` with the change.
- **Budgets:** the Assets page (T2) adds a budget row in `scripts/budgets.json`; every other item lives inside existing surfaces. `pnpm build && pnpm check:budgets` gates the phase.

## 6. Tests

- **Per detection item (D1–D7):** fixture pages (mobile/desktop meta variants, a `?nowprocket` variant, a prefetch-domains page, a combined-JS page, `data-minify` pages, the async-CSS swap page, the hosted-fonts style-variant page) + validator tables (hostile/malformed payloads rejected) + **reference-engine parity** on every new row.
- **Per tool:** golden tests on the pure cores — the diff engine (two documents → grouped difference list, including the feature attributions), the asset matrix builder (chips per file from existing detection results), the header classifier (platform/cache-layer rows, negative cases: headers absent → no card), the beacon-config decoder (hostile shapes rejected), the size-metrics math, the cache-age formatter (shared with P11's timestamp formatting rule).

## 7. Verification checklist

- [ ] Sub-phase 1 completed first: audit facts re-verified against the current plugin release; every decision row filled; label spellings confirmed on a real install and recorded.
- [ ] All quality gates green (`pnpm compile && pnpm lint && pnpm format:check && pnpm test`); `pnpm build && pnpm check:budgets` with the new Assets-page budget row.
- [ ] Real-site matrix (recorded results): (a) a site with separate mobile cache — desktop and phone visits both show their correct `mobile_cache` variant; (b) a site with prefetch domains — the `dns_prefetch` card lists them and never claims preconnect; (c) a combined-JS site — the new card is green while the minify card stays about minify only; (d) the ±cache diff on a busy page — emoji/Combine-Google-Fonts/custom-CDN attributions match reality; (e) a site behind Cloudflare or Sucuri — the platform/cache-layer cards fire with the layer-not-add-on wording; (f) a white-label install (meta stripped) — cards fall back to footprint evidence honestly.
- [ ] The 19 → 27 row count is real: every registry row renders on the Detections page, in the strip's chip set (P12's registry), and in the support report — one row, all surfaces.

## 8. Docs to update at the end of the phase

- README status table (P14.5 → ✅).
- Master plan: the delivered note in the §10 paragraph of this phase.
- AGENTS.md only if dependencies, permissions or structure changed (expected: none).
