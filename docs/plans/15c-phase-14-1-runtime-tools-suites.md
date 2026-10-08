# Phase 14.1 — Live analysis tools suites

**Depends on:** P4.1, P4.2, P14 (+P13's executor pattern landed). **Effort:** M. **Parallelizable with:** P14.5.

## TLDR

Automate P14's beacon/LCP/script-runtime tools on the local site: the no-host-artifacts contract, LCP highlight apply/revert style diffs, the `data-rocket-status` pending→executed flip on a delayed page, and the dynamic-import network contract (no beacon bytes until a run).

## Suites

1. **Dynamic-import contract:** before any tool run, the beacon chunk is absent from the network log (chunk-splitting verified per the P14 doc's trace item); after a run, cleanup leaves nothing.
2. **Beacon run hygiene:** the marked element never gains our completion artifacts; pre/post state of `[data-name="wpr-wpr-beacon"]` compared; no console logs from the harness path (the port's cleanup decisions made policy).
3. **LCP breakdown:** highlight border applied → reverted exactly (style diff before/after); sub-parts comparable to the site's real LCP event on the fixture page (the inspector-side parity judgment stays manual, P11.1's constraint).
4. **Script runtime view:** the delayed-page fixture (P4.2 mu-plugin) interacts to trigger Delay JS → statuses flip `pending`→`executed` deterministically; the re-run reflects the flip; grouped script tables render per the classification contract (P14's fixture corpus feeds counts).
5. **Cross-browser:** supported-entry checks and chunk behavior on Chromium asserted; Firefox outcomes recorded manually (`dev:firefox`) per harness limitation.

## Definition of done

- Suites green under `pnpm test:e2e`; P14's checklist annotated; the inspector-side parity comparisons documented as manual with reason (they require the other extension's dev build).

## Stays manual

Inspector side-by-side parity judgment; production-site beacon depth decisions; Firefox runtime.
