# Phase 16.3 — Side-by-Side mobile comparison: the engaged device shown in the bar

**Depends on:** P16.2 (05g — shipped 2026-10-12; the simulation, its states and its UI exist). **Effort:** S.
**Doc number:** the 05-family slot after 05g; the phase number continues the P16.x run (16 → 16.1 → 16.2). **Suites:** rides `tests/e2e/suites/site-side-by-side.spec.ts` (the 05f rows 3–4 surface) — no new suite.

## TLDR

While the mobile comparison is engaged (the machine's `presentation === 'phone'`), the overlay bar now states **what** is being simulated, next to the "Mobile comparison" switch: **`Generic Android phone`**. The name becomes a `displayName` field on the one-device profile in `lib/device-simulation/profiles.ts` (the concept's single declaring site — no display name exists anywhere today), and the overlay renders it as one `<Show>`-gated accent tag reusing the existing `.sbs-mobile-tag` style. No new module, no state, no persistence, no new dependency.

## Verified facts (code read 2026-10-12)

| Fact                                                                                                                                                                                                                                   | Source                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The device profile is one row — `id`/`userAgent`/`viewport`; **no human-readable device name exists** anywhere in `lib/device-simulation/` or the overlay                                                                              | `lib/device-simulation/profiles.ts:10-36`                                                                                                                                   |
| The UA identity is the profile's string itself (DNR header + page-world shadow); the label must derive from the profile, never from parsing the UA                                                                                     | `lib/device-simulation/rule.ts`, `lib/device-simulation/identity.ts:86,186`                                                                                                 |
| "Engaged" in the machine is precisely `presentation === 'phone'`, which mirrors the truthful session (`mirrorOf`) and survives the reload-restore boot path — no extra state needed                                                    | `lib/side-by-side/mobile-sim.ts:7-13,105-111,30-45`; restore: `entrypoints/isolated.content/side-by-side/index.tsx:483-495` → `openOverlay:288-339` → `simMachine.open:321` |
| The switch renders under `Show when={props.sim().available === true}`; the engaged accessor `phone()` exists; active-state mini-marks already ship: the `· mobile` side tags (style `.sbs-mobile-tag`) and failure notes (`.sbs-note`) | `entrypoints/isolated.content/side-by-side/ui.tsx:70,140-164`; `side-by-side.css:152-166`                                                                                   |
| The bar wraps (`flex-wrap`, side labels `flex: 1` absorb width); narrow-window wrap is already the recorded acceptable behavior from 05g's round                                                                                       | `side-by-side.css:39-61`; 05g round item 6                                                                                                                                  |
| Strings are plain inline literals (no i18n layer): "Cached", "· mobile", switch title — the label follows that pattern; the constant single-declares the name in `lib/device-simulation/`                                              | `ui.tsx:105,107,143`                                                                                                                                                        |
| Budget: isolated content script ≤ 95 raw / 34 gzip (`budgets` row), last measured 92.4/32.5 at B6; a string + `Show` + reused class is a fraction of a KiB                                                                             | `scripts/budgets.json:26-31`; 05g Shipped record                                                                                                                            |
| The engaged-session e2e helper `expectPhoneSession` already polls the settled session and is used by the reload-continuity row — the label assert extends that one helper and covers the restore path for free                         | `tests/e2e/suites/site-side-by-side.spec.ts:284-323`                                                                                                                        |
| Unit tier: no `.test.tsx` component-test harness exists repo-wide; the overlay view is thin glue — its rendering pins live in the e2e tier (AGENTS.md glue exemption), while the pure descriptor gets the unit pin                     | repo glob (no `*.test.tsx`); `profiles.test.ts` pins the profile row exactly                                                                                                |

## Design

### Wording — `Generic Android phone` (recommended)

The simulated device is one honest generic phone: the profile UA carries the reduced-UA `Android` + `Mobile` (phone-class) tokens — what real Chrome on Android sends and what UA decisions listen for — and the frame is a 412×892 portrait phone viewport, with the plugin's mobile decision rendering the phone copy. Evaluation of candidates:

| Candidate                 | Verdict                                                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Generic Android phone`   | **Recommended.** Platform + class stated honestly; "phone" (not "device") cannot be misread as covering a tablet-class profile the tool deliberately does not simulate. 21 chars — the bar wraps with minimal impact. |
| `Generic Android device`  | The user's verbatim example — accurate but "device" invites the tablet/desktop misread. Kept as the fallback if the owner pins the literal example.                                                                   |
| `Phone · generic 412×892` | Numbers in the bar are noise; the size already lives in the switch's title tooltip and the frames show it. Rejected.                                                                                                  |
| `Generic device`          | Loses the platform — the Android UA choice is a real, meaningful fact. Rejected.                                                                                                                                      |

### Structure — smallest that fits existing patterns

1. **`lib/device-simulation/profiles.ts`** — add one field to the one row (the owner of the device concept; additive, no consumer changes):

```ts
export interface DeviceProfile {
  // … existing fields
  /** The user-facing name of the simulated device (the overlay's engaged-device tag). */
  displayName: string;
}
```

value `displayName: 'Generic Android phone'` with a TSDoc note recording why "phone" (UA phone-class tokens + phone viewport; wording changes are recorded, never drifted).

2. **`entrypoints/isolated.content/side-by-side/ui.tsx`** — inside the mobile switch's `<label>`, after the switch text:

```tsx
<span class="sbs-switch-text">Mobile comparison</span>
<Show when={phone()}>
  <span class="sbs-mobile-tag">{DEVICE_SIMULATION_PROFILE.displayName}</span>
</Show>
```

Inside the switch label (not a bare sibling) so screen readers announce the engaged device as part of the switch's name and it enlarges the click target benignly. Gated strictly on the settled `phone()` presentation — the identical gate as the `· mobile` side marks, so it also shows in the "still active but refused" failure branch, where the requests truly still carry the phone UA and the warn text already says so. The label never renders on the PSI host (the enclosing `availability Show` gates it), never while the switch is hidden (engine without DNR), and an effectively closed overlay is invisible (`visibility: hidden`) — no further guards.

3. **`side-by-side.css`** — no new rules: reuse `.sbs-mobile-tag` (accent token, 11px, nowrap, valid on both palettes); update the class comment to name both marks (side labels + the device tag). The switch's `gap: 6px`/`white-space: nowrap` make the label+tag one wrap unit inside the wrapping bar.

Theme safety is inherited from the tokens (`--accent` background-agnostic, as the existing side marks prove); shadow isolation unchanged (everything is already inside the shadow root).

### State, correctness, provenance

- Derived purely from `props.sim().presentation` — no snapshot change, no protocol change, no persisted change (`features.sbsMobileSim` untouched; the label is a read-only rendering).
- The reload-continuity path needs nothing: the boot restore calls `simMachine.open`, the presentation converges to the truthful session, and the label follows the same memo the switch already does.
- Preferred over any name derived from `navigator.userAgent`/the UA string: the profile is the concept's owner, and the UA is a network identity, not a label composer.

## Tests

- **Unit (ships with C1):** `lib/device-simulation/profiles.test.ts` — the exact-equality pin of the single row gains `displayName: 'Generic Android phone'` (a wording change is then a deliberate edit) plus a non-empty assertion. No other unit target: the rendering is thin glue (repo has no component-test harness; the exemption is deliberate, recorded here).
- **E2e (ships with C3):** `tests/e2e/suites/site-side-by-side.spec.ts` — extend `expectPhoneSession` to assert the device tag is visible next to the engaged switch (a locator over the `.sbs-mobile-tag` in the switch area, e.g. a dedicated assertion counting the tag and asserting its text) and that it is absent in an off/`'auto'` branch (a small assertion riding the existing switch-off step of the mobile block). Because the reload-continuity row re-runs `expectPhoneSession` after `page.reload`, the restore path is covered automatically. Suite rows 3–4 of 05f are the standing surface (their record is updated, never silently skipped).
- **Gates:** `pnpm compile && pnpm lint && pnpm format:check && pnpm test`, then `pnpm build && pnpm check:budgets` after C2/C3.
- **Budget:** isolated content script headroom ≈ 1.7 KiB raw / ≈ 1.1 KiB gzip over the 95/34 ceiling (last measured 92.4/32.5; task-check ~93.3/32.9); the expected cost is ~0.1–0.3 KiB raw (string constant + `Show` + reused class). Budgets untouched unless the gate legitimately breaches — re-derivation with reasons then, per the gate's documented path.

## Phases

| Phase  | Does                                                                                                                                                                                                                                                                                                    | Depends | Parallelizable                                                               | Definition of done                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | `DeviceProfile.displayName` field + row value + TSDoc; `profiles.test.ts` pin extended                                                                                                                                                                                                                  | —       | C2 is a direct follow-up (sequential commits; the constant must exist first) | gates green; the profile row exact-pinned with the name                                                                                                                         |
| **C2** | `ui.tsx` device tag in the switch (imports the profile constant); `.sbs-mobile-tag` class comment extended, no new CSS rules                                                                                                                                                                            | C1      | —                                                                            | gates green; visual check both palettes (dark/light) + narrow window (wraps, no trap); PSI host unaffected (the tag is unreachable there — the outer availability `Show` holds) |
| **C3** | e2e row: `expectPhoneSession` + off-branch extension; local run of `site-side-by-side.spec.ts` (the P4.2 site); `pnpm build && pnpm check:budgets` (measured recorded); docs: README Documents+Status rows, master-plan §8 SBS-mobile row wording (visibility gained the device tag), 05f rows 3–4 note | C1, C2  | —                                                                            | full local e2e green incl. the reload-continuity row; the auto-flow (PSI) row unchanged; budgets pass or documented re-derivation                                               |

## Risks & open questions

- **Bar space/wrap (recorded, visible):** the bar gains ~21 characters in its middle; the switch label is nowrap so label+tag wrap as one unit, and side labels (`flex: 1`) absorb the rest — the worst case is one extra wrapped row on a very narrow window, the behavior 05g's round already recorded as acceptable. Deliberately one tag, not per-side (the side `· mobile` marks already carry per-half state).
- **Wording approval (open question):** `Generic Android phone` is recommended; the owner may pin the exact verbatim `Generic Android device` — a one-constant edit with the same structure either way.

## Stack

No new dependencies (verified: solid-js `Show` already imported in `ui.tsx`; the constant is plain TS). Vitest (unit pin), Playwright over the P4.2 local site (e2e, existing suite), Chrome tokens CSS (shared classes).
