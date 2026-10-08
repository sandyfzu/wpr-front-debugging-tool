# Phase 13.1 — RUCSS live-tester suites

**Depends on:** P4.1, P4.2, P13. **Effort:** S–M. **Parallelizable with:** P14 implementation.

## TLDR

Automate the RUCSS tester's round trip against the local site: the run contract (`#rucss_test_result_style` present, sheet size recorded), safelist/mobile/home variants, the failure-path matrix (offline run, mocked non-200, invalid regex), and the TEST MODE badge/chip once-per-run lifecycle.

## Suites

1. **Default run on the site:** a fixture page with styles → tester run → resulting page matches the port's same-page reference result; `document.querySelector('#rucss_test_result_style')` exists with the expected sheet size (recorded baseline).
2. **Variants:** the `safelist`/`mobile`/`home` configurations exercised (site config per round; endpoint-contract findings recorded in `endpoint.ts` as the P13 doc uses them).
3. **Failure paths:** runtime-offline round (styles intact, typed error surfaced); non-200 shapes (mocked at the harness route layer — the P13 doc's "record the how" item lands here, in the committed harness config); invalid replacement regex blocked pre-run with a report.
4. **TEST MODE lifecycle:** badge appears on the Detections card; the strip chip lands "(TEST MODE)" exactly once across repeat runs and both clear on reload (fixture round re-uses the site).
5. **Cross-browser fetch paths:** background fetch + no page-CORS assumptions verified on-chromium (both paths); Firefox runs stay manual (`dev:firefox` smoke), harness limitation recorded.

## Definition of done

- Suites green under `pnpm test:e2e`; P13's checklist annotated automated/manual; error reasons copy-reviewed in the doc (the copy item is a gate, not a suite).

## Stays manual

Production PSI/RUCSS-shaped external-service runs (P14.6 when the owner's external site enters scope); copy/wording acceptance.
