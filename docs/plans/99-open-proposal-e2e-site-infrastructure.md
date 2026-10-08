# OPEN PROPOSAL — E2E site infrastructure (absorbed into the master plan)

**Status: absorbed.** The owner settled this on 2026-10-08 and it now lives in the plan as
**P4.1** (harness), **P4.2** (dockerized local WP site + `apvm`-built WP Rocket + mu-plugin
fixtures + preinstalled KC conflict plugins) and **P4.3** (retro browser suites) —
`docs/plans/05b/05c/05d` — plus the future-scoped **P14.6** external-site track
(`docs/plans/15d`), the last test step before release. Master-plan §3 documents the
browser-test track and the owner's CI rule (no e2e lane; E2E is local-only). This file stays
for decision history only.

## Decisions (owner, 2026-10-08)

1. **Local WordPress test site in-repo via Docker Compose is the default target**
   (`docker/` directory — not yet created):
   - WordPress + MariaDB + wp-cli bootstrap; wp-admin test credentials in a git-ignored `.env`.
   - WP Rocket built into the image from the `apvm` CLI (`apvm build`, pinned tag/branch as
     needed). Docker-domain activation behavior is sorted empirically at harness build —
     verified then, never asserted from memory.
   - Preinstalled free Known-Conflicts plugins (filter the 121 plugin rows in
     `lib/known-conflicts/known-conflicts-db.json` to wp.org-installable names) so the
     Known Conflicts scan gets real `plugins.php` matches.
   - **Fixture strategy: mu-plugins** (owner-delegated call) — code-driven deterministic
     problem injection that self-resets and survives cache reloads, no admin-UI state to keep
     in sync: undefined references via Delay JS / Defer JS, `data-rocket-status` states,
     beacon fields, real plugin-table rows.
   - Slot for the diagnoser plugin (P7) and future panel-surface smoke pages.
   - Optional HTTPS via mkcert (http-only is functional — the extension matches `http://*/*`).
2. **External real test site — future scope only**, for flows a local container cannot fake
   (e.g. live external-service runs): credentials supplied by the owner in the git-ignored
   `.env` (harness reads them, never logs them); owner may later provide a disposable-site
   spawner once refined.
3. **CI: no e2e lane.** E2E stays a locally-invocable command (`pnpm test:e2e`), headed Chromium
   with the unpacked extension loaded. Unit/coverage tier remains the CI gate.
4. **Secrets hygiene already applied:** `.env` / `.env.*` (keeping `.env.example`) added to
   `.gitignore` immediately (owner instruction, good-practice-now).

## What this unlocks (reclassification of the former "cannot automate" list)

- Automatable with the local site: wp-admin/plugins.php Known-Conflicts scan, header capture on
  real main-frame responses, toolbar-badge pipeline, WPR presence/caching states (`?nowprocket`),
  detection summary push, Delay/Defer-caused undefined-references capture, follow-the-file flows
  through future panel surfaces (P5+), diagnoser plugin flows (P7).
- Stays manual: HelpScout (owner's mailbox/tickets), visual + subjective verdicts (palette,
  perceived speed), web-store/publication checks, OS-level environmental accidents, live PSI
  page-production runs (fixture-served instead).

## When

Parallel infrastructure track; most valuable from P5 on (the panel consumes the data flows).
Nothing earlier blocks it.

## Suggested shape when wired (owner's planning rules)

Small, independently reviewable sub-phases, e.g. **P16.1** docker site + fixtures + `apvm`-built
WP Rocket, **P16.2** Playwright harness + first fixture-page suite (`pnpm test:e2e`), local-only.
Exact numbering/spilit decided at wiring time.
