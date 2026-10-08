# Phase 14.6 — External-site track (future-scoped; the last test phase before release)

**Depends on:** P4.1, P14.5. **Effort:** S at decision time. **Parallelizable with:** nothing (sequenced immediately before P15).

## TLDR

The home for browser tests that need **something a local container cannot fake**: production-shaped external services and live external-site behavior (live PSI framing, real CDN/cache-signature environments, anything the P4.2 site under-simulates). Sequenced as the final test phase before P15, and deliverable **only when the owner's external test site / disposable-site spawner is in play** — otherwise it records a documented scope skip with the reason.

## Scope mechanism (owner decision, 2026-10-08)

- The owner supplies the external site (credentials via the git-ignored `.env`, or the disposable-site spawner once refined). The harness reads credentials, never logs them.
- At this phase's start: enumerate flows that proved un-fakeable during P4.x–P14.1 (each tagged "external" in those Suites), port the achievable ones as suites against the real site, and record the survivors as manual.
- If the owner's site is not available by then: mark the phase **skipped-by-scope**, fold the survivors into P15's manual checklist, and record why — never silently.

## Expected contents (from the current checks' shape; finalized at execution)

1. **Live external-service flows:** real PSI-style runs (P4.1/P4.3 stubs stay in place as the offline regression tier).
2. **Production-shaped cache signatures:** real CDN/header behavior for the stripped-signature matrix (P11.1's route-stripped variant keeps the offline tier).
3. **Any "works-live" caveats** the interim suites flagged with an external tag during implementation.

## Definition of done

- Either: suites against the external site green locally + survivors recorded; or: skip entry in this doc + P15 manual rows updated. No other output.
- Store-facing checks (web-store policy review) remain P15's regardless.

## Stays manual (structurally)

HelpScout mailbox flows; visual/subjective verdicts; publication checks; OS-level environmental accidents. These never enter this track — they are owner-verdict items by nature.
