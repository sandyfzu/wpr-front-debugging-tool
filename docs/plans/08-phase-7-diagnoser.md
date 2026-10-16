# P7: Diagnoser and P7.1 suites

## TLDR

**Deferred until rebuilt Support Diagnoser JSON is available.** Parser/extraction already ship; adapt them to v2 before rendering. Execute **after P14.6, before P5J/P15**; reserved nav row remains disabled/explained until then. Technical dependencies:P1/P5/P6+rebuilt plugin; independent P8/P9/parked P10 need not wait. Installed WXT/Solid/TS, shared UI/JSON tree, Vitest/Playwright; no planned dependency additions.

## Reference and retained requirements

First-baseline DiagnoserPage, GeneralInfoPage/utility/cards, OptimizationsInfoPage/OptimizationInfoItem. Capture v2 fixtures before deciding exact fields; preserve source behaviors where still meaningful:

- General: post-meta disabled-option banner only nonempty; plugin status/WPR+Diagnoser versions/Imagify/querystrings/user-agent; server load/web server/PHP and WP memory limits; constants; preload-RUCSS task/parameter rows; options minus version, filters minus null.
- Pure general/optimization models entry-local, defensive optional access with explicit fallback. Server load formatted percent or couldn't-get, status based on **actual load**, not serverInfo object. Constants WP_CACHE true→ok, DONOT* false→ok, others neutral. No conditional React hook/module-cache patterns.
- Option status1/true active,0/false off,other warn; native names via option map. Preserve empty-array **Empty Array**, empty string/null/undefined **Empty**, boolean0/1 option Active/Inactive, other String. Filters do not inherit inappropriate option status semantics.37-char label cap/full tooltip; real array item vs explicitly labeled string-character counts.
- Shared APG General/Optimizations tabs, default General; one page-store selection across route switches and sessionStorage across panel reload (extension). Plugin absent/not detected and WP Rocket inactive get distinct helpful original states/copy (native naming/typo rule still wins).
- Dense general card grid; copy user-agent/JSON, bounded collapsible JsonValue, no highlighter JSON dumps. Optimization cards expanded by default; nested array/long values consistently collapsed behind count, both Options/Filters honor toggle (source arrays ignored it). Expanding one card doesn't rebuild siblings.

## Small execution slices

- **P7A model/parser:** deps rebuilt plugin+P1; parallel none. Capture v2 JSON, adapt validators/extraction additively, pure field/value/status models. DoD: captured/missing/null/unknown fields, post-meta/server/constants/status/count/truncation tests green, no sensitive-data regression.
- **P7B pages:** depsA/P5/P6; parallel independent P8/P9. Tabs/cards/not-detected/inactive/persistence and copy above. DoD: render/state/focus/tab/disclosure tests, UI bar §D and bundle gates green.
- **P7.1 suites:** depsB/P4.1/P4.2+plugin install slot. Parallel independent P8–P10 technical work. Real site capture→panel fields/badges both tabs; unsupported/inactive/plugin-absent/degenerate fixture states; keyboard+axe every state. DoD: repeatable plugin/site preconditions, local suites green, same-page source comparison and manual fine-visual/Firefox outcomes identified, no fake store presented as real capture.

All slices run master gates; parser unknown fields documented in TSDoc. Final acceptance: same meaningful fields/badges as source on same plugin/page, deliberate v2 deltas recorded; rebuild-required gate never bypassed by coding against obsolete shape.
