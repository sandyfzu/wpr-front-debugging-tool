# Phase 7.1 — Diagnoser browser suites

**Depends on:** P4.1, P4.2, P7 (site needs the Support Diagnoser plugin — P4.2 holds the install slot). **Effort:** S. **Parallelizable with:** P8–P10 implementation.

## TLDR

Automate P7's site-driven checks against the local WP site: both Diagnoser tabs' field/badge sets with the plugin active, the not-detected state when it isn't, the inactive-WP-Rocket state — plus fixture-driven degenerate shapes and the keyboard/axe passes.

## Suites

1. **Plugin-active captures:** panel pages seeded by real site captures (P4.2 site + diagnoser plugin) → General Info + Optimizations Info fields/badges match what the plugin exposes on the same page load (assert source: dev-override capture made live during the run, then asserted in the direct panel page — same approach as P5.1/P6.1).
2. **Degenerate states:** unsupported WP → supported-but-inactive → not-detected (plugin absent), each asserted from the state contract rather than eyeballed; the doc's fixture-driven UI shapes replayed.
3. **Keyboard + a11y:** tablist semantics and disclosures operated under keyboard-only automation; axe run per state.

## Definition of done

- Suites green under `pnpm test:e2e`; P7's checklist annotated; site-idle state recorded so runs are repeatable.

## Stays manual

Fine-visual parity judgment vs a real production site (the P7 doc's side-by-side-on-real-site item remains with the owner when that site is in play — P14.6 if external).
